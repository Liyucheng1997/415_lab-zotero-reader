import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, Loader2, Plus, Minus, Search, Upload, Database, FileUp } from 'lucide-react';
import { Modal, toast } from '../ui/overlay.jsx';
import { api } from '../api.js';
import { useStore } from '../store.js';
import { addByIdentifier } from '../actions.js';
import { copyRich, download, itemTitle, creatorSummary, yearOf, isRegular, fmtDateTime } from '../lib/util.js';
import { SEARCH_FIELDS, opsFor, evalSearch } from '../lib/search.js';
import { ITEM_TYPES, REGULAR_TYPES } from '../../shared/schema.js';
import { collectionPath, PAGE_BGS } from '../store.js';
import { TypeIcon } from '../library/icons.jsx';
import { LanguageSelect, TranslationBox } from '../lib/translate.jsx';
import { useUpdate, checkForUpdates, openUpdateDialog } from '../update.jsx';

// —— 通过标识符添加 ——
export function IdentifierDialog({ close }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!v.trim()) return;
    setBusy(true);
    const r = await addByIdentifier(v);
    setBusy(false);
    if (r?.items?.length) close(true);
  };
  return (
    <Modal title="通过标识符添加" close={close} className="dlg-mid" footer={<>
      <button className="btn" onClick={() => close()}>取消</button>
      <button className="btn btn-primary" disabled={busy || !v.trim()} onClick={submit}>{busy && <Loader2 size={14} className="spin" />}添加</button>
    </>}>
      <div className="form">
        <div className="setting-desc">输入 DOI、arXiv ID、ISBN、PubMed ID 或网址，也可以直接输入论文标题。多个标识符请分行输入。</div>
        <textarea className="input" rows={5} autoFocus value={v} placeholder={'10.1038/nature14539\narXiv:1706.03762\n9780262035613\nhttps://…'}
          onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || !v.includes('\n'))) { e.preventDefault(); submit(); } }} />
      </div>
    </Modal>
  );
}

function useStyles() {
  const [styles, setStyles] = useState([]);
  useEffect(() => { api.get('/api/styles').then(setStyles); }, []);
  return [styles, setStyles];
}

// —— 生成参考文献 ——
export function BibliographyDialog({ close, ids }) {
  const prefs = useStore((s) => s.prefs);
  const [styles] = useStyles();
  const [style, setStyle] = useState(prefs.quickCopyStyle);
  const [mode, setMode] = useState('bibliography');
  const [lang, setLang] = useState(prefs.citeLang);
  const [q, setQ] = useState('');
  const [out, setOut] = useState(null);
  useEffect(() => {
    setOut(null);
    api.post('/api/cite', { ids, style, mode, lang }).then(setOut).catch((e) => setOut({ html: `<span style="color:var(--danger)">${e.message}</span>`, text: '' }));
  }, [ids, style, mode, lang]);
  const list = styles.filter((s) => !q || s.title.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="生成参考文献" close={close} className="dlg-wide" footer={<>
      <button className="btn" onClick={() => out && download(`<!doctype html><meta charset="utf-8"><body>${out.html}</body>`, 'bibliography.html', 'text/html')}><Download size={14} />保存为 HTML</button>
      <button className="btn" onClick={() => out && download(out.text, 'bibliography.txt')}><Download size={14} />保存为文本</button>
      <button className="btn btn-primary" onClick={async () => { await copyRich(out.html, out.text.trim()); toast('已复制到剪贴板', 'success'); close(); }}><Copy size={14} />复制</button>
    </>}>
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 16 }}>
        <div className="form" style={{ gap: 8 }}>
          <input className="input sm" placeholder="搜索样式" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <div className="style-list">
            {list.map((s) => <div key={s.id} className={`style-item${s.id === style ? ' active' : ''}`} onClick={() => setStyle(s.id)}>{s.title}</div>)}
          </div>
          <div className="row-flex" style={{ justifyContent: 'space-between' }}>
            <div className="seg sm"><button className={mode === 'bibliography' ? 'active' : ''} onClick={() => setMode('bibliography')}>参考文献</button><button className={mode === 'citation' ? 'active' : ''} onClick={() => setMode('citation')}>引注</button></div>
            <select className="input sm" value={lang} onChange={(e) => setLang(e.target.value)} style={{ width: 92 }}>
              <option value="en-US">英文</option><option value="en-GB">英式</option><option value="zh-CN">中文</option><option value="de-DE">德文</option><option value="fr-FR">法文</option>
            </select>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => { useStore.getState().setPrefs({ quickCopyStyle: style, citeLang: lang }); toast('已设为快速复制样式', 'success'); }}>设为快速复制默认样式</button>
        </div>
        <div className="form" style={{ gap: 8 }}>
          <div className="label-caps">预览 · {ids.length} 个条目</div>
          <div className="preview-box" style={{ maxHeight: 330, minHeight: 300 }}>
            {out ? <div dangerouslySetInnerHTML={{ __html: out.html }} /> : <div className="spinner" />}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// —— 导出 ——
