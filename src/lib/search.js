// 条目列表计算：视图 → 标签筛选 → 搜索 → 排序 → 展开
import { useStore, indexes, descendantCollections } from '../store.js';
import { yearOf, creatorSummary, containerOf, itemTitle, htmlToText, normTitle, typeLabel } from './util.js';
import { creatorName } from '../../shared/schema.js';

const noteTextCache = new Map();
function noteText(it) {
  const k = it.id + ':' + it.dateModified;
  if (!noteTextCache.has(k)) noteTextCache.set(k, htmlToText(it.note).toLowerCase());
  return noteTextCache.get(k);
}

function matchesTCY(it, q) {
  if (it.itemType === 'note') return noteText(it).includes(q);
  const f = it.fields || {};
  if ((f.title || '').toLowerCase().includes(q)) return true;
  if (it.itemType === 'attachment') return (it.filename || '').toLowerCase().includes(q);
  if (yearOf(f.date) === q) return true;
  return (it.creators || []).some((c) => creatorName(c).toLowerCase().includes(q) || `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase().includes(q));
}
function matchesAll(it, q) {
  if (matchesTCY(it, q)) return true;
  if (Object.values(it.fields || {}).some((v) => String(v).toLowerCase().includes(q))) return true;
  return (it.tags || []).some((t) => t.tag.toLowerCase().includes(q));
}

// 多个词：全部命中
function makeMatcher(text, mode, hits) {
  const words = text.toLowerCase().match(/"[^"]+"|\S+/g)?.map((w) => w.replace(/"/g, '')) || [];
  if (!words.length) return null;
  const fn = mode === 'tcy' ? matchesTCY : matchesAll;
  return (it) => words.every((w) => fn(it, w)) || (mode === 'everything' && hits?.has(it.id));
}

export const SORT_GETTERS = {
  title: (it) => itemTitle(it).replace(/^[\s"'“‘(\[]+/, '').toLowerCase(),
  creator: (it) => creatorSummary(it).toLowerCase(),
  year: (it) => yearOf(it.fields?.date),
  publication: (it) => containerOf(it).toLowerCase(),
  itemType: (it) => typeLabel(it.itemType),
  dateAdded: (it) => it.dateAdded,
  dateModified: (it) => it.dateModified,
  extra: (it) => it.fields?.extra || '',
  attachments: (it) => (it.itemType === 'attachment' ? 1 : 0),
  notes: (it) => 0,
};

export function viewBase(state) {
  const { items, view, prefs } = state;
  const all = Object.values(items);
  switch (view.type) {
    case 'trash':
      return all.filter((it) => it.deleted && (!it.parentId || !items[it.parentId]?.deleted));
    case 'collection': {
      const ids = new Set(prefs.includeSubcollections ? descendantCollections(view.id) : [view.id]);
      return all.filter((it) => !it.deleted && !it.parentId && it.collections.some((c) => ids.has(c)));
    }
    case 'unfiled':
      return all.filter((it) => !it.deleted && !it.parentId && !it.collections.length);
    case 'duplicates':
      return duplicateGroups(state).flat().map((id) => items[id]);
    case 'search': {
      const s = state.savedSearches.find((x) => x.id === view.id);
      return s ? all.filter((it) => !it.deleted && !it.parentId && evalSearch(it, s.conditions, state)) : [];
    }
    case 'recent':
      return all.filter((it) => !it.deleted && !it.parentId).sort((a, b) => (b.dateAdded > a.dateAdded ? 1 : -1)).slice(0, 100);
    default:
      return all.filter((it) => !it.deleted && !it.parentId);
  }
}

export function computeRows(state) {
  const { searchText, searchMode, fulltextHits, tagFilter, sort, expanded, view } = state;
  const { children } = indexes();
  const inTrash = view.type === 'trash';
  const kids = (it) => (children.get(it.id) || []).filter((c) => inTrash || !c.deleted);
  let base = viewBase(state);

  if (tagFilter.length) {
    base = base.filter((it) => tagFilter.every((t) => it.tags.some((x) => x.tag === t) || kids(it).some((c) => c.tags.some((x) => x.tag === t))));
  }

  const matcher = makeMatcher(searchText.trim(), searchMode, fulltextHits);
  let matchedChildren = null;
  if (matcher) {
    matchedChildren = new Set();
    base = base.filter((it) => {
      let ok = matcher(it);
      for (const c of kids(it)) if (matcher(c)) { matchedChildren.add(c.id); ok = true; }
      return ok;
    });
  }

  const dupMode = view.type === 'duplicates';
  if (!dupMode && view.type !== 'recent') {
    const g = SORT_GETTERS[sort.field] || SORT_GETTERS.title;
    const sec = SORT_GETTERS.dateAdded;
    const cache = new Map(base.map((it) => [it.id, g(it)]));
    base.sort((a, b) => {
      const x = cache.get(a.id), y = cache.get(b.id);
      if (x === y) return (sec(a) > sec(b) ? -1 : 1);
      if (!x) return 1;
      if (!y) return -1;
      return (x > y ? 1 : -1) * sort.dir;
    });
  }

  const rows = [];
  let prevGroup = null;
  const groupOf = dupMode ? new Map(duplicateGroups(state).flatMap((g, i) => g.map((id) => [id, i]))) : null;
  for (const it of base) {
    const ks = kids(it);
    const groupStart = dupMode && groupOf.get(it.id) !== prevGroup;
    if (dupMode) prevGroup = groupOf.get(it.id);
    rows.push({ item: it, depth: 0, hasKids: ks.length > 0, groupStart, context: matcher && !matcher(it) });
    const show = expanded[it.id] ?? (matchedChildren && ks.some((c) => matchedChildren.has(c.id)));
    if (show) for (const c of ks) {
      if (matchedChildren && searchText && !matchedChildren.has(c.id) && expanded[it.id] === undefined) continue;
      rows.push({ item: c, depth: 1, parent: it, context: matcher && !matchedChildren?.has(c.id) });
    }
  }
  return { rows, count: base.length };
}

// —— 重复条目检测 ——
let dupCacheV = -1;
let dupCache = [];
export function duplicateGroups(state) {
  if (dupCacheV === state.version) return dupCache;
  const regular = Object.values(state.items).filter((it) => !it.deleted && !it.parentId && it.itemType !== 'note' && it.itemType !== 'attachment');
  const parent = new Map(regular.map((it) => [it.id, it.id]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => parent.set(find(a), find(b));
  const by = (keyFn) => {
    const m = new Map();
    for (const it of regular) {
      const k = keyFn(it);
      if (!k) continue;
      if (m.has(k)) {
        const other = m.get(k);
        const ya = yearOf(it.fields.date), yb = yearOf(other.fields.date);
        const doiA = it.fields.DOI?.toLowerCase(), doiB = other.fields.DOI?.toLowerCase();
        if (keyFn !== doiKey && doiA && doiB && doiA !== doiB) continue;
        if (keyFn !== doiKey && ya && yb && Math.abs(+ya - +yb) > 1) continue;
        union(it.id, other.id);
      } else m.set(k, it);
    }
  };
  const doiKey = (it) => it.fields.DOI?.toLowerCase().trim();
  by(doiKey);
  by((it) => it.fields.ISBN?.replace(/[^\dx]/gi, ''));
  by((it) => { const t = normTitle(it.fields.title); return t.length > 8 ? t : null; });
  const groups = new Map();
  for (const it of regular) {
    const r = find(it.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(it.id);
  }
  dupCache = [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => (state.items[a].dateAdded < state.items[b].dateAdded ? -1 : 1)));
  dupCache.sort((a, b) => itemTitle(state.items[a[0]]).localeCompare(itemTitle(state.items[b[0]])));
  dupCacheV = state.version;
  return dupCache;
}

// —— 高级搜索 ——
export const SEARCH_FIELDS = [
  { key: 'title', label: '标题' },
  { key: 'creator', label: '作者' },
  { key: 'year', label: '年份', numeric: true },
  { key: 'publication', label: '出版物' },
  { key: 'itemType', label: '条目类型', enum: true },
  { key: 'tag', label: '标签' },
  { key: 'collection', label: '分类', enum: true },
  { key: 'abstractNote', label: '摘要' },
  { key: 'DOI', label: 'DOI' },
  { key: 'note', label: '笔记内容' },
  { key: 'dateAdded', label: '添加日期', date: true },
  { key: 'dateModified', label: '修改日期', date: true },
  { key: 'anyField', label: '任意字段' },
  { key: 'attachment', label: '附件类型', enum: true },
];
export const OPERATORS = {
  text: [['contains', '包含'], ['doesNotContain', '不包含'], ['is', '是'], ['isNot', '不是']],
  enum: [['is', '是'], ['isNot', '不是']],
  numeric: [['is', '是'], ['isLessThan', '早于'], ['isGreaterThan', '晚于']],
  date: [['isAfter', '晚于'], ['isBefore', '早于'], ['inTheLast', '最近（天）']],
};
export const opsFor = (field) => {
  const f = SEARCH_FIELDS.find((x) => x.key === field);
  return OPERATORS[f?.enum ? 'enum' : f?.numeric ? 'numeric' : f?.date ? 'date' : 'text'];
};

function condValues(it, field) {
  const { children } = indexes();
  const f = it.fields || {};
  switch (field) {
    case 'title': return [f.title || ''];
    case 'creator': return it.creators.map((c) => `${c.firstName || ''} ${c.lastName || ''} ${c.name || ''}`);
    case 'year': return [yearOf(f.date)];
    case 'publication': return [containerOf(it)];
    case 'itemType': return [it.itemType];
    case 'tag': return [...it.tags.map((t) => t.tag), ...(children.get(it.id) || []).flatMap((c) => c.tags.map((t) => t.tag))];
    case 'collection': return it.collections.map(String);
    case 'note': return (children.get(it.id) || []).filter((c) => c.itemType === 'note').map((c) => htmlToText(c.note)).concat(it.itemType === 'note' ? [htmlToText(it.note)] : []);
    case 'dateAdded': return [it.dateAdded];
    case 'dateModified': return [it.dateModified];
    case 'anyField': return Object.values(f);
    case 'attachment': {
      const att = (children.get(it.id) || []).filter((c) => c.itemType === 'attachment' && !c.deleted);
      return att.length ? att.map((a) => (a.contentType === 'application/pdf' ? 'pdf' : a.linkMode === 'linked_url' ? 'link' : 'other')) : ['none'];
    }
    default: return [f[field] || ''];
  }
}

export function evalCondition(it, c, state) {
  const vals = condValues(it, c.field).map((v) => String(v ?? '').toLowerCase());
  const v = String(c.value ?? '').toLowerCase();
  switch (c.op) {
    case 'contains': return vals.some((x) => x.includes(v));
    case 'doesNotContain': return !vals.some((x) => x.includes(v));
    case 'is': return vals.some((x) => x === v);
    case 'isNot': return !vals.some((x) => x === v);
    case 'isLessThan': return vals.some((x) => x && +x < +v);
    case 'isGreaterThan': return vals.some((x) => x && +x > +v);
    case 'isBefore': return vals.some((x) => x && x < v);
    case 'isAfter': return vals.some((x) => x && x > v);
    case 'inTheLast': {
      const t = new Date(Date.now() - (+v || 0) * 864e5).toISOString().replace('T', ' ').slice(0, 19);
      return vals.some((x) => x >= t);
    }
    default: return true;
  }
}

export function evalSearch(it, conditions, state) {
  const conds = conditions.conditions || [];
  if (!conds.length) return true;
  const test = (x) => (conditions.mode === 'any' ? conds.some((c) => evalCondition(x, c, state)) : conds.every((c) => evalCondition(x, c, state)));
  return test(it);
}
