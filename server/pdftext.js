// 在 Node 端用 pdf.js 读取 PDF 文本（全文索引、元数据识别）
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let pdfjs;
async function lib() {
  if (!pdfjs) pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  return pdfjs;
}
const standardFontDataUrl = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep;

export async function openPdf(file) {
  const { getDocument } = await lib();
  const data = new Uint8Array(await fs.promises.readFile(file));
  return getDocument({ data, standardFontDataUrl, verbosity: 0, isEvalSupported: false, disableFontFace: true }).promise;
}

export async function pageText(doc, n) {
  const page = await doc.getPage(n);
  const tc = await page.getTextContent();
  let out = '';
  for (const it of tc.items) out += it.str + (it.hasEOL ? '\n' : '');
  return { text: out, items: tc.items };
}

export async function extractText(file, maxPages = Infinity) {
  const doc = await openPdf(file);
  try {
    const pages = [];
    const n = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= n; i++) pages.push((await pageText(doc, i)).text);
    return { numPages: doc.numPages, text: pages.join('\n\f') };
  } finally {
    doc.destroy();
  }
}

// 首页最大字号的文字，作为标题候选
export async function guessInfo(file) {
  const doc = await openPdf(file);
  try {
    const meta = await doc.getMetadata().catch(() => ({}));
    const first = await pageText(doc, 1);
    const second = doc.numPages > 1 ? await pageText(doc, 2) : { text: '' };
    const sized = first.items.filter((i) => i.str.trim()).map((i) => ({ s: i.str, h: Math.round(Math.abs(i.transform[3]) * 10) / 10, y: i.transform[5] }));
    let title = '';
    if (sized.length) {
      const max = Math.max(...sized.filter((x) => x.s.trim().length > 1).map((x) => x.h));
      const parts = sized.filter((x) => x.h >= max - 0.6);
      const ys = parts.map((p) => p.y);
      const top = Math.max(...ys);
      title = parts.filter((p) => top - p.y < max * 4).map((p) => p.s).join(' ').replace(/\s+/g, ' ').trim();
    }
    return {
      numPages: doc.numPages,
      infoTitle: meta?.info?.Title || '',
      infoAuthor: meta?.info?.Author || '',
      text: first.text + '\n' + second.text,
      title,
    };
  } finally {
    doc.destroy();
  }
}
