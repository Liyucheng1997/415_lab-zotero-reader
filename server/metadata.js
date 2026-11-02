// 通过标识符（DOI / arXiv / ISBN / PMID / URL）或 PDF 内容获取元数据
import { cslToItem } from './csl.js';
import { guessInfo } from './pdftext.js';

const UA = { 'User-Agent': 'MyZotero/1.0 (personal reference manager; mailto:anonymous@example.com)' };
const timeoutFetch = (url, opts = {}, ms = 15000) => fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) }, signal: AbortSignal.timeout(ms) });

export const DOI_RE = /\b(10\.\d{4,9}\/[^\s"<>,;]+[^\s"<>,;.)\]])/i;
export const ARXIV_RE = /(?:arxiv[:\s/.]*(?:abs\/)?)\s*(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i;
const ISBN_RE = /\b(97[89][\d-]{10,14}|\d{9}[\dX])\b/i;

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

export async function lookupDOI(doi) {
  doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim();
  // arXiv 的 DataCite DOI 直接走 arXiv 接口，信息更全
  const ax = doi.match(/^10\.48550\/arxiv\.(.+)$/i);
  if (ax) return lookupArxiv(ax[1]);
  let csl;
  try {
    const r = await timeoutFetch(`https://doi.org/${encodeURIComponent(doi)}`, { headers: { Accept: 'application/vnd.citationstyles.csl+json' } });
    if (r.ok) csl = await r.json();
  } catch { /* 回退 CrossRef */ }
  if (!csl) {
    const r = await timeoutFetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    if (!r.ok) throw new Error(`找不到 DOI：${doi}`);
    csl = crossrefToCSL((await r.json()).message);
  }
  const item = cslToItem(csl);
  item.fields.DOI ||= doi;
  if (!item.fields.url && csl.URL) item.fields.url = csl.URL;
  return item;
}

function crossrefToCSL(m) {
  const typeMap = { 'journal-article': 'article-journal', 'proceedings-article': 'paper-conference', 'book-chapter': 'chapter', 'posted-content': 'article', book: 'book', 'monograph': 'book', report: 'report', dissertation: 'thesis', dataset: 'dataset', standard: 'standard' };
  return { ...m, type: typeMap[m.type] || m.type, title: m.title?.[0], 'container-title': m['container-title']?.[0], 'container-title-short': m['short-container-title']?.[0], ISSN: m.ISSN?.[0], ISBN: m.ISBN?.[0], issued: m.issued || m['published-print'] || m['published-online'], abstract: m.abstract, event: undefined };
}

export async function lookupArxiv(id) {
  id = id.replace(/^arxiv:\s*/i, '').replace(/v\d+$/, '').trim();
  const r = await timeoutFetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
  const xml = await r.text();
  const entry = xml.split('<entry>')[1];
  if (!entry) throw new Error(`找不到 arXiv：${id}`);
  const tag = (t) => decode((entry.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1] || '').replace(/\s+/g, ' ').trim();
  const authors = [...entry.matchAll(/<author>\s*<name>([^<]+)<\/name>/g)].map((m) => {
    const parts = decode(m[1]).trim().split(/\s+/);
    return { creatorType: 'author', lastName: parts.pop(), firstName: parts.join(' ') };
  });
  const cats = [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]);
  const published = tag('published').slice(0, 10);
  const journalDoi = (entry.match(/<arxiv:doi[^>]*>([^<]+)</) || [])[1];
  const fields = {
    title: tag('title'), abstractNote: tag('summary'), date: published, repository: 'arXiv', archiveID: `arXiv:${id}`,
    url: `http://arxiv.org/abs/${id}`, DOI: `10.48550/arXiv.${id}`, libraryCatalog: 'arXiv.org', accessDate: new Date().toISOString().slice(0, 10),
  };
  const comment = (entry.match(/<arxiv:comment[^>]*>([\s\S]*?)<\/arxiv:comment>/) || [])[1];
  if (comment) fields.extra = `Comment: ${decode(comment).replace(/\s+/g, ' ').trim()}`;
  return { itemType: 'preprint', fields, creators: authors, tags: cats.map((c) => ({ tag: c, type: 1 })), journalDoi, pdfUrl: `https://arxiv.org/pdf/${id}` };
}