const EXPORT_FORMATS = [['bibtex', 'BibTeX'], ['biblatex', 'BibLaTeX'], ['ris', 'RIS'], ['csljson', 'CSL JSON'], ['csv', 'CSV']];
export function ExportDialog({ close, ids, name }) {
  const [format, setFormat] = useState('bibtex');
  const [out, setOut] = useState(null);
  useEffect(() => { setOut(null); api.post('/api/export', { ids, format }).then(setOut).catch((e) => toast(e.message, 'error')); }, [ids, format]);
  return (
    <Modal title={`导出 ${ids.length} 个条目`} close={close} className="dlg-wide" footer={<>
      <button className="btn" onClick={async () => { await navigator.clipboard.writeText(out.text); toast('已复制', 'success'); }}><Copy size={14} />复制</button>
      <button className="btn btn-primary" onClick={() => { download(out.text, `${name || 'export'}.${out.ext}`); close(); }}><Download size={14} />保存文件</button>
    </>}>
      <div className="form">
        <div className="seg">{EXPORT_FORMATS.map(([k, l]) => <button key={k} className={format === k ? 'active' : ''} onClick={() => setFormat(k)}>{l}</button>)}</div>
        <pre className="preview-box" style={{ fontFamily: 'var(--mono)', fontSize: 12, margin: 0, height: 340, maxHeight: 340, whiteSpace: 'pre-wrap' }}>{out ? out.text.slice(0, 20000) : '…'}</pre>
      </div>
    </Modal>
  );
}

