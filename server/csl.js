// Zotero 条目 ⇄ CSL-JSON 互转
import { parseDateParts, ITEM_TYPES } from '../shared/schema.js';

const TYPE_TO_CSL = {
  journalArticle: 'article-journal', magazineArticle: 'article-magazine', newspaperArticle: 'article-newspaper',
  book: 'book', bookSection: 'chapter', conferencePaper: 'paper-conference', thesis: 'thesis', report: 'report',
  webpage: 'webpage', preprint: 'article', computerProgram: 'software', dataset: 'dataset', patent: 'patent',
  presentation: 'speech', manuscript: 'manuscript', document: 'document', blogPost: 'post-weblog',
  encyclopediaArticle: 'entry-encyclopedia', letter: 'personal_communication', standard: 'standard',
};
const CSL_TO_TYPE = {
  'article-journal': 'journalArticle', 'article-magazine': 'magazineArticle', 'article-newspaper': 'newspaperArticle',
  book: 'book', chapter: 'bookSection', 'paper-conference': 'conferencePaper', thesis: 'thesis', report: 'report',
  webpage: 'webpage', article: 'preprint', software: 'computerProgram', dataset: 'dataset', patent: 'patent',
  speech: 'presentation', manuscript: 'manuscript', document: 'document', 'post-weblog': 'blogPost', post: 'blogPost',
  'entry-encyclopedia': 'encyclopediaArticle', 'entry-dictionary': 'encyclopediaArticle', entry: 'encyclopediaArticle',
  personal_communication: 'letter', standard: 'standard', 'review-book': 'journalArticle', review: 'journalArticle',
};

// Zotero 字段 → CSL 变量
const FIELD_TO_CSL = {
  title: 'title', abstractNote: 'abstract', volume: 'volume', issue: 'issue', pages: 'page', numPages: 'number-of-pages',
  edition: 'edition', place: 'publisher-place', publisher: 'publisher', DOI: 'DOI', ISBN: 'ISBN', ISSN: 'ISSN', url: 'URL',
  language: 'language', journalAbbreviation: 'container-title-short', shortTitle: 'title-short', extra: 'note',
  series: 'collection-title', seriesTitle: 'collection-title', seriesNumber: 'collection-number', numberOfVolumes: 'number-of-volumes',
  conferenceName: 'event-title', meetingName: 'event-title', section: 'section', versionNumber: 'version', libraryCatalog: 'source',
  callNumber: 'call-number', archive: 'archive', archiveLocation: 'archive_location', citationKey: 'citation-key',
  reportNumber: 'number', patentNumber: 'number', number: 'number', archiveID: 'number', applicationNumber: 'call-number',
  genre: 'genre', thesisType: 'genre', reportType: 'genre', websiteType: 'genre', presentationType: 'genre', manuscriptType: 'genre',
  letterType: 'genre', type: 'genre', status: 'status', medium: 'medium', format: 'medium', system: 'medium',
  publicationTitle: 'container-title', proceedingsTitle: 'container-title', bookTitle: 'container-title', websiteTitle: 'container-title',
  blogTitle: 'container-title', encyclopediaTitle: 'container-title',
  university: 'publisher', institution: 'publisher', company: 'publisher', repository: 'publisher', organization: 'authority',
  issuingAuthority: 'authority', country: 'jurisdiction',
};
const CREATOR_TO_CSL = {
  author: 'author', editor: 'editor', translator: 'translator', contributor: 'contributor', bookAuthor: 'container-author',
  seriesEditor: 'collection-editor', reviewedAuthor: 'reviewed-author', programmer: 'author', presenter: 'author',
  inventor: 'author', recipient: 'recipient', director: 'director', interviewer: 'interviewer', commenter: 'commenter',
};

export function itemToCSL(item, { cjkLiteral = false } = {}) {
  const f = item.fields || {};
  const csl = { id: item.key, type: TYPE_TO_CSL[item.itemType] || 'document' };
  for (const [k, v] of Object.entries(f)) {
    const ck = FIELD_TO_CSL[k];
    if (ck && v && !csl[ck]) csl[ck] = v;
  }
  if (item.itemType === 'standard' && f.organization && !(item.creators || []).length) csl.author = [{ literal: f.organization }];
  if (f.date) {
    const dp = parseDateParts(f.date);
    csl.issued = dp ? { 'date-parts': [dp] } : { literal: f.date };
  }
  if (f.accessDate) {
    const dp = parseDateParts(f.accessDate);
    if (dp) csl.accessed = { 'date-parts': [dp] };
  }
  for (const c of item.creators || []) {
    const role = CREATOR_TO_CSL[c.creatorType] || 'author';
    const cjk = cjkLiteral && /[㐀-鿿]/.test((c.lastName || '') + (c.firstName || ''));
    (csl[role] ||= []).push(c.name || cjk ? { literal: c.name || `${c.lastName || ''}${c.firstName || ''}` } : { family: c.lastName || '', given: c.firstName || '' });
  }
  return csl;
}

