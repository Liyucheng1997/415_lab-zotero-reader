// 导出带注释的 PDF（写入标准 PDF 注释，其他阅读器也能看到）
import fs from 'node:fs';
import { PDFDocument, PDFName, PDFString, PDFArray } from 'pdf-lib';

function hexToRgb(hex) {
  const h = (hex || '#ffd400').replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

export async function exportAnnotatedPdf(file, annotations) {
  const pdf = await PDFDocument.load(await fs.promises.readFile(file), { ignoreEncryption: true });
  const pages = pdf.getPages();
  for (const a of annotations) {
    const pos = a.position;
    const page = pages[pos.pageIndex];
    if (!page) continue;
    const color = hexToRgb(a.color);
    const ctx = pdf.context;
    const base = {
      Type: 'Annot', C: color, T: PDFString.of('MyZotero'), M: PDFString.of(`D:${(a.dateModified || '').replace(/\D/g, '')}`),
      Contents: PDFString.of([a.text, a.comment].filter(Boolean).join('\n\n')), F: 4,
    };
    let dict;
    const rects = pos.rects || [];
    const bbox = rects.length ? [Math.min(...rects.map((r) => r[0])), Math.min(...rects.map((r) => r[1])), Math.max(...rects.map((r) => r[2])), Math.max(...rects.map((r) => r[3]))] : [0, 0, 0, 0];
    if (a.type === 'highlight' || a.type === 'underline') {
      const quads = rects.flatMap(([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1]);
      dict = ctx.obj({ ...base, Subtype: a.type === 'highlight' ? 'Highlight' : 'Underline', Rect: bbox, QuadPoints: quads, CA: a.type === 'highlight' ? 0.5 : 1 });
    } else if (a.type === 'note') {
      dict = ctx.obj({ ...base, Subtype: 'Text', Rect: bbox, Name: 'Comment', Open: false });
    } else if (a.type === 'image') {
      dict = ctx.obj({ ...base, Subtype: 'Square', Rect: bbox, BS: { W: 2 } });
    } else if (a.type === 'text') {
      dict = ctx.obj({ ...base, Subtype: 'FreeText', Rect: bbox, Contents: PDFString.of(a.comment || ''), DA: PDFString.of(`/Helv ${pos.fontSize || 14} Tf ${color.join(' ')} rg`) });
    } else if (a.type === 'ink') {
      const paths = pos.paths || [];
      const all = paths.flat();
      const xs = all.filter((_, i) => i % 2 === 0), ys = all.filter((_, i) => i % 2 === 1);
      const r = xs.length ? [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] : bbox;
      dict = ctx.obj({ ...base, Subtype: 'Ink', Rect: r, InkList: paths, BS: { W: pos.width || 2 } });
    } else continue;
    const ref = ctx.register(dict);
    let annots = page.node.lookup(PDFName.of('Annots'));
    if (!(annots instanceof PDFArray)) {
      annots = ctx.obj([]);
      page.node.set(PDFName.of('Annots'), annots);
    }
    annots.push(ref);
  }
  return Buffer.from(await pdf.save());
}
