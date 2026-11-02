// 从本机 Zotero 数据目录导入（只读复制 zotero.sqlite，不改动 Zotero）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db, tx, now, setSetting, DATA_DIR } from './db.js';
import { indexText } from './fulltext.js';

const ANN_TYPES = { 1: 'highlight', 2: 'note', 3: 'image', 4: 'ink', 5: 'underline', 6: 'text' };
const LINK_MODES = { 0: 'imported_file', 1: 'imported_url', 2: 'linked_file', 3: 'linked_url', 4: 'embedded_image' };

export function defaultZoteroDir() {
  const d = path.join(os.homedir(), 'Zotero');
  return fs.existsSync(path.join(d, 'zotero.sqlite')) ? d : '';
}

function baseAttachmentPath() {
  // 读取 Zotero prefs.js 里的相对附件根目录
  try {
    const profiles = path.join(process.env.APPDATA || path.join(os.homedir(), '.zotero'), 'Zotero', 'Zotero', 'Profiles');
    for (const p of fs.readdirSync(profiles)) {
      const prefs = path.join(profiles, p, 'prefs.js');
      if (!fs.existsSync(prefs)) continue;
      const m = fs.readFileSync(prefs, 'utf8').match(/user_pref\("extensions\.zotero\.baseAttachmentPath",\s*"([^"]+)"\)/);
      if (m) return m[1].replace(/\\\\/g, '\\');
    }
  } catch { /* 无 */ }
  return '';
}

