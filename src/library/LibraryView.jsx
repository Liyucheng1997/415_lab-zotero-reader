import { useRef } from 'react';
import Sidebar from './Sidebar.jsx';
import ItemsPane from './ItemsPane.jsx';
import ItemPane from './ItemPane.jsx';
import { local, saveLocal } from '../lib/util.js';

// 拖动调整宽度；dir = 1 表示向右拖变宽，-1 表示向左拖变宽
export function Resizer({ varName, dir = 1, min, max, target, horizontal }) {
  const start = (e) => {
    e.preventDefault();
    const el = target?.current || document.documentElement;
    const cur = parseFloat(getComputedStyle(el).getPropertyValue(varName)) || 0;
    const p0 = horizontal ? e.clientY : e.clientX;
    let v = cur;
    const move = (ev) => {
      v = Math.min(max, Math.max(min, cur + ((horizontal ? ev.clientY : ev.clientX) - p0) * dir));
      el.style.setProperty(varName, `${v}px`);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      saveLocal(`size${varName}`, v);
      document.body.style.cursor = '';
    };
    document.body.style.cursor = horizontal ? 'row-resize' : 'col-resize';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return <div className={horizontal ? 'resizer-h' : 'resizer'} onPointerDown={start} />;
}

// 启动时恢复尺寸
for (const v of ['--sidebar-w', '--pane-w', '--tag-h', '--rside-w', '--rctx-w']) {
  const s = local(`size${v}`, null);
  if (s) document.documentElement.style.setProperty(v, `${s}px`);
}

export default function LibraryView({ hidden }) {
  const ref = useRef(null);
  return (
    <div className="library" ref={ref} style={hidden ? { display: 'none' } : undefined}>
      <Sidebar />
      <Resizer varName="--sidebar-w" min={180} max={420} />
      <ItemsPane />
      <Resizer varName="--pane-w" dir={-1} min={300} max={720} />
      <ItemPane />
    </div>
  );
}
