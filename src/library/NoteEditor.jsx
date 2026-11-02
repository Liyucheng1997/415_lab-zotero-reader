import { useEffect, useMemo, useRef } from 'react';
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, Quote, Link2, RemoveFormatting, Highlighter, Subscript, Superscript, Code, Undo2, Redo2, BookMarked,
} from 'lucide-react';
import { updateItem } from '../actions.js';
import { useStore, getItem } from '../store.js';
import { debounce } from '../lib/util.js';
import { api } from '../api.js';
import { showMenu, prompt, openDialog } from '../ui/overlay.jsx';
import { ANNOTATION_COLORS } from '../../shared/schema.js';

// Zotero 笔记里内嵌图片通过 data-attachment-key 引用子附件
function resolveImages(root, noteId) {
  const items = useStore.getState().items;
  root.querySelectorAll('img[data-attachment-key]').forEach((img) => {
    const k = img.getAttribute('data-attachment-key');
    const att = Object.values(items).find((i) => i.key === k && i.parentId === noteId) || Object.values(items).find((i) => i.key === k);
    if (att && !img.getAttribute('src')) img.setAttribute('src', `/api/file/${att.id}`);
  });
}

// 保存前去掉我们补上的 src，保持与 Zotero 格式兼容
function serialize(root) {
  const clone = root.cloneNode(true);
  clone.querySelectorAll('img[data-attachment-key]').forEach((img) => img.removeAttribute('src'));
  return clone.innerHTML;
}

