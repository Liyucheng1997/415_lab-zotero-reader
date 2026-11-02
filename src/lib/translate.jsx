import { useEffect, useState } from 'react';
import { Copy, Loader2, Languages, RotateCw } from 'lucide-react';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { toast } from '../ui/overlay.jsx';

export const LANGS = [
  ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['fr', 'Français'],
  ['de', 'Deutsch'], ['it', 'Italiano'], ['es', 'Español'], ['pt', 'Português'], ['ru', 'Русский'], ['ar', 'العربية'],
];
export const langName = (code) => LANGS.find((l) => l[0] === code)?.[1] || code;

export function translateText(text, to) {
  const { prefs } = useStore.getState();
  return api.post('/api/translate', { text, from: prefs.translateFrom || 'auto', to: to || prefs.translateTo || 'zh-CN', engine: 'google' });
}

// 译文显示框：text 变化即翻译
export function TranslationBox({ text, actions, onResult, maxHeight = 200, compact }) {
  const to = useStore((s) => s.prefs.translateTo);
  const [state, setState] = useState({ loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!text?.trim()) { setState({ result: { text: '' } }); return; }
    let alive = true;
    setState({ loading: true });
    translateText(text, to).then((r) => { if (alive) { setState({ result: r }); onResult?.(r); } }).catch((e) => alive && setState({ error: e.message }));
    return () => { alive = false; };
  }, [text, to, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const r = state.result;
  return (
    <div className={`tr-box${compact ? ' compact' : ''}`}>
      <div className="tr-head">
        <Languages size={13} />
        <span className="grow">Google 翻译 · {r?.detected && r.detected !== 'auto' ? `${langName(r.detected)} → ` : ''}{langName(to)}</span>
        {state.error && <button className="icon-btn sm" title="重试" onMouseDown={(e) => e.preventDefault()} onClick={() => setNonce(nonce + 1)}><RotateCw size={13} /></button>}
        {r?.text && <button className="icon-btn sm" title="复制译文" onMouseDown={(e) => e.preventDefault()} onClick={() => { navigator.clipboard.writeText(r.text); toast('译文已复制', 'success'); }}><Copy size={13} /></button>}
        {r?.text && actions?.(r)}
      </div>
      <div className="tr-text" style={{ maxHeight }}>
        {state.loading ? <span className="muted row-flex" style={{ gap: 6 }}><Loader2 size={13} className="spin" />正在翻译…</span>
          : state.error ? <span style={{ color: 'var(--danger)' }}>{state.error}</span>
            : r.text}
      </div>
    </div>
  );
}

export function LanguageSelect({ value, onChange, auto, className = 'input sm', style }) {
  return (
    <select className={className} style={style} value={value} onChange={(e) => onChange(e.target.value)}>
      {auto && <option value="auto">自动检测</option>}
      {LANGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}
