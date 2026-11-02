// 条目类型、字段、作者类型：与 Zotero 字段名保持一致，便于导入导出。
const TAIL = ['shortTitle', 'url', 'accessDate', 'archive', 'archiveLocation', 'libraryCatalog', 'callNumber', 'rights', 'extra'];

export const ITEM_TYPES = {
  journalArticle: { label: '期刊文章', fields: ['title', 'abstractNote', 'publicationTitle', 'volume', 'issue', 'pages', 'date', 'series', 'seriesTitle', 'seriesText', 'journalAbbreviation', 'language', 'DOI', 'ISSN', 'citationKey', ...TAIL], creators: ['author', 'contributor', 'editor', 'translator', 'reviewedAuthor'] },
  conferencePaper: { label: '会议论文', fields: ['title', 'abstractNote', 'date', 'proceedingsTitle', 'conferenceName', 'place', 'publisher', 'volume', 'pages', 'series', 'language', 'DOI', 'ISBN', 'citationKey', ...TAIL], creators: ['author', 'contributor', 'editor', 'seriesEditor', 'translator'] },
  preprint: { label: '预印本', fields: ['title', 'abstractNote', 'genre', 'repository', 'archiveID', 'place', 'date', 'series', 'seriesNumber', 'DOI', 'citationKey', 'language', ...TAIL], creators: ['author', 'contributor', 'editor', 'reviewedAuthor', 'translator'] },
  book: { label: '图书', fields: ['title', 'abstractNote', 'series', 'seriesNumber', 'volume', 'numberOfVolumes', 'edition', 'place', 'publisher', 'date', 'numPages', 'language', 'ISBN', 'citationKey', ...TAIL], creators: ['author', 'contributor', 'editor', 'seriesEditor', 'translator'] },
  bookSection: { label: '图书章节', fields: ['title', 'abstractNote', 'bookTitle', 'series', 'seriesNumber', 'volume', 'numberOfVolumes', 'edition', 'place', 'publisher', 'date', 'pages', 'language', 'ISBN', 'citationKey', ...TAIL], creators: ['author', 'bookAuthor', 'contributor', 'editor', 'seriesEditor', 'translator'] },
  thesis: { label: '学位论文', fields: ['title', 'abstractNote', 'thesisType', 'university', 'place', 'date', 'numPages', 'language', 'citationKey', ...TAIL], creators: ['author', 'contributor'] },
  report: { label: '报告', fields: ['title', 'abstractNote', 'reportNumber', 'reportType', 'seriesTitle', 'place', 'institution', 'date', 'pages', 'language', 'citationKey', ...TAIL], creators: ['author', 'contributor', 'seriesEditor', 'translator'] },
  standard: { label: '标准', fields: ['title', 'abstractNote', 'organization', 'committee', 'type', 'number', 'versionNumber', 'status', 'date', 'publisher', 'place', 'DOI', 'numPages', 'language', 'citationKey', ...TAIL], creators: ['author', 'contributor'] },
  patent: { label: '专利', fields: ['title', 'abstractNote', 'place', 'country', 'assignee', 'issuingAuthority', 'patentNumber', 'filingDate', 'pages', 'applicationNumber', 'priorityNumbers', 'issueDate', 'references', 'legalStatus', 'language', 'shortTitle', 'url', 'accessDate', 'rights', 'extra'], creators: ['inventor', 'attorneyAgent', 'contributor'] },
  dataset: { label: '数据集', fields: ['title', 'abstractNote', 'identifier', 'type', 'versionNumber', 'date', 'repository', 'place', 'format', 'size', 'DOI', 'citationKey', 'language', ...TAIL], creators: ['author', 'contributor'] },
  computerProgram: { label: '软件', fields: ['title', 'abstractNote', 'seriesTitle', 'versionNumber', 'date', 'system', 'place', 'company', 'programmingLanguage', 'ISBN', 'citationKey', ...TAIL], creators: ['programmer', 'contributor'] },
  webpage: { label: '网页', fields: ['title', 'abstractNote', 'websiteTitle', 'websiteType', 'date', 'shortTitle', 'url', 'accessDate', 'language', 'rights', 'extra'], creators: ['author', 'contributor', 'translator'] },
  blogPost: { label: '博客文章', fields: ['title', 'abstractNote', 'blogTitle', 'websiteType', 'date', 'url', 'accessDate', 'language', 'shortTitle', 'rights', 'extra'], creators: ['author', 'commenter', 'contributor'] },
  magazineArticle: { label: '杂志文章', fields: ['title', 'abstractNote', 'publicationTitle', 'volume', 'issue', 'date', 'pages', 'language', 'ISSN', ...TAIL], creators: ['author', 'contributor', 'reviewedAuthor', 'translator'] },
  newspaperArticle: { label: '报纸文章', fields: ['title', 'abstractNote', 'publicationTitle', 'place', 'edition', 'date', 'section', 'pages', 'language', 'ISSN', ...TAIL], creators: ['author', 'contributor', 'reviewedAuthor', 'translator'] },
  encyclopediaArticle: { label: '百科条目', fields: ['title', 'abstractNote', 'encyclopediaTitle', 'series', 'seriesNumber', 'volume', 'numberOfVolumes', 'edition', 'place', 'publisher', 'date', 'pages', 'ISBN', 'language', ...TAIL], creators: ['author', 'contributor', 'editor', 'seriesEditor', 'translator'] },
  presentation: { label: '演示文稿', fields: ['title', 'abstractNote', 'presentationType', 'date', 'place', 'meetingName', 'url', 'accessDate', 'language', 'shortTitle', 'rights', 'extra'], creators: ['presenter', 'contributor'] },
  manuscript: { label: '手稿', fields: ['title', 'abstractNote', 'manuscriptType', 'place', 'date', 'numPages', 'language', ...TAIL], creators: ['author', 'contributor', 'translator'] },
  letter: { label: '信件', fields: ['title', 'abstractNote', 'letterType', 'date', 'language', ...TAIL], creators: ['author', 'contributor', 'recipient'] },
  document: { label: '文档', fields: ['title', 'abstractNote', 'publisher', 'date', 'language', ...TAIL], creators: ['author', 'contributor', 'editor', 'translator', 'reviewedAuthor'] },
  // 非常规条目
  note: { label: '笔记', fields: [], creators: [] },
  attachment: { label: '附件', fields: ['title', 'url', 'accessDate'], creators: [] },
};

