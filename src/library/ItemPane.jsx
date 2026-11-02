import { useEffect, useMemo, useState } from 'react';
import {
  ChevronRight, ChevronDown, FileText, MoreHorizontal, Plus, Minus, X, FolderOpen, Trash2, ExternalLink, StickyNote, Paperclip, Link2, Search,
  RefreshCw, Wand2, BookMarked, Download, Folder, ArrowUpRight, Merge, Library, Highlighter, Loader2, FileDown, Pencil, Languages,
} from 'lucide-react';
import { useStore, getItem, childrenOf, bestAttachment, collectionPath } from '../store.js';
import { ITEM_TYPES, REGULAR_TYPES, FIELD_LABELS, CREATOR_LABELS, MULTILINE_FIELDS } from '../../shared/schema.js';
import Editable from './Editable.jsx';
import NoteEditor from './NoteEditor.jsx';
import { TypeIcon } from './icons.jsx';
import { showMenu, openDialog, toast } from '../ui/overlay.jsx';
import {
  updateItem, openItem, showFile, openExternal, trashItems, createNote, attachFileDialog, attachLink, findPdf, refreshMetadata, recognize,
  itemMenu, copyBibliography, renameFromParent, createParentItem,
} from '../actions.js';
import { api } from '../api.js';
import { itemTitle, creatorSummary, yearOf, containerOf, typeLabel, fmtDateTime, isPdf, isRegular, noteTitle, fmtDate } from '../lib/util.js';
import { duplicateGroups } from '../lib/search.js';
import { TranslationBox } from '../lib/translate.jsx';

const dialogs = () => import('../dialogs/dialogs.jsx');

function Section({ id, title, count, children, actions }) {
  const collapsed = useStore((s) => s.collapsed[`sec-${id}`]);
  const { setCollapsed } = useStore.getState();
  return (
    <div className={`section${collapsed ? ' closed' : ''}`}>
      <div className="section-head" onClick={() => setCollapsed(`sec-${id}`, !collapsed)}>
        <span className="nav-twisty"><ChevronRight size={13} strokeWidth={2} /></span>
        <span className="s-title">{title}{count != null && <span className="s-count">{count}</span>}</span>
        <span onClick={(e) => e.stopPropagation()} className="row-flex" style={{ gap: 2 }}>{actions}</span>
      </div>
      <div className="section-body">{children}</div>
    </div>
  );
}

