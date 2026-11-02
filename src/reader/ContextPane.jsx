import { useEffect, useState } from 'react';
import { ChevronLeft, Plus, StickyNote, Highlighter, Trash2 } from 'lucide-react';
import { useStore, childrenOf } from '../store.js';
import { RegularPane } from '../library/ItemPane.jsx';
import NoteEditor from '../library/NoteEditor.jsx';
import { createNote, trashItems } from '../actions.js';
import { noteTitle, fmtDateTime, itemTitle } from '../lib/util.js';
import { toast } from '../ui/overlay.jsx';
import { TranslationBox, LanguageSelect } from '../lib/translate.jsx';

function TranslatePanel({ selText }) {
  const prefs = useStore((s) => s.prefs);
  const { setPrefs } = useStore.getState();
  const [src, setSrc] = useState(selText || '');
  const [query, setQuery] = useState(selText || '');
  useEffect(() => { if (selText) { setSrc(selText); setQuery(selText); } }, [selText]);
  return (
    <div className="tr-panel">
      <div className="row-flex">
        <LanguageSelect auto value={prefs.translateFrom} onChange={(v) => setPrefs({ translateFrom: v })} style={{ flex: 1 }} />
        <span className="muted">→</span>
        <LanguageSelect value={prefs.translateTo} onChange={(v) => setPrefs({ translateTo: v })} style={{ flex: 1 }} />
      </div>
      <textarea className="input" placeholder="在 PDF 中选中文字会自动出现在这里，也可以直接输入" value={src}
        onChange={(e) => setSrc(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) setQuery(src); }} />
      <div className="row-flex">
        <button className="btn btn-sm btn-primary" disabled={!src.trim()} onClick={() => setQuery(src)}>翻译</button>
        <span className="muted" style={{ fontSize: 12 }}>Ctrl+Enter</span>
      </div>
      {query.trim() && <TranslationBox text={query} maxHeight={9999} />}
      <label className="form-check" style={{ fontSize: 12.5 }}><input type="checkbox" checked={prefs.autoTranslate} onChange={(e) => setPrefs({ autoTranslate: e.target.checked })} />选中文字时自动翻译</label>
      <label className="form-check" style={{ fontSize: 12.5 }}><input type="checkbox" checked={prefs.translateIntoComment} onChange={(e) => setPrefs({ translateIntoComment: e.target.checked })} />创建高亮时把译文写入注释评论</label>
    </div>
  );
}

export default function ContextPane({ att, parent, noteId, setNoteId, anns, annHtml, selText }) {
  const [tab, setTab] = useState(parent ? 'info' : 'notes');
  useStore((s) => s.version);
  const owner = parent || null;
  const notes = owner ? childrenOf(owner.id).filter((c) => c.itemType === 'note' && !c.deleted) : [];
  const noteOpen = noteId && useStore.getState().items[noteId];

  const fromAnnotations = async () => {
    if (!anns.length) return toast('还没有注释');
    const parts = [];
    for (const a of anns) parts.push(await annHtml(a));
    const title = `<h1>注释（${new Date().toLocaleDateString('zh-CN')}）</h1><p><em>${itemTitle(parent || att)}</em></p>`;
    const n = await createNote(owner?.id || null, title + parts.join(''));
    setNoteId(n.id);
    setTab('notes');
    toast(`已从 ${anns.length} 条注释创建笔记`, 'success');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="rs-head">
        <div className="seg" style={{ width: '100%', display: 'flex' }}>
          <button style={{ flex: 1, justifyContent: 'center' }} className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')} disabled={!parent}>条目信息</button>
          <button style={{ flex: 1, justifyContent: 'center' }} className={tab === 'notes' ? 'active' : ''} onClick={() => setTab('notes')}>笔记{notes.length ? ` ${notes.length}` : ''}</button>
          <button style={{ flex: 1, justifyContent: 'center' }} className={tab === 'translate' ? 'active' : ''} onClick={() => setTab('translate')}>翻译</button>
        </div>
      </div>
      {tab === 'info' && parent && <RegularPane item={parent} compact />}
      {tab === 'translate' && <TranslatePanel selText={selText} />}
      {tab === 'notes' && (noteOpen ? (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
          <div className="row-flex" style={{ padding: '0 10px 6px' }}>
            <button className="btn btn-sm btn-ghost" onClick={() => setNoteId(null)}><ChevronLeft size={14} />全部笔记</button>
          </div>
          <NoteEditor key={noteId} noteId={noteId} compact />
        </div>
      ) : (
        <div className="pane-scroll" style={{ padding: '0 10px' }}>
          <div className="row-flex" style={{ padding: '4px 0 10px' }}>
            <button className="btn btn-sm btn-primary" onClick={async () => { const n = await createNote(owner?.id || null); setNoteId(n.id); }}><Plus size={14} />新建笔记</button>
            <button className="btn btn-sm" onClick={fromAnnotations}><Highlighter size={14} />从注释创建</button>
          </div>
          {notes.map((n) => (
            <div key={n.id} className="list-row" onClick={() => setNoteId(n.id)}>
              <StickyNote size={15} strokeWidth={1.75} className="type-ico" />
              <div className="lr-main"><div className="lr-title">{noteTitle(n.note) || '无标题笔记'}</div><div className="lr-sub">{fmtDateTime(n.dateModified)}</div></div>
              <span className="actions"><button className="icon-btn sm" onClick={(e) => { e.stopPropagation(); trashItems([n.id]); }}><Trash2 size={14} /></button></span>
            </div>
          ))}
          {!notes.length && (
            <div className="empty" style={{ padding: '40px 12px', fontSize: 13 }}>
              <StickyNote size={30} strokeWidth={1.4} className="ico" />
              {owner ? '这篇文献还没有笔记。选中 PDF 文本后点「添加到笔记」，或拖动注释卡片到笔记里。' : '独立 PDF 的笔记会作为独立笔记保存在文库中。'}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