export const REGULAR_TYPES = Object.keys(ITEM_TYPES).filter((t) => t !== 'note' && t !== 'attachment');

export const FIELD_LABELS = {
  title: '标题', abstractNote: '摘要', publicationTitle: '期刊', proceedingsTitle: '会议录', conferenceName: '会议名称',
  bookTitle: '书名', websiteTitle: '网站', blogTitle: '博客名', encyclopediaTitle: '百科全书', volume: '卷', issue: '期',
  pages: '页码', date: '日期', series: '系列', seriesTitle: '系列标题', seriesText: '系列描述', seriesNumber: '系列编号',
  journalAbbreviation: '期刊缩写', language: '语言', DOI: 'DOI', ISSN: 'ISSN', ISBN: 'ISBN', shortTitle: '短标题',
  url: '网址', accessDate: '访问时间', archive: '档案', archiveLocation: '档案位置', libraryCatalog: '馆藏目录',
  callNumber: '索书号', rights: '版权', extra: '其他', place: '地点', publisher: '出版社', edition: '版本',
  numberOfVolumes: '总卷数', numPages: '总页数', thesisType: '论文类型', university: '学校', reportNumber: '报告编号',
  reportType: '报告类型', institution: '机构', genre: '类型', repository: '仓库', archiveID: '存档 ID', citationKey: '引用键',
  organization: '组织', committee: '委员会', type: '类型', number: '编号', versionNumber: '版本号', status: '状态',
  country: '国家', assignee: '受让人', issuingAuthority: '发布机构', patentNumber: '专利号', filingDate: '申请日期',
  applicationNumber: '申请号', priorityNumbers: '优先权号', issueDate: '公告日期', references: '参考文献', legalStatus: '法律状态',
  identifier: '标识符', format: '格式', size: '大小', system: '系统', company: '公司', programmingLanguage: '编程语言',
  websiteType: '网站类型', section: '版块', presentationType: '演示类型', meetingName: '会议名称', manuscriptType: '手稿类型',
  letterType: '信件类型', dateAdded: '添加日期', dateModified: '修改日期',
};

