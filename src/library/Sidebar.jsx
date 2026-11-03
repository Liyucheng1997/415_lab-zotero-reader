import { useMemo, useState } from 'react';
import { Library, Folder, FolderOpen, ChevronRight, Trash2, Copy, FileQuestion, Search, Plus, Clock, Pencil, Trash, SlidersHorizontal } from 'lucide-react';
import { useStore } from '../store.js';
import { showMenu, openDialog, confirm } from '../ui/overlay.jsx';
import { collectionMenu, newCollection, addToCollection, moveCollection, emptyTrash, trashItems } from '../actions.js';
import { duplicateGroups } from '../lib/search.js';
import { api } from '../api.js';
import TagSelector from './TagSelector.jsx';
import { Resizer } from './LibraryView.jsx';

const getDragItems = (e) => {
  try { return JSON.parse(e.dataTransfer.getData('mz/items')); } catch { return null; }
};

function Nav({ icon: Icon, label, active, depth = 0, twisty, open, onTwisty, count, onClick, onContextMenu, onDrop, acceptDrop, draggable, onDragStart }) {
  const [drop, setDrop] = useState(false);
  return (
    <div
      className={`nav${active ? ' active' : ''}${drop ? ' drop' : ''}`}
      style={{ paddingLeft: 4 + depth * 16 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={(e) => { if (acceptDrop?.(e)) { e.preventDefault(); setDrop(true); } }}
      onDragLeave={() => setDrop(false)}
      onDrop={(e) => { setDrop(false); onDrop?.(e); }}
    >
      <span className={`nav-twisty${open ? ' open' : ''}`} onClick={(e) => { if (twisty) { e.stopPropagation(); onTwisty(); } }} style={{ visibility: twisty ? 'visible' : 'hidden' }}>
        <ChevronRight size={13} strokeWidth={2} />
      </span>
      <Icon size={16} strokeWidth={1.75} className="nav-ico" />
      <span className="nav-label">{label}</span>
      {count > 0 && <span className="nav-count">{count}</span>}
    </div>
  );
}

export default function Sidebar() {
  const collections = useStore((s) => s.collections);
  const savedSearches = useStore((s) => s.savedSearches);
  const view = useStore((s) => s.view);
  const collapsed = useStore((s) => s.collapsed);
  const version = useStore((s) => s.version);
  const { setView, setCollapsed } = useStore.getState();

  const counts = useMemo(() => {
    const s = useStore.getState();
    const m = new Map();
    const deep = new Map(); // 含所有子分类的条目数（去重），折叠时显示
    const parentOf = new Map(collections.map((c) => [c.id, c.parentId]));
    let lib = 0, unfiled = 0, trash = 0;
    for (const it of Object.values(s.items)) {
      if (it.deleted) { if (!it.parentId || !s.items[it.parentId]?.deleted) trash++; continue; }
      if (it.parentId) continue;
      lib++;
      if (!it.collections.length) unfiled++;
      const seen = new Set();
      for (const c of it.collections) {
        m.set(c, (m.get(c) || 0) + 1);
        for (let p = c; p != null && !seen.has(p); p = parentOf.get(p)) seen.add(p);
      }
      for (const p of seen) deep.set(p, (deep.get(p) || 0) + 1);
    }
    return { m, deep, lib, unfiled, trash, dups: duplicateGroups(s).length };
  }, [version, collections]);

  const byParent = useMemo(() => {
    const m = new Map();
    for (const c of collections) {
      const k = c.parentId ?? 0;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(c);
    }
    for (const list of m.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    return m;
  }, [collections]);

  const acceptDrop = (e) => e.dataTransfer.types.includes('mz/items') || e.dataTransfer.types.includes('mz/collection');
  const tree = (parentId, depth) => (byParent.get(parentId) || []).map((c) => {
    const kids = byParent.has(c.id);
    const open = kids && collapsed[c.id] === false;
    return (
      <div key={c.id}>
        <Nav
          icon={open ? FolderOpen : Folder}
          label={c.name}
          depth={depth}
          twisty={kids}
          open={open}
          count={(open ? counts.m : counts.deep).get(c.id)}
          onTwisty={() => setCollapsed(c.id, open)}
          active={view.type === 'collection' && view.id === c.id}
          onClick={() => setView({ type: 'collection', id: c.id })}
          onContextMenu={(e) => showMenu(e, collectionMenu(c))}
          draggable
          onDragStart={(e) => { e.dataTransfer.setData('mz/collection', String(c.id)); e.dataTransfer.effectAllowed = 'move'; }}
          acceptDrop={acceptDrop}
          onDrop={(e) => {
            const ids = getDragItems(e);
            if (ids) return addToCollection(ids, c.id);
            const cid = +e.dataTransfer.getData('mz/collection');
            if (cid && cid !== c.id) moveCollection(cid, c.id);
          }}
        />
        {open && tree(c.id, depth + 1)}
      </div>
    );
  });

  const searchMenu = (s) => [
    { label: '编辑保存的搜索…', icon: Pencil, onClick: () => import('../dialogs/dialogs.jsx').then((m) => openDialog(m.AdvancedSearchDialog, { saved: s })) },
    { label: '删除', icon: Trash, danger: true, onClick: async () => {
      if (!(await confirm({ title: `删除保存的搜索「${s.name}」？`, danger: true, okText: '删除' }))) return;
      await api.del(`/api/searches/${s.id}`);
      useStore.getState().setSavedSearches(savedSearches.filter((x) => x.id !== s.id));
      if (view.type === 'search' && view.id === s.id) setView({ type: 'library' });
    } },
  ];

  return (
    <div className="sidebar">
      <div className="side-scroll">
        <div className="side-group">
          <span className="label-caps">文库</span>
          <button className="icon-btn" title="新建分类" onClick={() => newCollection(null)}><Plus size={15} /></button>
        </div>
        <Nav icon={Library} label="我的文库" count={counts.lib} active={view.type === 'library'} onClick={() => setView({ type: 'library' })}
          acceptDrop={(e) => e.dataTransfer.types.includes('mz/collection')}
          onDrop={(e) => { const cid = +e.dataTransfer.getData('mz/collection'); if (cid) moveCollection(cid, null); }}
          twisty={collections.length > 0} open={collapsed.root !== true} onTwisty={() => setCollapsed('root', collapsed.root !== true)} />
        {collapsed.root !== true && tree(0, 1)}
        {savedSearches.map((s) => (
          <Nav key={`s${s.id}`} icon={Search} label={s.name} depth={1} active={view.type === 'search' && view.id === s.id} onClick={() => setView({ type: 'search', id: s.id })} onContextMenu={(e) => showMenu(e, searchMenu(s))} />
        ))}
        <Nav icon={Clock} label="最近添加" depth={1} active={view.type === 'recent'} onClick={() => setView({ type: 'recent' })} />
        <Nav icon={FileQuestion} label="未分类条目" depth={1} count={counts.unfiled} active={view.type === 'unfiled'} onClick={() => setView({ type: 'unfiled' })} />
        <Nav icon={Copy} label="重复条目" depth={1} count={counts.dups} active={view.type === 'duplicates'} onClick={() => setView({ type: 'duplicates' })} />
        <Nav icon={Trash2} label="回收站" depth={1} count={counts.trash} active={view.type === 'trash'} onClick={() => setView({ type: 'trash' })}
          onContextMenu={(e) => showMenu(e, [{ label: '清空回收站…', icon: Trash2, danger: true, onClick: emptyTrash }])}
          acceptDrop={(e) => e.dataTransfer.types.includes('mz/items')}
          onDrop={(e) => { const ids = getDragItems(e); if (ids) trashItems(ids); }} />
        <Nav icon={SlidersHorizontal} label="高级搜索" depth={1} onClick={() => import('../dialogs/dialogs.jsx').then((m) => openDialog(m.AdvancedSearchDialog))} />
      </div>
      <Resizer varName="--tag-h" dir={-1} min={80} max={600} horizontal />
      <TagSelector />
    </div>
  );
}