// —— 作者 ——
function Creators({ item }) {
  const types = ITEM_TYPES[item.itemType]?.creators?.length ? ITEM_TYPES[item.itemType].creators : ['author', 'contributor', 'editor'];
  const [focusNew, setFocusNew] = useState(-1);
  const cs = item.creators;
  const save = (list) => updateItem(item.id, { creators: list });
  const set = (i, patch) => save(cs.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const add = (i) => { const n = [...cs]; n.splice(i + 1, 0, { creatorType: cs[i]?.creatorType || types[0], lastName: '', firstName: '' }); save(n); setFocusNew(i + 1); };
  const remove = (i) => save(cs.filter((_, k) => k !== i));
  const move = (i, d) => { const n = [...cs]; const [c] = n.splice(i, 1); n.splice(i + d, 0, c); save(n); };
  const toggleMode = (i) => {
    const c = cs[i];
    if (c.name != null) { const p = c.name.trim().split(/\s+/); const last = p.pop() || ''; set(i, { name: undefined, lastName: last, firstName: p.join(' ') }); }
    else set(i, { name: [c.firstName, c.lastName].filter(Boolean).join(' '), lastName: undefined, firstName: undefined });
  };
  const list = cs.length ? cs : [{ creatorType: types[0], lastName: '', firstName: '', placeholder: true }];
  return list.map((c, i) => (
    <div key={i} style={{ display: 'contents' }}>
      <div className="f-label btnlike" title="更改作者类型" onClick={(e) => showMenu(e, [
        ...types.map((t) => ({ label: CREATOR_LABELS[t] || t, checked: c.creatorType === t, onClick: () => (c.placeholder ? save([{ ...c, placeholder: undefined, creatorType: t }]) : set(i, { creatorType: t })) })),
        '-',
        { label: c.name != null ? '切换为两个字段' : '切换为单个字段', onClick: () => toggleMode(i), disabled: c.placeholder },
        { label: '上移', disabled: i === 0 || c.placeholder, onClick: () => move(i, -1) },
        { label: '下移', disabled: i === cs.length - 1 || c.placeholder, onClick: () => move(i, 1) },
        { label: '移到最前', disabled: i === 0 || c.placeholder, onClick: () => move(i, -i) },
      ])}>{CREATOR_LABELS[c.creatorType] || c.creatorType}</div>
      <div className="creator-row">
        {c.name != null ? (
          <Editable className="f-value" value={c.name} placeholder="名称" autoFocus={focusNew === i} onSave={(v) => set(i, { name: v })} />
        ) : (
          <>
            <Editable className="f-value last" value={c.lastName} placeholder="姓" autoFocus={focusNew === i}
              onSave={(v) => (c.placeholder ? save([{ creatorType: c.creatorType, lastName: v, firstName: '' }]) : set(i, { lastName: v }))} />
            <span className="muted">,</span>
            <Editable className="f-value" value={c.firstName} placeholder="名" onSave={(v) => (c.placeholder ? save([{ creatorType: c.creatorType, lastName: '', firstName: v }]) : set(i, { firstName: v }))} />
          </>
        )}
        <span className="c-btns">
          {!c.placeholder && <button className="icon-btn sm" title="移除" onClick={() => remove(i)}><Minus size={13} /></button>}
          <button className="icon-btn sm" title="添加作者" onClick={() => (c.placeholder ? save([{ creatorType: types[0], lastName: '', firstName: '' }, { creatorType: types[0], lastName: '', firstName: '' }]) : add(i))}><Plus size={13} /></button>
        </span>
      </div>
    </div>
  ));
}

// —— 字段 ——
function Fields({ item }) {
  const def = ITEM_TYPES[item.itemType]?.fields || [];
  const extraKeys = Object.keys(item.fields).filter((k) => !def.includes(k));
  const keys = [...def, ...extraKeys].filter((k) => k !== 'title' && k !== 'abstractNote');
  const save = (k, v) => updateItem(item.id, { fields: { ...item.fields, [k]: v } });
  const link = (k) => (k === 'url' && item.fields.url ? item.fields.url : k === 'DOI' && item.fields.DOI ? `https://doi.org/${item.fields.DOI}` : null);
  return (
    <div className="fields">
      <Creators item={item} />
      {keys.map((k) => (
        <div key={k} style={{ display: 'contents' }}>
          <div className={`f-label${link(k) ? ' btnlike' : ''}`} title={link(k) ? '在浏览器中打开' : FIELD_LABELS[k] || k} onClick={() => link(k) && window.open(link(k), '_blank')}>
            {FIELD_LABELS[k] || k}{link(k) && <ArrowUpRight size={11} style={{ verticalAlign: -1, marginLeft: 2 }} />}
          </div>
          <Editable className="f-value" value={item.fields[k]} multiline={MULTILINE_FIELDS.has(k)} onSave={(v) => save(k, v)} />
        </div>
      ))}
      <div className="f-label">添加日期</div>
      <div className="f-value td-muted" style={{ cursor: 'default' }}>{fmtDateTime(item.dateAdded)}</div>
      <div className="f-label">修改日期</div>
      <div className="f-value td-muted" style={{ cursor: 'default' }}>{fmtDateTime(item.dateModified)}</div>
    </div>
  );
}

// —— 标签 ——
export function TagsEditor({ item }) {
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState('');
  const tagColors = useStore((s) => s.tagColors);
  const allTags = useMemo(() => [...new Set(Object.values(useStore.getState().items).flatMap((i) => i.tags.map((t) => t.tag)))].sort(), [adding]); // eslint-disable-line react-hooks/exhaustive-deps
  const color = new Map(tagColors.map((t) => [t.tag, t.color]));
  const add = (t) => {
    const tags = t.split(/[;\n]/).map((x) => x.trim()).filter((x) => x && !item.tags.some((y) => y.tag === x));
    if (tags.length) updateItem(item.id, { tags: [...item.tags, ...tags.map((tag) => ({ tag, type: 0 }))] });
  };
  return (
    <div className="chips">
      {item.tags.map((t) => (
        <span key={t.tag} className={`tag-chip${t.type === 1 ? ' auto' : ''}`} title={t.type === 1 ? '自动标签' : ''}>
          {color.has(t.tag) && <span className="dot" style={{ background: color.get(t.tag) }} />}
          <span className="ellipsis">{t.tag}</span>
          <button onClick={() => updateItem(item.id, { tags: item.tags.filter((x) => x.tag !== t.tag) })}><X size={11} /></button>
        </span>
      ))}
      {adding ? (
        <span className="tag-chip" style={{ paddingRight: 10 }}>
          <input autoFocus list="mz-all-tags" value={v} placeholder="新标签" onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { add(v); setV(''); } if (e.key === 'Escape') setAdding(false); }}
            onBlur={() => { if (v) add(v); setV(''); setAdding(false); }} />
          <datalist id="mz-all-tags">{allTags.slice(0, 2000).map((t) => <option key={t} value={t} />)}</datalist>
        </span>
      ) : (
        <button className="btn btn-sm" onClick={() => setAdding(true)}><Plus size={13} />添加</button>
      )}
    </div>
  );
}