export const CREATOR_LABELS = {
  author: '作者', contributor: '贡献者', editor: '编辑', translator: '译者', reviewedAuthor: '被评论作者',
  seriesEditor: '系列编辑', bookAuthor: '图书作者', programmer: '程序员', inventor: '发明人', attorneyAgent: '代理人',
  presenter: '报告人', commenter: '评论人', recipient: '收件人', director: '导演', interviewer: '采访者', interviewee: '受访者',
};

// 长文本字段
export const MULTILINE_FIELDS = new Set(['abstractNote', 'extra']);

// 取年份
export function yearOf(date) {
  const m = String(date || '').match(/\b(1[0-9]\d\d|20\d\d|21\d\d)\b/);
  return m ? m[1] : '';
}

// 解析日期为 [y, m, d]
export function parseDateParts(date) {
  const s = String(date || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2}))?/);
  if (m) return [+m[1], +m[2], m[3] ? +m[3] : undefined].filter((x) => x !== undefined);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) return [+m[3], +m[2], +m[1]];
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const y = yearOf(s);
  if (!y) return null;
  const mi = months.findIndex((mo) => s.toLowerCase().includes(mo));
  if (mi >= 0) {
    const d = s.replace(y, '').match(/\b(\d{1,2})\b/);
    return d ? [+y, mi + 1, +d[1]] : [+y, mi + 1];
  }
  return [+y];
}

export function creatorName(c) {
  if (!c) return '';
  if (c.name) return c.name;
  return [c.lastName, c.firstName].filter(Boolean).join(', ');
}

export function creatorLast(c) {
  return c ? c.name || c.lastName || c.firstName || '' : '';
}

// 列表里的"作者"列：Zotero 风格
export function creatorSummary(item) {
  const cs = (item.creators || []);
  const types = ITEM_TYPES[item.itemType]?.creators || ['author'];
  const primary = types[0] || 'author';
  let list = cs.filter((c) => c.creatorType === primary);
  if (!list.length) list = cs.filter((c) => c.creatorType === 'editor');
  if (!list.length) list = cs;
  if (!list.length) return '';
  const n = (c) => creatorLast(c);
  if (list.length === 1) return n(list[0]);
  if (list.length === 2) return `${n(list[0])} 和 ${n(list[1])}`;
  return `${n(list[0])} 等`;
}

// 期刊/会议/书名等"出版物"字段
export const CONTAINER_FIELDS = ['publicationTitle', 'proceedingsTitle', 'bookTitle', 'websiteTitle', 'blogTitle', 'encyclopediaTitle', 'repository', 'university', 'institution', 'publisher'];
export function containerOf(item) {
  const f = item.fields || {};
  for (const k of CONTAINER_FIELDS) if (f[k]) return f[k];
  return '';
}

// Zotero 注释调色板（内容颜色，非界面装饰色）
export const ANNOTATION_COLORS = [
  { color: '#ffd400', name: '黄色' },
  { color: '#ff6666', name: '红色' },
  { color: '#5fb236', name: '绿色' },
  { color: '#2ea8e5', name: '蓝色' },
  { color: '#a28ae5', name: '紫色' },
  { color: '#e56eee', name: '品红' },
  { color: '#f19837', name: '橙色' },
  { color: '#aaaaaa', name: '灰色' },
];

export const KEY_CHARS = '23456789ABCDEFGHIJKLMNPQRSTUVWXYZ';
export function makeKey() {
  let k = '';
  for (let i = 0; i < 8; i++) k += KEY_CHARS[Math.floor(Math.random() * KEY_CHARS.length)];
  return k;
}
