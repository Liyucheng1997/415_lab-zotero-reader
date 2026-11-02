import { useMemo, useState } from 'react';
import { Search, MoreHorizontal, X } from 'lucide-react';
import { useStore, indexes } from '../store.js';
import { showMenu } from '../ui/overlay.jsx';
import { tagMenu, addTagToItems, deleteTags } from '../actions.js';
import { viewBase } from '../lib/search.js';

export default function TagSelector() {
  const version = useStore((s) => s.version);
  const view = useStore((s) => s.view);
  const tagFilter = useStore((s) => s.tagFilter);
  const tagColors = useStore((s) => s.tagColors);
  const prefs = useStore((s) => s.prefs);
  const [q, setQ] = useState('');
  const [dropTag, setDropTag] = useState(null);
  const { setTagFilter, setPrefs } = useStore.getState();

  const { inView, all } = useMemo(() => {
    const s = useStore.getState();
    const { tags, children } = indexes();
    const base = viewBase(s);
    const inView = new Map();
    for (const it of base) {
      for (const t of it.tags) inView.set(t.tag, t.type);
      for (const c of children.get(it.id) || []) for (const t of c.tags) if (!inView.has(t.tag)) inView.set(t.tag, t.type);
    }
    return { inView, all: tags };
  }, [version, view]);

  const colored = new Map(tagColors.map((t) => [t.tag, t]));
  const ql = q.trim().toLowerCase();
  const source = prefs.tagDisplayAll ? [...all.values()].map((t) => [t.tag, t.type]) : [...inView.entries()];
  const list = source
    .filter(([tag, type]) => !colored.has(tag) && (prefs.showAutoTags || type === 0) && (!ql || tag.toLowerCase().includes(ql)))
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'));

  const toggle = (tag) => setTagFilter(tagFilter.includes(tag) ? tagFilter.filter((t) => t !== tag) : [...tagFilter, tag]);
  const pill = (tag, type, color) => {
    const sel = tagFilter.includes(tag);
    const has = inView.has(tag);
    return (
      <button
        key={tag}
        className={`tag-pill${sel ? ' sel' : ''}${!has && !sel ? ' disabled' : ''}${type === 1 ? ' auto' : ''}${dropTag === tag ? ' drop' : ''}`}
        onClick={() => toggle(tag)}
        onContextMenu={(e) => showMenu(e, tagMenu(tag, colored.get(tag)))}
        onDragOver={(e) => { if (e.dataTransfer.types.includes('mz/items')) { e.preventDefault(); setDropTag(tag); } }}
        onDragLeave={() => setDropTag(null)}
        onDrop={(e) => { setDropTag(null); try { addTagToItems(JSON.parse(e.dataTransfer.getData('mz/items')), tag); } catch { /* 忽略 */ } }}
        title={tag}
      >
        {color && <span className="dot" style={{ background: color }} />}
        <span>{tag}</span>
      </button>
    );
  };

  return (
    <div className="tag-box">
      <div className="tag-scroll">
        {tagColors.length > 0 && (
          <div className="tag-colored">
            {tagColors.filter((t) => !ql || t.tag.toLowerCase().includes(ql)).map((t) => pill(t.tag, 0, t.color))}
          </div>
        )}
        {list.length ? list.slice(0, 1500).map(([tag, type]) => pill(tag, type)) : <span className="muted" style={{ fontSize: 12, padding: 4 }}>{ql ? '没有匹配的标签' : '此视图中没有标签'}</span>}
      </div>
      <div className="tag-foot">
        <Search size={14} className="muted" />
        <input className="input" placeholder="筛选标签" value={q} onChange={(e) => setQ(e.target.value)} />
        {tagFilter.length > 0 && <button className="icon-btn sm" title="取消选择" onClick={() => setTagFilter([])}><X size={14} /></button>}
        <button className="icon-btn sm" title="标签选项" onClick={(e) => showMenu(e, [
          { label: `取消选择全部（${tagFilter.length}）`, disabled: !tagFilter.length, onClick: () => setTagFilter([]) },
          '-',
          { label: '显示自动标签', checked: prefs.showAutoTags, onClick: () => setPrefs({ showAutoTags: !prefs.showAutoTags }) },
          { label: '显示文库中的所有标签', checked: prefs.tagDisplayAll, onClick: () => setPrefs({ tagDisplayAll: !prefs.tagDisplayAll }) },
          '-',
          { label: '删除自动标签…', danger: true, onClick: () => deleteTags([...all.values()].filter((t) => t.type === 1).map((t) => t.tag)) },
        ], { anchor: e.currentTarget, align: 'right' })}><MoreHorizontal size={14} /></button>
      </div>
    </div>
  );
}