function Related({ item }) {
  const items = useStore((s) => s.items);
  const rel = item.relations.map((id) => items[id]).filter(Boolean);
  const unrelate = async (other) => { const r = await api.post(`/api/items/${item.id}/relate`, { otherId: other, remove: true }); useStore.getState().upsert(r.items); };
  return (
    <>
      {rel.map((r) => (
        <div key={r.id} className="list-row" onClick={() => { useStore.getState().setView({ type: 'library' }); useStore.getState().select([r.id]); setTimeout(() => window.dispatchEvent(new CustomEvent('mz-reveal', { detail: r.id })), 50); }}>
          <TypeIcon item={r} />
          <div className="lr-main"><div className="lr-title">{itemTitle(r)}</div><div className="lr-sub">{[creatorSummary(r), yearOf(r.fields.date)].filter(Boolean).join(' · ')}</div></div>
          <span className="actions"><button className="icon-btn sm" title="移除关联" onClick={(e) => { e.stopPropagation(); unrelate(r.id); }}><X size={13} /></button></span>
        </div>
      ))}
      {!rel.length && <div className="muted" style={{ padding: '2px 8px 6px', fontSize: 12.5 }}>没有关联条目</div>}
    </>
  );
}

function AttachmentRow({ a }) {
  const busy = useStore((s) => s.busy[`rec${a.id}`]);
  return (
    <div className="list-row" onDoubleClick={() => openItem(a)} onClick={() => openItem(a)} onContextMenu={(e) => showMenu(e, itemMenu([a.id]))}>
      <TypeIcon item={a} />
      <div className="lr-main">
        <div className="lr-title">{itemTitle(a)}</div>
        <div className="lr-sub">{[a.filename && a.filename !== a.fields.title ? a.filename : '', a.annotationCount ? `${a.annotationCount} 条注释` : '', a.lastRead ? `上次阅读 ${fmtDate(a.lastRead)}` : ''].filter(Boolean).join(' · ') || (a.linkMode === 'linked_url' ? a.fields.url : '')}</div>
      </div>
      {busy && <Loader2 size={14} className="spin muted" />}
      <span className="actions">
        {a.linkMode !== 'linked_url' && <button className="icon-btn sm" title="在文件夹中显示" onClick={(e) => { e.stopPropagation(); showFile(a.id); }}><FolderOpen size={14} /></button>}
        <button className="icon-btn sm" title="移入回收站" onClick={(e) => { e.stopPropagation(); trashItems([a.id]); }}><Trash2 size={14} /></button>
      </span>
    </div>
  );
}

