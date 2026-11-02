// 划词翻译：Google 免费翻译接口（translate.googleapis.com, client=gtx）
const cache = new Map();
const MAX_CACHE = 500;

export const LANGUAGES = [
  ['zh-CN', '简体中文'], ['zh-TW', '繁體中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['fr', 'Français'],
  ['de', 'Deutsch'], ['it', 'Italiano'], ['es', 'Español'], ['pt', 'Português'], ['ru', 'Русский'], ['ar', 'العربية'],
];

// 学术文本预处理：去掉断行连字符、合并换行
export function cleanText(text) {
  return String(text || '')
    .replace(/(\w)-\s*\n\s*(\w)/g, '$1$2')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function google(text, sl, tl) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}&dt=t&dj=1`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'User-Agent': 'Mozilla/5.0' },
    body: new URLSearchParams({ q: text }),
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 429) throw new Error('Google 翻译请求过于频繁，请稍后再试');
  if (!r.ok) throw new Error(`Google 翻译失败（${r.status}）`);
  const d = await r.json();
  return { text: (d.sentences || []).map((s) => s.trans || '').join(''), detected: d.src || sl };
}

// 长文本按句子切成不超过 4500 字符的块
function chunks(text, max = 4500) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = '';
  for (const s of text.match(/[^.!?。！？]+[.!?。！？]*\s*/g) || [text]) {
    if ((cur + s).length > max && cur) { out.push(cur); cur = ''; }
    cur += s;
  }
  if (cur) out.push(cur);
  return out;
}

export async function translate({ text, from = 'auto', to = 'zh-CN', engine = 'google' }) {
  const src = cleanText(text);
  if (!src) return { text: '', detected: from, engine };
  const key = `${engine}|${from}|${to}|${src}`;
  if (cache.has(key)) return cache.get(key);
  if (engine !== 'google') throw new Error(`不支持的翻译引擎：${engine}`);
  const parts = [];
  let detected = from;
  for (const c of chunks(src)) {
    const r = await google(c, from, to);
    parts.push(r.text);
    detected = r.detected;
  }
  const result = { text: parts.join(''), detected, engine, source: src };
  cache.set(key, result);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return result;
}