export async function lookupISBN(isbn) {
  isbn = isbn.replace(/[^\dX]/gi, '');
  const r = await timeoutFetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  const d = (await r.json())[`ISBN:${isbn}`];
  if (!d) throw new Error(`找不到 ISBN：${isbn}`);
  return {
    itemType: 'book',
    fields: {
      title: d.subtitle ? `${d.title}: ${d.subtitle}` : d.title, publisher: d.publishers?.[0]?.name, place: d.publish_places?.[0]?.name,
      date: d.publish_date, numPages: d.number_of_pages ? String(d.number_of_pages) : undefined, ISBN: isbn, url: d.url, libraryCatalog: 'Open Library',
    },
    creators: (d.authors || []).map((a) => {
      const parts = a.name.split(/\s+/);
      return { creatorType: 'author', lastName: parts.pop(), firstName: parts.join(' ') };
    }),
    tags: [],
  };
}

export async function lookupPMID(pmid) {
  const r = await timeoutFetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`);
  const d = (await r.json()).result?.[pmid];
  if (!d) throw new Error(`找不到 PMID：${pmid}`);
  const doi = d.articleids?.find((a) => a.idtype === 'doi')?.value;
  if (doi) {
    try {
      const it = await lookupDOI(doi);
      it.fields.extra = [it.fields.extra, `PMID: ${pmid}`].filter(Boolean).join('\n');
      return it;
    } catch { /* 用 PubMed 自己的数据 */ }
  }
  return {
    itemType: 'journalArticle',
    fields: { title: d.title, publicationTitle: d.fulljournalname, journalAbbreviation: d.source, volume: d.volume, issue: d.issue, pages: d.pages, date: d.pubdate, ISSN: d.issn, DOI: doi, extra: `PMID: ${pmid}`, libraryCatalog: 'PubMed' },
    creators: (d.authors || []).map((a) => {
      const [last, ini] = a.name.split(' ');
      return { creatorType: 'author', lastName: last, firstName: ini || '' };
    }),
    tags: [],
  };
}

// 网页：读取 citation_* / Dublin Core / Open Graph 元数据（类似 Zotero Connector 的 Embedded Metadata）
export async function lookupURL(url) {
  const ax = url.match(/arxiv\.org\/(?:abs|pdf)\/([^\s?#]+?)(?:\.pdf)?(?:v\d+)?(?:[?#]|$)/i);
  if (ax) return lookupArxiv(ax[1]);
  const doiInUrl = url.match(/doi\.org\/(10\..+)$/i);
  if (doiInUrl) return lookupDOI(decodeURIComponent(doiInUrl[1]));
  const r = await timeoutFetch(url, { headers: { Accept: 'text/html,application/xhtml+xml' } });
  const html = await r.text();
  const metas = [...html.matchAll(/<meta\s+[^>]*>/gi)].map((m) => {
    const tag = m[0];
    const name = (tag.match(/(?:name|property)\s*=\s*["']([^"']+)["']/i) || [])[1];
    const content = (tag.match(/content\s*=\s*["']([^"']*)["']/i) || [])[1];
    return name && content != null ? [name.toLowerCase(), decode(content)] : null;
  }).filter(Boolean);
  const get = (...names) => metas.find(([n]) => names.includes(n))?.[1];
  const all = (...names) => metas.filter(([n]) => names.includes(n)).map(([, v]) => v);
  const doi = get('citation_doi', 'dc.identifier', 'prism.doi', 'bepress_citation_doi');
  if (doi && DOI_RE.test(doi)) {
    try {
      const it = await lookupDOI(doi.match(DOI_RE)[1]);
      it.fields.url ||= url;
      return it;
    } catch { /* 用页面数据 */ }
  }
  const title = get('citation_title', 'dc.title', 'og:title', 'twitter:title') || decode((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '').trim();
  const journal = get('citation_journal_title');
  const conf = get('citation_conference_title');
  const authors = all('citation_author', 'dc.creator', 'author');
  const itemType = journal ? 'journalArticle' : conf ? 'conferencePaper' : 'webpage';
  const fields = {
    title, url, accessDate: new Date().toISOString().slice(0, 10),
    date: get('citation_publication_date', 'citation_date', 'dc.date', 'article:published_time')?.slice(0, 10),
    abstractNote: get('citation_abstract', 'dc.description', 'description', 'og:description'),
  };
  if (itemType === 'journalArticle') Object.assign(fields, { publicationTitle: journal, volume: get('citation_volume'), issue: get('citation_issue'), pages: [get('citation_firstpage'), get('citation_lastpage')].filter(Boolean).join('-'), ISSN: get('citation_issn') });
  else if (itemType === 'conferencePaper') Object.assign(fields, { proceedingsTitle: conf, publisher: get('citation_publisher') });
  else fields.websiteTitle = get('og:site_name');
  return {
    itemType, fields,
    creators: authors.map((a) => {
      if (a.includes(',')) { const [l, f] = a.split(',').map((s) => s.trim()); return { creatorType: 'author', lastName: l, firstName: f }; }
      const p = a.trim().split(/\s+/);
      return p.length > 1 ? { creatorType: 'author', lastName: p.pop(), firstName: p.join(' ') } : { creatorType: 'author', name: a.trim() };
    }),
    tags: all('citation_keywords', 'keywords').flatMap((k) => k.split(/[,;]/)).map((t) => t.trim()).filter(Boolean).slice(0, 20).map((tag) => ({ tag, type: 1 })),
    pdfUrl: get('citation_pdf_url'),
  };
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function similarity(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean));
  const B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return (2 * n) / (A.size + B.size);
}

export async function searchCrossrefByTitle(title) {
  const r = await timeoutFetch(`https://api.crossref.org/works?rows=5&query.bibliographic=${encodeURIComponent(title)}`);
  if (!r.ok) return null;
  const items = (await r.json()).message?.items || [];
  let best = null;
  for (const m of items) {
    const s = similarity(title, m.title?.[0]);
    if (s > 0.8 && (!best || s > best.s)) best = { s, m };
  }
  if (!best) return null;
  return lookupDOI(best.m.DOI).catch(() => cslToItem(crossrefToCSL(best.m)));
}