export function RegularPane({ item }) {
  const [focusTitle, setFocusTitle] = useState(false);
  const [showTr, setShowTr] = useState(false);
  const kids = childrenOf(item.id).filter((c) => !c.deleted || item.deleted);
  const atts = kids.filter((c) => c.itemType === 'attachment');
  const notes = kids.filter((c) => c.itemType === 'note');
  const att = bestAttachment(item);
  const busyRef = useStore((s) => s.busy[`ref${item.id}`]);
  const busyPdf = useStore((s) => s.busy[`pdf${item.id}`]);
  useEffect(() => {
    const h = (e) => e.detail === item.id && setFocusTitle(Date.now());
    window.addEventListener('mz-focus-title', h);
    return () => window.removeEventListener('mz-focus-title', h);
  }, [item.id]);
  const sub = [creatorSummary(item), yearOf(item.fields.date), containerOf(item)].filter(Boolean).join(' · ');
  return (
    <div className="pane-scroll">
      <div className="pane-head">
        <div className="pane-type">
          <button className="type-chip" title="更改条目类型" onClick={(e) => showMenu(e, REGULAR_TYPES.map((t) => ({ label: ITEM_TYPES[t].label, checked: item.itemType === t, onClick: () => updateItem(item.id, { itemType: t }) })), { anchor: e.currentTarget })}>
            <TypeIcon item={item} size={13} plain />{typeLabel(item.itemType)}<ChevronDown size={12} />
          </button>
          {item.deleted && <span className="row-flex" style={{ gap: 5, fontSize: 12, color: 'var(--danger)', fontWeight: 500 }}><span className="dot" style={{ background: 'var(--danger)' }} />已在回收站</span>}
        </div>
        <Editable key={`t${item.id}-${focusTitle}`} className="pane-title" value={item.fields.title} multiline autoFocus={!!focusTitle} onSave={(v) => updateItem(item.id, { fields: { ...item.fields, title: v } })} />
        {showTr && item.fields.title && <div style={{ marginTop: 8 }}><TranslationBox text={item.fields.title} compact maxHeight={120} /></div>}
        {sub && <div className="pane-sub">{sub}</div>}
        <div className="pane-actions">
          {att ? (
            <button className="btn btn-primary btn-sm" onClick={() => openItem(item)}>
              <FileText size={14} />{isPdf(att) ? '打开 PDF' : att.linkMode === 'linked_url' ? '打开链接' : '打开附件'}
            </button>
          ) : (
            <button className="btn btn-primary btn-sm" disabled={busyPdf} onClick={() => findPdf(item.id)}>{busyPdf ? <Loader2 size={14} className="spin" /> : <Search size={14} />}查找可用 PDF</button>
          )}
          {(item.fields.url || item.fields.DOI) && (
            <button className="btn btn-sm" onClick={() => window.open(item.fields.DOI ? `https://doi.org/${item.fields.DOI}` : item.fields.url, '_blank')}><ExternalLink size={14} />在线查看</button>
          )}
          <button className={`btn btn-sm${showTr ? ' btn-ghost' : ''}`} title="翻译标题和摘要" onClick={() => setShowTr(!showTr)}><Languages size={14} />翻译</button>
          <button className="btn btn-sm" onClick={(e) => showMenu(e, [
            { label: '更新元数据', icon: RefreshCw, onClick: () => refreshMetadata(item.id) },
            { label: '查找可用 PDF', icon: Search, onClick: () => findPdf(item.id) },
            '-',
            { label: '复制参考文献', icon: BookMarked, onClick: () => copyBibliography([item.id]) },
            { label: '生成参考文献…', icon: BookMarked, onClick: () => dialogs().then((m) => openDialog(m.BibliographyDialog, { ids: [item.id] })) },
            { label: '导出…', icon: Download, onClick: () => dialogs().then((m) => openDialog(m.ExportDialog, { ids: [item.id] })) },
            '-',
            { label: '移入回收站', icon: Trash2, danger: true, onClick: () => trashItems([item.id]) },
          ], { anchor: e.currentTarget })}>{busyRef ? <Loader2 size={14} className="spin" /> : <MoreHorizontal size={14} />}更多</button>
        </div>
      </div>

      <Section id="info" title="信息">
        <Fields item={item} />
      </Section>
      <Section id="abstract" title="摘要" actions={item.fields.abstractNote && <button className={`icon-btn sm${showTr ? ' on' : ''}`} title="翻译摘要" onClick={() => setShowTr(!showTr)}><Languages size={14} /></button>}>
        <Editable className="f-value abstract" value={item.fields.abstractNote} multiline placeholder="添加摘要…" onSave={(v) => updateItem(item.id, { fields: { ...item.fields, abstractNote: v } })} />
        {showTr && item.fields.abstractNote && <div style={{ marginTop: 8 }}><TranslationBox text={item.fields.abstractNote} maxHeight={9999} /></div>}
      </Section>
      <Section id="atts" title="附件" count={atts.length} actions={
        <button className="icon-btn sm" title="添加附件" onClick={(e) => showMenu(e, [
          { label: '附加文件…', icon: Paperclip, onClick: () => attachFileDialog(item.id) },
          { label: '附加网址链接…', icon: Link2, onClick: () => attachLink(item.id) },
          { label: '查找可用 PDF', icon: Search, onClick: () => findPdf(item.id) },
        ], { anchor: e.currentTarget, align: 'right' })}><Plus size={15} /></button>
      }>
        {atts.map((a) => <AttachmentRow key={a.id} a={a} />)}
        {!atts.length && <div className="muted" style={{ padding: '2px 8px 6px', fontSize: 12.5 }}>没有附件 · 可直接把文件拖到条目上</div>}
      </Section>
      <Section id="notes" title="笔记" count={notes.length} actions={<button className="icon-btn sm" title="添加笔记" onClick={() => createNote(item.id)}><Plus size={15} /></button>}>
        {notes.map((n) => (
          <div key={n.id} className="list-row" onClick={() => useStore.getState().select([n.id])} onContextMenu={(e) => showMenu(e, itemMenu([n.id]))}>
            <StickyNote size={15} strokeWidth={1.75} className="type-ico" />
            <div className="lr-main"><div className="lr-title">{noteTitle(n.note) || '无标题笔记'}</div><div className="lr-sub">{fmtDateTime(n.dateModified)}</div></div>
            <span className="actions"><button className="icon-btn sm" title="移入回收站" onClick={(e) => { e.stopPropagation(); trashItems([n.id]); }}><Trash2 size={14} /></button></span>
          </div>
        ))}
        {!notes.length && <div className="muted" style={{ padding: '2px 8px 6px', fontSize: 12.5 }}>没有笔记</div>}
      </Section>
      <Section id="tags" title="标签" count={item.tags.length}><TagsEditor item={item} /></Section>
      <Section id="related" title="关联" count={item.relations.length} actions={
        <button className="icon-btn sm" title="添加关联" onClick={async () => {
          const { ItemPicker } = await dialogs();
          const ids = await openDialog(ItemPicker, { title: '添加关联条目', exclude: [item.id] });
          for (const o of ids || []) { const r = await api.post(`/api/items/${item.id}/relate`, { otherId: o }); useStore.getState().upsert(r.items); }
        }}><Plus size={15} /></button>
      }><Related item={item} /></Section>
      <Section id="cols" title="所在分类" count={item.collections.length}>
        {item.collections.map((c) => (
          <div key={c} className="list-row" onClick={() => useStore.getState().setView({ type: 'collection', id: c })}>
            <Folder size={15} strokeWidth={1.75} className="type-ico" /><div className="lr-main"><div className="lr-title">{collectionPath(c)}</div></div>
          </div>
        ))}
        {!item.collections.length && <div className="muted" style={{ padding: '2px 8px 6px', fontSize: 12.5 }}>未分类 · 可把条目拖到左侧分类上</div>}
      </Section>
    </div>
  );
}

