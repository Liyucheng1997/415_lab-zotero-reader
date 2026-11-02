import { ITEM_TYPES, yearOf, creatorSummary, containerOf } from '../../shared/schema.js';

export { yearOf, creatorSummary, containerOf };

export function itemTitle(item) {
  if (!item) return '';
  if (item.itemType === 'note') return noteTitle(item.note) || '无标题笔记';
  return item.fields?.title || (item.itemType === 'attachment' ? item.filename : '') || '无标题';
}

export function noteTitle(html) {
  if (!html) return '';
  const d = document.createElement('div');
  d.innerHTML = html.replace(/<\/(p|h\d|div|li|blockquote)>/gi, '\n</$1>').replace(/<br\s*\/?>/gi, '\n');
  return (d.textContent || '').trim().split('\n').map((s) => s.trim()).find(Boolean)?.slice(0, 200) || '';
}

export function htmlToText(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  return d.textContent || '';
}

export const typeLabel = (t) => ITEM_TYPES[t]?.label || t;

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  d.cancel = () => clearTimeout(t);
  return d;
}

export function download(text, filename, type = 'text/plain;charset=utf-8') {
  const blob = text instanceof Blob ? text : new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function copyRich(html, text) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + (s.length <= 19 ? 'Z' : ''));
  if (isNaN(d)) return s;
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  if (d.toDateString() === now.toDateString()) return `今天 ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`;
}

export function fmtDateTime(s) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return s;
  return d.toLocaleString('zh-CN', { hour12: false });
}

export const isPdf = (it) => it?.itemType === 'attachment' && (it.contentType === 'application/pdf' || /\.pdf$/i.test(it.filename || ''));
export const isRegular = (it) => it && it.itemType !== 'note' && it.itemType !== 'attachment';

export function local(key, fallback) {
  try {
    const v = localStorage.getItem(`mz-${key}`);
    return v == null ? fallback : JSON.parse(v);
  } catch { return fallback; }
}
export function saveLocal(key, value) {
  try { localStorage.setItem(`mz-${key}`, JSON.stringify(value)); } catch { /* 忽略 */ }
}

export const normTitle = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
