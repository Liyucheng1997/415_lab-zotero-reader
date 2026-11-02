// pdf.js 查看器封装：连续滚动、缩放、查找、链接，以及与 Zotero 兼容的注释图层
import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import 'pdfjs-dist/web/pdf_viewer.css';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
globalThis.pdfjsLib = pdfjsLib;
let viewerLib;
const loadViewerLib = async () => (viewerLib ||= await import('pdfjs-dist/web/pdf_viewer.mjs'));

const SVGNS = 'http://www.w3.org/2000/svg';
const pad = (n, w) => String(Math.max(0, Math.round(n))).padStart(w, '0');

export class PdfView {
  constructor(container, handlers) {
    this.container = container;
    this.h = handlers;
    this.annotations = [];
    this.selectedId = null;
    this.tool = 'select';
    this.color = '#ffd400';
    this.inkWidth = 2;
    this.dark = false;
    this.destroyed = false;
    this.eraserSize = 10;
  }

  async open(url) {
    const { EventBus, PDFViewer, PDFLinkService, PDFFindController, LinkTarget } = await loadViewerLib();
    if (this.destroyed) return;
    const viewerEl = document.createElement('div');
    viewerEl.className = 'pdfViewer';
    this.container.appendChild(viewerEl);
    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK, externalLinkRel: 'noopener noreferrer' });
    const findController = new PDFFindController({ eventBus, linkService });
    const viewer = new PDFViewer({
      container: this.container, viewer: viewerEl, eventBus, linkService, findController,
      textLayerMode: 1, removePageBorders: true, annotationEditorMode: pdfjsLib.AnnotationEditorType.DISABLE,
      maxCanvasPixels: 2 ** 25,
    });
    linkService.setViewer(viewer);
    Object.assign(this, { eventBus, linkService, findController, viewer });

    const loadingTask = pdfjsLib.getDocument({ url, cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', isEvalSupported: false });
    this.loadingTask = loadingTask;
    const doc = await loadingTask.promise;
    if (this.destroyed) { doc.destroy(); return; }
    this.doc = doc;
    this.pageLabels = await doc.getPageLabels().catch(() => null);
    eventBus.on('pagesinit', () => this.h.onInit?.());
    eventBus.on('pagerendered', (e) => this.decoratePage(e.source));
    eventBus.on('textlayerrendered', (e) => this.decoratePage(e.source));
    eventBus.on('pagechanging', (e) => this.h.onPage?.(e.pageNumber));
    eventBus.on('scalechanging', (e) => { this.h.onScale?.(e.scale, e.presetValue); requestAnimationFrame(() => this.redrawAll()); });
    eventBus.on('updateviewarea', (e) => this.h.onViewArea?.(e.location));
    eventBus.on('updatefindmatchescount', (e) => this.h.onFindCount?.(e.matchesCount));
    eventBus.on('updatefindcontrolstate', (e) => this.h.onFindCount?.(e.matchesCount, e.state));

    viewer.setDocument(doc);
    linkService.setDocument(doc);

    this.bindEvents();
    return { numPages: doc.numPages };
  }

  destroy() {
    this.destroyed = true;
    this.unbind?.();
    try { this.viewer?.setDocument(null); } catch { /* 忽略 */ }
    this.loadingTask?.destroy();
    this.doc = null;
  }

  // —— 视图控制 ——
  get numPages() { return this.doc?.numPages || 0; }
  get page() { return this.viewer?.currentPageNumber || 1; }
  set page(n) { if (this.viewer) this.viewer.currentPageNumber = Math.max(1, Math.min(this.numPages, n)); }
  get scale() { return this.viewer?.currentScale || 1; }
  setScale(v) { if (this.viewer) this.viewer.currentScaleValue = String(v); }
  zoom(f) { if (this.viewer) this.viewer.currentScale = Math.max(0.25, Math.min(6, Math.round(this.viewer.currentScale * f * 100) / 100)); }
  rotate(d) { if (this.viewer) this.viewer.pagesRotation = (this.viewer.pagesRotation + d + 360) % 360; }
  setSpread(mode) { if (this.viewer) this.viewer.spreadMode = mode; }
  setScrollMode(mode) { if (this.viewer) this.viewer.scrollMode = mode; }
  pageLabel(i) { return this.pageLabels?.[i] || String(i + 1); }

  restore(loc) {
    if (!loc) { this.viewer.currentScaleValue = 'page-width'; return; }
    this.viewer.currentScaleValue = String(loc.scale ?? 'page-width');
    if (loc.pageNumber) this.viewer.scrollPageIntoView({ pageNumber: loc.pageNumber, destArray: [null, { name: 'XYZ' }, loc.left ?? 0, loc.top ?? null, null], allowNegativeOffset: true });
  }

  goToDest(dest) { this.linkService.goToDestination(dest); }

  scrollToAnnotation(a) {
    const p = a.position;
    const r = p.rects?.[0] || (p.paths?.[0] ? [p.paths[0][0], p.paths[0][1], p.paths[0][0], p.paths[0][1]] : null);
    const page = this.doc && p.pageIndex + 1;
    if (!page) return;
    this.viewer.scrollPageIntoView({ pageNumber: page, destArray: [null, { name: 'XYZ' }, r ? r[0] - 40 : 0, r ? r[3] + 60 : null, null], allowNegativeOffset: true });
  }

  find(query, { again, previous, caseSensitive, entireWord } = {}) {
    this.eventBus?.dispatch('find', { source: this, type: again ? 'again' : '', query, caseSensitive: !!caseSensitive, entireWord: !!entireWord, highlightAll: true, findPrevious: !!previous, phraseSearch: true });
  }
  clearFind() { this.eventBus?.dispatch('findbarclose', { source: this }); }

  // —— 注释 ——
  setAnnotations(list, selectedId) {
    this.annotations = list;
    this.selectedId = selectedId;
    this.redrawAll();
  }
  setTool(tool, color) {
    this.tool = tool;
    if (color) this.color = color;
    this.container.classList.toggle('tool-hand', tool === 'hand');
    this.redrawAll();
  }

  pageViews() {
    const out = [];
    for (let i = 0; i < this.numPages; i++) {
      const pv = this.viewer.getPageView(i);
      if (pv?.div) out.push(pv);
    }
    return out;
  }

  redrawAll() {
    if (!this.viewer) return;
    for (const pv of this.pageViews()) if (pv.div.querySelector('.canvasWrapper')) this.decoratePage(pv);
  }

  decoratePage(pv) {
    if (!pv?.div || !pv.viewport) return;
    let layer = pv.div.querySelector(':scope > .zz-layer');
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'zz-layer';
      const cw = pv.div.querySelector('.canvasWrapper');
      if (cw?.nextSibling) pv.div.insertBefore(layer, cw.nextSibling);
      else pv.div.appendChild(layer);
    }
    this.drawLayer(pv, layer);
    let tl = pv.div.querySelector(':scope > .zz-tool-layer');
    const needTool = ['note', 'text', 'image', 'ink', 'eraser'].includes(this.tool);
    if (needTool && !tl) {
      tl = document.createElement('div');
      tl.className = 'zz-tool-layer';
      tl.dataset.page = pv.id - 1;
      pv.div.appendChild(tl);
    } else if (!needTool && tl) tl.remove();
    if (tl) tl.style.cursor = this.tool === 'eraser' ? 'cell' : 'crosshair';
  }

  drawLayer(pv, layer) {
    const vp = pv.viewport;
    const pageIndex = pv.id - 1;
    const scale = vp.scale;
    layer.innerHTML = '';
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('width', vp.width);
    svg.setAttribute('height', vp.height);
    layer.appendChild(svg);
    const rectOf = (r) => {
      const [x1, y1, x2, y2] = vp.convertToViewportRectangle(r);
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    };
    const mk = (tag, attrs) => {
      const el = document.createElementNS(SVGNS, tag);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      return el;
    };
    for (const a of this.annotations) {
      const p = a.position;
      if (p.pageIndex !== pageIndex) continue;
      const color = a.color || '#ffd400';
      const sel = a.id === this.selectedId;
      const g = mk('g', { 'data-id': a.id });
      if (a.type === 'highlight') {
        for (const r of p.rects || []) {
          const b = rectOf(r);
          g.appendChild(mk('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: color, 'fill-opacity': 0.42, class: 'zz-hl' }));
        }
      } else if (a.type === 'underline') {
        for (const r of p.rects || []) {
          const b = rectOf(r);
          const t = Math.max(1.2, 1.1 * scale);
          g.appendChild(mk('rect', { x: b.x, y: b.y + b.h - t, width: b.w, height: t, fill: color }));
        }
      } else if (a.type === 'image') {
        const b = rectOf(p.rects[0]);
        g.appendChild(mk('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'none', stroke: color, 'stroke-width': Math.max(1.5, 2 * scale / 1.5) }));
      } else if (a.type === 'ink') {
        for (const path of p.paths || []) {
          const pts = [];
          for (let i = 0; i < path.length; i += 2) pts.push(vp.convertToViewportPoint(path[i], path[i + 1]).join(','));
          g.appendChild(mk('polyline', { points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': (p.width || 2) * scale, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        }
      } else if (a.type === 'note') {
        const b = rectOf(p.rects[0]);
        const d = document.createElement('div');
        d.className = 'zz-note-ico';
        d.dataset.id = a.id;
        Object.assign(d.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px`, background: color, outline: sel ? '2px solid var(--primary)' : '', outlineOffset: '2px' });
        d.innerHTML = `<svg width="${b.w * 0.6}" height="${b.h * 0.6}" viewBox="0 0 24 24" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="2.4" stroke-linecap="round"><path d="M6 8h12M6 12h12M6 16h7"/></svg>`;
        layer.appendChild(d);
      } else if (a.type === 'text') {
        const b = rectOf(p.rects[0]);
        const d = document.createElement('div');
        d.className = `zz-text-ann${sel ? ' sel' : ''}`;
        d.dataset.id = a.id;
        Object.assign(d.style, { left: `${b.x}px`, top: `${b.y}px`, minWidth: `${b.w}px`, minHeight: `${b.h}px`, fontSize: `${(p.fontSize || 14) * scale}px`, color });
        d.textContent = a.comment || '';
        layer.appendChild(d);
      }
      if (sel && a.type !== 'note' && a.type !== 'text') {
        const bb = this.bbox(a, vp);
        if (bb) g.appendChild(mk('rect', { x: bb.x - 3, y: bb.y - 3, width: bb.w + 6, height: bb.h + 6, rx: 3, class: 'zz-sel-outline' }));
      }
      svg.appendChild(g);
    }
  }

  bbox(a, vp) {
    const p = a.position;
    let pts = [];
    if (p.rects?.length) for (const r of p.rects) { const v = vp.convertToViewportRectangle(r); pts.push([v[0], v[1]], [v[2], v[3]]); }
    if (p.paths?.length) for (const path of p.paths) for (let i = 0; i < path.length; i += 2) pts.push(vp.convertToViewportPoint(path[i], path[i + 1]));
    if (!pts.length) return null;
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }

  // 注释在容器中的客户区矩形（定位弹窗）
  clientRectOf(a) {
    const pv = this.viewer?.getPageView(a.position.pageIndex);
    if (!pv?.div) return null;
    const bb = this.bbox(a, pv.viewport);
    if (!bb) return null;
    const pr = pv.div.getBoundingClientRect();
    return { left: pr.left + bb.x, top: pr.top + bb.y, right: pr.left + bb.x + bb.w, bottom: pr.top + bb.y + bb.h, width: bb.w, height: bb.h };
  }

  // —— 交互 ——
  pageAt(clientX, clientY) {
    for (const pv of this.pageViews()) {
      const r = pv.div.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) return { pv, x: clientX - r.left, y: clientY - r.top };
    }
    return null;
  }

  hitTest(clientX, clientY) {
    const hit = this.pageAt(clientX, clientY);
    if (!hit) return null;
    const [px, py] = hit.pv.viewport.convertToPdfPoint(hit.x, hit.y);
    const tol = 4 / hit.pv.viewport.scale;
    const cands = this.annotations.filter((a) => a.position.pageIndex === hit.pv.id - 1);
    for (let i = cands.length - 1; i >= 0; i--) {
      const a = cands[i];
      const p = a.position;
      if (p.rects?.some(([x1, y1, x2, y2]) => px >= Math.min(x1, x2) - tol && px <= Math.max(x1, x2) + tol && py >= Math.min(y1, y2) - tol && py <= Math.max(y1, y2) + tol)) return a;
      if (p.paths?.some((path) => { for (let k = 0; k < path.length; k += 2) if (Math.hypot(path[k] - px, path[k + 1] - py) < tol + (p.width || 2)) return true; return false; })) return a;
    }
    return null;
  }

  sortIndex(pageIndex, offset, top) { return `${pad(pageIndex, 5)}|${pad(offset, 6)}|${pad(top, 5)}`; }

  topOf(pv, y2) {
    const h = pv.pdfPage.view[3] - pv.pdfPage.view[1];
    return h - y2;
  }

  // 读取当前文本选区 → 每页的 PDF 坐标矩形
  readSelection() {
    const sel = getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!this.container.contains(range.commonAncestorContainer)) return null;
    const pages = new Map();
    for (const cr of range.getClientRects()) {
      if (cr.width < 1 || cr.height < 1) continue;
      const hit = this.pageAt(cr.left + cr.width / 2, cr.top + cr.height / 2);
      if (!hit) continue;
      const pr = hit.pv.div.getBoundingClientRect();
      const [x1, y1] = hit.pv.viewport.convertToPdfPoint(cr.left - pr.left, cr.bottom - pr.top);
      const [x2, y2] = hit.pv.viewport.convertToPdfPoint(cr.right - pr.left, cr.top - pr.top);
      const r = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
      if (!pages.has(hit.pv)) pages.set(hit.pv, []);
      pages.get(hit.pv).push(r);
    }
    if (!pages.size) return null;
    const text = sel.toString().replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ').trim();
    const out = [];
    for (const [pv, rects] of pages) {
      const merged = mergeRects(rects);
      const pageIndex = pv.id - 1;
      const offset = charOffset(pv, range);
      const top = this.topOf(pv, Math.max(...merged.map((r) => r[3])));
      out.push({ pageIndex, pageLabel: this.pageLabel(pageIndex), rects: merged, sortIndex: this.sortIndex(pageIndex, offset, top) });
    }
    const last = [...range.getClientRects()].filter((r) => r.width > 0).pop();
    return { pages: out, text, anchor: last ? { left: last.left, right: last.right, top: last.top, bottom: last.bottom } : null };
  }

  bindEvents() {
    const c = this.container;
    let drag = null;
    let downAt = null;
    const down = (e) => {
      if (e.button !== 0) return;
      downAt = { x: e.clientX, y: e.clientY };
      const tl = e.target.closest('.zz-tool-layer');
      if (this.tool === 'hand' && !tl) {
        drag = { type: 'hand', x: e.clientX, y: e.clientY, sl: c.scrollLeft, st: c.scrollTop };
        c.classList.add('dragging');
        e.preventDefault();
        return;
      }
      if (!tl) return;
      e.preventDefault();
      const pageIndex = +tl.dataset.page;
      const pv = this.viewer.getPageView(pageIndex);
      const pr = pv.div.getBoundingClientRect();
      const pt = pv.viewport.convertToPdfPoint(e.clientX - pr.left, e.clientY - pr.top);
      tl.setPointerCapture(e.pointerId);
      if (this.tool === 'note' || this.tool === 'text') {
        const size = this.tool === 'note' ? 22 : 14;
        const rect = this.tool === 'note' ? [pt[0] - 11, pt[1] - 11, pt[0] + 11, pt[1] + 11] : [pt[0], pt[1] - size, pt[0] + 140, pt[1]];
        this.h.onCreate?.({ type: this.tool, color: this.tool === 'text' ? this.color : this.color, pageLabel: this.pageLabel(pageIndex), sortIndex: this.sortIndex(pageIndex, 0, this.topOf(pv, rect[3])), position: this.tool === 'text' ? { pageIndex, fontSize: 14, rotation: 0, rects: [rect] } : { pageIndex, rects: [rect] } });
        return;
      }
      if (this.tool === 'image') {
        const box = document.createElement('div');
        Object.assign(box.style, { position: 'absolute', border: `2px solid ${this.color}`, background: `${this.color}22`, pointerEvents: 'none' });
        tl.appendChild(box);
        drag = { type: 'image', tl, pv, pr, x0: e.clientX - pr.left, y0: e.clientY - pr.top, box, pageIndex };
        return;
      }
      if (this.tool === 'ink') {
        const svg = document.createElementNS(SVGNS, 'svg');
        Object.assign(svg.style, { position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' });
        const line = document.createElementNS(SVGNS, 'polyline');
        line.setAttribute('fill', 'none');
        line.setAttribute('stroke', this.color);
        line.setAttribute('stroke-width', this.inkWidth * pv.viewport.scale);
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(line);
        tl.appendChild(svg);
        const vx = e.clientX - pr.left, vy = e.clientY - pr.top;
        drag = { type: 'ink', tl, pv, pr, svg, line, pts: [[vx, vy]], pdf: [...pt], pageIndex };
        line.setAttribute('points', `${vx},${vy}`);
        return;
      }
      if (this.tool === 'eraser') {
        drag = { type: 'eraser', pv, pr, pageIndex };
        this.erase(drag, e);
      }
    };
    const move = (e) => {
      if (!drag) return;
      if (drag.type === 'hand') { c.scrollLeft = drag.sl - (e.clientX - drag.x); c.scrollTop = drag.st - (e.clientY - drag.y); return; }
      const pr = drag.pv.div.getBoundingClientRect();
      const x = e.clientX - pr.left, y = e.clientY - pr.top;
      if (drag.type === 'image') {
        Object.assign(drag.box.style, { left: `${Math.min(x, drag.x0)}px`, top: `${Math.min(y, drag.y0)}px`, width: `${Math.abs(x - drag.x0)}px`, height: `${Math.abs(y - drag.y0)}px` });
        drag.x1 = x; drag.y1 = y;
      } else if (drag.type === 'ink') {
        drag.pts.push([x, y]);
        drag.pdf.push(...drag.pv.viewport.convertToPdfPoint(x, y));
        drag.line.setAttribute('points', drag.pts.map((p) => p.join(',')).join(' '));
      } else if (drag.type === 'eraser') this.erase(drag, e);
    };
    const up = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      c.classList.remove('dragging');
      if (d.type === 'image') {
        d.box.remove();
        if (d.x1 == null || Math.abs(d.x1 - d.x0) < 6 || Math.abs(d.y1 - d.y0) < 6) return;
        const [ax, ay] = d.pv.viewport.convertToPdfPoint(d.x0, d.y0);
        const [bx, by] = d.pv.viewport.convertToPdfPoint(d.x1, d.y1);
        const rect = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
        this.h.onCreate?.({ type: 'image', color: this.color, pageLabel: this.pageLabel(d.pageIndex), sortIndex: this.sortIndex(d.pageIndex, 0, this.topOf(d.pv, rect[3])), position: { pageIndex: d.pageIndex, rects: [rect] } });
      } else if (d.type === 'ink') {
        d.svg.remove();
        if (d.pdf.length < 4) return;
        const path = d.pdf.map((v) => Math.round(v * 1000) / 1000);
        // 与最近 1.5 秒内同页同色的手绘合并为一条注释（Zotero 行为）
        const now = Date.now();
        const prev = this.lastInk && now - this.lastInk.t < 1500 && this.lastInk.pageIndex === d.pageIndex && this.lastInk.color === this.color ? this.annotations.find((a) => a.id === this.lastInk.id) : null;
        if (prev) {
          this.h.onUpdate?.(prev.id, { position: { ...prev.position, paths: [...prev.position.paths, path] } });
          this.lastInk.t = now;
        } else {
          const ys = path.filter((_, i) => i % 2 === 1);
          this.h.onCreate?.({ type: 'ink', color: this.color, pageLabel: this.pageLabel(d.pageIndex), sortIndex: this.sortIndex(d.pageIndex, 0, this.topOf(d.pv, Math.max(...ys))), position: { pageIndex: d.pageIndex, width: this.inkWidth, paths: [path] } }).then?.((a) => { if (a) this.lastInk = { id: a.id, t: Date.now(), pageIndex: d.pageIndex, color: this.color }; });
        }
      }
    };
    const click = (e) => {
      if (this.tool === 'hand' || e.target.closest('.zz-tool-layer')) return;
      if (getSelection()?.toString()) return;
      // 拖动选择文字后触发的 click 不算点击注释
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return;
      const el = e.target.closest('.zz-note-ico, .zz-text-ann');
      const a = el ? this.annotations.find((x) => String(x.id) === el.dataset.id) : this.hitTest(e.clientX, e.clientY);
      if (e.target.closest('.annotationLayer a')) return;
      this.h.onAnnotationClick?.(a || null, e);
    };
    const mouseup = (e) => {
      if (e.button !== 0 || this.tool === 'hand') return;
      setTimeout(() => {
        const s = this.readSelection();
        this.h.onSelection?.(s, e);
      }, 0);
    };
    c.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    c.addEventListener('click', click);
    c.addEventListener('mouseup', mouseup);
    this.unbind = () => {
      c.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      c.removeEventListener('click', click);
      c.removeEventListener('mouseup', mouseup);
    };
  }

  erase(d, e) {
    const pr = d.pv.div.getBoundingClientRect();
    const [px, py] = d.pv.viewport.convertToPdfPoint(e.clientX - pr.left, e.clientY - pr.top);
    const r = this.eraserSize / d.pv.viewport.scale;
    for (const a of this.annotations) {
      if (a.type !== 'ink' || a.position.pageIndex !== d.pageIndex) continue;
      const paths = a.position.paths.filter((path) => { for (let k = 0; k < path.length; k += 2) if (Math.hypot(path[k] - px, path[k + 1] - py) < r) return false; return true; });
      if (paths.length !== a.position.paths.length) {
        if (paths.length) this.h.onUpdate?.(a.id, { position: { ...a.position, paths } });
        else this.h.onDelete?.([a.id]);
      }
    }
  }

  // 截取页面区域（图片注释预览）
  async renderRegion(pageIndex, rect, scale = 2) {
    if (!this.doc) return null;
    const page = await this.doc.getPage(pageIndex + 1);
    const [x1, y1, x2, y2] = rect;
    const full = page.getViewport({ scale });
    const [vx1, vy1, vx2, vy2] = full.convertToViewportRectangle([x1, y1, x2, y2]);
    const w = Math.ceil(Math.abs(vx2 - vx1)), h = Math.ceil(Math.abs(vy2 - vy1));
    if (!w || !h) return null;
    const vp = page.getViewport({ scale, offsetX: -Math.min(vx1, vx2), offsetY: -Math.min(vy1, vy2) });
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    return canvas.toDataURL('image/png');
  }

  async renderThumb(pageIndex, width, canvas) {
    const page = await this.doc.getPage(pageIndex + 1);
    const vp0 = page.getViewport({ scale: 1, rotation: this.viewer?.pagesRotation || 0 });
    const scale = (width * (window.devicePixelRatio || 1)) / vp0.width;
    const vp = page.getViewport({ scale, rotation: this.viewer?.pagesRotation || 0 });
    canvas.width = vp.width;
    canvas.height = vp.height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${(vp.height / vp.width) * width}px`;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  }

  async pageSize(pageIndex) {
    const page = await this.doc.getPage(pageIndex + 1);
    const vp = page.getViewport({ scale: 1 });
    return { w: vp.width, h: vp.height };
  }
}

// 同一行的矩形合并
function mergeRects(rects) {
  const sorted = rects.map((r) => [...r]).sort((a, b) => b[3] - a[3] || a[0] - b[0]);
  const lines = [];
  for (const r of sorted) {
    const h = r[3] - r[1];
    const line = lines.find((l) => {
      const ov = Math.min(l[3], r[3]) - Math.max(l[1], r[1]);
      return ov > 0.5 * Math.min(h, l[3] - l[1]) && r[0] <= l[2] + h * 1.5 && r[2] >= l[0] - h * 1.5;
    });
    if (line) { line[0] = Math.min(line[0], r[0]); line[1] = Math.min(line[1], r[1]); line[2] = Math.max(line[2], r[2]); line[3] = Math.max(line[3], r[3]); }
    else lines.push(r);
  }
  return lines.map((r) => r.map((v) => Math.round(v * 1000) / 1000));
}

function charOffset(pv, range) {
  const tl = pv.div.querySelector('.textLayer');
  if (!tl || !tl.contains(range.startContainer)) return 0;
  const walker = document.createTreeWalker(tl, NodeFilter.SHOW_TEXT);
  let n = 0;
  while (walker.nextNode()) {
    if (walker.currentNode === range.startContainer) return n + range.startOffset;
    n += walker.currentNode.length;
  }
  return n;
}
