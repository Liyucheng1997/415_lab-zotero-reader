// 浮层：右键菜单、提示、对话框（全局函数调用）
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { ChevronRight, Check, X, AlertTriangle, HelpCircle } from 'lucide-react';

const useUI = create((set) => ({
  menu: null,
  toasts: [],
  dialogs: [],
  set,
}));

let uid = 0;

// —— 菜单 ——
// items: [{ label, icon, onClick, shortcut, disabled, danger, checked, submenu: [...] } | '-' | { header }]
export function showMenu(e, items, opts = {}) {
  e?.preventDefault?.();
  e?.stopPropagation?.();
  const r = opts.anchor?.getBoundingClientRect?.();
  const x = r ? (opts.align === 'right' ? r.right : r.left) : e.clientX;
  const y = r ? r.bottom + 6 : e.clientY;
  useUI.getState().set({ menu: { x, y, items: items.filter(Boolean), alignRight: opts.align === 'right' } });
}
export const closeMenu = () => useUI.getState().set({ menu: null });

function MenuList({ items, x, y, alignRight, onClose, level = 0 }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y, visibility: 'hidden' });
  const [sub, setSub] = useState(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = alignRight ? x - w : x;
    let top = y;
    if (left + w > innerWidth - 8) left = level ? x - w - (ref.current.parentWidth || 0) : innerWidth - w - 8;
    if (top + h > innerHeight - 8) top = Math.max(8, innerHeight - h - 8);
    setPos({ left: Math.max(8, left), top, visibility: 'visible' });
  }, [x, y, alignRight, level]);
  return (
    <>
      <div ref={ref} className="popover menu" style={pos} onMouseDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
        {items.map((it, i) => {
          if (it === '-') return <div key={i} className="menu-sep" />;
          if (it.header) return <div key={i} className="menu-header">{it.header}</div>;
          const Icon = it.icon;
          return (
            <div
              key={i}
              className={`menu-item${it.disabled ? ' disabled' : ''}${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}`}
              onMouseEnter={(e) => {
                if (it.submenu) {
                  const r = e.currentTarget.getBoundingClientRect();
                  setSub({ items: it.submenu, x: r.right + 4, y: r.top - 5, i });
                } else setSub(null);
              }}
              onClick={() => {
                if (it.disabled || it.submenu) return;
                onClose();
                it.onClick?.();
              }}
            >
              <span className="menu-icon">{it.checked ? <Check size={15} /> : Icon ? <Icon size={15} strokeWidth={1.75} /> : it.swatch ? <span className="dot" style={{ background: it.swatch, width: 10, height: 10 }} /> : null}</span>
              <span className="menu-label">{it.label}</span>
              {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
              {it.submenu && <ChevronRight size={14} className="menu-arrow" />}
            </div>
          );
        })}
      </div>
      {sub && <MenuList key={sub.i} items={sub.items.filter(Boolean)} x={sub.x} y={sub.y} onClose={onClose} level={level + 1} />}
    </>
  );
}

function MenuHost() {
  const menu = useUI((s) => s.menu);
  useEffect(() => {
    if (!menu) return;
    const close = () => closeMenu();
    const key = (e) => e.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', key);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', key);
      window.removeEventListener('resize', close);
    };
  }, [menu]);
  if (!menu) return null;
  return <MenuList {...menu} onClose={closeMenu} />;
}

// —— 提示 ——
export function toast(msg, type = 'info', ms = 2600) {
  const id = ++uid;
  const { set } = useUI.getState();
  set((s) => ({ toasts: [...s.toasts, { id, msg, type, show: false }] }));
  requestAnimationFrame(() => requestAnimationFrame(() => set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, show: true } : t)) }))));
  setTimeout(() => set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, show: false } : t)) })), ms);
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms + 400);
}
function ToastHost() {
  const toasts = useUI((s) => s.toasts);
  return (
    <div className="toast-host">
      {toasts.map((t) => <div key={t.id} className={`toast toast-${t.type}${t.show ? ' show' : ''}`}>{t.msg}</div>)}
    </div>
  );
}

// —— 对话框 ——
// openDialog(Component, props) → Promise（组件通过 props.close(value) 关闭）
export function openDialog(Component, props = {}) {
  return new Promise((resolve) => {
    const id = ++uid;
    const close = (v) => {
      useUI.getState().set((s) => ({ dialogs: s.dialogs.filter((d) => d.id !== id) }));
      resolve(v);
    };
    useUI.getState().set((s) => ({ dialogs: [...s.dialogs, { id, Component, props: { ...props, close } }] }));
  });
}
function DialogHost() {
  const dialogs = useUI((s) => s.dialogs);
  useEffect(() => {
    if (!dialogs.length) return;
    const top = dialogs[dialogs.length - 1];
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); top.props.close(undefined); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [dialogs]);
  return dialogs.map(({ id, Component, props }) => (
    <div key={id} className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && props.close(undefined)}>
      <Component {...props} />
    </div>
  ));
}

export function Modal({ title, close, children, footer, className = 'dlg-mid', bodyStyle }) {
  return (
    <div className={`modal ${className}`}>
      <div className="modal-header">
        <span>{title}</span>
        <button className="modal-x" onClick={() => close(undefined)}><X size={15} /></button>
      </div>
      <div className="modal-body" style={bodyStyle}>{children}</div>
      {footer && <div className="modal-footer">{footer}</div>}
    </div>
  );
}

function ConfirmDialog({ close, title, message, okText = '确定', cancelText = '取消', danger, icon }) {
  const Icon = icon || (danger ? AlertTriangle : HelpCircle);
  useEffect(() => {
    const k = (e) => e.key === 'Enter' && close(true);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [close]);
  return (
    <div className="modal confirm">
      <div className={`confirm-ico${danger ? ' danger' : ''}`}><Icon size={22} strokeWidth={1.75} /></div>
      <div className="confirm-title">{title}</div>
      {message && <div className="confirm-msg">{message}</div>}
      <div className="confirm-btns">
        <button className="btn" onClick={() => close(false)}>{cancelText}</button>
        <button className={`btn ${danger ? 'btn-danger-solid' : 'btn-primary'}`} autoFocus onClick={() => close(true)}>{okText}</button>
      </div>
    </div>
  );
}
export const confirm = (opts) => openDialog(ConfirmDialog, opts).then(Boolean);

function PromptDialog({ close, title, label, value = '', okText = '确定', multiline, placeholder }) {
  const [v, setV] = useState(value);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const submit = () => close(v);
  return (
    <Modal title={title} close={close} className="dlg-small" footer={<><button className="btn" onClick={() => close(undefined)}>取消</button><button className="btn btn-primary" onClick={submit}>{okText}</button></>}>
      <div className="form">
        {label && <div className="form-label">{label}</div>}
        {multiline
          ? <textarea ref={ref} className="input" rows={5} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} />
          : <input ref={ref} className="input" value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />}
      </div>
    </Modal>
  );
}
export const prompt = (opts) => openDialog(PromptDialog, opts);

export function OverlayHost() {
  return (
    <>
      <DialogHost />
      <MenuHost />
      <ToastHost />
    </>
  );
}
