import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Search, Plus, Wand2, Paperclip, StickyNote, ChevronRight, ChevronDown, ArrowUp, ArrowDown, FileText, Trash2, Loader2,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, getItem, collectionPath, childrenOf, DEFAULT_COLUMNS } from '../store.js';
import { computeRows } from '../lib/search.js';
import { showMenu, openDialog } from '../ui/overlay.jsx';
import {
  itemMenu, newItemMenu, addFiles, openItem, trashItems, createNote, attachFileDialog, attachLink, copyBibliography, copyCitation,
  restoreItems, deleteForever, emptyTrash, updateItem, removeFromCollection,
} from '../actions.js';
import { api } from '../api.js';
import { itemTitle, creatorSummary, yearOf, containerOf, fmtDate, typeLabel, isPdf, debounce } from '../lib/util.js';
import { TypeIcon } from './icons.jsx';

const COLUMN_LABELS = { title: '标题', creator: '创建者', year: '年份', publication: '出版物', itemType: '条目类型', dateAdded: '添加日期', dateModified: '修改日期', extra: '其他', attachments: '附件', notes: '笔记' };

function viewTitle(view, savedSearches) {
  switch (view.type) {
    case 'collection': return collectionPath(view.id);
    case 'unfiled': return '未分类条目';
    case 'duplicates': return '重复条目';
    case 'trash': return '回收站';
    case 'recent': return '最近添加';
    case 'search': return savedSearches.find((s) => s.id === view.id)?.name || '保存的搜索';
    default: return '我的文库';
  }
}

const SEARCH_MODES = { tcy: '标题、作者、年份', all: '所有字段和标签', everything: '所有内容' };