// —— 导入 ——
export function ImportDialog({ close }) {
  const view = useStore((s) => s.view);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [zdir, setZdir] = useState('');
  const [zlast, setZlast] = useState(null);
  const [zres, setZres] = useState(null);
  const fileRef = useRef(null);
  useEffect(() => { api.get('/api/import/zotero/default').then((r) => { setZdir(r.dir || ''); setZlast(r.last); }); }, []);
  const doImport = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/import', { text, collectionId: view.type === 'collection' ? view.id : null });
      useStore.getState().upsert(r.items);
      useStore.getState().select(r.items.map((i) => i.id));
      toast(`已导入 ${r.items.length} 个条目`, 'success');
      close(true);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  const doZotero = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/import/zotero', { dir: zdir });
      setZres(r);
      await useStore.getState().load();
      toast('Zotero 文库导入完成', 'success');
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  };
  return (
    <Modal title="导入" close={close} className="dlg-wide">
      <div className="setting-block" style={{ paddingTop: 0 }}>
        <div className="row-flex"><Database size={16} className="muted" /><div className="setting-title">从 Zotero 导入整个文库</div></div>
        <div className="setting-desc">读取 Zotero 数据目录（只读复制 zotero.sqlite，不修改 Zotero），导入条目、分类、标签、笔记、附件链接、PDF 注释与全文缓存。可重复导入，已存在的条目只在 Zotero 中更新过时才会覆盖。{zlast && ` 上次导入：${fmtDateTime(zlast)}`}</div>
        <div className="row-flex">
          <input className="input" style={{ flex: 1 }} value={zdir} onChange={(e) => setZdir(e.target.value)} placeholder="例如 C:\Users\你\Zotero" onKeyDown={(e) => e.stopPropagation()} />
          <button className="btn btn-primary" disabled={busy || !zdir} onClick={doZotero}>{busy ? <Loader2 size={14} className="spin" /> : <Upload size={14} />}导入</button>
        </div>
        {zres && (
          <div className="stat-grid">
            <div className="stat"><div className="l">新条目</div><div className="n">{zres.items}</div></div>
            <div className="stat"><div className="l">更新</div><div className="n">{zres.updated}</div></div>
            <div className="stat"><div className="l">注释</div><div className="n">{zres.annotations}</div></div>
            <div className="stat"><div className="l">分类</div><div className="n">{zres.collections}</div></div>
          </div>
        )}
      </div>
      <div className="setting-block">
        <div className="row-flex"><FileUp size={16} className="muted" /><div className="setting-title">导入 BibTeX / RIS / CSL JSON</div></div>
        <div className="setting-desc">粘贴文本或选择文件{view.type === 'collection' ? `，条目会放入「${collectionPath(view.id)}」` : ''}。</div>
        <textarea className="input" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder="@article{…}" style={{ fontFamily: 'var(--mono)', fontSize: 12 }} onKeyDown={(e) => e.stopPropagation()} />
        <div className="row-flex">
          <input ref={fileRef} type="file" accept=".bib,.ris,.json,.txt,.nbib" hidden onChange={async (e) => { const f = e.target.files[0]; if (f) setText(await f.text()); }} />
          <button className="btn" onClick={() => fileRef.current.click()}>选择文件…</button>
          <div className="grow" />
          <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={doImport}>{busy && <Loader2 size={14} className="spin" />}导入条目</button>
        </div>
      </div>
    </Modal>
  );
}

