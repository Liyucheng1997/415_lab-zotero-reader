import { useEffect, useRef } from 'react';

// 行内可编辑文本：失焦保存，回车确认（多行用 Shift+Enter 换行），Esc 还原
export default function Editable({ value, onSave, multiline, placeholder = '', className = '', autoFocus, onTab, title }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el) el.textContent = value || '';
  }, [value]);
  useEffect(() => {
    if (autoFocus && ref.current) {
      ref.current.focus();
      const r = document.createRange();
      r.selectNodeContents(ref.current);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  }, [autoFocus]);
  const commit = () => {
    const el = ref.current;
    const v = (el.innerText || '').replace(/ /g, ' ').replace(/\n$/, '');
    const nv = multiline ? v : v.replace(/\s*\n\s*/g, ' ').trim();
    if (nv !== (value || '')) onSave(nv);
    el.classList.toggle('empty', !nv);
  };
  return (
    <div
      ref={ref}
      className={`${className}${!value ? ' empty' : ''}`}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      spellCheck={false}
      data-placeholder={placeholder}
      title={title}
      onBlur={commit}
      onPaste={(e) => {
        e.preventDefault();
        const t = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, multiline ? t : t.replace(/\s*\n\s*/g, ' '));
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (!multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); ref.current.blur(); }
        if (e.key === 'Escape') { ref.current.textContent = value || ''; ref.current.blur(); }
        if (e.key === 'Tab' && onTab) { e.preventDefault(); commit(); onTab(e.shiftKey ? -1 : 1); }
      }}
    />
  );
}