function SearchBox() {
  const mode = useStore((s) => s.searchMode);
  const [v, setV] = useState('');
  const ref = useRef(null);
  const apply = useMemo(() => debounce(async (text, m) => {
    const s = useStore.getState();
    s.setSearch(text);
    if (m === 'everything' && text.trim()) {
      const hits = await api.get(`/api/fulltext/search?q=${encodeURIComponent(text.trim())}`).catch(() => []);
      const items = useStore.getState().items;
      const map = new Map();
      for (const h of hits) {
        if (!map.has(h.itemId)) map.set(h.itemId, h.snippet);
        const p = items[h.itemId]?.parentId;
        if (p && !map.has(p)) map.set(p, h.snippet);
      }
      useStore.getState().setFulltextHits(map);
    } else s.setFulltextHits(null);
  }, 220), []);
  useEffect(() => {
    const k = (e) => {
      if (useStore.getState().activeTab !== 'library') return;
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'k')) { e.preventDefault(); ref.current?.focus(); ref.current?.select(); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return (
    <div className="search">
      <Search size={14} className="s-ico" />
      <input
        ref={ref}
        className="input"
        placeholder={`搜索${SEARCH_MODES[mode]}`}
        value={v}
        onChange={(e) => { setV(e.target.value); apply(e.target.value, mode); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setV(''); apply.flush('', mode); }
          if (e.key === 'Enter') apply.flush(v, mode);
          if (e.key === 'ArrowDown') { e.preventDefault(); document.querySelector('.table')?.focus(); }
        }}
      />
      <button className="s-mode" onClick={(e) => showMenu(e, Object.entries(SEARCH_MODES).map(([k, label]) => ({
        label, checked: mode === k, onClick: () => { useStore.getState().setSearchMode(k); apply.flush(v, k); },
      })), { anchor: e.currentTarget, align: 'right' })}>{{ tcy: '标题', all: '全部', everything: '全文' }[mode]}<ChevronDown size={11} /></button>
    </div>
  );
}

function IdentifierButton() {
  const busy = useStore((s) => s.busy.identify);
  return (
    <button className="icon-btn" title="通过标识符添加条目（DOI、arXiv、ISBN、PMID、网址）" onClick={() => import('../dialogs/dialogs.jsx').then((m) => openDialog(m.IdentifierDialog))}>
      {busy ? <Loader2 size={17} className="spin" /> : <Wand2 size={17} strokeWidth={1.75} />}
    </button>
  );
}

function Toolbar({ count }) {
  const view = useStore((s) => s.view);
  const savedSearches = useStore((s) => s.savedSearches);
  const selected = useStore((s) => s.selected);
  const sel = selected.length === 1 ? getItem(selected[0]) : null;
  const parentForChild = sel && sel.itemType !== 'note' && sel.itemType !== 'attachment' ? sel.id : null;
  return (
    <div className="items-toolbar">
      <div className="items-title" title={viewTitle(view, savedSearches)}>{viewTitle(view, savedSearches)}</div>
      <span className="items-sub">{count} 个条目</span>
      <div className="grow" />
      {view.type === 'trash' ? (
        <button className="btn btn-sm btn-danger" onClick={emptyTrash}><Trash2 size={14} />清空回收站</button>
      ) : (
        <>
          <button className="icon-btn" title="新建条目" onClick={(e) => showMenu(e, newItemMenu(), { anchor: e.currentTarget })}><Plus size={18} strokeWidth={1.75} /></button>
          <IdentifierButton />
          <button className="icon-btn" title="添加附件" onClick={(e) => showMenu(e, [
            { label: parentForChild ? '附加文件到所选条目…' : '添加文件（自动识别元数据）…', icon: Paperclip, onClick: () => attachFileDialog(parentForChild) },
            { label: '附加网址链接…', disabled: !parentForChild, onClick: () => attachLink(parentForChild) },
          ], { anchor: e.currentTarget })}><Paperclip size={17} strokeWidth={1.75} /></button>
          <button className="icon-btn" title="新建笔记" onClick={(e) => showMenu(e, [
            { label: '新建独立笔记', onClick: () => createNote(null) },
            { label: '新建子笔记', disabled: !parentForChild, onClick: () => createNote(parentForChild) },
          ], { anchor: e.currentTarget })}><StickyNote size={17} strokeWidth={1.75} /></button>
        </>
      )}
      <div className="sep-v" />
      <SearchBox />
    </div>
  );
}

function cellValue(key, it) {
  switch (key) {
    case 'creator': return creatorSummary(it);
    case 'year': return yearOf(it.fields?.date);
    case 'publication': return containerOf(it);
    case 'itemType': return typeLabel(it.itemType);
    case 'dateAdded': return fmtDate(it.dateAdded);
    case 'dateModified': return fmtDate(it.dateModified);
    case 'extra': return it.fields?.extra || '';
    default: return '';
  }
}

export default function ItemsPane() {
  const state = useStore(useShallow((s) => ({
    version: s.version, view: s.view, searchText: s.searchText, searchMode: s.searchMode, fulltextHits: s.fulltextHits,
    tagFilter: s.tagFilter, sort: s.sort, expanded: s.expanded, inc: s.prefs.includeSubcollections, savedSearches: s.savedSearches,
  })));
  const selected = useStore((s) => s.selected);
  const columns = useStore((s) => s.columns);
  const tagColors = useStore((s) => s.tagColors);
  const busy = useStore((s) => s.busy);
  const { rows, count } = useMemo(() => computeRows(useStore.getState()), [state]); // eslint-disable-line react-hooks/exhaustive-deps
  const bodyRef = useRef(null);
  const cursor = useRef(null);
  const [scroll, setScroll] = useState({ top: 0, h: 600 });
  const [fileDrop, setFileDrop] = useState(false);
  const [dropRow, setDropRow] = useState(null);
  const rowH = 30;
  const selSet = useMemo(() => new Set(selected), [selected]);
  const colorMap = useMemo(() => new Map(tagColors.map((t) => [t.tag, t.color])), [tagColors]);
  const cols = columns.filter((c) => c.visible);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScroll((s) => ({ ...s, h: el.clientHeight })));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 选中条目滚动到可见
  const ensureVisible = useCallback((idx) => {
    const el = bodyRef.current;
    if (!el || idx < 0) return;
    const top = idx * rowH + 4;
    if (top < el.scrollTop) el.scrollTop = top - 4;
    else if (top + rowH > el.scrollTop + el.clientHeight) el.scrollTop = top + rowH - el.clientHeight + 8;
  }, []);
  useEffect(() => {
    const h = (e) => {
      const i = rows.findIndex((r) => r.item.id === e.detail);
      ensureVisible(i);
    };
    window.addEventListener('mz-reveal', h);
    return () => window.removeEventListener('mz-reveal', h);
  }, [rows, ensureVisible]);
  useEffect(() => {
    if (selected.length === 1) ensureVisible(rows.findIndex((r) => r.item.id === selected[0]));
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const { select, toggleExpand, setSort, setColumns } = useStore.getState();
  const anchor = useStore((s) => s.anchor);

  const onRowMouseDown = (e, row, idx) => {
    const id = row.item.id;
    if (e.button !== 0 && selSet.has(id)) return;
    if (e.shiftKey && anchor != null) {
      const a = rows.findIndex((r) => r.item.id === anchor);
      const [x, y] = a < idx ? [a, idx] : [idx, a];
      select(rows.slice(x, y + 1).map((r) => r.item.id), anchor);
    } else if (e.ctrlKey || e.metaKey) {
      select(selSet.has(id) ? selected.filter((s) => s !== id) : [...selected, id], id);
    } else if (state.view.type === 'duplicates') {
      // 重复条目视图：点击选中整组
      const start = rows.slice(0, idx + 1).map((r) => r.groupStart).lastIndexOf(true);
      let end = idx + 1;
      while (end < rows.length && !rows[end].groupStart) end++;
      select(rows.slice(Math.max(0, start), end).map((r) => r.item.id), id);
    } else if (!selSet.has(id)) select([id], id);
    // 已选中多项时，按下不改变选择（便于拖动），松开时在 onClick 里改为单选
  };

  const onKeyDown = (e) => {
    const sIdx = rows.findIndex((r) => r.item.id === (anchor ?? selected[selected.length - 1]));
    const idx = e.shiftKey && cursor.current != null && rows[cursor.current] && selSet.has(rows[cursor.current].item.id) ? cursor.current : sIdx;
    const cur = rows[idx];
    const move = (to) => {
      to = Math.max(0, Math.min(rows.length - 1, to));
      if (!rows[to]) return;
      if (e.shiftKey && anchor != null) {
        const a = rows.findIndex((r) => r.item.id === anchor);
        const [x, y] = a < to ? [a, to] : [to, a];
        select(rows.slice(x, y + 1).map((r) => r.item.id), anchor);
        cursor.current = to;
      } else {
        select([rows[to].item.id], rows[to].item.id);
        cursor.current = to;
      }
      ensureVisible(to);
    };
    const ids = selected;
    const s = useStore.getState();
    if (e.key === 'ArrowDown') { e.preventDefault(); move(idx + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(idx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(rows.length - 1); }
    else if (e.key === 'PageDown') { e.preventDefault(); move(idx + Math.floor(scroll.h / rowH)); }
    else if (e.key === 'PageUp') { e.preventDefault(); move(idx - Math.floor(scroll.h / rowH)); }
    else if (e.key === 'ArrowRight' && cur) { e.preventDefault(); if (cur.hasKids && !s.expanded[cur.item.id]) toggleExpand(cur.item.id, true); else if (rows[idx + 1]?.depth) move(idx + 1); }
    else if (e.key === 'ArrowLeft' && cur) { e.preventDefault(); if (cur.depth) { const p = rows.findIndex((r) => r.item.id === cur.parent.id); move(p); } else toggleExpand(cur.item.id, false); }
    else if (e.key === 'Enter' && cur) openItem(cur.item);
    else if ((e.key === 'Delete' || e.key === 'Backspace') && ids.length) {
      e.preventDefault();
      if (state.view.type === 'trash') deleteForever(ids);
      else if (state.view.type === 'collection' && !e.shiftKey && e.key === 'Delete' && !(e.ctrlKey || e.metaKey)) removeFromCollection(ids.filter((i) => !getItem(i)?.parentId), state.view.id).then(() => ids.some((i) => getItem(i)?.parentId) && trashItems(ids.filter((i) => getItem(i)?.parentId)));
      else trashItems(ids);
    }
    else if ((e.key === '+' || e.key === '=') && !e.ctrlKey) { const ex = {}; rows.forEach((r) => { if (r.hasKids) ex[r.item.id] = true; }); s.setExpanded({ ...s.expanded, ...ex }); }
    else if (e.key === '-' && !e.ctrlKey) s.setExpanded({});
    else if ((e.ctrlKey || e.metaKey) && e.key === 'a') { e.preventDefault(); select(rows.map((r) => r.item.id)); }
    else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'C' || e.key === 'c')) { e.preventDefault(); copyBibliography(ids); }
    else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'A' || e.key === 'a')) { e.preventDefault(); copyCitation(ids); }
    else if (/^[1-9]$/.test(e.key) && !e.ctrlKey && ids.length) {
      // 数字键切换彩色标签（与 Zotero 相同）
      const tc = s.tagColors[+e.key - 1];
      if (!tc) return;
      const its = ids.map(getItem).filter(Boolean);
      const all = its.every((i) => i.tags.some((t) => t.tag === tc.tag));
      for (const it of its) updateItem(it.id, { tags: all ? it.tags.filter((t) => t.tag !== tc.tag) : [...it.tags.filter((t) => t.tag !== tc.tag), { tag: tc.tag, type: 0 }] });
    }
  };

  // —— 列头 ——
  const onHeaderMenu = (e) => showMenu(e, [
    ...DEFAULT_COLUMNS.filter((c) => c.key !== 'title').map((d) => {
      const c = columns.find((x) => x.key === d.key) || d;
      return { label: COLUMN_LABELS[d.key], checked: c.visible, onClick: () => setColumns(columns.map((x) => (x.key === d.key ? { ...x, visible: !x.visible } : x))) };
    }),
    '-',
    { label: '恢复默认列', onClick: () => setColumns(DEFAULT_COLUMNS) },
  ]);
  const startResize = (e, key) => {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const c = columns.find((x) => x.key === key);
    const w0 = c.width;
    const move = (ev) => setColumns(useStore.getState().columns.map((x) => (x.key === key ? { ...x, width: Math.max(30, w0 + ev.clientX - x0) } : x)));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // —— 拖拽 ——
  const onDragStart = (e, row) => {
    const ids = selSet.has(row.item.id) ? selected : [row.item.id];
    e.dataTransfer.setData('mz/items', JSON.stringify(ids));
    e.dataTransfer.setData('text/plain', ids.map((i) => itemTitle(getItem(i))).join('\n'));
    e.dataTransfer.effectAllowed = 'copyMove';
  };
  const onDropFiles = (e, parentRow) => {
    e.preventDefault();
    setFileDrop(false);
    setDropRow(null);
    const files = [...(e.dataTransfer.files || [])];
    const parent = parentRow?.item && parentRow.item.itemType !== 'note' && parentRow.item.itemType !== 'attachment' ? parentRow.item.id : null;
    if (files.length) return addFiles(files, { parentId: parent });
    // 把附件/笔记拖到父条目上
    try {
      const ids = JSON.parse(e.dataTransfer.getData('mz/items'));
      if (parent && ids?.length) {
        const movable = ids.map(getItem).filter((i) => i && (i.itemType === 'attachment' || i.itemType === 'note') && i.id !== parent);
        if (movable.length) api.post('/api/items/batch', { ids: movable.map((i) => i.id), op: 'setParent', parentId: parent }).then((r) => { useStore.getState().upsert(r.items); toggleExpand(parent, true); });
      }
    } catch { /* 忽略 */ }
  };

  const first = Math.max(0, Math.floor(scroll.top / rowH) - 10);
  const last = Math.min(rows.length, Math.ceil((scroll.top + scroll.h) / rowH) + 10);
  const empty = !rows.length;

  return (
    <div className="card items-card">
      <Toolbar count={count} />
      <div className="table" tabIndex={0} onKeyDown={onKeyDown}>
        <div className="thead" onContextMenu={onHeaderMenu}>
          <div style={{ width: 0 }} />
          {cols.map((c) => (
            <div
              key={c.key}
              className={`th${c.key === 'title' ? ' flex' : ''}${state.sort.field === c.key ? ' sorted' : ''}`}
              style={c.key === 'title' ? undefined : { width: c.width, justifyContent: c.key === 'attachments' || c.key === 'notes' ? 'center' : undefined }}
              onClick={() => setSort({ field: c.key, dir: state.sort.field === c.key ? -state.sort.dir : 1 })}
            >
              {c.key === 'attachments' ? <Paperclip size={13} /> : c.key === 'notes' ? <StickyNote size={13} /> : COLUMN_LABELS[c.key]}
              {state.sort.field === c.key && (state.sort.dir > 0 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
              {c.key !== 'title' && <span className="th-resize" onPointerDown={(e) => startResize(e, c.key)} onClick={(e) => e.stopPropagation()} />}
            </div>
          ))}
        </div>
        <div
          ref={bodyRef}
          className={`tbody${fileDrop ? ' drop' : ''}`}
          onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, h: e.currentTarget.clientHeight })}
          onMouseDown={(e) => { if (e.target === e.currentTarget) select([]); }}
          onContextMenu={(e) => { if (e.target === e.currentTarget) showMenu(e, newItemMenu()); }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setFileDrop(true); } }}
          onDragLeave={(e) => { if (e.target === e.currentTarget) setFileDrop(false); }}
          onDrop={(e) => onDropFiles(e, null)}
        >
          <div style={{ height: rows.length * rowH + 8, position: 'relative' }}>
            {rows.slice(first, last).map((row, i) => {
              const idx = first + i;
              const it = row.item;
              const sel = selSet.has(it.id);
              const kids = row.hasKids;
              const open = state.expanded[it.id] ?? (row.hasKids && rows[idx + 1]?.depth === 1);
              const dotColors = it.tags.map((t) => colorMap.get(t.tag)).filter(Boolean);
              const snippet = state.fulltextHits && (state.fulltextHits.get(it.id));
              return (
                <div
                  key={it.id}
                  className={`tr${sel ? ' sel' : ''}${row.context ? ' context' : ''}${dropRow === it.id ? ' drop' : ''}${row.groupStart && idx ? ' dup-group-sep' : ''}`}
                  style={{ top: idx * rowH + 4 }}
                  draggable
                  onDragStart={(e) => onDragStart(e, row)}
                  onDragOver={(e) => { if (row.depth === 0 && it.itemType !== 'note' && it.itemType !== 'attachment' && (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('mz/items'))) { e.preventDefault(); e.stopPropagation(); setDropRow(it.id); } }}
                  onDragLeave={() => setDropRow(null)}
                  onDrop={(e) => { e.stopPropagation(); onDropFiles(e, row); }}
                  onMouseDown={(e) => onRowMouseDown(e, row, idx)}
                  onClick={(e) => { if (!e.shiftKey && !e.ctrlKey && !e.metaKey && selected.length > 1 && state.view.type !== 'duplicates') select([it.id], it.id); }}
                  onDoubleClick={() => openItem(it)}
                  onContextMenu={(e) => showMenu(e, itemMenu(selSet.has(it.id) ? selected : [it.id]))}
                >
                  {cols.map((c) => {
                    if (c.key === 'title') {
                      return (
                        <div key="title" className="td flex" style={{ paddingLeft: 4 + row.depth * 22 }}>
                          <span className={`twisty${open ? ' open' : ''}`} style={{ visibility: kids ? 'visible' : 'hidden' }} onMouseDown={(e) => e.stopPropagation()} onClick={() => toggleExpand(it.id, !open)}>
                            <ChevronRight size={13} strokeWidth={2} />
                          </span>
                          <TypeIcon item={it} />
                          <span className="title-text">{itemTitle(it)}</span>
                          {busy[`rec${it.id}`] && <Loader2 size={13} className="spin muted" />}
                          {dotColors.length > 0 && <span className="tag-dots">{dotColors.slice(0, 6).map((cl, k) => <span key={k} className="dot" style={{ background: cl }} />)}</span>}
                          {snippet && <span className="hl-snippet" dangerouslySetInnerHTML={{ __html: markSnippet(snippet, state.searchText) }} />}
                        </div>
                      );
                    }
                    if (c.key === 'attachments') return <div key={c.key} className="td" style={{ width: c.width, padding: 0, display: 'flex', justifyContent: 'center' }}><AttIndicator row={row} /></div>;
                    if (c.key === 'notes') {
                      const n = row.depth === 0 && it.itemType !== 'note' ? notesCount(it) : 0;
                      return <div key={c.key} className="td td-muted" style={{ width: c.width, textAlign: 'center' }}>{n || ''}</div>;
                    }
                    return <div key={c.key} className="td td-muted" style={{ width: c.width }}>{row.depth === 0 ? cellValue(c.key, it) : ''}</div>;
                  })}
                </div>
              );
            })}
          </div>
          {empty && (
            <div className="empty" style={{ position: 'absolute', inset: 0 }}>
              <FileText size={34} strokeWidth={1.4} className="ico" />
              {state.searchText ? '没有找到匹配的条目' : state.view.type === 'trash' ? '回收站是空的' : state.view.type === 'duplicates' ? '没有重复条目' : '把 PDF 拖到这里，或点击上方魔法棒通过 DOI 添加'}
            </div>
          )}
          {fileDrop && <div className="drop-hint">松开以导入文件，PDF 会自动识别元数据</div>}
        </div>
      </div>
      <div className="items-foot">
        <span>{selected.length ? `已选择 ${selected.length} 项` : `${count} 个条目`}</span>
        {state.view.type === 'trash' && selected.length > 0 && (
          <span className="row-flex"><button className="btn btn-sm btn-ghost" onClick={() => restoreItems(selected)}>恢复</button></span>
        )}
      </div>
    </div>
  );
}

