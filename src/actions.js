// 跨组件共享的操作
import {
  FileText, FolderOpen, StickyNote, Paperclip, Link2, Search, RefreshCw, Wand2, Quote, BookMarked, Download, FolderPlus, FolderMinus,
  Copy, Trash2, RotateCcw, XCircle, ExternalLink, FileDown, Pencil, Tag, Palette, FileSearch, Merge, Link as LinkIcon,
} from 'lucide-react';
import { api } from './api.js';
import { useStore, getItem, childrenOf, bestAttachment, collectionPath } from './store.js';
import { toast, confirm, prompt, openDialog } from './ui/overlay.jsx';
import { copyRich, isPdf, isRegular, itemTitle, esc } from './lib/util.js';
import { ITEM_TYPES, REGULAR_TYPES } from '../shared/schema.js';

const S = () => useStore.getState();
const lazy = (name) => import('./dialogs/dialogs.jsx').then((m) => m[name]);

export async function updateItem(id, patch) {
  const it = getItem(id);
  if (it) S().upsert([{ ...it, ...patch, fields: patch.fields || it.fields }]);
  try {
    const r = await api.patch(`/api/items/${id}`, patch);
    S().upsert(r.items);
  } catch (e) {
    toast(e.message, 'error');
    if (it) S().upsert([it]);
  }
}

export async function createItem(itemType, extra = {}) {
  const v = S().view;
  const collections = v.type === 'collection' ? [v.id] : [];
  const it = await api.post('/api/items', { itemType, fields: {}, creators: [], collections, ...extra });
  S().upsert([it]);
  S().select([it.id]);
  if (it.parentId) S().toggleExpand(it.parentId, true);
  window.dispatchEvent(new CustomEvent('mz-focus-title', { detail: it.id }));
  return it;
}

export async function createNote(parentId, html = '') {
  const it = await createItem('note', { parentId: parentId || null, note: html, collections: parentId ? [] : undefined });
  return it;
}

export function newItemMenu() {
  const common = ['journalArticle', 'conferencePaper', 'preprint', 'book', 'bookSection', 'thesis', 'webpage'];
  return [
    { header: '新建条目' },
    ...common.map((t) => ({ label: ITEM_TYPES[t].label, onClick: () => createItem(t) })),
    '-',
    { label: '更多类型', submenu: REGULAR_TYPES.filter((t) => !common.includes(t)).map((t) => ({ label: ITEM_TYPES[t].label, onClick: () => createItem(t) })) },
    '-',
    { label: '新建独立笔记', icon: StickyNote, onClick: () => createNote(null) },
    { label: '导入 BibTeX / RIS…', icon: Download, onClick: () => lazy('ImportDialog').then((D) => openDialog(D)) },
  ];
}

export async function addByIdentifier(text) {
  const v = S().view;
  S().setBusy('identify', true);
  try {
    const r = await api.post('/api/identify', { identifiers: text, collectionId: v.type === 'collection' ? v.id : null });
    S().upsert(r.items);
    if (r.items.length) S().select(r.items.map((i) => i.id));
    if (r.errors.length) toast(r.errors[0], 'error', 4000);
    else toast(`已添加 ${r.items.length} 个条目`, 'success');
    return r;
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    S().setBusy('identify', false);
  }
}

export async function addFiles(files, { parentId } = {}) {
  const v = S().view;
  const collectionId = v.type === 'collection' ? v.id : null;
  const created = [];
  for (const f of files) {
    try {
      toast(`正在导入 ${f.name}…`);
      const it = await api.upload(f, { parentId, collectionId });
      S().upsert([it]);
      created.push(it);
      if (!parentId && isPdf(it) && S().prefs.autoRecognize) recognize(it.id, true);
    } catch (e) {
      toast(`${f.name}：${e.message}`, 'error');
    }
  }
  if (created.length) {
    S().select(created.map((i) => i.id));
    if (parentId) S().toggleExpand(parentId, true);
  }
  return created;
}

export async function recognize(id, quiet) {
  S().setBusy(`rec${id}`, true);
  try {
    const r = await api.post(`/api/items/${id}/recognize`);
    if (r.recognized) {
      S().upsert(r.items);
      S().select([r.items[0].id]);
      toast(`已识别：${itemTitle(r.items[0]).slice(0, 40)}`, 'success');
    } else if (!quiet) toast('未能识别元数据，可手动创建父条目', 'error');
  } catch (e) {
    if (!quiet) toast(e.message, 'error');
  } finally {
    S().setBusy(`rec${id}`, false);
  }
}

