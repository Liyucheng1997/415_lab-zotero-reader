// 引文与参考文献：CSL 样式（citation-js）+ 内置 GB/T 7714-2015
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Cite, plugins } from '@citation-js/core';
import '@citation-js/plugin-csl';
import '@citation-js/plugin-bibtex';
import '@citation-js/plugin-ris';
import { itemToCSL } from './csl.js';
import { yearOf } from '../shared/schema.js';
import { getSetting, DATA_DIR } from './db.js';

const cslConfig = plugins.config.get('@csl');
const styles = new Map(); // id -> { id, title, source }

function styleTitle(xml) {
  return (xml.match(/<title>([^<]+)<\/title>/) || [])[1]?.replace(/&amp;/g, '&') || '';
}

export function loadStyles() {
  styles.clear();
  styles.set('gb-t-7714-2015', { id: 'gb-t-7714-2015', title: 'GB/T 7714-2015（顺序编码制）', source: 'builtin' });
  styles.set('apa', { id: 'apa', title: 'American Psychological Association 7th edition', source: 'builtin' });
  styles.set('vancouver', { id: 'vancouver', title: 'Vancouver', source: 'builtin' });
  styles.set('harvard1', { id: 'harvard1', title: 'Harvard', source: 'builtin' });
  const dirs = [path.join(DATA_DIR, 'styles'), getSetting('zoteroDataDir') && path.join(getSetting('zoteroDataDir'), 'styles'), path.join(os.homedir(), 'Zotero', 'styles')].filter(Boolean);
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.csl')) continue;
      const id = f.replace(/\.csl$/, '');
      if (styles.has(id) && styles.get(id).source !== 'builtin') continue;
      try {
        const xml = fs.readFileSync(path.join(dir, f), 'utf8');
        if (/<link[^>]+rel="independent-parent"/.test(xml)) {
          // 依赖样式：引用父样式
          const parent = (xml.match(/rel="independent-parent"[^>]*href="[^"]*\/([^"/]+)"/) || xml.match(/href="[^"]*\/([^"/]+)"[^>]*rel="independent-parent"/) || [])[1];
          if (parent) styles.set(id, { id, title: styleTitle(xml), source: 'dependent', parent });
          continue;
        }
        cslConfig.styles.add(id, xml);
        styles.set(id, { id, title: styleTitle(xml), source: dir });
      } catch { /* 忽略损坏样式 */ }
    }
  }
}
loadStyles();

export function listStyles() {
  return [...styles.values()].filter((s) => s.source !== 'dependent' || styles.has(s.parent)).map(({ id, title }) => ({ id, title }));
}

