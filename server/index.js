import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  db, tx, now, STORAGE_DIR, serializeAll, serializeCollections, getItem, getRawItem, createItem, updateItem,
  setTags, addRelation, removeRelation, getSetting, setSetting, serializeAnnotation, resolveAttachmentPath, newKey,
} from './db.js';
import { lookupIdentifier, recognizePdf, lookupDOI, lookupArxiv, ARXIV_RE } from './metadata.js';
import { listStyles, loadStyles, formatBibliography, formatCitation, exportAs, parseCitations, shortCitation } from './cite.js';
import { cslToItem } from './csl.js';
import { importZotero, defaultZoteroDir } from './zoteroImport.js';
import { indexAll, indexAttachment, searchFulltext, fulltextStats } from './fulltext.js';
import { exportAnnotatedPdf } from './pdfExport.js';
import { translate, LANGUAGES } from './translate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
app.use(express.json({ limit: '50mb' }));

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(e.status || 500).json({ error: e.message || String(e) });
});
const children = (id) => db.prepare('SELECT id FROM items WHERE parentId = ?').all(id).map((r) => r.id);
const withChildren = (ids) => {
  const out = new Set();
  for (const id of ids) { out.add(id); for (const c of children(id)) out.add(c); }
  return [...out];
};
const items = (ids) => ids.map(getItem).filter(Boolean);

// —— 文库 ——
app.get('/api/library', wrap((req, res) => {
  res.json({
    items: serializeAll(),
    collections: serializeCollections(),
    tagColors: db.prepare('SELECT tag, color, position FROM tagColors ORDER BY position').all().map((r) => ({ ...r })),
    savedSearches: db.prepare('SELECT * FROM savedSearches').all().map((s) => ({ ...s, conditions: JSON.parse(s.conditions) })),
  });
}));

app.post('/api/items', wrap((req, res) => {
  const b = req.body;
  const id = tx(() => createItem({ ...b, fields: b.fields || {}, creators: b.creators || [] }));
  res.json(getItem(id));
}));

app.patch('/api/items/:id', wrap((req, res) => {
  const id = +req.params.id;
  tx(() => updateItem(id, req.body));
  const touched = [id, ...(req.body.relations ? db.prepare('SELECT b FROM relations WHERE a = ?').all(id).map((r) => r.b) : [])];
  res.json({ items: items([...new Set([...touched, ...(req.body.relationsRemoved || [])])]) });
}));

app.post('/api/items/batch', wrap((req, res) => {
  const { ids, op, collectionId, tag, parentId } = req.body;
  let touched = ids;
  const removed = [];
  tx(() => {
    for (const id of ids) {
      if (op === 'trash') { for (const c of withChildren([id])) updateItem(c, { deleted: true }); }
      else if (op === 'restore') {
        updateItem(id, { deleted: false });
        const p = getRawItem(id)?.parentId;
        if (p) updateItem(p, { deleted: false });
      } else if (op === 'delete') {
        for (const c of withChildren([id])) {
          const row = getRawItem(c);
          if (row?.path?.startsWith('storage:')) fs.rmSync(path.join(STORAGE_DIR, row.key), { recursive: true, force: true });
          removed.push(c);
        }
        db.prepare('DELETE FROM items WHERE id = ?').run(id);
      } else if (op === 'addToCollection') db.prepare('INSERT OR IGNORE INTO collectionItems VALUES(?, ?)').run(collectionId, id);
      else if (op === 'removeFromCollection') db.prepare('DELETE FROM collectionItems WHERE collectionId = ? AND itemId = ?').run(collectionId, id);
      else if (op === 'addTag') db.prepare('INSERT OR IGNORE INTO itemTags VALUES(?, ?, 0)').run(id, tag);
      else if (op === 'removeTag') db.prepare('DELETE FROM itemTags WHERE itemId = ? AND tag = ?').run(id, tag);
      else if (op === 'setParent') updateItem(id, { parentId: parentId ?? null });
    }
  });
  if (op === 'trash' || op === 'restore') touched = withChildren(ids);
  if (op === 'restore') touched = [...new Set([...touched, ...ids.map((i) => getRawItem(i)?.parentId).filter(Boolean)])];
  if (op === 'delete') return res.json({ removed });
  res.json({ items: items(touched) });
}));