export async function refreshMetadata(id) {
  S().setBusy(`ref${id}`, true);
  try {
    const r = await api.post(`/api/items/${id}/refresh`);
    S().upsert(r.items);
    toast('元数据已更新', 'success');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    S().setBusy(`ref${id}`, false);
  }
}

export async function findPdf(id) {
  S().setBusy(`pdf${id}`, true);
  toast('正在查找可用 PDF…');
  try {
    const r = await api.post(`/api/items/${id}/find-pdf`);
    if (r.found) {
      S().upsert(r.items);
      S().toggleExpand(id, true);
      toast('已下载 PDF', 'success');
    } else toast('没有找到开放获取的 PDF', 'error');
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    S().setBusy(`pdf${id}`, false);
  }
}

export function openItem(item, nav) {
  if (!item) return;
  if (item.itemType === 'note') { S().select([item.id]); return; }
  const att = item.itemType === 'attachment' ? item : bestAttachment(item);
  if (!att) {
    if (item.fields?.url) window.open(item.fields.url, '_blank');
    else if (item.fields?.DOI) window.open(`https://doi.org/${item.fields.DOI}`, '_blank');
    else toast('此条目没有附件');
    return;
  }
  if (att.linkMode === 'linked_url') { window.open(att.fields.url, '_blank'); return; }
  if (isPdf(att)) { S().openReader(att.id, { nav }); markRead(att.id); return; }
  window.open(`/api/file/${att.id}`, '_blank');
}

function markRead(id) {
  api.patch(`/api/items/${id}`, { lastRead: new Date().toISOString().replace('T', ' ').slice(0, 19) }).then((r) => S().upsert(r.items)).catch(() => {});
}

export async function trashItems(ids) {
  if (!ids.length) return;
  const r = await api.post('/api/items/batch', { ids, op: 'trash' });
  S().upsert(r.items);
  S().select([]);
  toast(`已将 ${ids.length} 个条目移入回收站`);
}
export async function restoreItems(ids) {
  const r = await api.post('/api/items/batch', { ids, op: 'restore' });
  S().upsert(r.items);
  S().select([]);
  toast('已恢复', 'success');
}
export async function deleteForever(ids) {
  if (!(await confirm({ title: `永久删除 ${ids.length} 个条目？`, message: '此操作无法撤销。本应用存储的附件文件也会被删除（不会删除 Zotero 目录中的文件）。', okText: '永久删除', danger: true }))) return;
  const r = await api.post('/api/items/batch', { ids, op: 'delete' });
  S().remove(r.removed);
}
export async function emptyTrash() {
  const n = Object.values(S().items).filter((i) => i.deleted).length;
  if (!n) return toast('回收站是空的');
  if (!(await confirm({ title: '清空回收站？', message: `将永久删除 ${n} 个条目，此操作无法撤销。`, okText: '清空', danger: true }))) return;
  const r = await api.post('/api/trash/empty');
  S().remove(r.removed);
  toast('回收站已清空', 'success');
}

export async function addToCollection(ids, collectionId) {
  const top = ids.map(getItem).filter((i) => i && (!i.parentId || i.itemType === 'note')).map((i) => i.id);
  const r = await api.post('/api/items/batch', { ids: top, op: 'addToCollection', collectionId });
  S().upsert(r.items);
  toast(`已添加到「${collectionPath(collectionId)}」`, 'success');
}
export async function removeFromCollection(ids, collectionId) {
  const r = await api.post('/api/items/batch', { ids, op: 'removeFromCollection', collectionId });
  S().upsert(r.items);
  S().select([]);
}
export async function addTagToItems(ids, tag) {
  const r = await api.post('/api/items/batch', { ids, op: 'addTag', tag });
  S().upsert(r.items);
  toast(`已添加标签「${tag}」`, 'success');
}

export async function duplicateItem(id) {
  const v = S().view;
  const it = await api.post(`/api/items/${id}/duplicate`, { collectionId: v.type === 'collection' ? v.id : null });
  S().upsert([it]);
  S().select([it.id]);
}

export async function copyBibliography(ids, style) {
  const { prefs } = S();
  const r = await api.post('/api/cite', { ids, style: style || prefs.quickCopyStyle, mode: 'bibliography', lang: prefs.citeLang });
  if (!r.text) return toast('所选条目不能生成引文');
  await copyRich(r.html, r.text.trim());
  toast('参考文献已复制', 'success');
}
export async function copyCitation(ids, style) {
  const { prefs } = S();
  const r = await api.post('/api/cite', { ids, style: style || prefs.quickCopyStyle, mode: 'citation', lang: prefs.citeLang });
  if (!r.text) return toast('所选条目不能生成引文');
  await copyRich(r.html, r.text.trim());
  toast('引注已复制', 'success');
}