function templateFor(id) {
  const s = styles.get(id);
  if (s?.source === 'dependent') return s.parent;
  return s ? id : 'apa';
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function formatBibliography(items, styleId, format = 'html', lang = 'en-US') {
  if (styleId === 'gb-t-7714-2015') return gbt.bibliography(items, format);
  const cite = new Cite(items.map(itemToCSL));
  return cite.format('bibliography', { format, template: templateFor(styleId), lang });
}

export function formatCitation(items, styleId, format = 'text', lang = 'en-US') {
  if (styleId === 'gb-t-7714-2015') return `[${items.map((_, i) => i + 1).join(', ')}]`;
  const cite = new Cite(items.map(itemToCSL));
  return cite.format('citation', { format, template: templateFor(styleId), lang });
}

// 单条引文（用于笔记里插入）
export function shortCitation(item, page) {
  const cs = (item.creators || []).filter((c) => c.creatorType === 'author' || c.creatorType === 'editor');
  const name = (c) => c.name || c.lastName || c.firstName || '';
  const a = cs.length === 0 ? (item.fields?.title || '').slice(0, 24) : cs.length === 1 ? name(cs[0]) : cs.length === 2 ? `${name(cs[0])} & ${name(cs[1])}` : `${name(cs[0])} et al.`;
  const y = yearOf(item.fields?.date);
  return `(${[a, y].filter(Boolean).join(', ')}${page ? `, p. ${page}` : ''})`;
}

export async function parseCitations(text) {
  const cite = await Cite.async(text);
  return cite.data;
}

export function exportAs(items, format) {
  const cite = new Cite(items.map((i) => itemToCSL(i, { cjkLiteral: format !== 'csljson' })));
  if (format === 'bibtex') return cite.format('bibtex');
  if (format === 'biblatex') return cite.format('biblatex');
  if (format === 'ris') return cite.format('ris');
  return JSON.stringify(items.map(itemToCSL), null, 2);
}

// —— GB/T 7714-2015 ——
const hasCJK = (s) => /[㐀-鿿]/.test(s || '');
const gbt = {
  name(c) {
    if (c.name) return c.name;
    const last = c.lastName || '';
    const first = c.firstName || '';
    if (hasCJK(last) || hasCJK(first)) return `${last}${first}`;
    const initials = first.split(/[\s.-]+/).filter(Boolean).map((p) => p[0].toUpperCase()).join(' ');
    return [last.toUpperCase(), initials].filter(Boolean).join(' ');
  },
  authors(item, types = ['author', 'inventor', 'programmer', 'presenter']) {
    const list = (item.creators || []).filter((c) => types.includes(c.creatorType));
    if (!list.length) return '';
    const cn = hasCJK(item.fields?.title);
    const names = list.slice(0, 3).map(gbt.name);
    return names.join(', ') + (list.length > 3 ? (cn ? ', 等' : ', et al') : '');
  },
  code(item) {
    return { journalArticle: 'J', magazineArticle: 'J', newspaperArticle: 'N', conferencePaper: 'C', book: 'M', bookSection: 'M', thesis: 'D', report: 'R', standard: 'S', patent: 'P', dataset: 'DS', computerProgram: 'CP', webpage: 'EB/OL', blogPost: 'EB/OL', preprint: 'EB/OL' }[item.itemType] || 'Z';
  },
  entry(item) {
    const f = item.fields || {};
    const y = yearOf(f.date);
    const A = gbt.authors(item);
    const code = gbt.code(item);
    const pubPlace = [f.place, f.publisher || f.university || f.institution].filter(Boolean).join(': ');
    let s = A ? `${A}. ` : '';
    switch (item.itemType) {
      case 'journalArticle': case 'magazineArticle': case 'newspaperArticle': {
        s += `${f.title}[${code}]. ${f.publicationTitle || ''}`;
        s += y ? `, ${y}` : '';
        if (f.volume) s += `, ${f.volume}`;
        if (f.issue) s += `(${f.issue})`;
        if (f.pages) s += `: ${f.pages}`;
        s += '.';
        break;
      }
      case 'conferencePaper':
        s += `${f.title}[C]//${f.proceedingsTitle || f.conferenceName || ''}. ${pubPlace ? `${pubPlace}, ` : ''}${y}${f.pages ? `: ${f.pages}` : ''}.`;
        break;
      case 'bookSection': {
        const eds = gbt.authors(item, ['editor']);
        s += `${f.title}[M]//${eds ? `${eds}. ` : ''}${f.bookTitle || ''}. ${pubPlace ? `${pubPlace}, ` : ''}${y}${f.pages ? `: ${f.pages}` : ''}.`;
        break;
      }
      case 'book':
        s += `${f.title}[M]. ${f.edition ? `${f.edition}. ` : ''}${pubPlace ? `${pubPlace}, ` : ''}${y}.`;
        break;
      case 'thesis': case 'report':
        s += `${f.title}[${code}]. ${pubPlace ? `${pubPlace}, ` : ''}${y}.`;
        break;
      case 'standard':
        s = `${A || f.organization ? `${A || f.organization}. ` : ''}${f.title}${f.number ? `: ${f.number}` : ''}[S]. ${pubPlace ? `${pubPlace}, ` : ''}${y}.`;
        break;
      case 'patent':
        s += `${f.title}: ${[f.country, f.patentNumber].filter(Boolean).join(', ')}[P]. ${f.issueDate || f.date || ''}.`;
        break;
      default: {
        const src = f.repository || f.websiteTitle || f.blogTitle || f.publisher || '';
        s += `${f.title}[${code}]. ${src ? `${src}, ` : ''}${f.date ? `(${f.date})` : y}${f.accessDate ? `[${String(f.accessDate).slice(0, 10)}]` : ''}.`;
        if (f.url) s += ` ${f.url}.`;
      }
    }
    if (f.DOI) s += ` DOI: ${f.DOI}.`;
    return s.replace(/\s+/g, ' ').replace(/\.\./g, '.').replace(/\. ,/g, '.,');
  },
  bibliography(items, format) {
    const lines = items.map((it, i) => `[${i + 1}] ${gbt.entry(it)}`);
    if (format === 'html') return `<div class="csl-bib-body">${lines.map((l) => `<div class="csl-entry">${esc(l)}</div>`).join('')}</div>`;
    return lines.join('\n');
  },
};
