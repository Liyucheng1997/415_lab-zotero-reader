import { useEffect, lazy, Suspense } from 'react';
import { Library, FileText, X, Moon, Sun, Settings, MonitorCog } from 'lucide-react';
import { useStore, getItem } from './store.js';
import { OverlayHost, openDialog, showMenu } from './ui/overlay.jsx';
import LibraryView from './library/LibraryView.jsx';
import { itemTitle } from './lib/util.js';

const Reader = lazy(() => import('./reader/Reader.jsx'));

function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  useStore((s) => s.version);
  const { activate, closeTab, moveTab } = useStore.getState();
  const tabTitle = (id) => {
    const att = getItem(id);
    const parent = att?.parentId ? getItem(att.parentId) : null;
    return itemTitle(parent || att);
  };
  return (
    <div className="tabs">
      <div className="tabs-track">
        <button className={`tab${active === 'library' ? ' active' : ''}`} onClick={() => activate('library')}>
          <span className="tab-ico lib"><Library size={12} strokeWidth={2.2} /></span>
          <span className="tab-title">我的文库</span>
        </button>
        {tabs.map((t, i) => (
          <button
            key={t.id}
            className={`tab${active === `r${t.id}` ? ' active' : ''}`}
            title={tabTitle(t.id)}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('mz/tab', String(i))}
            onDragOver={(e) => e.dataTransfer.types.includes('mz/tab') && e.preventDefault()}
            onDrop={(e) => { const from = +e.dataTransfer.getData('mz/tab'); if (!isNaN(from)) moveTab(from, i); }}
            onClick={() => activate(`r${t.id}`)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(t.id); } }}
            onContextMenu={(e) => showMenu(e, [
              { label: '关闭', onClick: () => closeTab(t.id) },
              { label: '关闭其他标签', onClick: () => tabs.filter((x) => x.id !== t.id).forEach((x) => closeTab(x.id)) },
              { label: '关闭全部标签', onClick: () => tabs.forEach((x) => closeTab(x.id)) },
            ])}
          >
            <span className="tab-ico pdf"><FileText size={12} strokeWidth={2.2} /></span>
            <span className="tab-title">{tabTitle(t.id)}</span>
            <span className="tab-x" onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}><X size={12} /></span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Titlebar() {
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : MonitorCog;
  return (
    <div className="titlebar">
      <div className="logo">
        <div className="logo-mark"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M3.5 3.5h9l-9 9h9" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
        <div>
          <div className="logo-name">我的 Zotero</div>
          <div className="logo-sub">文献管理与阅读</div>
        </div>
      </div>
      <TabBar />
      <button className="tb-round" title="外观" onClick={(e) => showMenu(e, [
        { label: '跟随系统', icon: MonitorCog, checked: theme === 'system', onClick: () => setTheme('system') },
        { label: '浅色', icon: Sun, checked: theme === 'light', onClick: () => setTheme('light') },
        { label: '深色', icon: Moon, checked: theme === 'dark', onClick: () => setTheme('dark') },
      ], { anchor: e.currentTarget, align: 'right' })}><ThemeIcon size={16} strokeWidth={1.75} /></button>
      <button className="tb-round" title="设置" onClick={() => import('./dialogs/dialogs.jsx').then((m) => openDialog(m.SettingsDialog))}><Settings size={16} strokeWidth={1.75} /></button>
    </div>
  );
}

export default function App() {
  const loaded = useStore((s) => s.loaded);
  const error = useStore((s) => s.error);
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.activeTab);
  useEffect(() => { useStore.getState().load(); }, []);
  useEffect(() => {
    const key = (e) => {
      const s = useStore.getState();
      if (e.ctrlKey && e.key === 'w' && s.activeTab !== 'library') { e.preventDefault(); s.closeTab(+s.activeTab.slice(1)); }
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault();
        const keys = ['library', ...s.tabs.map((t) => `r${t.id}`)];
        const i = keys.indexOf(s.activeTab);
        s.activate(keys[(i + (e.shiftKey ? -1 : 1) + keys.length) % keys.length]);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  // 打开的阅读器保持挂载，切换标签不重新加载
  return (
    <>
      <Titlebar />
      {!loaded ? (
        <div className="empty"><div className="spinner" /></div>
      ) : error ? (
        <div className="empty">无法连接到本地服务：{error}<button className="btn btn-primary" onClick={() => location.reload()}>重试</button></div>
      ) : (
        <>
          <LibraryView hidden={active !== 'library'} />
          <Suspense fallback={active !== 'library' ? <div className="empty"><div className="spinner" /></div> : null}>
            {tabs.map((t) => <Reader key={t.id} attachmentId={t.id} active={active === `r${t.id}`} />)}
          </Suspense>
        </>
      )}
      <OverlayHost />
    </>
  );
}