export async function showFile(id) {
  try { await api.post(`/api/items/${id}/show-file`); } catch (e) { toast(e.message, 'error'); }
}
export async function openExternal(id) {
  try { await api.post(`/api/items/${id}/open-external`); } catch (e) { toast(e.message, 'error'); }
}

export async function attachFileDialog(parentId) {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.onchange = () => addFiles([...input.files], { parentId });
  input.click();
}
export async function attachLink(parentId) {
  const url = await prompt({ title: '附加网址链接', label: '网址', placeholder: 'https://…' });
  if (!url) return;
  const it = await api.post(`/api/items/${parentId || 0}/link-file`, { url });
  S().upsert([it]);
  if (parentId) S().toggleExpand(parentId, true);
}

export async function renameFromParent(id) {
  try {
    const r = await api.post(`/api/items/${id}/rename-from-parent`);
    S().upsert(r.items);
    toast('已重命名文件', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

export async function createParentItem(att) {
  const it = await api.post('/api/items', { itemType: 'document', fields: { title: (att.fields.title && att.fields.title !== 'PDF' ? att.fields.title : att.filename.replace(/\.[^.]+$/, '')) }, creators: [], collections: att.collections });
  const r = await api.patch(`/api/items/${att.id}`, { parentId: it.id, collections: [] });
  S().upsert([it, ...r.items]);
  S().select([it.id]);
  S().toggleExpand(it.id, true);
}

// —— 分类 ——
export async function newCollection(parentId = null) {
  const name = await prompt({ title: parentId ? '新建子分类' : '新建分类', label: '名称', value: '' });
  if (!name?.trim()) return;
  const r = await api.post('/api/collections', { name: name.trim(), parentId });
  S().setCollections(r.collections);
  if (parentId) S().setCollapsed(parentId, false);
  S().setView({ type: 'collection', id: r.id });
}
export async function renameCollection(c) {
  const name = await prompt({ title: '重命名分类', value: c.name });
  if (!name?.trim() || name === c.name) return;
  const r = await api.patch(`/api/collections/${c.id}`, { name: name.trim() });
  S().setCollections(r.collections);
}
export async function moveCollection(id, parentId) {
  try {
    const r = await api.patch(`/api/collections/${id}`, { parentId });
    S().setCollections(r.collections);
  } catch (e) { toast(e.message, 'error'); }
}
export async function deleteCollection(c, withItems) {
  const ok = await confirm({
    title: withItems ? `删除分类及其条目？` : `删除分类「${c.name}」？`,
    message: withItems ? `「${c.name}」及子分类会被删除，其中的条目会移入回收站。` : '分类及子分类会被删除，其中的条目仍保留在文库中。',
    okText: '删除', danger: true,
  });
  if (!ok) return;
  const r = await api.del(`/api/collections/${c.id}${withItems ? '?deleteItems=1' : ''}`);
  S().setCollections(r.collections);
  S().upsert(r.items);
  if (S().view.type === 'collection' && !r.collections.some((x) => x.id === S().view.id)) S().setView({ type: 'library' });
}

// —— 标签 ——
export async function renameTag(tag) {
  const to = await prompt({ title: '重命名标签', value: tag });
  if (!to?.trim() || to === tag) return;
  const r = await api.post('/api/tags/rename', { from: tag, to: to.trim() });
  S().upsert(r.items);
  const tc = await api.get('/api/library');
  S().setTagColors(tc.tagColors);
  S().setTagFilter(S().tagFilter.map((t) => (t === tag ? to.trim() : t)));
}
export async function deleteTags(tags) {
  if (!(await confirm({ title: tags.length > 1 ? `删除 ${tags.length} 个标签？` : `删除标签「${tags[0]}」？`, message: '标签会从所有条目上移除。', okText: '删除', danger: true }))) return;
  const r = await api.post('/api/tags/delete', { tags });
  S().upsert(r.items);
  S().setTagColors(S().tagColors.filter((t) => !tags.includes(t.tag)));
  S().setTagFilter(S().tagFilter.filter((t) => !tags.includes(t)));
}
export async function setTagColor(tag, color, position) {
  const r = await api.post('/api/tags/color', { tag, color, position });
  S().setTagColors(r.tagColors);
}

// —— 条目右键菜单 ——
export function itemMenu(ids) {
  const items = ids.map(getItem).filter(Boolean);
  if (!items.length) return [];
  const one = items.length === 1 ? items[0] : null;
  const { view, collections } = S();
  if (view.type === 'trash') {
    return [
      { label: '恢复到文库', icon: RotateCcw, onClick: () => restoreItems(ids) },
      { label: '永久删除…', icon: XCircle, danger: true, onClick: () => deleteForever(ids) },
    ];
  }
  const regular = items.filter(isRegular);
  const colTree = (parentId = null) => collections.filter((c) => c.parentId === parentId).map((c) => {
    const kids = colTree(c.id);
    return kids.length
      ? { label: c.name, submenu: [{ label: `添加到「${c.name}」`, onClick: () => addToCollection(ids, c.id) }, '-', ...kids] }
      : { label: c.name, onClick: () => addToCollection(ids, c.id) };
  });
  const menu = [];
  if (one) {
    const att = one.itemType === 'attachment' ? one : bestAttachment(one);
    if (att && att.linkMode !== 'linked_url') {
      menu.push({ label: isPdf(att) ? '打开 PDF' : '打开附件', icon: FileText, shortcut: '↵', onClick: () => openItem(one) });
      menu.push({ label: '在文件夹中显示', icon: FolderOpen, onClick: () => showFile(att.id) });
      menu.push({ label: '用系统程序打开', icon: ExternalLink, onClick: () => openExternal(att.id) });
    } else if (att) menu.push({ label: '打开链接', icon: ExternalLink, onClick: () => openItem(one) });
    else if (one.fields?.url || one.fields?.DOI) menu.push({ label: '在浏览器中查看', icon: ExternalLink, onClick: () => openItem(one) });
    menu.push('-');
  }
  if (one && isRegular(one)) {
    menu.push({ label: '添加笔记', icon: StickyNote, onClick: () => createNote(one.id) });
    menu.push({ label: '添加附件', icon: Paperclip, submenu: [
      { label: '附加文件…', icon: Paperclip, onClick: () => attachFileDialog(one.id) },
      { label: '附加网址链接…', icon: Link2, onClick: () => attachLink(one.id) },
    ] });
    menu.push('-');
    menu.push({ label: '查找可用 PDF', icon: Search, onClick: () => findPdf(one.id) });
    menu.push({ label: '更新元数据', icon: RefreshCw, onClick: () => refreshMetadata(one.id), disabled: !(one.fields.DOI || one.fields.archiveID || one.fields.url || one.fields.title) });
    menu.push('-');
  }
  if (one && one.itemType === 'attachment') {
    if (!one.parentId && isPdf(one)) menu.push({ label: '重新抓取 PDF 的元数据', icon: Wand2, onClick: () => recognize(one.id) });
    if (!one.parentId) menu.push({ label: '创建父条目…', icon: FileSearch, onClick: () => createParentItem(one) });
    if (one.parentId && one.linkMode === 'imported_file') menu.push({ label: '根据父条目重命名文件', icon: Pencil, onClick: () => renameFromParent(one.id) });
    if (isPdf(one)) menu.push({ label: '导出带注释的 PDF', icon: FileDown, onClick: () => { location.href = `/api/items/${one.id}/export-pdf`; } });
    menu.push('-');
  }
  if (regular.length) {
    menu.push({ label: '复制参考文献', icon: BookMarked, shortcut: 'Ctrl+Shift+C', onClick: () => copyBibliography(regular.map((i) => i.id)) });
    menu.push({ label: '复制引注', icon: Quote, shortcut: 'Ctrl+Shift+A', onClick: () => copyCitation(regular.map((i) => i.id)) });
    menu.push({ label: '生成参考文献…', icon: BookMarked, onClick: () => lazy('BibliographyDialog').then((D) => openDialog(D, { ids: regular.map((i) => i.id) })) });
    menu.push({ label: '导出条目…', icon: Download, onClick: () => lazy('ExportDialog').then((D) => openDialog(D, { ids: regular.map((i) => i.id) })) });
    menu.push('-');
  }
  if (items.some((i) => !i.parentId)) {
    if (collections.length) menu.push({ label: '添加到分类', icon: FolderPlus, submenu: [{ label: '新建分类…', icon: FolderPlus, onClick: async () => { await newCollection(); const v = S().view; if (v.type === 'collection') addToCollection(ids, v.id); } }, '-', ...colTree()] });
    if (view.type === 'collection') menu.push({ label: '从分类中移除', icon: FolderMinus, onClick: () => removeFromCollection(ids, view.id) });
    menu.push({ label: '添加标签…', icon: Tag, onClick: async () => { const t = await prompt({ title: '添加标签', label: `为 ${ids.length} 个条目添加标签` }); if (t?.trim()) addTagToItems(ids, t.trim()); } });
  }
  if (items.length === 2 && regular.length === 2) menu.push({ label: '设为关联条目', icon: LinkIcon, onClick: async () => { const r = await api.post(`/api/items/${ids[0]}/relate`, { otherId: ids[1] }); S().upsert(r.items); toast('已关联', 'success'); } });
  if (regular.length >= 2 && regular.length === items.length && regular.every((r) => r.itemType === regular[0].itemType)) menu.push({ label: '合并条目…', icon: Merge, onClick: () => S().select(ids) || window.dispatchEvent(new CustomEvent('mz-merge', { detail: ids })) });
  if (one && isRegular(one)) menu.push({ label: '复制条目', icon: Copy, onClick: () => duplicateItem(one.id) });
  menu.push('-');
  menu.push({ label: ids.length > 1 ? `将 ${ids.length} 个条目移入回收站` : '移入回收站…', icon: Trash2, danger: true, shortcut: 'Del', onClick: () => trashItems(ids) });
  return menu;
}

export function collectionMenu(c) {
  return [
    { label: '新建子分类…', icon: FolderPlus, onClick: () => newCollection(c.id) },
    { label: '重命名…', icon: Pencil, onClick: () => renameCollection(c) },
    '-',
    { label: '生成参考文献…', icon: BookMarked, onClick: () => lazy('BibliographyDialog').then((D) => openDialog(D, { ids: collectionItems(c.id) })) },
    { label: '导出分类…', icon: Download, onClick: () => lazy('ExportDialog').then((D) => openDialog(D, { ids: collectionItems(c.id), name: c.name })) },
    { label: '导入到此分类…', icon: Download, onClick: () => { S().setView({ type: 'collection', id: c.id }); lazy('ImportDialog').then((D) => openDialog(D)); } },
    '-',
    { label: '删除分类…', icon: Trash2, danger: true, onClick: () => deleteCollection(c, false) },
    { label: '删除分类及条目…', icon: XCircle, danger: true, onClick: () => deleteCollection(c, true) },
  ];
}
function collectionItems(cid) {
  return Object.values(S().items).filter((i) => !i.deleted && i.collections.includes(cid) && isRegular(i)).map((i) => i.id);
}

export function tagMenu(tag, colored) {
  const colors = ['#ff6666', '#ff8c19', '#ffd400', '#5fb236', '#2ea8e5', '#a28ae5', '#e56eee', '#aaaaaa', '#576dd9', '#009980'];
  return [
    { label: '设置颜色', icon: Palette, submenu: [
      ...colors.map((c) => ({ label: c, swatch: c, checked: colored?.color === c, onClick: () => setTagColor(tag, c) })),
      ...(colored ? ['-', { label: '移除颜色', onClick: () => setTagColor(tag, null) }] : []),
    ] },
    { label: '重命名标签…', icon: Pencil, onClick: () => renameTag(tag) },
    '-',
    { label: '删除标签…', icon: Trash2, danger: true, onClick: () => deleteTags([tag]) },
  ];
}

export function attachmentSummary(item) {
  const kids = childrenOf(item.id).filter((c) => !c.deleted);
  return { pdf: kids.find(isPdf), notes: kids.filter((c) => c.itemType === 'note').length, atts: kids.filter((c) => c.itemType === 'attachment') };
}

export function annotationToHtml(a, parent) {
  const page = a.pageLabel ? `, p. ${a.pageLabel}` : '';
  const cs = (parent?.creators || []).filter((c) => c.creatorType === 'author');
  const n = (c) => c.lastName || c.name || '';
  const who = cs.length ? (cs.length > 2 ? `${n(cs[0])} et al.` : cs.map(n).join(' & ')) : '';
  const y = (parent?.fields?.date || '').match(/\d{4}/)?.[0] || '';
  const cite = parent ? ` <span class="citation">(${esc([who, y].filter(Boolean).join(', '))}${esc(page)})</span>` : '';
  const comment = a.comment ? `<p>${esc(a.comment)}</p>` : '';
  if (a.type === 'image' && a.image) return `<p><img src="${a.image}"/>${cite}</p>${comment}`;
  if (a.type === 'note' || a.type === 'text' || a.type === 'ink') return `<p>${esc(a.comment || '')}${cite}</p>`;
  return `<p><span class="highlight" style="background:${a.color}55">“${esc(a.text || '')}”</span>${cite}</p>${comment}`;
}