app.post('/api/trash/empty', wrap((req, res) => {
  const ids = db.prepare('SELECT id FROM items WHERE deleted = 1').all().map((r) => r.id);
  const removed = [];
  tx(() => {
    for (const id of ids) {
      const row = getRawItem(id);
      if (!row) continue;
      for (const c of withChildren([id])) {
        const r = getRawItem(c);
        if (r?.path?.startsWith('storage:')) fs.rmSync(path.join(STORAGE_DIR, r.key), { recursive: true, force: true });
        removed.push(c);
      }
      db.prepare('DELETE FROM items WHERE id = ?').run(id);
    }
  });
  res.json({ removed });
}));

app.post('/api/items/:id/duplicate', wrap((req, res) => {
  const src = getItem(+req.params.id);
  const id = tx(() => createItem({ itemType: src.itemType, fields: src.fields, creators: src.creators, tags: src.tags, collections: req.body.collectionId ? [req.body.collectionId] : src.collections }));
  res.json(getItem(id));
}));

// 合并重复条目：子条目、标签、分类、关联转移到主条目，其余移入回收站
app.post('/api/items/merge', wrap((req, res) => {
  const { masterId, otherIds, fields } = req.body;
  tx(() => {
    const master = getItem(masterId);
    const tags = new Map(master.tags.map((t) => [t.tag, t]));
    const cols = new Set(master.collections);
    const rels = new Set(master.relations);
    for (const oid of otherIds) {
      const o = getItem(oid);
      o.tags.forEach((t) => tags.set(t.tag, t));
      o.collections.forEach((c) => cols.add(c));
      o.relations.forEach((r) => r !== masterId && rels.add(r));
      db.prepare('UPDATE items SET parentId = ? WHERE parentId = ?').run(masterId, oid);
      updateItem(oid, { deleted: true });
    }
    updateItem(masterId, { fields: fields || master.fields, tags: [...tags.values()], collections: [...cols], relations: [...rels].filter((r) => !otherIds.includes(r)) });
  });
  const ids = withChildren([masterId, ...otherIds]);
  res.json({ items: items(ids) });
}));

app.post('/api/items/:id/relate', wrap((req, res) => {
  const id = +req.params.id;
  const { otherId, remove } = req.body;
  tx(() => (remove ? removeRelation(id, otherId) : addRelation(id, otherId)));
  res.json({ items: items([id, otherId]) });
}));

// —— 文件 ——
function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180) || 'file';
}
function storeFile(buf, filename, { parentId = null, contentType = 'application/pdf', title } = {}) {
  const key = newKey('items');
  const name = safeName(filename);
  fs.mkdirSync(path.join(STORAGE_DIR, key), { recursive: true });
  fs.writeFileSync(path.join(STORAGE_DIR, key, name), buf);
  return createItem({ key, itemType: 'attachment', parentId, contentType, linkMode: 'imported_file', path: `storage:${name}`, fields: { title: title || (contentType === 'application/pdf' ? 'PDF' : name) } });
}
const mimeOf = (name) => ({ pdf: 'application/pdf', epub: 'application/epub+zip', html: 'text/html', htm: 'text/html', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }[name.split('.').pop().toLowerCase()] || 'application/octet-stream');

app.post('/api/upload', express.raw({ type: '*/*', limit: '500mb' }), wrap((req, res) => {
  const filename = decodeURIComponent(req.get('x-filename') || 'file.pdf');
  const parentId = req.query.parentId ? +req.query.parentId : null;
  const collectionId = req.query.collectionId ? +req.query.collectionId : null;
  const contentType = mimeOf(filename);
  const id = tx(() => {
    const aid = storeFile(req.body, filename, { parentId, contentType, title: parentId ? undefined : filename.replace(/\.[^.]+$/, '') });
    if (!parentId && collectionId) db.prepare('INSERT OR IGNORE INTO collectionItems VALUES(?, ?)').run(collectionId, aid);
    return aid;
  });
  res.json(getItem(id));
  if (contentType === 'application/pdf') setTimeout(() => indexAttachment(id).catch(() => {}), 500);
}));

