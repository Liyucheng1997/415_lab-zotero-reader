import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeKey } from '../shared/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.MYZOTERO_DATA || path.join(ROOT, 'data');
export const STORAGE_DIR = path.join(DATA_DIR, 'storage');
fs.mkdirSync(STORAGE_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'library.sqlite'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  itemType TEXT NOT NULL,
  parentId INTEGER REFERENCES items(id) ON DELETE CASCADE,
  fields TEXT NOT NULL DEFAULT '{}',
  creators TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  contentType TEXT,
  linkMode TEXT,
  path TEXT,
  dateAdded TEXT NOT NULL,
  dateModified TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  lastRead TEXT
);
CREATE INDEX IF NOT EXISTS items_parent ON items(parentId);
CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  parentId INTEGER REFERENCES collections(id) ON DELETE CASCADE,
  dateAdded TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collectionItems (
  collectionId INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  itemId INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (collectionId, itemId)
);
CREATE TABLE IF NOT EXISTS itemTags (
  itemId INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  type INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (itemId, tag)
);
CREATE TABLE IF NOT EXISTS tagColors (tag TEXT PRIMARY KEY, color TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS relations (
  a INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  b INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (a, b)
);
CREATE TABLE IF NOT EXISTS annotations (
  id INTEGER PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  attachmentId INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  text TEXT,
  comment TEXT,
  color TEXT,
  pageLabel TEXT,
  sortIndex TEXT,
  position TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  dateAdded TEXT NOT NULL,
  dateModified TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ann_att ON annotations(attachmentId);
CREATE TABLE IF NOT EXISTS savedSearches (id INTEGER PRIMARY KEY, key TEXT UNIQUE, name TEXT NOT NULL, conditions TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS fulltextStatus (itemId INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE, indexedAt TEXT, chars INTEGER);
CREATE VIRTUAL TABLE IF NOT EXISTS fulltext USING fts5(itemId UNINDEXED, content, tokenize = 'trigram');
`);

export const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
export const newKey = (table) => {
  const stmt = db.prepare(`SELECT 1 FROM ${table} WHERE key = ?`);
  let k;
  do k = makeKey(); while (stmt.get(k));
  return k;
};

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function getSetting(key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? JSON.parse(r.value) : fallback;
}
export function setSetting(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
}

// —— 条目序列化 ——
const tagsStmt = () => db.prepare('SELECT itemId, tag, type FROM itemTags');
export function serializeAll() {
  const rows = db.prepare('SELECT * FROM items').all();
  const tags = new Map();
  for (const t of tagsStmt().all()) {
    if (!tags.has(t.itemId)) tags.set(t.itemId, []);
    tags.get(t.itemId).push({ tag: t.tag, type: t.type });
  }
  const cols = new Map();
  for (const c of db.prepare('SELECT collectionId, itemId FROM collectionItems').all()) {
    if (!cols.has(c.itemId)) cols.set(c.itemId, []);
    cols.get(c.itemId).push(c.collectionId);
  }
  const rels = new Map();
  for (const r of db.prepare('SELECT a, b FROM relations').all()) {
    if (!rels.has(r.a)) rels.set(r.a, []);
    rels.get(r.a).push(r.b);
  }
  const annCounts = new Map(db.prepare('SELECT attachmentId, COUNT(*) n FROM annotations GROUP BY attachmentId').all().map((r) => [r.attachmentId, r.n]));
  return rows.map((r) => serializeRow(r, tags.get(r.id), cols.get(r.id), rels.get(r.id), annCounts.get(r.id)));
}

function serializeRow(r, tags = [], collections = [], relations = [], annotationCount = 0) {
  const o = {
    id: r.id, key: r.key, itemType: r.itemType, parentId: r.parentId,
    fields: JSON.parse(r.fields), creators: JSON.parse(r.creators),
    dateAdded: r.dateAdded, dateModified: r.dateModified, deleted: !!r.deleted,
    tags, collections, relations,
  };
  if (r.itemType === 'note') o.note = r.note || '';
  if (r.itemType === 'attachment') {
    Object.assign(o, { contentType: r.contentType, linkMode: r.linkMode, filename: r.path ? path.basename(r.path.replace(/^storage:/, '')) : '', annotationCount, lastRead: r.lastRead });
  }
  return o;
}

export function getItem(id) {
  const r = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!r) return null;
  const tags = db.prepare('SELECT tag, type FROM itemTags WHERE itemId = ?').all(id).map((t) => ({ tag: t.tag, type: t.type }));
  const collections = db.prepare('SELECT collectionId FROM collectionItems WHERE itemId = ?').all(id).map((c) => c.collectionId);
  const relations = db.prepare('SELECT b FROM relations WHERE a = ?').all(id).map((x) => x.b);
  const n = db.prepare('SELECT COUNT(*) n FROM annotations WHERE attachmentId = ?').get(id).n;
  return serializeRow(r, tags, collections, relations, n);
}

export function getRawItem(id) {
  return db.prepare('SELECT * FROM items WHERE id = ?').get(id);
}

export function createItem(data) {
  const t = now();
  const key = data.key || newKey('items');
  const r = db.prepare(`INSERT INTO items(key, itemType, parentId, fields, creators, note, contentType, linkMode, path, dateAdded, dateModified, deleted)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    key, data.itemType, data.parentId ?? null, JSON.stringify(cleanFields(data.fields || {})), JSON.stringify(data.creators || []),
    data.note ?? null, data.contentType ?? null, data.linkMode ?? null, data.path ?? null,
    data.dateAdded || t, data.dateModified || t, data.deleted ? 1 : 0,
  );
  const id = Number(r.lastInsertRowid);
  if (data.tags) setTags(id, data.tags);
  if (data.collections) for (const c of data.collections) db.prepare('INSERT OR IGNORE INTO collectionItems VALUES(?, ?)').run(c, id);
  if (data.relations) for (const b of data.relations) addRelation(id, b);
  return id;
}

function cleanFields(f) {
  const o = {};
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== null && String(v).trim() !== '') o[k] = String(v);
  return o;
}