// 自动识别：从文本中依次识别各种标识符
export async function lookupIdentifier(input) {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return lookupURL(s);
  const doi = s.match(DOI_RE);
  if (doi) return lookupDOI(doi[1]);
  const ax = s.match(ARXIV_RE) || s.match(/^(\d{4}\.\d{4,5})(v\d+)?$/);
  if (ax) return lookupArxiv(ax[1]);
  if (/^\d{1,9}$/.test(s)) return lookupPMID(s);
  const isbn = s.replace(/[-\s]/g, '').match(/^(97[89]\d{10}|\d{9}[\dX])$/i);
  if (isbn) return lookupISBN(isbn[1]);
  const pm = s.match(/^pmid:\s*(\d+)$/i);
  if (pm) return lookupPMID(pm[1]);
  // 视作标题检索
  const t = await searchCrossrefByTitle(s);
  if (t) return t;
  throw new Error('无法识别该标识符');
}

// PDF 元数据识别（类似 Zotero 的"重新抓取 PDF 的元数据"）
export async function recognizePdf(file) {
  const info = await guessInfo(file);
  const text = info.text;
  const doi = text.match(DOI_RE) || String(info.infoTitle).match(DOI_RE);
  if (doi) {
    try { return await lookupDOI(doi[1].replace(/[.)]+$/, '')); } catch { /* 继续 */ }
  }
  const ax = text.match(ARXIV_RE);
  if (ax) {
    try { return await lookupArxiv(ax[1]); } catch { /* 继续 */ }
  }
  const candidates = [info.infoTitle, info.title].filter((t) => t && t.length > 12 && t.length < 300 && !/^(microsoft word|untitled|\S+\.(docx?|pdf|tex))/i.test(t));
  for (const t of candidates) {
    const it = await searchCrossrefByTitle(t).catch(() => null);
    if (it) return it;
  }
  const isbn = text.match(/ISBN[:\s-]*((?:97[89])?[\d-]{9,16}[\dX])/i);
  if (isbn) {
    try { return await lookupISBN(isbn[1]); } catch { /* 继续 */ }
  }
  return null;
}