app.post('/api/items/:id/link-file', wrap((req, res) => {
  const { filePath, url, title } = req.body;
  const parentId = +req.params.id || null;
  const id = tx(() => (url
    ? createItem({ itemType: 'attachment', parentId, linkMode: 'linked_url', contentType: 'text/html', fields: { title: title || url, url, accessDate: now().slice(0, 10) } })
    : createItem({ itemType: 'attachment', parentId, linkMode: 'linked_file', contentType: mimeOf(filePath), path: filePath, fields: { title: title || path.basename(filePath) } })));
  res.json(getItem(id));
}));

app.get('/api/file/:id', wrap((req, res) => {
  const row = getRawItem(+req.params.id);
  if (!row) return res.status(404).end();
  if (row.linkMode === 'linked_url') return res.redirect(JSON.parse(row.fields).url);
  const file = resolveAttachmentPath(row);
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: '找不到文件', path: file });
  res.setHeader('Cache-Control', 'no-cache');
  if (req.query.download) res.attachment(path.basename(file));
  res.sendFile(path.resolve(file), { dotfiles: 'allow' });
}));

app.get('/api/file-key/:key', wrap((req, res) => {
  const row = db.prepare('SELECT id FROM items WHERE key = ?').get(req.params.key);
  if (!row) return res.status(404).end();
  res.redirect(`/api/file/${row.id}`);
}));

app.get('/api/file/:id/exists', wrap((req, res) => {
  const row = getRawItem(+req.params.id);
  const file = resolveAttachmentPath(row);
  res.json({ exists: !!file && fs.existsSync(file), path: file });
}));

app.post('/api/items/:id/show-file', wrap((req, res) => {
  const file = resolveAttachmentPath(getRawItem(+req.params.id));
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: '找不到文件' });
  if (process.platform === 'win32') spawn('explorer.exe', [`/select,${path.resolve(file)}`], { detached: true });
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [process.platform === 'darwin' ? '-R' : path.dirname(file), ...(process.platform === 'darwin' ? [file] : [])], { detached: true });
  res.json({ ok: true });
}));

app.post('/api/items/:id/open-external', wrap((req, res) => {
  const file = resolveAttachmentPath(getRawItem(+req.params.id));
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: '找不到文件' });
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '""', path.resolve(file)], { detached: true, windowsVerbatimArguments: false });
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [file], { detached: true });
  res.json({ ok: true });
}));

// 根据父条目元数据重命名文件（仅限本应用管理的文件）
app.post('/api/items/:id/rename-from-parent', wrap((req, res) => {
  const row = getRawItem(+req.params.id);
  if (!row?.path?.startsWith('storage:') || !row.parentId) return res.status(400).json({ error: '只能重命名本应用存储的、有父条目的文件' });
  const parent = getItem(row.parentId);
  const first = parent.creators[0];
  const y = (parent.fields.date || '').match(/\d{4}/)?.[0];
  const ext = path.extname(row.path);
  const name = safeName([first ? first.lastName || first.name : '', y, parent.fields.title].filter(Boolean).join(' - ').slice(0, 150)) + ext;
  const dir = path.join(STORAGE_DIR, row.key);
  fs.renameSync(path.join(dir, row.path.slice(8)), path.join(dir, name));
  updateItem(row.id, { path: `storage:${name}` });
  res.json({ items: items([row.id]) });
}));

// —— 元数据 ——
async function createFromMetadata(meta, { collectionId, parentFor } = {}) {
  return tx(() => {
    const id = createItem({ itemType: meta.itemType, fields: meta.fields, creators: meta.creators, tags: meta.tags || [], collections: collectionId ? [collectionId] : [] });
    if (parentFor) {
      updateItem(parentFor, { parentId: id, silent: true });
      db.prepare('DELETE FROM collectionItems WHERE itemId = ?').run(parentFor);
    }
    return id;
  });
}

app.post('/api/identify', wrap(async (req, res) => {
  const { identifiers, collectionId } = req.body;
  const list = String(identifiers).split(/[\n\r]+|(?<=\S)\s{2,}/).map((s) => s.trim()).filter(Boolean);
  const created = [];
  const errors = [];
  for (const idf of list) {
    try {
      const meta = await lookupIdentifier(idf);
      const id = await createFromMetadata(meta, { collectionId });
      created.push(id);
    } catch (e) { errors.push(`${idf}：${e.message}`); }
  }
  res.json({ items: items(created), errors });
}));

