import { create } from 'zustand';
import { api } from './api.js';
import { local, saveLocal } from './lib/util.js';

export const DEFAULT_COLUMNS = [
  { key: 'title', width: 0, visible: true },
  { key: 'creator', width: 150, visible: true },
  { key: 'year', width: 64, visible: true },
  { key: 'publication', width: 170, visible: false },
  { key: 'itemType', width: 100, visible: false },
  { key: 'dateAdded', width: 100, visible: true },
  { key: 'dateModified', width: 100, visible: false },
  { key: 'extra', width: 140, visible: false },
  { key: 'attachments', width: 34, visible: true },
  { key: 'notes', width: 40, visible: true },
];

export const DEFAULT_PREFS = {
  includeSubcollections: false,
  quickCopyStyle: 'apa',
  citeLang: 'en-US',
  pdfDark: false,
  pageBg: '#ffffff',
  autoRecognize: true,
  showAutoTags: true,
  tagDisplayAll: false,
  translateTo: 'zh-CN',
  translateFrom: 'auto',
  autoTranslate: true,
  translateIntoComment: false,
  autoUpdate: true,
  skipVersion: null,
};

// 阅读器页面背景色（白色即不着色）
export const PAGE_BGS = [
  { name: '白色', color: '#ffffff' },
  { name: '护眼绿', color: '#c7edcc' },
  { name: '羊皮纸', color: '#f4ecd8' },
  { name: '浅灰', color: '#e9e9eb' },
  { name: '淡蓝', color: '#dde9f6' },
  { name: '淡粉', color: '#f7e4e4' },
];

const restoredTabs =local('tabs', []);

export const useStore = create((set, get) => ({
  loaded: false,
  error: null,
  items: {},
  version: 0,
  collections: [],
  tagColors: [],
  savedSearches: [],
  view: local('view', { type: 'library' }),
  selected: [],
  anchor: null,
  expanded: {},
  searchText: '',
  searchMode: local('searchMode', 'tcy'),
  fulltextHits: null,
  tagFilter: [],
  tabs: restoredTabs,
  activeTab: local('activeTab', 'library'),
  sort: local('sort', { field: 'dateAdded', dir: -1 }),
  columns: local('columns', DEFAULT_COLUMNS),
  prefs: { ...DEFAULT_PREFS, ...local('prefs', {}) },
  theme: local('theme', 'system'),
  collapsed: local('collapsed', {}),
  busy: {},

  async load() {
    try {
      const d = await api.get('/api/library');
      const items = {};
      for (const it of d.items) items[it.id] = it;
      set((s) => ({
        loaded: true, items, version: s.version + 1, collections: d.collections, tagColors: d.tagColors, savedSearches: d.savedSearches,
        tabs: s.tabs.filter((t) => items[t.id]),
        activeTab: s.activeTab === 'library' || items[+String(s.activeTab).slice(1)] ? s.activeTab : 'library',
      }));
    } catch (e) {
      set({ error: e.message, loaded: true });
    }
  },

  upsert(list) {
    if (!list?.length) return;
    set((s) => {
      const items = { ...s.items };
      for (const it of list) items[it.id] = it;
      return { items, version: s.version + 1 };
    });
  },
  remove(ids) {
    set((s) => {
      const items = { ...s.items };
      for (const id of ids) delete items[id];
      return { items, version: s.version + 1, selected: s.selected.filter((x) => !ids.includes(x)), tabs: s.tabs.filter((t) => !ids.includes(t.id)), activeTab: ids.includes(+String(s.activeTab).slice(1)) ? 'library' : s.activeTab };
    });
    saveLocal('tabs', get().tabs);
  },

  setView(view) {
    saveLocal('view', view);
    set({ view, selected: [], anchor: null, tagFilter: get().tagFilter });
  },
  select(ids, anchor) { set({ selected: ids, anchor: anchor ?? ids[ids.length - 1] ?? null }); },
  toggleExpand(id, v) { set((s) => ({ expanded: { ...s.expanded, [id]: v ?? !s.expanded[id] } })); },
  setExpanded(expanded) { set({ expanded }); },
  setSearch(searchText) { set({ searchText }); },
  setSearchMode(searchMode) { saveLocal('searchMode', searchMode); set({ searchMode }); },
  setFulltextHits(fulltextHits) { set({ fulltextHits }); },
  setTagFilter(tagFilter) { set({ tagFilter }); },
  setSort(sort) { saveLocal('sort', sort); set({ sort }); },
  setColumns(columns) { saveLocal('columns', columns); set({ columns }); },
  setPrefs(p) { const prefs = { ...get().prefs, ...p }; saveLocal('prefs', prefs); set({ prefs }); },
  setCollapsed(id, v) { const collapsed = { ...get().collapsed, [id]: v }; saveLocal('collapsed', collapsed); set({ collapsed }); },
  setBusy(k, v) { set((s) => ({ busy: { ...s.busy, [k]: v } })); },
  setTheme(theme) {
    saveLocal('theme', theme);
    try { localStorage.setItem('mz-theme', theme); } catch { /* 忽略 */ }
    applyTheme(theme);
    set({ theme });
  },

  openReader(attachmentId, extra = {}) {
    const s = get();
    const key = `r${attachmentId}`;
    const tabs = s.tabs.some((t) => t.id === attachmentId) ? s.tabs : [...s.tabs, { id: attachmentId }];
    saveLocal('tabs', tabs);
    saveLocal('activeTab', key);
    set({ tabs, activeTab: key, pendingNav: extra.nav ? { id: attachmentId, ...extra.nav } : s.pendingNav });
  },
  pendingNav: null,
  clearPendingNav() { set({ pendingNav: null }); },
  activate(key) { saveLocal('activeTab', key); set({ activeTab: key }); },
  closeTab(id) {
    const s = get();
    const i = s.tabs.findIndex((t) => t.id === id);
    const tabs = s.tabs.filter((t) => t.id !== id);
    let activeTab = s.activeTab;
    if (activeTab === `r${id}`) activeTab = tabs[i] ? `r${tabs[i].id}` : tabs[i - 1] ? `r${tabs[i - 1].id}` : 'library';
    saveLocal('tabs', tabs);
    saveLocal('activeTab', activeTab);
    set({ tabs, activeTab });
  },
  moveTab(from, to) {
    const tabs = [...get().tabs];
    const [t] = tabs.splice(from, 1);
    tabs.splice(to, 0, t);
    saveLocal('tabs', tabs);
    set({ tabs });
  },

  setCollections(collections) { set({ collections }); },
  setTagColors(tagColors) { set({ tagColors }); },
  setSavedSearches(savedSearches) { set({ savedSearches }); },
}));