const CSL_TO_FIELD_BY_TYPE = {
  'container-title': { journalArticle: 'publicationTitle', magazineArticle: 'publicationTitle', newspaperArticle: 'publicationTitle', conferencePaper: 'proceedingsTitle', bookSection: 'bookTitle', webpage: 'websiteTitle', blogPost: 'blogTitle', encyclopediaArticle: 'encyclopediaTitle', preprint: 'repository' },
  publisher: { thesis: 'university', report: 'institution', computerProgram: 'company', preprint: 'repository', dataset: 'repository' },
  number: { report: 'reportNumber', patent: 'patentNumber', preprint: 'archiveID', standard: 'number' },
  genre: { thesis: 'thesisType', report: 'reportType', webpage: 'websiteType', blogPost: 'websiteType', presentation: 'presentationType', manuscript: 'manuscriptType', preprint: 'genre', standard: 'type', dataset: 'type' },
};
const CSL_TO_FIELD = {
  title: 'title', abstract: 'abstractNote', volume: 'volume', issue: 'issue', page: 'pages', 'number-of-pages': 'numPages',
  edition: 'edition', 'publisher-place': 'place', publisher: 'publisher', DOI: 'DOI', ISBN: 'ISBN', ISSN: 'ISSN', URL: 'url',
  language: 'language', 'container-title-short': 'journalAbbreviation', 'journalAbbreviation': 'journalAbbreviation', 'title-short': 'shortTitle',
  note: 'extra', 'collection-title': 'series', 'collection-number': 'seriesNumber', 'number-of-volumes': 'numberOfVolumes',
  'event-title': 'conferenceName', event: 'conferenceName', section: 'section', version: 'versionNumber', source: 'libraryCatalog',
  'call-number': 'callNumber', archive: 'archive', archive_location: 'archiveLocation', 'citation-key': 'citationKey',
  'container-title': 'publicationTitle', number: 'number', genre: 'genre',
};
const CSL_TO_CREATOR = {
  author: 'author', editor: 'editor', translator: 'translator', contributor: 'contributor', 'container-author': 'bookAuthor',
  'collection-editor': 'seriesEditor', 'reviewed-author': 'reviewedAuthor', recipient: 'recipient', director: 'director',
};

const one = (v) => (Array.isArray(v) ? v[0] : v);

export function cslToItem(csl) {
  const itemType = CSL_TO_TYPE[csl.type] || 'journalArticle';
  const allowed = new Set(ITEM_TYPES[itemType].fields);
  const fields = {};
  for (const [ck, v] of Object.entries(csl)) {
    let fk = CSL_TO_FIELD_BY_TYPE[ck]?.[itemType] || CSL_TO_FIELD[ck];
    if (!fk || v == null || typeof v === 'object' && !Array.isArray(v)) continue;
    let val = String(one(v)).trim();
    if (!val) continue;
    if (ck === 'event-title' && itemType === 'presentation') fk = 'meetingName';
    if (fk === 'conferenceName' && itemType !== 'conferencePaper') continue;
    if (!allowed.has(fk)) {
      if (fk === 'publisher' && allowed.has('repository')) fk = 'repository';
      else if (fk === 'number' && allowed.has('reportNumber')) fk = 'reportNumber';
      else continue;
    }
    if (fk === 'abstractNote') val = val.replace(/<\/?jats:[^>]+>/g, '').replace(/<[^>]+>/g, '').replace(/^\s*Abstract\s*/i, '').trim();
    fields[fk] ||= val;
  }
  if (csl.title) fields.title = String(one(csl.title)).replace(/<[^>]+>/g, '').trim();
  const issued = csl.issued || csl['published-print'] || csl['published-online'] || csl.created;
  const dp = issued?.['date-parts']?.[0];
  if (dp && dp[0]) fields.date = dp.map((x, i) => (i ? String(x).padStart(2, '0') : x)).join('-');
  else if (issued?.literal || issued?.raw) fields.date = issued.literal || issued.raw;
  const acc = csl.accessed?.['date-parts']?.[0];
  if (acc && allowed.has('accessDate')) fields.accessDate = acc.map((x, i) => (i ? String(x).padStart(2, '0') : x)).join('-');
  const creators = [];
  for (const [role, ct] of Object.entries(CSL_TO_CREATOR)) {
    for (const p of csl[role] || []) {
      if (p.literal || (!p.family && p.given)) creators.push({ creatorType: ct, name: p.literal || p.given });
      else if (p.family) creators.push({ creatorType: ct, lastName: [p['non-dropping-particle'], p.family].filter(Boolean).join(' '), firstName: [p.given, p['dropping-particle']].filter(Boolean).join(' ') });
    }
  }
  const validCreators = new Set(ITEM_TYPES[itemType].creators);
  for (const c of creators) if (!validCreators.has(c.creatorType)) c.creatorType = ITEM_TYPES[itemType].creators[0];
  const tags = [].concat(csl.keyword ? String(csl.keyword).split(/[,;]\s*/) : [], csl.tags || []).filter(Boolean).map((t) => ({ tag: String(t).trim(), type: 1 }));
  return { itemType, fields, creators, tags };
}