app.post('/api/items/:id/recognize', wrap(async (req, res) => {
  const id = +req.params.id;
  const row = getRawItem(id);
  const file = resolveAttachmentPath(row);
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: '找不到文件' });
  const meta = await recognizePdf(file).catch(() => null);
  if (!meta) return res.json({ recognized: false });
  const collections = db.prepare('SELECT collectionId FROM collectionItems WHERE itemId = ?').all(id).map((r) => r.collectionId);
  const pid = await createFromMetadata(meta, { parentFor: id });
  tx(() => { for (const c of collections) db.prepare('INSERT OR IGNORE INTO collectionItems VALUES(?, ?)').run(c, pid); updateItem(id, { fields: { ...JSON.parse(row.fields), title: 'PDF' }, silent: true }); });
  res.json({ recognized: true, items: items([pid, id]) });
}));

// 根据 DOI / arXiv 更新元数据
app.post('/api/items/:id/refresh', wrap(async (req, res) => {
  const it = getItem(+req.params.id);
  const f = it.fields;
  const ax = (f.archiveID || f.url || '').match(ARXIV_RE) || (f.url || '').match(/arxiv\.org\/abs\/([\d.]+)/);
  const meta = f.DOI && !/arxiv/i.test(f.DOI) ? await lookupDOI(f.DOI) : ax ? await lookupArxiv(ax[1]) : f.DOI ? await lookupDOI(f.DOI) : await lookupIdentifier(f.title || '');
  tx(() => updateItem(it.id, { itemType: meta.itemType, fields: { ...f, ...meta.fields, extra: f.extra || meta.fields.extra }, creators: meta.creators.length ? meta.creators : it.creators }));
  res.json({ items: items([it.id]) });
}));

// 查找可用 PDF：arXiv / OpenAlex 开放获取
app.post('/api/items/:id/find-pdf', wrap(async (req, res) => {
  const it = getItem(+req.params.id);
  const f = it.fields;
  const urls = [];
  const ax = (f.archiveID || f.url || f.DOI || '').match(/(\d{4}\.\d{4,5})/);
  if (ax && /arxiv/i.test(f.archiveID + f.url + f.DOI + f.repository)) urls.push(`https://arxiv.org/pdf/${ax[1]}`);
  if (f.DOI) {
    try {
      const r = await fetch(`https://api.openalex.org/works/doi:${encodeURIComponent(f.DOI)}`, { signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const w = await r.json();
        for (const loc of [w.best_oa_location, ...(w.locations || [])]) if (loc?.pdf_url) urls.push(loc.pdf_url);
      }
    } catch { /* 无 */ }
  }
  for (const u of [...new Set(urls)]) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 MyZotero' }, signal: AbortSignal.timeout(60000), redirect: 'follow' });
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || buf.subarray(0, 5).toString() !== '%PDF-') continue;
      const id = tx(() => storeFile(buf, `${(f.title || 'paper').slice(0, 80)}.pdf`, { parentId: it.id, title: 'Full Text PDF' }));
      setTimeout(() => indexAttachment(id).catch(() => {}), 500);
      return res.json({ found: true, items: items([id]) });
    } catch { /* 下一个 */ }
  }
  res.json({ found: false });
}));