function AttachmentPane({ item }) {
  const parent = item.parentId ? getItem(item.parentId) : null;
  const [exists, setExists] = useState(null);
  const busy = useStore((s) => s.busy[`rec${item.id}`]);
  useEffect(() => {
    if (item.linkMode === 'linked_url') return;
    api.get(`/api/file/${item.id}/exists`).then(setExists).catch(() => {});
  }, [item.id, item.linkMode]);
  return (
    <div className="pane-scroll">
      <div className="pane-head">
        <div className="pane-type"><span className="type-chip"><TypeIcon item={item} size={13} plain />{isPdf(item) ? 'PDF 附件' : item.linkMode === 'linked_url' ? '网址链接' : '附件'}</span></div>
        <Editable className="pane-title" value={item.fields.title} onSave={(v) => updateItem(item.id, { fields: { ...item.fields, title: v } })} />
        {parent && <div className="pane-sub" style={{ cursor: 'pointer' }} onClick={() => useStore.getState().select([parent.id])}>来自：{itemTitle(parent)}</div>}
        <div className="pane-actions">
          <button className="btn btn-primary btn-sm" disabled={exists && !exists.exists} onClick={() => openItem(item)}><FileText size={14} />{isPdf(item) ? '在阅读器中打开' : '打开'}</button>
          {item.linkMode !== 'linked_url' && <button className="btn btn-sm" onClick={() => showFile(item.id)}><FolderOpen size={14} />显示文件</button>}
          {item.linkMode !== 'linked_url' && <button className="btn btn-sm" onClick={() => openExternal(item.id)}><ExternalLink size={14} />系统打开</button>}
        </div>
      </div>
      {exists && !exists.exists && (
        <div style={{ margin: '0 20px 12px', fontSize: 12.5, color: 'var(--text-2)', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span className="dot" style={{ background: 'var(--warning)', marginTop: 6 }} />
          <span>找不到文件：<span style={{ wordBreak: 'break-all' }}>{exists.path}</span></span>
        </div>
      )}
      <Section id="att-info" title="信息">
        <div className="fields">
          <div className="f-label">文件名</div><div className="f-value" style={{ cursor: 'default', wordBreak: 'break-all' }}>{item.filename || '—'}</div>
          {item.fields.url && <><div className="f-label btnlike" onClick={() => window.open(item.fields.url, '_blank')}>网址</div><div className="f-value link" style={{ cursor: 'pointer', wordBreak: 'break-all' }} onClick={() => window.open(item.fields.url, '_blank')}>{item.fields.url}</div></>}
          <div className="f-label">存储方式</div><div className="f-value" style={{ cursor: 'default' }}>{{ imported_file: '存储的文件', imported_url: '存储的网页快照', linked_file: '链接到文件', linked_url: '网址链接' }[item.linkMode] || item.linkMode}</div>
          {isPdf(item) && <><div className="f-label">注释</div><div className="f-value" style={{ cursor: 'default' }}>{item.annotationCount || 0} 条</div></>}
          <div className="f-label">添加日期</div><div className="f-value td-muted" style={{ cursor: 'default' }}>{fmtDateTime(item.dateAdded)}</div>
          {item.lastRead && <><div className="f-label">上次阅读</div><div className="f-value td-muted" style={{ cursor: 'default' }}>{fmtDateTime(item.lastRead)}</div></>}
        </div>
      </Section>
      <Section id="att-tools" title="操作">
        {!item.parentId && isPdf(item) && <div className="list-row" onClick={() => recognize(item.id)}>{busy ? <Loader2 size={15} className="spin" /> : <Wand2 size={15} className="type-ico" />}<div className="lr-main">重新抓取 PDF 的元数据</div></div>}
        {!item.parentId && <div className="list-row" onClick={() => createParentItem(item)}><Plus size={15} className="type-ico" /><div className="lr-main">创建父条目</div></div>}
        {item.parentId && item.linkMode === 'imported_file' && <div className="list-row" onClick={() => renameFromParent(item.id)}><Pencil size={15} className="type-ico" /><div className="lr-main">根据父条目重命名文件</div></div>}
        {isPdf(item) && <div className="list-row" onClick={() => { location.href = `/api/items/${item.id}/export-pdf`; }}><FileDown size={15} className="type-ico" /><div className="lr-main">导出带注释的 PDF</div></div>}
        {isPdf(item) && <div className="list-row" onClick={async () => { toast('正在建立全文索引…'); const r = await api.post(`/api/fulltext/index/${item.id}`).catch((e) => ({ error: e.message })); toast(r.ok ? '已建立索引' : r.error || '无法索引', r.ok ? 'success' : 'error'); }}><Search size={15} className="type-ico" /><div className="lr-main">重建全文索引</div></div>}
      </Section>
      <Section id="att-tags" title="标签" count={item.tags.length}><TagsEditor item={item} /></Section>
    </div>
  );
}

function NotePane({ item }) {
  const parent = item.parentId ? getItem(item.parentId) : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      {parent && (
        <div className="list-row" style={{ margin: '8px 8px 0' }} onClick={() => useStore.getState().select([parent.id])}>
          <TypeIcon item={parent} /><div className="lr-main"><div className="lr-sub">所属条目</div><div className="lr-title">{itemTitle(parent)}</div></div>
        </div>
      )}
      <NoteEditor noteId={item.id} />
    </div>
  );
}

function MergePane({ ids }) {
  const items = ids.map(getItem).filter(Boolean);
  const [master, setMaster] = useState(items[0]?.id);
  const m = getItem(master) || items[0];
  const doMerge = async () => {
    const others = items.filter((i) => i.id !== m.id);
    const fields = { ...m.fields };
    for (const o of others) for (const [k, v] of Object.entries(o.fields)) if (!fields[k]) fields[k] = v;
    const r = await api.post('/api/items/merge', { masterId: m.id, otherIds: others.map((o) => o.id), fields });
    useStore.getState().upsert(r.items);
    useStore.getState().select([m.id]);
    toast(`已合并 ${items.length} 个条目`, 'success');
  };
  return (
    <div className="pane-scroll">
      <div className="pane-head">
        <div className="pane-title" style={{ cursor: 'default' }}>合并 {items.length} 个条目</div>
        <div className="pane-sub">选择要保留的主版本。其他版本的附件、笔记、标签和分类都会转移到主版本，空缺字段会被补全，其余版本移入回收站。</div>
        <div className="pane-actions"><button className="btn btn-primary btn-sm" onClick={doMerge}><Merge size={14} />合并 {items.length} 个条目</button></div>
      </div>
      <Section id="merge" title="主版本">
        {items.map((i) => (
          <label key={i.id} className="list-row" style={{ cursor: 'pointer' }}>
            <input type="radio" checked={master === i.id} onChange={() => setMaster(i.id)} />
            <div className="lr-main"><div className="lr-title">{itemTitle(i)}</div><div className="lr-sub">添加于 {fmtDateTime(i.dateAdded)} · {childrenOf(i.id).length} 个子条目 · {Object.keys(i.fields).length} 个字段</div></div>
          </label>
        ))}
      </Section>
      {m && <Section id="merge-preview" title="主版本信息"><Fields item={m} /></Section>}
    </div>
  );
}

function MultiPane({ ids }) {
  const view = useStore((s) => s.view);
  const items = ids.map(getItem).filter(Boolean);
  const regular = items.filter(isRegular);
  const [merging, setMerging] = useState(false);
  useEffect(() => {
    const h = () => setMerging(true);
    window.addEventListener('mz-merge', h);
    return () => window.removeEventListener('mz-merge', h);
  }, []);
  const isDupGroup = view.type === 'duplicates' && duplicateGroups(useStore.getState()).some((g) => g.length === ids.length && g.every((x) => ids.includes(x)));
  if ((isDupGroup || merging) && regular.length === items.length && regular.length > 1) return <MergePane key={ids.join()} ids={ids} />;
  return (
    <div className="multi-sel">
      <div className="big-num">{ids.length}</div>
      <div className="muted" style={{ fontSize: 14 }}>已选择 {ids.length} 个条目</div>
      <div className="row-flex" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
        {regular.length > 0 && <button className="btn btn-sm" onClick={() => dialogs().then((m) => openDialog(m.BibliographyDialog, { ids: regular.map((i) => i.id) }))}><BookMarked size={14} />生成参考文献</button>}
        {regular.length > 0 && <button className="btn btn-sm" onClick={() => dialogs().then((m) => openDialog(m.ExportDialog, { ids: regular.map((i) => i.id) }))}><Download size={14} />导出</button>}
        {regular.length > 1 && regular.length === items.length && <button className="btn btn-sm" onClick={() => setMerging(true)}><Merge size={14} />合并</button>}
      </div>
    </div>
  );
}

function LibraryStats() {
  const version = useStore((s) => s.version);
  const st = useMemo(() => {
    const all = Object.values(useStore.getState().items).filter((i) => !i.deleted);
    return {
      items: all.filter(isRegular).length,
      pdfs: all.filter(isPdf).length,
      notes: all.filter((i) => i.itemType === 'note').length,
      anns: all.reduce((n, i) => n + (i.annotationCount || 0), 0),
      recent: all.filter((i) => i.itemType === 'attachment' && i.lastRead).sort((a, b) => (a.lastRead < b.lastRead ? 1 : -1)).slice(0, 6),
    };
  }, [version]);
  return (
    <div className="pane-scroll">
      <div className="pane-head">
        <div className="label-caps" style={{ marginBottom: 4 }}>Library</div>
        <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-.03em' }}>文库概览</div>
      </div>
      <div style={{ padding: '0 20px 16px' }}>
        <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="stat"><div className="l">条目</div><div className="n">{st.items}</div></div>
          <div className="stat"><div className="l">PDF</div><div className="n">{st.pdfs}</div></div>
          <div className="stat"><div className="l">笔记</div><div className="n">{st.notes}</div></div>
          <div className="stat"><div className="l">注释</div><div className="n">{st.anns}</div></div>
        </div>
      </div>
      {st.recent.length > 0 && (
        <Section id="recent-read" title="最近阅读">
          {st.recent.map((a) => {
            const p = a.parentId ? getItem(a.parentId) : null;
            return (
              <div key={a.id} className="list-row" onClick={() => openItem(a)}>
                <Highlighter size={15} className="type-ico" />
                <div className="lr-main"><div className="lr-title">{itemTitle(p || a)}</div><div className="lr-sub">{fmtDate(a.lastRead)}{a.annotationCount ? ` · ${a.annotationCount} 条注释` : ''}</div></div>
              </div>
            );
          })}
        </Section>
      )}
      <div className="muted" style={{ padding: '16px 20px', fontSize: 12.5, lineHeight: 1.7 }}>
        <Library size={14} style={{ verticalAlign: -2, marginRight: 4 }} />
        选择一个条目查看详情。拖入 PDF 自动识别元数据；双击条目打开阅读器；数字键 1–9 切换彩色标签；Ctrl+Shift+C 复制参考文献。
      </div>
    </div>
  );
}

export default function ItemPane() {
  const selected = useStore((s) => s.selected);
  const item = useStore((s) => (s.selected.length === 1 ? s.items[s.selected[0]] : null));
  let body;
  if (selected.length > 1) body = <MultiPane ids={selected} />;
  else if (!item) body = <LibraryStats />;
  else if (item.itemType === 'note') body = <NotePane key={item.id} item={item} />;
  else if (item.itemType === 'attachment') body = <AttachmentPane key={item.id} item={item} />;
  else body = <RegularPane key={item.id} item={item} />;
  return <div className="card pane-card">{body}</div>;
}
