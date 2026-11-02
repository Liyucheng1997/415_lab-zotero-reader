import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  PanelLeft, PanelRight, MousePointer2, Hand, Highlighter, Underline, StickyNote, Type, SquareDashed, PenLine, Eraser, ChevronUp, ChevronDown,
  ZoomIn, ZoomOut, Search, X, MoreHorizontal, Copy, Trash2, NotebookPen, RotateCw, RotateCcw, FileDown, FolderOpen, Moon, Columns2, AlignJustify, Languages,
} from 'lucide-react';
import { PdfView } from './pdfView.js';
import ReaderSidebar from './ReaderSidebar.jsx';
import ContextPane from './ContextPane.jsx';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { showMenu, toast } from '../ui/overlay.jsx';
import { ANNOTATION_COLORS } from '../../shared/schema.js';
import { debounce, local, saveLocal } from '../lib/util.js';
import { showFile, annotationToHtml, createNote } from '../actions.js';
import { Resizer } from '../library/LibraryView.jsx';
import { TranslationBox, translateText } from '../lib/translate.jsx';

const TOOLS = [
  { key: 'highlight', icon: Highlighter, label: '高亮文本', hot: 'h' },
  { key: 'underline', icon: Underline, label: '下划线', hot: 'u' },
  { key: 'note', icon: StickyNote, label: '添加便笺', hot: 'n' },
  { key: 'text', icon: Type, label: '添加文本', hot: 't' },
  { key: 'image', icon: SquareDashed, label: '选择区域', hot: 'a' },
  { key: 'ink', icon: PenLine, label: '手绘', hot: 'd' },
  { key: 'eraser', icon: Eraser, label: '橡皮擦', hot: 'e' },
];
const bySort = (a, b) => (a.sortIndex || '').localeCompare(b.sortIndex || '');

function ColorRow({ value, onPick }) {
  return ANNOTATION_COLORS.map((c) => (
    <button key={c.color} className={`color-btn${value === c.color ? ' active' : ''}`} style={{ color: c.color }} title={c.name} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c.color)}>
      <span className="c" style={{ background: c.color }} />
    </button>
  ));
}

function AnnotationPopup({ a, pos, onChange, onDelete, onAddToNote, onClose }) {
  const [comment, setComment] = useState(a.comment || '');
  const [showTr, setShowTr] = useState(false);
  const [tags, setTags] = useState((a.tags || []).join(', '));
  const saveComment = useMemo(() => debounce((v) => onChange({ comment: v }), 400), [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => saveComment.cancel(), [saveComment]);
  return (
    <div className="ann-popup" style={pos} onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <div className="row-flex" style={{ gap: 0 }}>
        <ColorRow value={a.color} onPick={(color) => onChange({ color })} />
        <div className="grow" />
        <button className="icon-btn sm" onClick={onClose}><X size={14} /></button>
      </div>
      {a.text && <div className="ann-card-text" style={{ borderColor: a.color, margin: 0, maxHeight: 96, overflow: 'auto' }}>{a.text}</div>}
      {showTr && a.text && (
        <TranslationBox text={a.text} compact maxHeight={140}
          actions={(r) => <button className="btn btn-sm btn-ghost" style={{ height: 24, padding: '0 8px' }} onClick={() => { const v = comment ? `${comment}\n${r.text}` : r.text; setComment(v); onChange({ comment: v }); }}>填入评论</button>} />
      )}
      <textarea
        className="input"
        autoFocus={a.type === 'note' || a.type === 'text' || !a.text}
        placeholder={a.type === 'text' ? '输入文本…' : '添加评论…'}
        value={comment}
        onChange={(e) => { setComment(e.target.value); saveComment(e.target.value); }}
        onBlur={() => saveComment.flush(comment)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { saveComment.flush(comment); onClose(); } }}
      />
      {a.type === 'text' && (
        <label className="row-flex" style={{ fontSize: 12, color: 'var(--text-2)' }}>字号
          <input type="range" min="8" max="48" value={a.position.fontSize || 14} onChange={(e) => onChange({ position: { ...a.position, fontSize: +e.target.value, rects: [[a.position.rects[0][0], a.position.rects[0][3] - +e.target.value, a.position.rects[0][2], a.position.rects[0][3]]] } })} style={{ flex: 1 }} />
          <span className="tabular" style={{ width: 22 }}>{a.position.fontSize || 14}</span>
        </label>
      )}
      <input className="input sm" placeholder="标签（逗号分隔）" value={tags} onChange={(e) => setTags(e.target.value)}
        onBlur={() => onChange({ tags: tags.split(/[,，;]/).map((t) => t.trim()).filter(Boolean) })} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }} />
      <div className="row-flex">
        <span className="muted tabular" style={{ fontSize: 12 }}>第 {a.pageLabel} 页</span>
        <div className="grow" />
        {a.text && <button className={`icon-btn sm${showTr ? ' on' : ''}`} title="翻译" onClick={() => setShowTr(!showTr)}><Languages size={14} /></button>}
        {a.text && <button className="icon-btn sm" title="复制文本" onClick={() => { navigator.clipboard.writeText(a.text); toast('已复制', 'success'); }}><Copy size={14} /></button>}
        <button className="icon-btn sm" title="添加到笔记" onClick={onAddToNote}><NotebookPen size={14} /></button>
        <button className="icon-btn sm" title="删除" onClick={onDelete} style={{ color: 'var(--danger)' }}><Trash2 size={14} /></button>
      </div>
    </div>
  );
}