// —— 分类 ——
app.post('/api/collections', wrap((req, res) => {
  const r = db.prepare('INSERT INTO collections(key, name, parentId, dateAdded) VALUES(?, ?, ?, ?)').run(newKey('collections'), req.body.name, req.body.parentId ?? null, now());
  res.json({ collections: serializeCollections(), id: Number(r.lastInsertRowid) });
}));
app.patch('/api/collections/:id', wrap((req, res) => {
  const id = +req.params.id;
  if ('name' in req.body) db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(req.body.name, id);
  if ('parentId' in req.body) {
    // 防止移动到自己的子孙下
    let p = req.body.parentId;
    while (p) { if (p === id) return res.status(400).json({ error: '不能移动到自身的子分类中' }); p = db.prepare('SELECT parentId FROM collections WHERE id = ?').get(p)?.parentId; }
    db.prepare('UPDATE collections SET parentId = ? WHERE id = ?').run(req.body.parentId ?? null, id);
  }
  res.json({ collections: serializeCollections() });
}));
app.delete('/api/collections/:id', wrap((req, res) => {
  const id = +req.params.id;
  const desc = [id];
  for (let i = 0; i < desc.length; i++) desc.push(...db.prepare('SELECT id FROM collections WHERE parentId = ?').all(desc[i]).map((r) => r.id));
  let touched = [];
  tx(() => {
    const its = db.prepare(`SELECT DISTINCT itemId FROM collectionItems WHERE collectionId IN (${desc.map(() => '?').join(',')})`).all(...desc).map((r) => r.itemId);
    if (req.query.deleteItems) for (const i of withChildren(its)) updateItem(i, { deleted: true });
    db.prepare('DELETE FROM collections WHERE id = ?').run(id);
    touched = withChildren(its);
  });
  res.json({ collections: serializeCollections(), items: items(touched) });
}));

// —— 标签 ——
app.post('/api/tags/rename', wrap((req, res) => {
  const { from, to } = req.body;
  const ids = db.prepare('SELECT itemId FROM itemTags WHERE tag = ?').all(from).map((r) => r.itemId);
  tx(() => {
    for (const id of ids) { db.prepare('DELETE FROM itemTags WHERE itemId = ? AND tag = ?').run(id, from); db.prepare('INSERT OR IGNORE INTO itemTags VALUES(?, ?, 0)').run(id, to); }
    db.prepare('UPDATE tagColors SET tag = ? WHERE tag = ?').run(to, from);
    for (const a of db.prepare("SELECT id, tags FROM annotations WHERE tags LIKE ?").all(`%${JSON.stringify(from).slice(1, -1)}%`)) {
      db.prepare('UPDATE annotations SET tags = ? WHERE id = ?').run(JSON.stringify(JSON.parse(a.tags).map((t) => (t === from ? to : t))), a.id);
    }
  });
  res.json({ items: items(ids) });
}));
app.post('/api/tags/delete', wrap((req, res) => {
  const { tags } = req.body;
  const ids = new Set();
  tx(() => {
    for (const t of tags) {
      db.prepare('SELECT itemId FROM itemTags WHERE tag = ?').all(t).forEach((r) => ids.add(r.itemId));
      db.prepare('DELETE FROM itemTags WHERE tag = ?').run(t);
      db.prepare('DELETE FROM tagColors WHERE tag = ?').run(t);
    }
  });
  res.json({ items: items([...ids]) });
}));
app.post('/api/tags/color', wrap((req, res) => {
  const { tag, color, position } = req.body;
  tx(() => {
    if (!color) db.prepare('DELETE FROM tagColors WHERE tag = ?').run(tag);
    else {
      const rows = db.prepare('SELECT tag FROM tagColors WHERE tag != ? ORDER BY position').all(tag).map((r) => r.tag);
      rows.splice(Math.min(position ?? rows.length, rows.length), 0, tag);
      db.prepare('INSERT OR REPLACE INTO tagColors VALUES(?, ?, 0)').run(tag, color);
      rows.forEach((t, i) => db.prepare('UPDATE tagColors SET position = ? WHERE tag = ?').run(i, t));
    }
  });
  res.json({ tagColors: db.prepare('SELECT tag, color, position FROM tagColors ORDER BY position').all().map((r) => ({ ...r })) });
}));