export function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  window.mzDesktop?.setTheme(dark); // 桌面版：同步窗口按钮颜色
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(useStore.getState().theme));

// —— 派生索引（按 version 缓存） ——
let cacheVersion = -1;
let cache = null;
export function indexes() {
  const s = useStore.getState();
  if (cacheVersion === s.version && cache) return cache;
  const children = new Map();
  const tags = new Map();
  for (const it of Object.values(s.items)) {
    if (it.parentId) {
      if (!children.has(it.parentId)) children.set(it.parentId, []);
      children.get(it.parentId).push(it);
    }
    if (!it.deleted) for (const t of it.tags) {
      if (!tags.has(t.tag)) tags.set(t.tag, { tag: t.tag, type: t.type, items: new Set() });
      const e = tags.get(t.tag);
      e.items.add(it.parentId && it.itemType !== 'note' ? it.parentId : it.id);
      if (t.type === 0) e.type = 0;
    }
  }
  for (const list of children.values()) list.sort((a, b) => (a.itemType === b.itemType ? (a.fields.title || '').localeCompare(b.fields.title || '') : a.itemType === 'attachment' ? -1 : 1));
  cacheVersion = s.version;
  cache = { children, tags };
  return cache;
}

export const childrenOf = (id) => indexes().children.get(id) || [];
export const getItem = (id) => useStore.getState().items[id];

export function bestAttachment(item) {
  if (!item) return null;
  if (item.itemType === 'attachment') return item;
  const kids = childrenOf(item.id).filter((c) => c.itemType === 'attachment' && !c.deleted);
  return kids.find((c) => c.contentType === 'application/pdf') || kids.find((c) => c.linkMode !== 'linked_url') || kids[0] || null;
}

export function collectionPath(id) {
  const cols = useStore.getState().collections;
  const out = [];
  let c = cols.find((x) => x.id === id);
  while (c) { out.unshift(c.name); c = cols.find((x) => x.id === c.parentId); }
  return out.join(' / ');
}

export function descendantCollections(id) {
  const cols = useStore.getState().collections;
  const out = [id];
  for (let i = 0; i < out.length; i++) for (const c of cols) if (c.parentId === out[i]) out.push(c.id);
  return out;
}