export function updateItem(id, patch) {
  const cur = getRawItem(id);
  if (!cur) throw new Error('条目不存在');
  const sets = [];
  const vals = [];
  if (patch.fields) { sets.push('fields = ?'); vals.push(JSON.stringify(cleanFields(patch.fields))); }
  if (patch.creators) { sets.push('creators = ?'); vals.push(JSON.stringify(patch.creators)); }
  for (const k of ['itemType', 'note', 'parentId', 'path', 'linkMode', 'contentType', 'lastRead']) {
    if (k in patch) { sets.push(`${k} = ?`); vals.push(patch[k]); }
  }
  if ('deleted' in patch) { sets.push('deleted = ?'); vals.push(patch.deleted ? 1 : 0); }
  if (patch.tags) setTags(id, patch.tags);
  if (patch.collections) {
    db.prepare('DELETE FROM collectionItems WHERE itemId = ?').run(id);
    for (const c of patch.collections) db.prepare('INSERT OR IGNORE INTO collectionItems VALUES(?, ?)').run(c, id);
  }
  if (patch.relations) {
    const old = db.prepare('SELECT b FROM relations WHERE a = ?').all(id).map((r) => r.b);
    for (const b of old) if (!patch.relations.includes(b)) removeRelation(id, b);
    for (const b of patch.relations) addRelation(id, b);
  }
  if (!patch.silent && patch.lastRead === undefined) { sets.push('dateModified = ?'); vals.push(now()); }
  if (sets.length) db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
}

export function setTags(id, tags) {
  db.prepare('DELETE FROM itemTags WHERE itemId = ?').run(id);
  const ins = db.prepare('INSERT OR IGNORE INTO itemTags(itemId, tag, type) VALUES(?, ?, ?)');
  for (const t of tags) {
    const tag = typeof t === 'string' ? t : t.tag;
    if (tag && tag.trim()) ins.run(id, tag.trim(), typeof t === 'string' ? 0 : t.type || 0);
  }
}

export function addRelation(a, b) {
  if (a === b) return;
  db.prepare('INSERT OR IGNORE INTO relations VALUES(?, ?)').run(a, b);
  db.prepare('INSERT OR IGNORE INTO relations VALUES(?, ?)').run(b, a);
}
export function removeRelation(a, b) {
  db.prepare('DELETE FROM relations WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)').run(a, b, b, a);
}

export function serializeCollections() {
  return db.prepare('SELECT id, key, name, parentId, dateAdded FROM collections ORDER BY name COLLATE NOCASE').all().map((c) => ({ ...c }));
}

export function serializeAnnotation(a) {
  return { ...a, position: JSON.parse(a.position), tags: JSON.parse(a.tags || '[]') };
}

// 文件路径解析：storage:xxx → data/storage/KEY/xxx；其余视为绝对路径
export function resolveAttachmentPath(row) {
  if (!row || !row.path) return null;
  if (row.path.startsWith('storage:')) return path.join(STORAGE_DIR, row.key, row.path.slice(8));
  return row.path;
}