// —— 注释 ——
app.get('/api/annotations/:attachmentId', wrap((req, res) => {
  res.json(db.prepare('SELECT * FROM annotations WHERE attachmentId = ? ORDER BY sortIndex').all(+req.params.attachmentId).map(serializeAnnotation));
}));
app.get('/api/annotations', wrap((req, res) => {
  // 所有注释（用于标签/检索）
  res.json(db.prepare('SELECT id, key, attachmentId, type, text, comment, color, pageLabel, tags FROM annotations').all().map((a) => ({ ...a, tags: JSON.parse(a.tags) })));
}));
app.post('/api/annotations', wrap((req, res) => {
  const a = req.body;
  const t = now();
  const r = db.prepare('INSERT INTO annotations(key, attachmentId, type, text, comment, color, pageLabel, sortIndex, position, tags, dateAdded, dateModified) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(newKey('annotations'), a.attachmentId, a.type, a.text ?? null, a.comment ?? null, a.color ?? null, a.pageLabel ?? null, a.sortIndex ?? null, JSON.stringify(a.position), JSON.stringify(a.tags || []), t, t);
  res.json(serializeAnnotation(db.prepare('SELECT * FROM annotations WHERE id = ?').get(Number(r.lastInsertRowid))));
}));
app.patch('/api/annotations/:id', wrap((req, res) => {
  const id = +req.params.id;
  const sets = [];
  const vals = [];
  for (const k of ['type', 'text', 'comment', 'color', 'pageLabel', 'sortIndex']) if (k in req.body) { sets.push(`${k} = ?`); vals.push(req.body[k]); }
  if (req.body.position) { sets.push('position = ?'); vals.push(JSON.stringify(req.body.position)); }
  if (req.body.tags) { sets.push('tags = ?'); vals.push(JSON.stringify(req.body.tags)); }
  sets.push('dateModified = ?'); vals.push(now());
  db.prepare(`UPDATE annotations SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
  res.json(serializeAnnotation(db.prepare('SELECT * FROM annotations WHERE id = ?').get(id)));
}));
app.post('/api/annotations/delete', wrap((req, res) => {
  tx(() => { for (const id of req.body.ids) db.prepare('DELETE FROM annotations WHERE id = ?').run(id); });
  res.json({ ok: true });
}));

app.get('/api/items/:id/export-pdf', wrap(async (req, res) => {
  const row = getRawItem(+req.params.id);
  const file = resolveAttachmentPath(row);
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: '找不到文件' });
  const anns = db.prepare('SELECT * FROM annotations WHERE attachmentId = ?').all(row.id).map(serializeAnnotation);
  const buf = await exportAnnotatedPdf(file, anns);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file).replace(/\.pdf$/i, '') + ' (annotated).pdf')}`);
  res.end(buf);
}));

// —— 保存的搜索 ——
app.post('/api/searches', wrap((req, res) => {
  const r = db.prepare('INSERT INTO savedSearches(key, name, conditions) VALUES(?, ?, ?)').run(newKey('savedSearches'), req.body.name, JSON.stringify(req.body.conditions));
  res.json({ id: Number(r.lastInsertRowid), key: '', name: req.body.name, conditions: req.body.conditions });
}));
app.patch('/api/searches/:id', wrap((req, res) => {
  if (req.body.name) db.prepare('UPDATE savedSearches SET name = ? WHERE id = ?').run(req.body.name, +req.params.id);
  if (req.body.conditions) db.prepare('UPDATE savedSearches SET conditions = ? WHERE id = ?').run(JSON.stringify(req.body.conditions), +req.params.id);
  res.json({ ok: true });
}));
app.delete('/api/searches/:id', wrap((req, res) => {
  db.prepare('DELETE FROM savedSearches WHERE id = ?').run(+req.params.id);
  res.json({ ok: true });
}));

// —— 设置 ——
app.get('/api/settings/:key', wrap((req, res) => res.json({ value: getSetting(req.params.key) })));
app.put('/api/settings/:key', wrap((req, res) => { setSetting(req.params.key, req.body.value); res.json({ ok: true }); }));

// —— 全文 ——
app.get('/api/fulltext/search', wrap((req, res) => res.json(searchFulltext(String(req.query.q || '')))));
app.get('/api/fulltext/status', wrap((req, res) => res.json(fulltextStats())));
app.post('/api/fulltext/index', wrap((req, res) => { indexAll(); res.json(fulltextStats()); }));
app.post('/api/fulltext/index/:id', wrap(async (req, res) => res.json({ ok: await indexAttachment(+req.params.id) })));

// —— 翻译 ——
app.get('/api/translate/languages', wrap((req, res) => res.json(LANGUAGES)));
app.post('/api/translate', wrap(async (req, res) => res.json(await translate(req.body))));

// —— 引文 / 导入导出 ——
app.get('/api/styles', wrap((req, res) => res.json(listStyles())));
app.post('/api/styles/reload', wrap((req, res) => { loadStyles(); res.json(listStyles()); }));
app.post('/api/styles/install', wrap((req, res) => {
  const { name, xml } = req.body;
  if (!/<style[\s>]/.test(xml)) return res.status(400).json({ error: '不是有效的 CSL 样式文件' });
  const dir = path.join(path.dirname(STORAGE_DIR), 'styles');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, safeName(name).replace(/\.csl$/i, '') + '.csl'), xml);
  loadStyles();
  res.json(listStyles());
}));