export function importZotero(zoteroDir, { onProgress } = {}) {
  const src = path.join(zoteroDir, 'zotero.sqlite');
  if (!fs.existsSync(src)) throw new Error(`没有找到 ${src}`);
  const tmp = path.join(DATA_DIR, 'zotero-import.sqlite');
  fs.copyFileSync(src, tmp);
  const z = new DatabaseSync(tmp, { readOnly: true });
  const q = (s, ...a) => z.prepare(s).all(...a);
  const base = baseAttachmentPath();
  const stats = { items: 0, updated: 0, notes: 0, attachments: 0, annotations: 0, collections: 0, tags: 0, skipped: 0 };

  const types = new Map(q('SELECT itemTypeID, typeName FROM itemTypesCombined').map((r) => [r.itemTypeID, r.typeName]));
  const fieldNames = new Map(q('SELECT fieldID, fieldName FROM fieldsCombined').map((r) => [r.fieldID, r.fieldName]));
  const creatorTypes = new Map(q('SELECT creatorTypeID, creatorType FROM creatorTypes').map((r) => [r.creatorTypeID, r.creatorType]));
  const items = q('SELECT itemID, itemTypeID, key, dateAdded, dateModified FROM items WHERE libraryID = 1');
  const deleted = new Set(q('SELECT itemID FROM deletedItems').map((r) => r.itemID));
  const fields = new Map();
  for (const r of q('SELECT d.itemID, d.fieldID, v.value FROM itemData d JOIN itemDataValues v USING(valueID)')) {
    if (!fields.has(r.itemID)) fields.set(r.itemID, {});
    let v = String(r.value);
    // Zotero 内部日期格式："2024-05-00 05/2024" → 取用户输入的原文
    const name = fieldNames.get(r.fieldID);
    if (/date$/i.test(name) && name !== 'accessDate') {
      const m = v.match(/^\d{4}-\d{2}-\d{2} (.+)$/);
      if (m && !/^\d{2}:\d{2}/.test(m[1])) v = m[1];
    }
    fields.get(r.itemID)[name] = v;
  }
  const creators = new Map();
  for (const r of q('SELECT ic.itemID, c.firstName, c.lastName, c.fieldMode, ic.creatorTypeID FROM itemCreators ic JOIN creators c USING(creatorID) ORDER BY ic.itemID, ic.orderIndex')) {
    if (!creators.has(r.itemID)) creators.set(r.itemID, []);
    const ct = creatorTypes.get(r.creatorTypeID) || 'author';
    creators.get(r.itemID).push(r.fieldMode === 1 ? { creatorType: ct, name: r.lastName } : { creatorType: ct, lastName: r.lastName, firstName: r.firstName });
  }
  const notes = new Map(q('SELECT itemID, parentItemID, note FROM itemNotes').map((r) => [r.itemID, r]));
  const atts = new Map(q('SELECT * FROM itemAttachments').map((r) => [r.itemID, r]));
  const anns = q('SELECT * FROM itemAnnotations');
  const tagsByItem = new Map();
  for (const r of q('SELECT it.itemID, t.name, it.type FROM itemTags it JOIN tags t USING(tagID)')) {
    if (!tagsByItem.has(r.itemID)) tagsByItem.set(r.itemID, []);
    tagsByItem.get(r.itemID).push({ tag: r.name, type: r.type });
  }
  const zKey = new Map(items.map((r) => [r.itemID, r.key]));

  const result = tx(() => {
    const idMap = new Map(); // zotero itemID → 本地 id
    const existing = new Map(db.prepare('SELECT id, key, dateModified FROM items').all().map((r) => [r.key, r]));
    const upsert = (zi, data) => {
      const ex = existing.get(zi.key);
      if (ex) {
        idMap.set(zi.itemID, ex.id);
        if (zi.dateModified <= ex.dateModified) { stats.skipped++; return null; }
        db.prepare('UPDATE items SET itemType=?, fields=?, creators=?, note=?, contentType=?, linkMode=?, path=?, dateModified=?, deleted=? WHERE id=?')
          .run(data.itemType, JSON.stringify(data.fields || {}), JSON.stringify(data.creators || []), data.note ?? null, data.contentType ?? null, data.linkMode ?? null, data.path ?? null, zi.dateModified, deleted.has(zi.itemID) ? 1 : 0, ex.id);
        stats.updated++;
        return ex.id;
      }
      const r = db.prepare('INSERT INTO items(key, itemType, fields, creators, note, contentType, linkMode, path, dateAdded, dateModified, deleted, lastRead) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(zi.key, data.itemType, JSON.stringify(data.fields || {}), JSON.stringify(data.creators || []), data.note ?? null, data.contentType ?? null, data.linkMode ?? null, data.path ?? null, zi.dateAdded, zi.dateModified, deleted.has(zi.itemID) ? 1 : 0, data.lastRead ?? null);
      const id = Number(r.lastInsertRowid);
      idMap.set(zi.itemID, id);
      stats.items++;
      return id;
    };

    const parents = new Map();
    let n = 0;
    for (const zi of items) {
      const type = types.get(zi.itemTypeID);
      if (type === 'annotation') continue;
      onProgress?.(++n, items.length);
      let data = { itemType: type, fields: fields.get(zi.itemID) || {}, creators: creators.get(zi.itemID) || [] };
      if (type === 'note') {
        const nt = notes.get(zi.itemID);
        data = { itemType: 'note', note: nt?.note || '', fields: {} };
        if (nt?.parentItemID) parents.set(zi.itemID, nt.parentItemID);
        stats.notes++;
      } else if (type === 'attachment') {
        const a = atts.get(zi.itemID);
        if (!a) continue;
        let p = a.path || '';
        if (p.startsWith('storage:')) p = path.join(zoteroDir, 'storage', zi.key, p.slice(8));
        else if (p.startsWith('attachments:')) p = base ? path.join(base, p.slice(12)) : p.slice(12);
        data = { itemType: 'attachment', fields: fields.get(zi.itemID) || {}, contentType: a.contentType, linkMode: LINK_MODES[a.linkMode] || 'linked_file', path: p || null, lastRead: a.lastRead ? new Date(a.lastRead * 1000).toISOString().replace('T', ' ').slice(0, 19) : null };
        if (a.parentItemID) parents.set(zi.itemID, a.parentItemID);
        stats.attachments++;
      } else if (!data.fields.title && !data.creators.length && !type) continue;
      const id = upsert(zi, data);
      if (id) {
        db.prepare('DELETE FROM itemTags WHERE itemId = ?').run(id);
        for (const t of tagsByItem.get(zi.itemID) || []) db.prepare('INSERT OR IGNORE INTO itemTags VALUES(?,?,?)').run(id, t.tag, t.type);
      }
    }
    for (const [child, parent] of parents) {
      if (idMap.has(child) && idMap.has(parent)) db.prepare('UPDATE items SET parentId = ? WHERE id = ?').run(idMap.get(parent), idMap.get(child));
    }

    // 分类
    const colRows = q('SELECT collectionID, collectionName, parentCollectionID, key, clientDateModified FROM collections WHERE libraryID = 1');
    const colMap = new Map();
    const exCols = new Map(db.prepare('SELECT id, key FROM collections').all().map((r) => [r.key, r.id]));
    for (const c of colRows) {
      if (exCols.has(c.key)) {
        db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(c.collectionName, exCols.get(c.key));
        colMap.set(c.collectionID, exCols.get(c.key));
      } else {
        const r = db.prepare('INSERT INTO collections(key, name, dateAdded) VALUES(?,?,?)').run(c.key, c.collectionName, c.clientDateModified || now());
        colMap.set(c.collectionID, Number(r.lastInsertRowid));
        stats.collections++;
      }
    }
    for (const c of colRows) {
      if (c.parentCollectionID && colMap.has(c.parentCollectionID)) db.prepare('UPDATE collections SET parentId = ? WHERE id = ?').run(colMap.get(c.parentCollectionID), colMap.get(c.collectionID));
    }
    for (const r of q('SELECT collectionID, itemID FROM collectionItems')) {
      if (colMap.has(r.collectionID) && idMap.has(r.itemID)) db.prepare('INSERT OR IGNORE INTO collectionItems VALUES(?,?)').run(colMap.get(r.collectionID), idMap.get(r.itemID));
    }

    // 关联条目
    const pred = new Map(q('SELECT predicateID, predicate FROM relationPredicates').map((r) => [r.predicateID, r.predicate]));
    const keyToLocal = new Map([...idMap].map(([zid, lid]) => [zKey.get(zid), lid]));
    for (const r of q('SELECT itemID, predicateID, object FROM itemRelations')) {
      if (pred.get(r.predicateID) !== 'dc:relation') continue;
      const k = r.object.split('/').pop();
      if (idMap.has(r.itemID) && keyToLocal.has(k)) {
        const a = idMap.get(r.itemID), b = keyToLocal.get(k);
        if (a !== b) { db.prepare('INSERT OR IGNORE INTO relations VALUES(?,?)').run(a, b); db.prepare('INSERT OR IGNORE INTO relations VALUES(?,?)').run(b, a); }
      }
    }

    // 注释
    const exAnn = new Map(db.prepare('SELECT key, dateModified FROM annotations').all().map((r) => [r.key, r.dateModified]));
    const itemInfo = new Map(items.map((r) => [r.itemID, r]));
    for (const a of anns) {
      const zi = itemInfo.get(a.itemID);
      if (!zi || !idMap.has(a.parentItemID)) continue;
      const tags = JSON.stringify((tagsByItem.get(a.itemID) || []).map((t) => t.tag));
      const type = ANN_TYPES[a.type] || 'highlight';
      if (exAnn.has(zi.key)) {
        if (zi.dateModified > exAnn.get(zi.key)) db.prepare('UPDATE annotations SET type=?, text=?, comment=?, color=?, pageLabel=?, sortIndex=?, position=?, tags=?, dateModified=? WHERE key=?').run(type, a.text, a.comment, a.color, a.pageLabel, a.sortIndex, a.position, tags, zi.dateModified, zi.key);
        continue;
      }
      db.prepare('INSERT INTO annotations(key, attachmentId, type, text, comment, color, pageLabel, sortIndex, position, tags, dateAdded, dateModified) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(zi.key, idMap.get(a.parentItemID), type, a.text, a.comment, a.color, a.pageLabel, a.sortIndex, a.position, tags, zi.dateAdded, zi.dateModified);
      stats.annotations++;
    }

    // 标签颜色
    const tc = q("SELECT value FROM syncedSettings WHERE setting = 'tagColors' AND libraryID = 1")[0];
    if (tc) {
      try {
        JSON.parse(tc.value).forEach((t, i) => db.prepare('INSERT OR REPLACE INTO tagColors VALUES(?,?,?)').run(t.name, t.color, i));
      } catch { /* 忽略 */ }
    }
    stats.tags = db.prepare('SELECT COUNT(DISTINCT tag) n FROM itemTags').get().n;
    return idMap;
  });
  z.close();
  fs.rmSync(tmp, { force: true });
  setSetting('zoteroDataDir', zoteroDir);
  setSetting('lastZoteroImport', now());
  // 后台导入 Zotero 已有的全文缓存
  setImmediate(() => importFulltextCache(zoteroDir, result, zKey));
  return stats;
}

function importFulltextCache(zoteroDir, idMap, zKey) {
  const done = new Set(db.prepare('SELECT itemId FROM fulltextStatus').all().map((r) => r.itemId));
  for (const [zid, lid] of idMap) {
    if (done.has(lid)) continue;
    const cache = path.join(zoteroDir, 'storage', zKey.get(zid) || '', '.zotero-ft-cache');
    try {
      if (fs.existsSync(cache)) indexText(lid, fs.readFileSync(cache, 'utf8'));
    } catch { /* 跳过 */ }
  }
}
