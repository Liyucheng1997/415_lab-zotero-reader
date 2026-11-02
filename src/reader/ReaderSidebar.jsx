import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Highlighter, Underline, StickyNote, Type, SquareDashed, PenLine, MoreHorizontal, Search, X, LayoutGrid, ListTree, MessageSquareText } from 'lucide-react';
import { ANNOTATION_COLORS } from '../../shared/schema.js';
import { showMenu, toast } from '../ui/overlay.jsx';
import { debounce } from '../lib/util.js';
import { annotationToHtml } from '../actions.js';
import { translateText } from '../lib/translate.jsx';

const TYPE_ICON = { highlight: Highlighter, underline: Underline, note: StickyNote, text: Type, image: SquareDashed, ink: PenLine };

function Thumbs({ viewRef, numPages, page, ready }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ready) return;
    const done = new Set();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const i = +e.target.dataset.i;
        if (done.has(i)) continue;
        done.add(i);
        const c = e.target.querySelector('canvas');
        viewRef.current?.renderThumb(i, 132, c).then(() => { c.style.display = 'block'; e.target.querySelector('.thumb-ph')?.remove(); }).catch(() => {});
      }
    }, { root: ref.current, rootMargin: '300px' });
    ref.current?.querySelectorAll('.thumb').forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [ready, numPages, viewRef]);
  useEffect(() => {
    ref.current?.querySelector(`.thumb[data-i="${page - 1}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [page]);
  return (
    <div className="rs-body" ref={ref}>
      <div className="thumbs">
        {Array.from({ length: numPages }, (_, i) => (
          <div key={i} className={`thumb${page === i + 1 ? ' active' : ''}`} data-i={i} onClick={() => { viewRef.current.page = i + 1; }}>
            <div className="thumb-ph" style={{ width: 132, height: 170 }} />
            <canvas style={{ display: 'none' }} />
            <span>{viewRef.current?.pageLabel(i) || i + 1}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function OutlineNode({ node, viewRef, depth }) {
  const [open, setOpen] = useState(depth < 1);
  const kids = node.items || [];
  return (
    <>
      <div className="ol-item" style={{ paddingLeft: 6 + depth * 14 }} onClick={() => (node.dest ? viewRef.current.goToDest(node.dest) : node.url && window.open(node.url, '_blank'))}>
        <span className={`nav-twisty${open ? ' open' : ''}`} style={{ visibility: kids.length ? 'visible' : 'hidden' }} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}><ChevronRight size={12} /></span>
        <span style={{ fontWeight: depth === 0 ? 500 : 400 }}>{node.title}</span>
      </div>
      {open && kids.map((k, i) => <OutlineNode key={i} node={k} viewRef={viewRef} depth={depth + 1} />)}
    </>
  );
}

const imgCache = new Map();
function AnnImage({ a, viewRef }) {
  const key = `${a.id}:${JSON.stringify(a.position.rects)}`;
  const [src, setSrc] = useState(imgCache.get(key));
  useEffect(() => {
    if (src) return;
    let alive = true;
    const t = setTimeout(() => viewRef.current?.renderRegion(a.position.pageIndex, a.position.rects[0], 1.6).then((u) => { if (u) { imgCache.set(key, u); if (alive) setSrc(u); } }).catch(() => {}), 200);
    return () => { alive = false; clearTimeout(t); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div className="ann-card-img" style={{ borderColor: a.color }}>{src ? <img src={src} alt="" /> : <div style={{ height: 60 }} />}</div>;
}

function AnnCard({ a, sel, onSelect, onUpdate, onDelete, onAddToNote, viewRef, parent }) {
  const Icon = TYPE_ICON[a.type] || Highlighter;
  const ref = useRef(null);
  const save = useMemo(() => debounce((v) => onUpdate(a.id, { comment: v }), 500), [a.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ref.current && document.activeElement !== ref.current) ref.current.textContent = a.comment || ''; }, [a.comment]);
  const menu = (e) => showMenu(e, [
    ...ANNOTATION_COLORS.map((c) => ({ label: c.name, swatch: c.color, checked: a.color === c.color, onClick: () => onUpdate(a.id, { color: c.color }) })),
    '-',
    ...(a.type === 'highlight' ? [{ label: '改为下划线', onClick: () => onUpdate(a.id, { type: 'underline' }) }] : a.type === 'underline' ? [{ label: '改为高亮', onClick: () => onUpdate(a.id, { type: 'highlight' }) }] : []),
    { label: '编辑页码…', onClick: async () => { const { prompt } = await import('../ui/overlay.jsx'); const v = await prompt({ title: '页码', value: a.pageLabel }); if (v) onUpdate(a.id, { pageLabel: v }); } },
    ...(a.text ? [{ label: '翻译并写入评论', onClick: async () => {
      try { const r = await translateText(a.text); onUpdate(a.id, { comment: a.comment ? `${a.comment}\n${r.text}` : r.text }); } catch (err) { toast(err.message, 'error'); }
    } }] : []),
    { label: '添加到笔记', onClick: () => onAddToNote(a) },
    { label: '复制', onClick: async () => { await navigator.clipboard.writeText([a.text, a.comment].filter(Boolean).join('\n\n')); toast('已复制', 'success'); } },
    '-',
    { label: '删除', danger: true, onClick: () => onDelete([a.id]) },
  ], { anchor: e.currentTarget, align: 'right' });
  return (
    <div
      id={`ann-card-${a.id}`}
      className={`ann-card${sel ? ' sel' : ''}`}
      onClick={() => onSelect(a)}
      onContextMenu={menu}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', [a.text && `“${a.text}”`, a.comment].filter(Boolean).join(' '));
        e.dataTransfer.setData('text/html', annotationToHtml(a, parent));
      }}
    >
      <div className="ann-card-head">
        <Icon size={13} style={{ color: a.color }} />
        <span className="grow">第 {a.pageLabel} 页</span>
        <button className="icon-btn sm" onClick={(e) => { e.stopPropagation(); menu(e); }}><MoreHorizontal size={14} /></button>
      </div>
      {(a.type === 'highlight' || a.type === 'underline') && a.text && <div className="ann-card-text" style={{ borderColor: a.color }}>{a.text}</div>}
      {a.type === 'image' && <AnnImage a={a} viewRef={viewRef} />}
      <div
        ref={ref}
        className="ann-card-comment"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        onClick={(e) => e.stopPropagation()}
        onInput={(e) => save(e.currentTarget.innerText)}
        onBlur={(e) => save.flush(e.currentTarget.innerText)}
        onKeyDown={(e) => e.stopPropagation()}
      />
      {a.tags?.length > 0 && <div className="ann-card-tags">{a.tags.map((t) => <span key={t}>{t}</span>)}</div>}
    </div>
  );
}

function Annotations({ anns, selId, ...rest }) {
  const [q, setQ] = useState('');
  const [colors, setColors] = useState([]);
  const [tags, setTags] = useState([]);
  const allTags = [...new Set(anns.flatMap((a) => a.tags || []))];
  const usedColors = ANNOTATION_COLORS.filter((c) => anns.some((a) => a.color === c.color));
  const ql = q.toLowerCase();
  const list = anns.filter((a) => (!ql || `${a.text || ''} ${a.comment || ''} ${(a.tags || []).join(' ')}`.toLowerCase().includes(ql))
    && (!colors.length || colors.includes(a.color)) && (!tags.length || tags.every((t) => a.tags?.includes(t))));
  return (
    <>
      <div style={{ padding: '0 10px 8px' }}>
        <div className="search" style={{ width: '100%' }}>
          <Search size={14} className="s-ico" />
          <input className="input" placeholder="搜索注释" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} style={{ paddingRight: 30 }} />
          {q && <button className="s-mode" onClick={() => setQ('')}><X size={12} /></button>}
        </div>
      </div>
      {(usedColors.length > 1 || allTags.length > 0) && (
        <div className="ann-filter">
          {usedColors.length > 1 && usedColors.map((c) => (
            <button key={c.color} className={`color-btn${colors.includes(c.color) ? ' active' : ''}`} style={{ color: c.color }} title={c.name}
              onClick={() => setColors(colors.includes(c.color) ? colors.filter((x) => x !== c.color) : [...colors, c.color])}><span className="c" style={{ background: c.color }} /></button>
          ))}
          {allTags.map((t) => <button key={t} className={`tag-pill${tags.includes(t) ? ' sel' : ''}`} onClick={() => setTags(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}>{t}</button>)}
        </div>
      )}
      <div className="rs-body">
        <div className="ann-list">
          {list.map((a) => <AnnCard key={a.id} a={a} sel={a.id === selId} {...rest} />)}
          {!list.length && (
            <div className="empty" style={{ padding: '40px 12px', fontSize: 13 }}>
              <Highlighter size={30} strokeWidth={1.4} className="ico" />
              {anns.length ? '没有匹配的注释' : '选中文本即可高亮，或用工具栏添加便笺、区域和手绘'}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default function ReaderSidebar({ view, setView, viewRef, numPages, page, outline, ready, anns, selId, parent, onSelect, onUpdate, onDelete, onAddToNote }) {
  return (
    <>
      <div className="rs-head">
        <div className="seg" style={{ width: '100%', display: 'flex' }}>
          <button style={{ flex: 1, justifyContent: 'center' }} className={view === 'thumbs' ? 'active' : ''} onClick={() => setView('thumbs')} title="缩略图"><LayoutGrid size={14} /></button>
          <button style={{ flex: 1, justifyContent: 'center' }} className={view === 'annotations' ? 'active' : ''} onClick={() => setView('annotations')} title="注释"><MessageSquareText size={14} />{anns.length > 0 && <span className="tabular">{anns.length}</span>}</button>
          <button style={{ flex: 1, justifyContent: 'center' }} className={view === 'outline' ? 'active' : ''} onClick={() => setView('outline')} title="大纲"><ListTree size={14} /></button>
        </div>
      </div>
      {view === 'thumbs' && <Thumbs viewRef={viewRef} numPages={numPages} page={page} ready={ready} />}
      {view === 'outline' && (
        <div className="rs-body">
          <div className="outline">
            {outline?.length ? outline.map((n, i) => <OutlineNode key={i} node={n} viewRef={viewRef} depth={0} />) : <div className="empty" style={{ padding: 30 }}>{outline ? '此文档没有大纲' : <div className="spinner" />}</div>}
          </div>
        </div>
      )}
      {view === 'annotations' && <Annotations anns={anns} selId={selId} onSelect={onSelect} onUpdate={onUpdate} onDelete={onDelete} onAddToNote={onAddToNote} viewRef={viewRef} parent={parent} />}
    </>
  );
}