export default function NoteEditor({ noteId, compact }) {
  const note = useStore((s) => s.items[noteId]);
  const ref = useRef(null);
  const lastSaved = useRef(null);
  const save = useMemo(() => debounce((html) => {
    if (html === lastSaved.current) return;
    lastSaved.current = html;
    updateItem(noteId, { note: html });
  }, 600), [noteId]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !note) return;
    if (note.note === lastSaved.current && el.innerHTML) return;
    el.innerHTML = note.note || '';
    lastSaved.current = note.note || '';
    resolveImages(el, noteId);
  }, [noteId, note?.note]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = ref.current;
    return () => el && save.flush(serialize(el)); // 卸载时保存
  }, [save]);

  // 从阅读器等处插入内容
  useEffect(() => {
    const h = (e) => {
      if (e.detail.noteId !== noteId || !ref.current) return;
      ref.current.focus();
      const sel = getSelection();
      if (!sel.rangeCount || !ref.current.contains(sel.anchorNode)) {
        const r = document.createRange();
        r.selectNodeContents(ref.current);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      document.execCommand('insertHTML', false, e.detail.html);
      save(serialize(ref.current));
    };
    window.addEventListener('mz-note-insert', h);
    return () => window.removeEventListener('mz-note-insert', h);
  }, [noteId, save]);

  if (!note) return null;
  const exec = (cmd, val) => { document.execCommand(cmd, false, val); ref.current.focus(); save(serialize(ref.current)); };
  const block = (tag) => exec('formatBlock', tag);

  const insertCitation = async () => {
    const { ItemPicker } = await import('../dialogs/dialogs.jsx');
    const ids = await openDialog(ItemPicker, { title: '插入引注' });
    if (!ids?.length) return;
    const { prefs } = useStore.getState();
    const r = await api.post('/api/cite', { ids, style: prefs.quickCopyStyle, mode: 'citation', lang: prefs.citeLang });
    exec('insertHTML', `<span class="citation">${r.text.trim().replace(/</g, '&lt;')}</span>&nbsp;`);
  };

  return (
    <div className="note-editor">
      <div className="note-toolbar">
        <select defaultValue="" onChange={(e) => { block(e.target.value); e.target.value = ''; }} title="段落样式">
          <option value="" disabled>段落</option>
          <option value="p">正文</option>
          <option value="h1">标题 1</option>
          <option value="h2">标题 2</option>
          <option value="h3">标题 3</option>
          <option value="pre">代码块</option>
          <option value="blockquote">引用</option>
        </select>
        <div className="sep-v" />
        <button className="icon-btn" title="加粗 Ctrl+B" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}><Bold size={15} /></button>
        <button className="icon-btn" title="斜体 Ctrl+I" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}><Italic size={15} /></button>
        <button className="icon-btn" title="下划线 Ctrl+U" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}><Underline size={15} /></button>
        {!compact && <button className="icon-btn" title="删除线" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('strikeThrough')}><Strikethrough size={15} /></button>}
        <button className="icon-btn" title="高亮" onMouseDown={(e) => e.preventDefault()} onClick={(e) => showMenu(e, [
          ...ANNOTATION_COLORS.map((c) => ({ label: c.name, swatch: c.color, onClick: () => exec('hiliteColor', `${c.color}66`) })),
          '-', { label: '清除高亮', onClick: () => exec('hiliteColor', 'transparent') },
        ], { anchor: e.currentTarget })}><Highlighter size={15} /></button>
        {!compact && <>
          <button className="icon-btn" title="下标" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('subscript')}><Subscript size={15} /></button>
          <button className="icon-btn" title="上标" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('superscript')}><Superscript size={15} /></button>
          <button className="icon-btn" title="行内代码" onMouseDown={(e) => e.preventDefault()} onClick={() => { const t = getSelection().toString(); exec('insertHTML', `<code>${t.replace(/</g, '&lt;') || 'code'}</code>`); }}><Code size={15} /></button>
        </>}
        <div className="sep-v" />
        <button className="icon-btn" title="无序列表" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')}><List size={15} /></button>
        <button className="icon-btn" title="有序列表" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')}><ListOrdered size={15} /></button>
        <button className="icon-btn" title="引用" onMouseDown={(e) => e.preventDefault()} onClick={() => block('blockquote')}><Quote size={15} /></button>
        <button className="icon-btn" title="链接" onMouseDown={(e) => e.preventDefault()} onClick={async () => {
          const sel = getSelection();
          const range = sel.rangeCount ? sel.getRangeAt(0) : null;
          const url = await prompt({ title: '插入链接', placeholder: 'https://…' });
          if (!url) return;
          ref.current.focus();
          if (range) { sel.removeAllRanges(); sel.addRange(range); }
          if (range && !range.collapsed) exec('createLink', url);
          else exec('insertHTML', `<a href="${url.replace(/"/g, '&quot;')}">${url.replace(/</g, '&lt;')}</a>`);
        }}><Link2 size={15} /></button>
        <button className="icon-btn" title="插入引注" onMouseDown={(e) => e.preventDefault()} onClick={insertCitation}><BookMarked size={15} /></button>
        <button className="icon-btn" title="清除格式" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('removeFormat')}><RemoveFormatting size={15} /></button>
        {!compact && <>
          <div className="grow" />
          <button className="icon-btn" title="撤销" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('undo')}><Undo2 size={15} /></button>
          <button className="icon-btn" title="重做" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('redo')}><Redo2 size={15} /></button>
        </>}
      </div>
      <div
        ref={ref}
        className="note-body"
        contentEditable
        suppressContentEditableWarning
        onInput={() => save(serialize(ref.current))}
        onBlur={() => save.flush(serialize(ref.current))}
        onKeyDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          const a = e.target.closest('a');
          if (a && (e.ctrlKey || e.metaKey)) window.open(a.href, '_blank');
        }}
        onDrop={(e) => {
          // 从文库拖入条目：插入引注
          const raw = e.dataTransfer.getData('mz/items');
          if (!raw) return;
          e.preventDefault();
          const ids = JSON.parse(raw).filter((i) => getItem(i)?.itemType !== 'note');
          api.post('/api/cite', { ids, style: useStore.getState().prefs.quickCopyStyle, mode: 'citation' }).then((r) => {
            ref.current.focus();
            document.execCommand('insertHTML', false, `<span class="citation">${r.text.trim().replace(/</g, '&lt;')}</span>&nbsp;`);
            save(serialize(ref.current));
          });
        }}
      />
    </div>
  );
}