function markSnippet(snippet, q) {
  const safe = snippet.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const words = q.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return words.length ? safe.replace(new RegExp(`(${words.join('|')})`, 'gi'), '<mark>$1</mark>') : safe;
}

function notesCount(it) {
  return childrenOf(it.id).filter((c) => c.itemType === 'note' && !c.deleted).length;
}

function AttIndicator({ row }) {
  const it = row.item;
  if (it.itemType === 'attachment') {
    if (row.depth === 0) return null;
    return <span className={`att-ind${isPdf(it) ? ' pdf' : ''}`} onDoubleClick={(e) => { e.stopPropagation(); openItem(it); }}><TypeIcon item={it} size={14} plain /></span>;
  }
  if (it.itemType === 'note') return null;
  const kids = childrenOf(it.id).filter((c) => c.itemType === 'attachment' && !c.deleted);
  if (!kids.length) return null;
  const pdf = kids.find(isPdf);
  return (
    <span className={`att-ind${pdf ? ' pdf' : ''}`} title={pdf ? '打开 PDF' : '附件'} onMouseDown={(e) => e.stopPropagation()} onClick={() => openItem(it)}>
      {pdf ? <FileText size={14} strokeWidth={1.9} /> : <Paperclip size={14} strokeWidth={1.75} />}
    </span>
  );
}