// —— 高级搜索 / 保存的搜索 ——
export function AdvancedSearchDialog({ close, saved }) {
  const collections = useStore((s) => s.collections);
  const [mode, setMode] = useState(saved?.conditions.mode || 'all');
  const [conds, setConds] = useState(saved?.conditions.conditions || [{ field: 'title', op: 'contains', value: '' }]);
  const [name, setName] = useState(saved?.name || '');
  const conditions = { mode, conditions: conds };
  const results = useMemo(() => {
    const s = useStore.getState();
    return Object.values(s.items).filter((it) => !it.deleted && !it.parentId && evalSearch(it, conditions, s)).slice(0, 300);
  }, [JSON.stringify(conditions)]); // eslint-disable-line react-hooks/exhaustive-deps
  const setCond = (i, patch) => setConds(conds.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const save = async () => {
    const n = name.trim() || '未命名搜索';
    const st = useStore.getState();
    if (saved) {
      await api.patch(`/api/searches/${saved.id}`, { name: n, conditions });
      st.setSavedSearches(st.savedSearches.map((x) => (x.id === saved.id ? { ...x, name: n, conditions } : x)));
    } else {
      const r = await api.post('/api/searches', { name: n, conditions });
      st.setSavedSearches([...st.savedSearches, r]);
      st.setView({ type: 'search', id: r.id });
    }
    toast('已保存搜索', 'success');
    close(true);
  };
  const valueInput = (c, i) => {
    const f = SEARCH_FIELDS.find((x) => x.key === c.field);
    if (c.field === 'itemType') return <select className="input" value={c.value} onChange={(e) => setCond(i, { value: e.target.value })}><option value="">选择…</option>{REGULAR_TYPES.concat(['note', 'attachment']).map((t) => <option key={t} value={t}>{ITEM_TYPES[t].label}</option>)}</select>;
    if (c.field === 'collection') return <select className="input" value={c.value} onChange={(e) => setCond(i, { value: e.target.value })}><option value="">选择…</option>{collections.map((col) => <option key={col.id} value={col.id}>{collectionPath(col.id)}</option>)}</select>;
    if (c.field === 'attachment') return <select className="input" value={c.value} onChange={(e) => setCond(i, { value: e.target.value })}><option value="">选择…</option><option value="pdf">PDF</option><option value="link">网址链接</option><option value="other">其他文件</option><option value="none">无附件</option></select>;
    return <input className="input" type={f?.date && c.op !== 'inTheLast' ? 'date' : 'text'} value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />;
  };
  return (
    <Modal title={saved ? '编辑保存的搜索' : '高级搜索'} close={close} className="dlg-wide" footer={<>
      <input className="input" style={{ marginRight: 'auto', width: 220 }} placeholder="搜索名称" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <button className="btn" onClick={() => close()}>关闭</button>
      <button className="btn btn-primary" onClick={save}>{saved ? '保存' : '保存搜索'}</button>
    </>}>
      <div className="form">
        <div className="row-flex">
          <span className="form-label">符合</span>
          <div className="seg sm"><button className={mode === 'all' ? 'active' : ''} onClick={() => setMode('all')}>全部条件</button><button className={mode === 'any' ? 'active' : ''} onClick={() => setMode('any')}>任一条件</button></div>
        </div>
        {conds.map((c, i) => (
          <div key={i} className="cond-row">
            <select className="input" value={c.field} onChange={(e) => setCond(i, { field: e.target.value, op: opsFor(e.target.value)[0][0], value: '' })}>
              {SEARCH_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>
            <select className="input" style={{ width: 100 }} value={c.op} onChange={(e) => setCond(i, { op: e.target.value })}>
              {opsFor(c.field).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <div style={{ flex: 1, display: 'flex' }}>{valueInput(c, i)}</div>
            <button className="icon-btn" disabled={conds.length === 1} onClick={() => setConds(conds.filter((_, k) => k !== i))}><Minus size={15} /></button>
            <button className="icon-btn" onClick={() => setConds([...conds.slice(0, i + 1), { field: 'title', op: 'contains', value: '' }, ...conds.slice(i + 1)])}><Plus size={15} /></button>
          </div>
        ))}
        <div className="label-caps" style={{ marginTop: 6 }}>结果 · {results.length}{results.length === 300 ? '+' : ''}</div>
        <div className="style-list" style={{ height: 220 }}>
          {results.map((it) => (
            <div key={it.id} className="list-row" onDoubleClick={() => { const s = useStore.getState(); s.setView({ type: 'library' }); s.select([it.id]); close(); setTimeout(() => window.dispatchEvent(new CustomEvent('mz-reveal', { detail: it.id })), 60); }}>
              <TypeIcon item={it} />
              <div className="lr-main"><div className="lr-title">{itemTitle(it)}</div><div className="lr-sub">{[creatorSummary(it), yearOf(it.fields.date)].filter(Boolean).join(' · ')}</div></div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// —— 条目选择器（插入引注、添加关联） ——
export function ItemPicker({ close, title = '选择条目', exclude = [] }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState([]);
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return Object.values(useStore.getState().items)
      .filter((i) => !i.deleted && isRegular(i) && !exclude.includes(i.id))
      .filter((i) => !ql || `${i.fields.title} ${creatorSummary(i)} ${yearOf(i.fields.date)}`.toLowerCase().includes(ql))
      .slice(0, 200);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title={title} close={close} className="dlg-mid" footer={<>
      <button className="btn" onClick={() => close()}>取消</button>
      <button className="btn btn-primary" disabled={!sel.length} onClick={() => close(sel)}>确定{sel.length ? `（${sel.length}）` : ''}</button>
    </>}>
      <div className="form" style={{ gap: 8 }}>
        <div className="search" style={{ width: '100%' }}>
          <Search size={14} className="s-ico" />
          <input className="input" autoFocus placeholder="搜索标题、作者、年份" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && list[0]) close(sel.length ? sel : [list[0].id]); }} style={{ paddingRight: 12 }} />
        </div>
        <div className="style-list" style={{ height: 320 }}>
          {list.map((it) => (
            <label key={it.id} className="list-row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={sel.includes(it.id)} onChange={() => setSel(sel.includes(it.id) ? sel.filter((x) => x !== it.id) : [...sel, it.id])} />
              <div className="lr-main"><div className="lr-title">{itemTitle(it)}</div><div className="lr-sub">{[creatorSummary(it), yearOf(it.fields.date)].filter(Boolean).join(' · ')}</div></div>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  );
}

// —— 设置 ——
const UPDATE_STATUS = {
  checking: '正在检查更新…',
  latest: '已是最新版本',
  available: (u) => `发现新版本 v${u.version}`,
  downloading: (u) => `正在下载 v${u.version}（${u.percent || 0}%）`,
  downloaded: (u) => `v${u.version} 已下载，重启软件即可完成更新`,
  error: (u) => `检查更新失败：${u.error}`,
};
function UpdateSettings({ prefs, setPrefs }) {
  const u = useUpdate();
  const s = UPDATE_STATUS[u.status];
  return (
    <div className="setting-block">
      <div className="setting-title">软件更新</div>
      {u.status === 'unsupported' ? (
        <div className="setting-desc">只有安装版（桌面版）支持检查更新；浏览器版和开发模式下请用 git 拉取最新代码。</div>
      ) : <>
        <div className="row-flex">
          <span className="setting-desc">当前版本 v{u.current}{s ? `　·　${typeof s === 'function' ? s(u) : s}` : ''}</span>
          <span style={{ flex: 1 }} />
          {['available', 'downloading', 'downloaded'].includes(u.status)
            ? <button className="btn btn-sm btn-primary" onClick={openUpdateDialog}>查看更新</button>
            : <button className="btn btn-sm" disabled={u.status === 'checking'} onClick={() => checkForUpdates()}>{u.status === 'checking' ? <Loader2 size={13} className="spin" /> : null}检查更新</button>}
        </div>
        <label className="form-check"><input type="checkbox" checked={prefs.autoUpdate} onChange={(e) => setPrefs({ autoUpdate: e.target.checked })} />启动时自动检查更新</label>
      </>}
    </div>
  );
}

export function SettingsDialog({ close }) {
  const prefs = useStore((s) => s.prefs);
  const theme = useStore((s) => s.theme);
  const { setPrefs, setTheme } = useStore.getState();
  const [styles, setStyles] = useStyles();
  const [ft, setFt] = useState(null);
  const [info, setInfo] = useState(null);
  const [tab, setTab] = useState('general');
  const cslRef = useRef(null);
  useEffect(() => {
    api.get('/api/info').then(setInfo);
    const poll = () => api.get('/api/fulltext/status').then(setFt).catch(() => {});
    poll();
    const t = setInterval(poll, 1500);
    return () => clearInterval(t);
  }, []);
  return (
    <Modal title="设置" close={close} className="dlg-wide" bodyStyle={{ minHeight: 420 }}>
      <div className="seg" style={{ marginBottom: 6 }}>
        {[['general', '通用'], ['translate', '翻译'], ['cite', '引文'], ['search', '搜索与索引'], ['import', '导入与数据']].map(([k, l]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'general' && <>
        <div className="setting-block">
          <div className="setting-title">外观</div>
          <div className="seg">{[['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']].map(([k, l]) => <button key={k} className={theme === k ? 'active' : ''} onClick={() => setTheme(k)}>{l}</button>)}</div>
          <label className="form-check"><input type="checkbox" checked={prefs.pdfDark} onChange={(e) => setPrefs({ pdfDark: e.target.checked })} />深色模式下反转 PDF 页面颜色</label>
        </div>
        <div className="setting-block">
          <div className="setting-title">阅读背景色</div>
          <div className="setting-desc">PDF 页面的纸张颜色，文字和图片保持原色。也可在阅读器右上角「更多」菜单中切换。</div>
          <div className="bg-swatches">
            {PAGE_BGS.map((b) => (
              <button key={b.color} className={`bg-swatch${prefs.pageBg === b.color ? ' active' : ''}`} onClick={() => setPrefs({ pageBg: b.color })}>
                <span className="c" style={{ background: b.color }} />{b.name}
              </button>
            ))}
            <label className={`bg-swatch custom${PAGE_BGS.some((b) => b.color === prefs.pageBg) ? '' : ' active'}`}>
              <span className="c" style={{ background: prefs.pageBg }} />自定义
              <input type="color" value={prefs.pageBg} onChange={(e) => setPrefs({ pageBg: e.target.value })} />
            </label>
          </div>
        </div>
        <div className="setting-block">
          <div className="setting-title">文库</div>
          <label className="form-check"><input type="checkbox" checked={prefs.includeSubcollections} onChange={(e) => setPrefs({ includeSubcollections: e.target.checked })} />在分类中显示子分类的条目</label>
          <label className="form-check"><input type="checkbox" checked={prefs.autoRecognize} onChange={(e) => setPrefs({ autoRecognize: e.target.checked })} />导入 PDF 时自动识别元数据并创建父条目</label>
        </div>
        <UpdateSettings prefs={prefs} setPrefs={setPrefs} />
        <div className="setting-block">
          <div className="setting-title">快捷键</div>
          <div className="setting-desc" style={{ lineHeight: 2 }}>
            <kbd>Ctrl+F</kbd> 搜索　<kbd>Enter</kbd> 打开　<kbd>Del</kbd> 移入回收站　<kbd>+</kbd>/<kbd>-</kbd> 展开/折叠全部　<kbd>1–9</kbd> 彩色标签<br />
            <kbd>Ctrl+Shift+C</kbd> 复制参考文献　<kbd>Ctrl+Shift+A</kbd> 复制引注　<kbd>Ctrl+Tab</kbd> 切换标签页　<kbd>Ctrl+W</kbd> 关闭阅读器<br />
            阅读器：选中文字即翻译　<kbd>H</kbd> 高亮　<kbd>U</kbd> 下划线　<kbd>N</kbd> 便笺　<kbd>T</kbd> 文本　<kbd>A</kbd> 区域　<kbd>D</kbd> 手绘　<kbd>Esc</kbd> 选择　<kbd>Ctrl+F</kbd> 查找
          </div>
        </div>
      </>}
      {tab === 'translate' && <>
        <div className="setting-block">
          <div className="setting-title">划词翻译</div>
          <div className="setting-desc">在 PDF 中选中文字时，在弹出的工具条下方显示译文。当前使用 Google 免费翻译接口（需要能访问 translate.googleapis.com）。</div>
          <div className="row-flex">
            <span className="form-label" style={{ width: 60 }}>源语言</span>
            <LanguageSelect auto className="input" value={prefs.translateFrom} onChange={(v) => setPrefs({ translateFrom: v })} style={{ width: 160 }} />
            <span className="form-label" style={{ width: 60, marginLeft: 12 }}>目标语言</span>
            <LanguageSelect className="input" value={prefs.translateTo} onChange={(v) => setPrefs({ translateTo: v })} style={{ width: 160 }} />
          </div>
          <label className="form-check"><input type="checkbox" checked={prefs.autoTranslate} onChange={(e) => setPrefs({ autoTranslate: e.target.checked })} />选中文字时自动翻译</label>
          <label className="form-check"><input type="checkbox" checked={prefs.translateIntoComment} onChange={(e) => setPrefs({ translateIntoComment: e.target.checked })} />创建高亮 / 下划线时把译文写入注释评论</label>
        </div>
        <div className="setting-block">
          <div className="setting-title">测试</div>
          <TranslationBox text="Semi-active suspension systems offer a favorable trade-off between ride comfort and energy consumption." maxHeight={120} />
        </div>
      </>}
      {tab === 'cite' && <>
        <div className="setting-block">
          <div className="setting-title">快速复制</div>
          <div className="setting-desc">Ctrl+Shift+C / Ctrl+Shift+A 以及右键「复制参考文献」使用的样式。</div>
          <div className="row-flex">
            <select className="input" style={{ flex: 1 }} value={prefs.quickCopyStyle} onChange={(e) => setPrefs({ quickCopyStyle: e.target.value })}>
              {styles.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
            <select className="input" style={{ width: 110 }} value={prefs.citeLang} onChange={(e) => setPrefs({ citeLang: e.target.value })}>
              <option value="en-US">英文</option><option value="zh-CN">中文</option><option value="en-GB">英式</option>
            </select>
          </div>
        </div>
        <div className="setting-block">
          <div className="setting-title">引文样式（{styles.length}）</div>
          <div className="setting-desc">自动加载 Zotero 数据目录 styles 文件夹中的 CSL 样式，另内置 GB/T 7714-2015、APA、Vancouver、Harvard。可从 Zotero 样式库下载 .csl 文件安装。</div>
          <div className="row-flex">
            <input ref={cslRef} type="file" accept=".csl,.xml" hidden onChange={async (e) => {
              const f = e.target.files[0];
              if (!f) return;
              try { setStyles(await api.post('/api/styles/install', { name: f.name, xml: await f.text() })); toast('样式已安装', 'success'); } catch (err) { toast(err.message, 'error'); }
            }} />
            <button className="btn" onClick={() => cslRef.current.click()}><Plus size={14} />安装 CSL 样式…</button>
            <button className="btn btn-ghost" onClick={() => window.open('https://www.zotero.org/styles', '_blank')}>浏览 Zotero 样式库</button>
          </div>
        </div>
      </>}
      {tab === 'search' && ft && (
        <div className="setting-block">
          <div className="setting-title">全文索引</div>
          <div className="setting-desc">「所有内容」搜索模式会检索 PDF 全文。从 Zotero 导入的条目会直接使用 Zotero 的全文缓存；新添加的 PDF 会自动建立索引。为其余 PDF 建立索引需要读取文件（云盘中的文件可能会被下载）。</div>
          <div className="progress"><div style={{ width: `${ft.pdfs ? Math.round((ft.indexed / ft.pdfs) * 100) : 0}%` }} /></div>
          <div className="row-flex" style={{ justifyContent: 'space-between' }}>
            <span className="setting-desc tabular">已索引 {ft.indexed} / {ft.pdfs} 个 PDF{ft.running ? ` · 正在处理 ${ft.done}/${ft.total}` : ''}</span>
            <button className="btn btn-sm" disabled={ft.running} onClick={() => api.post('/api/fulltext/index').then(setFt)}>{ft.running ? <Loader2 size={13} className="spin" /> : null}为未索引的 PDF 建立索引</button>
          </div>
        </div>
      )}
      {tab === 'import' && <>
        <div className="setting-block">
          <div className="setting-title">导入</div>
          <div className="setting-desc">从 Zotero 导入整个文库，或导入 BibTeX / RIS / CSL JSON。</div>
          <div><button className="btn btn-primary" onClick={() => { close(); import('./dialogs.jsx').then((m) => import('../ui/overlay.jsx').then((o) => o.openDialog(m.ImportDialog))); }}>打开导入…</button></div>
        </div>
        <div className="setting-block">
          <div className="setting-title">数据位置</div>
          <div className="setting-desc" style={{ wordBreak: 'break-all' }}>数据库与附件保存在：{info?.dataDir}<br />本应用存储的附件：{info?.storage}<br />从 Zotero 导入的附件仍保留在原位置，通过链接打开。</div>
        </div>
      </>}
    </Modal>
  );
}