const ordered = (ids) => ids.map(getItem).filter((i) => i && i.itemType !== 'note' && i.itemType !== 'attachment');
app.post('/api/cite', wrap((req, res) => {
  const { ids, style = 'apa', mode = 'bibliography', format = 'html', lang = 'en-US' } = req.body;
  const its = ordered(ids);
  if (!its.length) return res.json({ html: '', text: '' });
  const fn = mode === 'citation' ? formatCitation : formatBibliography;
  res.json({ html: fn(its, style, 'html', lang), text: fn(its, style, 'text', lang) });
}));
app.post('/api/cite/short', wrap((req, res) => {
  const it = getItem(req.body.id);
  res.json({ text: it ? shortCitation(it, req.body.page) : '' });
}));

app.post('/api/export', wrap((req, res) => {
  const { ids, format } = req.body;
  const its = ordered(ids);
  if (format === 'csv') {
    const cols = ['key', 'itemType', 'title', 'creators', 'date', 'publication', 'volume', 'issue', 'pages', 'DOI', 'url', 'abstractNote', 'tags', 'dateAdded'];
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = its.map((i) => [i.key, i.itemType, i.fields.title, i.creators.map((c) => c.name || `${c.lastName}, ${c.firstName}`).join('; '), i.fields.date, i.fields.publicationTitle || i.fields.proceedingsTitle || i.fields.bookTitle || '', i.fields.volume, i.fields.issue, i.fields.pages, i.fields.DOI, i.fields.url, i.fields.abstractNote, i.tags.map((t) => t.tag).join('; '), i.dateAdded].map(q).join(','));
    return res.json({ text: '﻿' + [cols.join(','), ...rows].join('\r\n'), ext: 'csv' });
  }
  res.json({ text: exportAs(its, format), ext: { bibtex: 'bib', biblatex: 'bib', ris: 'ris', csljson: 'json' }[format] || 'txt' });
}));

app.post('/api/import', wrap(async (req, res) => {
  const { text, collectionId } = req.body;
  let data;
  try { data = await parseCitations(text); } catch (e) { return res.status(400).json({ error: `无法解析：${e.message}` }); }
  const created = tx(() => data.map((csl) => {
    const meta = cslToItem(csl);
    return createItem({ ...meta, collections: collectionId ? [collectionId] : [] });
  }));
  res.json({ items: items(created) });
}));

app.get('/api/import/zotero/default', wrap((req, res) => res.json({ dir: getSetting('zoteroDataDir') || defaultZoteroDir(), last: getSetting('lastZoteroImport') })));
app.post('/api/import/zotero', wrap((req, res) => {
  const stats = importZotero(req.body.dir);
  loadStyles();
  res.json(stats);
}));

app.get('/api/info', wrap((req, res) => res.json({ dataDir: path.dirname(STORAGE_DIR), storage: STORAGE_DIR, node: process.version })));

// —— 前端 ——
app.use('/pdfjs', express.static(path.join(ROOT, 'node_modules', 'pdfjs-dist'), { maxAge: '7d' }));
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// 启动服务；port 为 0 时由系统分配。返回实际端口
export function start(port = +process.env.PORT || 5417) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const actual = server.address().port;
      console.log(`我的 Zotero 已启动：http://localhost:${actual}`);
      // 启动时只索引本应用存储的 PDF；外部（如 Zotero/OneDrive）文件需手动建立索引，避免批量下载云端文件
      setTimeout(() => indexAll({ localOnly: true }).catch(() => {}), 5000);
      resolve(actual);
    });
    server.on('error', reject);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) start();
