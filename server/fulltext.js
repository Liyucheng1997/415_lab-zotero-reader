// 全文索引：FTS5（trigram，支持中文子串）
import fs from 'node:fs';
import { db, now, resolveAttachmentPath } from './db.js';
import { extractText } from './pdftext.js';

export function indexText(itemId, text) {
  db.prepare('DELETE FROM fulltext WHERE itemId = ?').run(itemId);
  db.prepare('INSERT INTO fulltext(itemId, content) VALUES(?, ?)').run(itemId, text);
  db.prepare('INSERT OR REPLACE INTO fulltextStatus VALUES(?, ?, ?)').run(itemId, now(), text.length);
}

export async function indexAttachment(itemId) {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(itemId);
  const file = resolveAttachmentPath(row);
  if (!file || row.contentType !== 'application/pdf' || !fs.existsSync(file)) return false;
  const { text } = await extractText(file);
  indexText(itemId, text);
  return true;
}

let running = false;
export const indexerState = { running: false, done: 0, total: 0, current: '' };

export async function indexAll({ localOnly = false } = {}) {
  if (running) return;
  running = true;
  try {
    const todo = db.prepare(`SELECT id, path, key FROM items WHERE itemType = 'attachment' AND contentType = 'application/pdf' AND deleted = 0
      AND id NOT IN (SELECT itemId FROM fulltextStatus)`).all().filter((r) => !localOnly || r.path?.startsWith('storage:'));
    Object.assign(indexerState, { running: true, done: 0, total: todo.length });
    for (const r of todo) {
      indexerState.current = r.path || '';
      try { await indexAttachment(r.id); } catch { db.prepare('INSERT OR REPLACE INTO fulltextStatus VALUES(?, ?, 0)').run(r.id, now()); }
      indexerState.done++;
      await new Promise((res) => setTimeout(res, 5));
    }
  } finally {
    running = false;
    indexerState.running = false;
  }
}

// 返回命中的附件 id 及片段
export function searchFulltext(q) {
  q = q.trim();
  if (!q) return [];
  const snip = `substr(content, max(1, instr(lower(content), lower(?)) - 40), 120) AS snip`;
  const rows = [...q].length >= 3
    ? db.prepare(`SELECT itemId, ${snip} FROM fulltext WHERE fulltext MATCH ? LIMIT 500`).all(q, '"' + q.replace(/"/g, '""') + '"')
    : db.prepare(`SELECT itemId, ${snip} FROM fulltext WHERE instr(lower(content), lower(?)) > 0 LIMIT 500`).all(q, q);
  // 注释文字也参与"所有内容"搜索
  const like = `%${q.replace(/[%_]/g, '')}%`;
  for (const a of db.prepare('SELECT attachmentId, text, comment FROM annotations WHERE text LIKE ? OR comment LIKE ? LIMIT 300').all(like, like)) {
    rows.push({ itemId: a.attachmentId, snip: `注释：${[a.text, a.comment].filter(Boolean).join(' — ').slice(0, 120)}` });
  }
  return rows.map((r) => ({ itemId: Number(r.itemId), snippet: String(r.snip || '').replace(/\s+/g, ' ').trim() }));
}

export function fulltextStats() {
  return {
    indexed: db.prepare('SELECT COUNT(*) n FROM fulltextStatus WHERE chars > 0').get().n,
    pdfs: db.prepare("SELECT COUNT(*) n FROM items WHERE itemType = 'attachment' AND contentType = 'application/pdf' AND deleted = 0").get().n,
    ...indexerState,
  };
}