export default function Reader({ attachmentId, active }) {
  const att = useStore((s) => s.items[attachmentId]);
  const parent = useStore((s) => (att?.parentId ? s.items[att.parentId] : null));
  const prefs = useStore((s) => s.prefs);
  const theme = useStore((s) => s.theme);
  const pendingNav = useStore((s) => (s.pendingNav?.id === attachmentId ? s.pendingNav : null));
  const containerRef = useRef(null);
  const mainRef = useRef(null);
  const viewRef = useRef(null);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState('1');
  const [scale, setScale] = useState(1);
  const [anns, setAnns] = useState([]);
  const [selId, setSelId] = useState(null);
  const [tool, setTool] = useState('select');
  const [color, setColor] = useState(local('annColor', '#ffd400'));
  const [sidebar, setSidebar] = useState(local('readerSidebar', 'annotations'));
  const [ctxOpen, setCtxOpen] = useState(local('readerCtx', true));
  const [selPopup, setSelPopup] = useState(null);
  const [lastSelText, setLastSelText] = useState('');
  const selTr = useRef(null);
  const [annPopup, setAnnPopup] = useState(null);
  const [find, setFind] = useState(null);
  const [outline, setOutline] = useState(null);
  const [ctxNoteId, setCtxNoteId] = useState(null);
  const [darkPdf, setDarkPdf] = useState(null);
  const lastDeleted = useRef(null);
  const findRef = useRef(null);

  const isDark = useMemo(() => document.documentElement.dataset.theme === 'dark', [theme]); // eslint-disable-line react-hooks/exhaustive-deps
  const pdfDark = darkPdf ?? (isDark && prefs.pdfDark);

  const setCount = useCallback((n) => {
    const it = useStore.getState().items[attachmentId];
    if (it) useStore.getState().upsert([{ ...it, annotationCount: n }]);
  }, [attachmentId]);

  // —— 注释增删改 ——
  const createAnnotation = useCallback(async (draft) => {
    try {
      const a = await api.post('/api/annotations', { ...draft, attachmentId });
      setAnns((prev) => { const n = [...prev, a].sort(bySort); setCount(n.length); return n; });
      return a;
    } catch (e) { toast(e.message, 'error'); return null; }
  }, [attachmentId, setCount]);
  const updateAnnotation = useCallback(async (id, patch) => {
    setAnns((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
    try {
      const a = await api.patch(`/api/annotations/${id}`, patch);
      setAnns((prev) => prev.map((x) => (x.id === id ? a : x)));
    } catch (e) { toast(e.message, 'error'); }
  }, []);
  const deleteAnnotations = useCallback(async (ids) => {
    let removed = [];
    setAnns((prev) => { removed = prev.filter((a) => ids.includes(a.id)); const n = prev.filter((a) => !ids.includes(a.id)); setCount(n.length); return n; });
    setSelId(null);
    setAnnPopup(null);
    await api.post('/api/annotations/delete', { ids });
    lastDeleted.current = removed;
    if (removed.length) toast(`已删除 ${removed.length} 条注释 · Ctrl+Z 撤销`);
  }, [setCount]);
  const undoDelete = useCallback(async () => {
    const list = lastDeleted.current;
    if (!list?.length) return;
    lastDeleted.current = null;
    for (const a of list) await createAnnotation({ type: a.type, text: a.text, comment: a.comment, color: a.color, pageLabel: a.pageLabel, sortIndex: a.sortIndex, position: a.position, tags: a.tags });
    toast('已恢复注释', 'success');
  }, [createAnnotation]);

  // 由选区创建高亮/下划线；comment 为译文时直接写入，否则按设置自动翻译后写入
  const annotateFrom = useCallback(async (type, c, sel, comment) => {
    const created = [];
    for (const p of sel.pages) created.push(await createAnnotation({ type, color: c, text: sel.text, comment: comment || null, pageLabel: p.pageLabel, sortIndex: p.sortIndex, position: { pageIndex: p.pageIndex, rects: p.rects } }));
    if (!comment && useStore.getState().prefs.translateIntoComment) {
      const cached = selTr.current;
      const tr = cached?.source && cached.source === sel.text ? cached : await translateText(sel.text).catch(() => null);
      if (tr?.text) for (const a of created.filter(Boolean)) updateAnnotation(a.id, { comment: tr.text });
    }
  }, [createAnnotation, updateAnnotation]);
  const annotateSelection = (type, c, comment) => {
    const sel = selPopup?.sel;
    getSelection().removeAllRanges();
    setSelPopup(null);
    if (sel) annotateFrom(type, c, sel, comment);
  };

  const addToNote = useCallback(async (html) => {
    if (ctxNoteId && useStore.getState().items[ctxNoteId]) {
      window.dispatchEvent(new CustomEvent('mz-note-insert', { detail: { noteId: ctxNoteId, html } }));
      return;
    }
    const n = await createNote(parent?.id || null, html);
    setCtxNoteId(n.id);
    setCtxOpen(true);
    toast('已添加到新笔记', 'success');
  }, [ctxNoteId, parent]);

  const annHtml = useCallback(async (a) => {
    const copy = { ...a };
    if (a.type === 'image') copy.image = await viewRef.current?.renderRegion(a.position.pageIndex, a.position.rects[0], 1.5);
    return annotationToHtml(copy, parent);
  }, [parent]);

  // 最新状态供 PdfView 回调使用
  const live = useRef({});
  live.current = { tool, color, createAnnotation, updateAnnotation, deleteAnnotations, anns, annotateFrom };

  const popupPos = (r, w = 300, h = 220) => {
    const m = mainRef.current.getBoundingClientRect();
    let left = (r.left + r.right) / 2 - m.left - w / 2;
    left = Math.max(8, Math.min(m.width - w - 8, left));
    let top = r.bottom - m.top + 10;
    if (top > m.height - h - 10) top = Math.max(50, r.top - m.top - h - 10);
    return { left, top };
  };

  useEffect(() => {
    const view = new PdfView(containerRef.current, {
      onInit: async () => {
        const st = await api.get(`/api/settings/reader:${attachmentId}`).catch(() => null);
        view.restore(st?.value?.location);
        setNumPages(view.numPages);
        setStatus('ready');
        view.doc.getOutline().then((o) => setOutline(o || [])).catch(() => setOutline([]));
      },
      onPage: (n) => { setPage(n); setPageInput(view.pageLabel(n - 1)); },
      onScale: (s) => setScale(s),
      onViewArea: debounce((loc) => api.put(`/api/settings/reader:${attachmentId}`, { value: { location: { pageNumber: loc.pageNumber, scale: loc.scale, top: loc.top, left: loc.left } } }).catch(() => {}), 800),
      onFindCount: (m) => setFind((f) => (f ? { ...f, count: m } : f)),
      onSelection: async (s) => {
        const L = live.current;
        if (!s) { setSelPopup(null); return; }
        setLastSelText(s.text);
        selTr.current = null;
        if (L.tool === 'highlight' || L.tool === 'underline') {
          getSelection().removeAllRanges();
          setSelPopup(null);
          L.annotateFrom(L.tool, L.color, s);
          return;
        }
        const auto = useStore.getState().prefs.autoTranslate;
        if (s.anchor) setSelPopup({ sel: s, showTr: auto, pos: popupPos(s.anchor, 380, auto ? 270 : 50) });
      },
      onAnnotationClick: (a) => {
        setSelPopup(null);
        if (!a) { setSelId(null); setAnnPopup(null); return; }
        setSelId(a.id);
        const r = view.clientRectOf(a);
        if (r) setAnnPopup({ id: a.id, pos: popupPos(r) });
        document.getElementById(`ann-card-${a.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      },
      onCreate: async (draft) => {
        const a = await live.current.createAnnotation(draft);
        if (a && (a.type === 'note' || a.type === 'text')) {
          setSelId(a.id);
          setTimeout(() => { const r = view.clientRectOf(a); if (r) setAnnPopup({ id: a.id, pos: popupPos(r) }); }, 30);
        }
        return a;
      },
      onUpdate: (id, patch) => live.current.updateAnnotation(id, patch),
      onDelete: (ids) => live.current.deleteAnnotations(ids),
    });
    viewRef.current = view;
    view.open(`/api/file/${attachmentId}`).catch((e) => { setStatus('error'); setError(e?.message || String(e)); });
    api.get(`/api/annotations/${attachmentId}`).then((list) => setAnns(list.sort(bySort))).catch(() => {});
    return () => view.destroy();
  }, [attachmentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { viewRef.current?.setAnnotations(anns, selId); }, [anns, selId]);
  useEffect(() => { viewRef.current?.setTool(tool, color); if (tool !== 'select') { setSelPopup(null); } }, [tool, color]);
  useEffect(() => { containerRef.current?.classList.toggle('pdf-dark', !!pdfDark); }, [pdfDark]);
  useEffect(() => { saveLocal('annColor', color); }, [color]);
  useEffect(() => { saveLocal('readerSidebar', sidebar); }, [sidebar]);
  useEffect(() => { saveLocal('readerCtx', ctxOpen); }, [ctxOpen]);
  // 从文库跳转到某条注释
  useEffect(() => {
    if (!pendingNav || status !== 'ready') return;
    const a = anns.find((x) => x.id === pendingNav.annotationId);
    if (a) { viewRef.current.scrollToAnnotation(a); setSelId(a.id); }
    else if (pendingNav.page) viewRef.current.page = pendingNav.page;
    useStore.getState().clearPendingNav();
  }, [pendingNav, status, anns]);

  // 快捷键
  useEffect(() => {
    if (!active) return;
    const key = (e) => {
      const tag = e.target.tagName;
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;
      const v = viewRef.current;
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); setFind((f) => f || { q: getSelection().toString().slice(0, 100), count: null }); setTimeout(() => findRef.current?.select(), 0); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) { e.preventDefault(); v?.zoom(1.1); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); v?.zoom(1 / 1.1); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); v?.setScale('page-width'); return; }
      if (editing) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undoDelete(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') { setTool('select'); setSelId(null); setAnnPopup(null); setSelPopup(null); setFind(null); v?.clearFind(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selId) { e.preventDefault(); deleteAnnotations([selId]); return; }
      const t = TOOLS.find((x) => x.hot === e.key.toLowerCase());
      if (t) { setTool((cur) => (cur === t.key ? 'select' : t.key)); return; }
      if (e.key === 'ArrowRight' && v && !containerRef.current.contains(document.activeElement)) { v.page = v.page + 1; }
      if (e.key === 'ArrowLeft' && v && !containerRef.current.contains(document.activeElement)) { v.page = v.page - 1; }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [active, selId, deleteAnnotations, undoDelete]);

  // 标签页激活时重新计算尺寸
  useEffect(() => { if (active && viewRef.current?.viewer) requestAnimationFrame(() => viewRef.current.viewer.update?.()); }, [active, sidebar, ctxOpen]);

  const v = viewRef.current;
  const selAnn = anns.find((a) => a.id === annPopup?.id);
  const zoomMenu = (e) => showMenu(e, [
    { label: '适合宽度', onClick: () => v.setScale('page-width') },
    { label: '适合页面', onClick: () => v.setScale('page-fit') },
    { label: '自动', onClick: () => v.setScale('auto') },
    '-',
    ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((z) => ({ label: `${z * 100}%`, checked: Math.abs(scale - z) < 0.01, onClick: () => v.setScale(z) })),
  ], { anchor: e.currentTarget });
  const moreMenu = (e) => showMenu(e, [
    { label: '顺时针旋转', icon: RotateCw, onClick: () => v.rotate(90) },
    { label: '逆时针旋转', icon: RotateCcw, onClick: () => v.rotate(-90) },
    '-',
    { label: '单页', icon: AlignJustify, onClick: () => v.setSpread(0) },
    { label: '双页（奇数页在左）', icon: Columns2, onClick: () => v.setSpread(1) },
    { label: '双页（偶数页在左）', icon: Columns2, onClick: () => v.setSpread(2) },
    '-',
    { label: '纵向滚动', onClick: () => v.setScrollMode(0) },
    { label: '横向滚动', onClick: () => v.setScrollMode(1) },
    { label: '平铺', onClick: () => v.setScrollMode(2) },
    '-',
    { label: '深色页面', icon: Moon, checked: !!pdfDark, onClick: () => setDarkPdf(!pdfDark) },
    '-',
    { label: '导出带注释的 PDF', icon: FileDown, onClick: () => { location.href = `/api/items/${attachmentId}/export-pdf`; } },
    { label: '在文件夹中显示', icon: FolderOpen, onClick: () => showFile(attachmentId) },
  ], { anchor: e.currentTarget, align: 'right' });

  const ToolColor = (
    <button className="tool-color" title="注释颜色" onClick={(e) => showMenu(e, ANNOTATION_COLORS.map((c) => ({ label: c.name, swatch: c.color, checked: c.color === color, onClick: () => setColor(c.color) })), { anchor: e.currentTarget })}>
      <span className="swatch-dot" style={{ background: color }} />
    </button>
  );

  return (
    <div className="reader" style={active ? undefined : { display: 'none' }}>
      {sidebar && (
        <>
          <div className="card reader-side">
            <ReaderSidebar
              view={sidebar} setView={setSidebar} viewRef={viewRef} numPages={numPages} page={page} outline={outline} ready={status === 'ready'}
              anns={anns} selId={selId} parent={parent}
              onSelect={(a) => { setSelId(a.id); viewRef.current?.scrollToAnnotation(a); setAnnPopup(null); }}
              onUpdate={updateAnnotation} onDelete={deleteAnnotations} onAddToNote={async (a) => addToNote(await annHtml(a))}
            />
          </div>
          <Resizer varName="--rside-w" min={180} max={480} />
        </>
      )}
      <div className="card reader-main" ref={mainRef}>
        <div className="reader-toolbar">
          <button className={`icon-btn${sidebar ? ' on' : ''}`} title="侧栏" onClick={() => setSidebar(sidebar ? null : 'annotations')}><PanelLeft size={17} strokeWidth={1.75} /></button>
          <div className="sep-v" />
          <button className={`icon-btn${tool === 'select' ? ' on' : ''}`} title="选择文本 (Esc)" onClick={() => setTool('select')}><MousePointer2 size={16} strokeWidth={1.75} /></button>
          <button className={`icon-btn${tool === 'hand' ? ' on' : ''}`} title="抓手" onClick={() => setTool('hand')}><Hand size={16} strokeWidth={1.75} /></button>
          <div className="sep-v" />
          {TOOLS.map((t) => (
            <button key={t.key} className={`icon-btn${tool === t.key ? ' on' : ''}`} title={`${t.label} (${t.hot.toUpperCase()})`} onClick={() => setTool(tool === t.key ? 'select' : t.key)}>
              <t.icon size={16} strokeWidth={1.75} />
            </button>
          ))}
          {ToolColor}
          <div className="sep-v" />
          <button className="icon-btn" title="上一页" disabled={page <= 1} onClick={() => { v.page = page - 1; }}><ChevronUp size={17} /></button>
          <input className="page-input" value={pageInput} onChange={(e) => setPageInput(e.target.value)} onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') {
                const lbl = v.pageLabels?.indexOf(pageInput);
                const n = lbl >= 0 ? lbl + 1 : parseInt(pageInput, 10);
                if (n) v.page = n;
                e.currentTarget.blur();
              }
            }} />
          <span className="muted tabular" style={{ fontSize: 12, padding: '0 4px', whiteSpace: 'nowrap' }}>/ {numPages || '–'}</span>
          <button className="icon-btn" title="下一页" disabled={page >= numPages} onClick={() => { v.page = page + 1; }}><ChevronDown size={17} /></button>
          <div className="sep-v" />
          <button className="icon-btn" title="缩小 (Ctrl -)" onClick={() => v.zoom(1 / 1.1)}><ZoomOut size={16} strokeWidth={1.75} /></button>
          <button className="zoom-btn" onClick={zoomMenu}>{Math.round(scale * 100)}%</button>
          <button className="icon-btn" title="放大 (Ctrl +)" onClick={() => v.zoom(1.1)}><ZoomIn size={16} strokeWidth={1.75} /></button>
          <div className="grow" />
          <button className={`icon-btn${find ? ' on' : ''}`} title="查找 (Ctrl+F)" onClick={() => { setFind(find ? null : { q: '', count: null }); if (find) v.clearFind(); }}><Search size={16} strokeWidth={1.75} /></button>
          <button className="icon-btn" title="更多" onClick={moreMenu}><MoreHorizontal size={17} /></button>
          <button className={`icon-btn${ctxOpen ? ' on' : ''}`} title="条目与笔记" onClick={() => setCtxOpen(!ctxOpen)}><PanelRight size={17} strokeWidth={1.75} /></button>
        </div>
        <div className="viewer-wrap">
          <div ref={containerRef} className="viewer-container" tabIndex={0} />
          {status === 'loading' && <div className="empty" style={{ position: 'absolute', inset: 0 }}><div className="spinner" /></div>}
          {status === 'error' && (
            <div className="empty" style={{ position: 'absolute', inset: 0 }}>
              <span>无法打开 PDF：{error}</span>
              <button className="btn" onClick={() => showFile(attachmentId)}>在文件夹中显示</button>
            </div>
          )}
          {find && (
            <div className="find-bar" onMouseDown={(e) => e.stopPropagation()}>
              <input ref={findRef} className="input" autoFocus placeholder="在文档中查找" value={find.q}
                onChange={(e) => { setFind({ ...find, q: e.target.value }); v.find(e.target.value); }}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') v.find(find.q, { again: true, previous: e.shiftKey });
                  if (e.key === 'Escape') { setFind(null); v.clearFind(); }
                }} />
              <span className="find-count">{find.count?.total ? `${find.count.current} / ${find.count.total}` : find.q ? '无结果' : ''}</span>
              <button className="icon-btn sm" onClick={() => v.find(find.q, { again: true, previous: true })}><ChevronUp size={15} /></button>
              <button className="icon-btn sm" onClick={() => v.find(find.q, { again: true })}><ChevronDown size={15} /></button>
              <button className="icon-btn sm" onClick={() => { setFind(null); v.clearFind(); }}><X size={14} /></button>
            </div>
          )}
        </div>
        {selPopup && (
          <div className="sel-popup" style={{ left: selPopup.pos.left, top: selPopup.pos.top }} onMouseDown={(e) => e.preventDefault()}>
            <div className="sel-row">
              <ColorRow value={null} onPick={(c) => annotateSelection('highlight', c)} />
              <div className="sep-v" />
              <button className="icon-btn sm" title="下划线" onClick={() => annotateSelection('underline', color)}><Underline size={15} /></button>
              <button className={`icon-btn sm${selPopup.showTr ? ' on' : ''}`} title="翻译" onClick={() => setSelPopup({ ...selPopup, showTr: !selPopup.showTr })}><Languages size={15} /></button>
              <button className="icon-btn sm" title="复制" onClick={() => { navigator.clipboard.writeText(selPopup.sel.text); toast('已复制', 'success'); setSelPopup(null); }}><Copy size={15} /></button>
              <button className="icon-btn sm" title="添加到笔记" onClick={() => {
                const p = selPopup.sel.pages[0];
                addToNote(annotationToHtml({ type: 'highlight', text: selPopup.sel.text, color, pageLabel: p.pageLabel }, parent));
                setSelPopup(null);
              }}><NotebookPen size={15} /></button>
              <button className="icon-btn sm" title="在网上搜索" onClick={() => { window.open(`https://www.google.com/search?q=${encodeURIComponent(selPopup.sel.text)}`, '_blank'); setSelPopup(null); }}><Search size={15} /></button>
            </div>
            {selPopup.showTr && (
              <TranslationBox
                text={selPopup.sel.text}
                maxHeight={180}
                onResult={(r) => { selTr.current = r; }}
                actions={(r) => <button className="btn btn-sm btn-ghost" style={{ height: 24, padding: '0 8px' }} onMouseDown={(e) => e.preventDefault()} onClick={() => annotateSelection('highlight', color, r.text)}>高亮并写入评论</button>}
              />
            )}
          </div>
        )}
        {selAnn && annPopup && (
          <AnnotationPopup
            key={selAnn.id}
            a={selAnn}
            pos={annPopup.pos}
            onChange={(patch) => updateAnnotation(selAnn.id, patch)}
            onDelete={() => deleteAnnotations([selAnn.id])}
            onAddToNote={async () => addToNote(await annHtml(selAnn))}
            onClose={() => setAnnPopup(null)}
          />
        )}
      </div>
      {ctxOpen && (
        <>
          <Resizer varName="--rctx-w" dir={-1} min={280} max={640} />
          <div className="card reader-ctx">
            <ContextPane att={att} parent={parent} noteId={ctxNoteId} setNoteId={setCtxNoteId} anns={anns} annHtml={annHtml} selText={lastSelText} />
          </div>
        </>
      )}
    </div>
  );
}
