import { CATALOG, linearToHex, oklabToLinear, buildEdgeRect, buildCornerRect, buildSingleLattice, cropWindow, viewAspect, footprintPolygon, type Frame, resolvePalette, assemblyPlan, billOfMaterials, renderViewSVG, renderTopSVG, type DieType, type Lattice, type Mode } from '../core';
import { DiceViewer } from './viewer';
import { drawDiceView, drawFlat, stretchLightness } from './canvas2d';
import type { JobRequest, JobResult } from './worker';
import { PRESETS, type Preset } from './presets';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const fmt = (n: number) => n.toLocaleString('en-US');

// ---------- state
let mode: Mode = 'single';
const slotImages: (ImageData | null)[] = [null, null, null];
const slotNames: string[] = ['', '', ''];
const slotFrames: Frame[] = [0, 1, 2].map(() => ({ cx: 0.5, cy: 0.5, zoom: 1 }));
const slotURLs: string[] = ['', '', ''];
let selected = new Set(['black']);
let lastLattice: Lattice | null = null;
let lastResult: JobResult | null = null;
let lastTypes: DieType[] = [];
let lastPip = 0.14;
let jobId = 0;

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const viewer = new DiceViewer($('#viewer'));

// ---------- placeholders (procedural, so the page works before any upload)
function placeholder(kind: number, size = 256): ImageData {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!;
  if (kind === 0) {
    const grd = g.createLinearGradient(0, 0, size, size); grd.addColorStop(0, '#f6e27a'); grd.addColorStop(1, '#c8201e');
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
    g.fillStyle = '#1a1a1a'; g.beginPath(); g.arc(size * 0.5, size * 0.5, size * 0.3, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f4f1ea'; g.beginPath(); g.arc(size * 0.5, size * 0.5, size * 0.16, 0, Math.PI * 2); g.fill();
  } else if (kind === 1) {
    g.fillStyle = '#1e4fb5'; g.fillRect(0, 0, size, size);
    g.fillStyle = '#f4f1ea';
    for (let i = 0; i < 5; i++) g.fillRect(size * (0.1 + i * 0.18), size * 0.15, size * 0.08, size * 0.7);
    g.fillStyle = '#f2c21b'; g.beginPath(); g.moveTo(size * 0.2, size * 0.85); g.lineTo(size * 0.8, size * 0.85); g.lineTo(size * 0.5, size * 0.25); g.closePath(); g.fill();
  } else {
    const grd = g.createRadialGradient(size * 0.4, size * 0.4, 10, size * 0.5, size * 0.5, size * 0.7);
    grd.addColorStop(0, '#f4f1ea'); grd.addColorStop(0.6, '#1f8a3b'); grd.addColorStop(1, '#17171a');
    g.fillStyle = grd; g.fillRect(0, 0, size, size);
    g.strokeStyle = '#c8201e'; g.lineWidth = size * 0.05; g.strokeRect(size * 0.2, size * 0.2, size * 0.6, size * 0.6);
  }
  return g.getImageData(0, 0, size, size);
}

// ---------- slots
const slotsEl = $('#slots');
function img0IsPortrait(c: HTMLCanvasElement) { return c.height > c.width * 1.15; }
function nViews() { return mode === 'corner' ? 3 : mode === 'edge' ? 2 : 1; }
function gridDims(): [number, number] { return [Number(gwEl.value), Number(ghEl.value)]; }
type Stretch = 'crop' | 'auto' | 'stretch';
let stretch: Stretch = 'auto';
const MAX_STRETCH = 1.25;
/** Aspect (w/h) of the crop window for slot i given the view's aspect: the view's own, or the picture's own, or in between. */
function windowAspect(i: number, viewA: number): number {
  const img = slotImages[i];
  if (!img || mode === 'single' || stretch === 'crop') return viewA;
  const srcA = img.width / img.height;
  if (stretch === 'stretch') return srcA;
  return Math.min(Math.max(viewA, srcA / MAX_STRETCH), srcA * MAX_STRETCH);
}
function currentLattice(): Lattice {
  const [w, h] = gridDims();
  return mode === 'single' ? buildSingleLattice(w, h) : mode === 'corner' ? buildCornerRect(w, h) : buildEdgeRect(w, h);
}
/** Aspect (width / height) of each view's picture for the current mode and size. */
function currentAspects(): number[] {
  const L = currentLattice();
  return L.views.map((_, v) => windowAspect(v, viewAspect(L, v)));
}
function currentPolygons(): [number, number][][] {
  const L = currentLattice();
  return L.views.map((_, v) => footprintPolygon(L, v));
}
function renderSlots() {
  const n = nViews();
  const aspects = currentAspects(), polys = currentPolygons();
  slotsEl.innerHTML = '';
  slotsEl.className = `slots n${n}`;
  for (let i = 0; i < n; i++) {
    const d = document.createElement('div');
    d.className = 'slot';
    const img = slotImages[i];
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    inp.addEventListener('change', () => inp.files?.[0] && loadFile(i, inp.files[0]));
    d.appendChild(inp);
    if (img) {
      const stage = document.createElement('div'); stage.className = 'stage-img';
      const im = document.createElement('img'); im.src = slotURLs[i]; im.alt = `Picture ${i + 1}`; im.draggable = false;
      const shade = document.createElement('div'); shade.className = 'shade';
      const fr = document.createElement('div'); fr.className = 'frame';
      fr.style.setProperty('--img', `url(${slotURLs[i]})`);
      const poly = polys[i];
      const pct = poly.map(([x, y]) => [(x * 100).toFixed(2), (y * 100).toFixed(2)]);
      fr.style.clipPath = `polygon(${pct.map(([x, y]) => `${x}% ${y}%`).join(', ')})`;
      const outline = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      outline.setAttribute('class', 'outline'); outline.setAttribute('viewBox', '0 0 100 100'); outline.setAttribute('preserveAspectRatio', 'none');
      const pg = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      pg.setAttribute('points', pct.map(([x, y]) => `${x},${y}`).join(' ')); pg.setAttribute('vector-effect', 'non-scaling-stroke');
      outline.appendChild(pg);
      const used = document.createElement('span'); used.className = 'used'; used.textContent = 'Used';
      stage.append(im, shade, fr, outline, used);
      d.appendChild(stage);
      const place = () => {
        // image is drawn with object-fit: contain inside the slot
        const W = stage.clientWidth, H = stage.clientHeight;
        const k = Math.min(W / img.width, H / img.height), ox = (W - img.width * k) / 2, oy = (H - img.height * k) / 2;
        const win = cropWindow(img.width, img.height, aspects[i] ?? 1, slotFrames[i]);
        const L = ox + win.x0 * k, T = oy + win.y0 * k, FW = win.w * k, FH = win.h * k;
        Object.assign(fr.style, { left: `${L}px`, top: `${T}px`, width: `${FW}px`, height: `${FH}px` });
        Object.assign(outline.style, { left: `${L}px`, top: `${T}px`, width: `${FW}px`, height: `${FH}px` });
        Object.assign(used.style, { left: `${L + FW / 2}px`, top: `${T + FH}px` });
        // the frame shows the picture un-shaded: paint the same image inside it, aligned to the stage
        fr.style.setProperty('--bgsize', `${img.width * k}px ${img.height * k}px`);
        fr.style.setProperty('--bgpos', `${ox - L}px ${oy - T}px`);
        return k;
      };
      requestAnimationFrame(place);
      let drag: { x: number; y: number; cx: number; cy: number } | null = null;
      stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: slotFrames[i].cx, cy: slotFrames[i].cy }; stage.setPointerCapture(e.pointerId); });
      stage.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const k = place();
        slotFrames[i].cx = Math.min(1, Math.max(0, drag.cx + (e.clientX - drag.x) / (k * img.width)));
        slotFrames[i].cy = Math.min(1, Math.max(0, drag.cy + (e.clientY - drag.y) / (k * img.height)));
        place();
      });
      const end = () => { if (drag) { drag = null; scheduleBuild(); } };
      stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
      stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        slotFrames[i].zoom = Math.min(4, Math.max(1, slotFrames[i].zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
        zoom.value = String(slotFrames[i].zoom); place(); scheduleBuild();
      }, { passive: false });
      stage.addEventListener('dblclick', () => { slotFrames[i] = { cx: 0.5, cy: 0.5, zoom: 1 }; zoom.value = '1'; place(); scheduleBuild(); });
      const num = document.createElement('span'); num.className = 'num'; num.textContent = String(i + 1); d.appendChild(num);
      const ch = document.createElement('button'); ch.className = 'change'; ch.type = 'button'; ch.textContent = 'Replace';
      ch.addEventListener('click', () => inp.click());
      d.appendChild(ch);
      const zw = document.createElement('div'); zw.className = 'zoom';
      const zoom = document.createElement('input'); zoom.type = 'range'; zoom.min = '1'; zoom.max = '4'; zoom.step = '0.02'; zoom.value = String(slotFrames[i].zoom); zoom.setAttribute('aria-label', 'zoom');
      zoom.addEventListener('input', () => { slotFrames[i].zoom = Number(zoom.value); place(); });
      zoom.addEventListener('change', scheduleBuild);
      zw.appendChild(zoom); d.appendChild(zw);
    } else {
      d.classList.add('empty'); d.textContent = n === 1 ? 'Add a picture' : `Add picture ${i + 1}`; d.appendChild(inp);
      d.addEventListener('click', () => inp.click());
    }
    d.addEventListener('dragover', (e) => { e.preventDefault(); d.classList.add('over'); });
    d.addEventListener('dragleave', () => d.classList.remove('over'));
    d.addEventListener('drop', (e) => { e.preventDefault(); d.classList.remove('over'); const f = e.dataTransfer?.files?.[0]; if (f) loadFile(i, f); });
    slotsEl.appendChild(d);
  }
}
let buildTimer = 0;
function scheduleBuild() { clearTimeout(buildTimer); buildTimer = window.setTimeout(build, 350); }
async function loadSample(i: number, name: string, frame?: Frame) {
  if (frame) slotFrames[i] = frame;
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}samples/${name}.jpg`);
    if (!r.ok) return;
    const f = new File([await r.blob()], `${name}.jpg`, { type: 'image/jpeg' });
    await loadFile(i, f, !!frame);
  } catch { /* samples are optional */ }
}
async function loadFile(i: number, file: File, keepFrame = false) {
  const bmp = await createImageBitmap(file);
  const max = 512, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d')!; g.drawImage(bmp, 0, 0, c.width, c.height);
  slotImages[i] = g.getImageData(0, 0, c.width, c.height);
  slotNames[i] = file.name.replace(/\.[^.]+$/, '');
  slotURLs[i] = c.toDataURL('image/jpeg', 0.85);
  if (!keepFrame) slotFrames[i] = { cx: 0.5, cy: img0IsPortrait(c) ? 0.42 : 0.5, zoom: 1 };
  renderSlots(); updateCount();
}

// ---------- swatches
const swEl = $('#swatches');
function multiColourAllowed() { return mode === 'single'; }
function renderSwatches() {
  swEl.innerHTML = '';
  if (!multiColourAllowed() && selected.size > 1) selected = new Set([[...selected][0]]);
  swEl.classList.toggle('locked', !multiColourAllowed());
  $('#dice-hint').textContent = multiColourAllowed() ? 'Pick one or more colours.' : 'One die colour. Several viewers share it, so colour can only tint.';
  ($('#colour-block') as HTMLElement).hidden = !(multiColourAllowed() && selected.size > 1);
  for (const t of CATALOG) {
    const b = document.createElement('button');
    b.className = 'swatch' + (selected.has(t.name) ? ' on' : '');
    b.style.background = t.body; b.style.setProperty('--sw-pip', t.pip);
    b.title = t.name; b.setAttribute('aria-pressed', String(selected.has(t.name))); b.setAttribute('aria-label', `${t.name} dice`);
    b.addEventListener('click', () => {
      if (multiColourAllowed()) { if (selected.has(t.name)) { if (selected.size > 1) selected.delete(t.name); } else selected.add(t.name); }
      else selected = new Set([t.name]);
      renderSwatches();
    });
    swEl.appendChild(b);
  }
}

// ---------- controls
const gwEl = $<HTMLInputElement>('#grid-w'), ghEl = $<HTMLInputElement>('#grid-h');
function updateCount() {
  const [w, h] = gridDims();
  const L = currentLattice();
  $('#dice-count').textContent = `${w} × ${h} = ${fmt(L.cells.length)} dice`;
  ($('#shape-row') as HTMLElement).hidden = mode === 'single';
  $('#shape-hint').textContent = stretch === 'crop' ? 'Exact shapes, wide crop' : stretch === 'auto' ? `Up to ${Math.round((MAX_STRETCH - 1) * 100)}% wider` : 'Whole picture, as in the paper';
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-stretch]')) b.addEventListener('click', () => {
  stretch = b.dataset.stretch as Stretch;
  document.querySelectorAll('[data-stretch]').forEach((x) => x.classList.toggle('active', x === b));
  updateCount(); renderSlots(); scheduleBuild();
});
for (const el of [gwEl, ghEl]) el.addEventListener('change', () => { updateCount(); renderSlots(); });
function setMode(m: Mode) {
  mode = m;
  document.querySelectorAll<HTMLButtonElement>('.mode').forEach((x) => x.classList.toggle('active', x.dataset.mode === m));
  $('#pic-hint').textContent = mode === 'single' ? 'Drag the frame to choose the part that is used.' : 'One per viewer. The bright shape is what lands on the dice: drag it, scroll to zoom.';
  updateCount(); renderSlots(); renderSwatches();
  ($('[data-snap=view3]') as HTMLElement).hidden = mode !== 'corner';
  ($('[data-snap=view2]') as HTMLElement).hidden = mode === 'single';
  ($('[data-snap=top]') as HTMLElement).hidden = mode === 'single';
}
for (const b of document.querySelectorAll<HTMLButtonElement>('.mode')) b.addEventListener('click', () => setMode(b.dataset.mode as Mode));

// ---------- gallery
const galleryEl = $('#gallery');
function renderGallery(activeId?: string) {
  galleryEl.innerHTML = '';
  for (const p of PRESETS) {
    const card = document.createElement('button'); card.className = 'gcard' + (p.id === activeId ? ' active' : ''); card.type = 'button';
    const im = document.createElement('img'); im.src = `${import.meta.env.BASE_URL}gallery/${p.id}.png`; im.alt = p.title; im.loading = 'lazy';
    const t = document.createElement('span'); t.className = 'gt'; t.textContent = p.title;
    const m = document.createElement('span'); m.className = 'gm';
    for (const name of p.colours) { const c = CATALOG.find((x) => x.name === name); if (!c) continue; const d = document.createElement('i'); d.className = 'dot'; d.style.background = c.body; m.appendChild(d); }
    const n = document.createElement('span'); n.textContent = `${p.pictures.length > 1 ? `${p.pictures.length} pictures · ` : ''}${p.w} × ${p.h}`; m.appendChild(n);
    card.append(im, t, m);
    card.addEventListener('click', () => applyPreset(p));
    galleryEl.appendChild(card);
  }
}
async function applyPreset(p: Preset) {
  renderGallery(p.id);
  gwEl.value = String(p.w); ghEl.value = String(p.h);
  selected = new Set(p.colours);
  $<HTMLSelectElement>('#style').value = p.style ?? 'smooth';
  const hue = $<HTMLInputElement>('#hue'); hue.value = String(p.hue ?? 6); hue.dispatchEvent(new Event('input'));
  const gamma = $<HTMLInputElement>('#gamma'); gamma.value = String(p.gamma ?? 1); gamma.dispatchEvent(new Event('input'));
  ($('#smooth-row') as HTMLElement).hidden = (p.style ?? 'smooth') !== 'smooth';
  setMode(p.mode);
  await Promise.all(p.pictures.map((pic, i) => loadSample(i, pic.sample, pic.frame ?? { cx: 0.5, cy: 0.5, zoom: 1 })));
  renderSlots(); updateCount(); build();
}
const bind = (id: string, out: string, f = (v: string) => v) => { const el = $<HTMLInputElement>(id); const o = $(out); const up = () => (o.textContent = f(el.value)); el.addEventListener('input', up); up(); };
bind('#smooth', '#smooth-out', (v) => Number(v).toFixed(3));
$<HTMLSelectElement>('#style').addEventListener('change', () => { ($('#smooth-row') as HTMLElement).hidden = $<HTMLSelectElement>('#style').value !== 'smooth'; });
bind('#chroma', '#chroma-out', (v) => Number(v).toFixed(2));
bind('#hue', '#hue-out');
bind('#gamma', '#gamma-out', (v) => Number(v).toFixed(2));
bind('#sweeps', '#sweeps-out');

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-snap]')) b.addEventListener('click', () => {
  viewer.snapTo(b.dataset.snap as 'view1');
  document.querySelectorAll('[data-snap]').forEach((x) => x.classList.toggle('active', x === b));
});

// ---------- build
function toLinearPayload(img: ImageData) {
  // keep sRGB bytes -> linear conversion in the worker-side core (imageFromRGBA) cheap: do it here
  const n = img.width * img.height, data = new Float32Array(n * 3);
  const lut = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  for (let i = 0; i < n; i++) { data[i * 3] = lut[img.data[i * 4]]; data[i * 3 + 1] = lut[img.data[i * 4 + 1]]; data[i * 3 + 2] = lut[img.data[i * 4 + 2]]; }
  return { width: img.width, height: img.height, data };
}

const status = $('#status'), buildBtn = $<HTMLButtonElement>('#build');
function build() {
  const n = nViews();
  const [gw, gh] = gridDims();
  const types = CATALOG.filter((t) => selected.has(t.name));
  const images = Array.from({ length: n }, (_, i) => toLinearPayload(slotImages[i] ?? placeholder(i)));
  const frames = Array.from({ length: n }, (_, i) => ({ ...slotFrames[i] }));
  const req: JobRequest = {
    id: ++jobId, mode, images, frames, types, gridW: gw, gridH: gh, fit: mode === 'single' ? 'crop' : stretch, maxStretch: MAX_STRETCH,
    pipRadius: Number($<HTMLInputElement>('#pip').value), chromaWeight: Number($<HTMLInputElement>('#chroma').value), hueWeight: Number($<HTMLInputElement>('#hue').value), gamma: Number($<HTMLInputElement>('#gamma').value),
    sweeps: Number($<HTMLInputElement>('#sweeps').value),
    style: $<HTMLSelectElement>('#style').value as 'smooth', smoothWeight: Number($<HTMLInputElement>('#smooth').value),
    harmonise: $<HTMLSelectElement>('#harm').value as 'mean',
    weights: new Array(n).fill(1), fitLightness: $<HTMLInputElement>('#fitL').checked, fitChroma: $<HTMLInputElement>('#fitC').checked, grey: $<HTMLInputElement>('#grey').checked,
  };
  lastTypes = types; lastPip = req.pipRadius;
  buildBtn.disabled = true; status.textContent = 'Starting…';
  worker.postMessage(req, images.map((im) => im.data.buffer));
}
buildBtn.addEventListener('click', build);

worker.onmessage = (ev: MessageEvent<JobResult & { progress?: string; error?: string }>) => {
  const msg = ev.data;
  if (msg.id !== jobId) return;
  if (msg.progress) { status.textContent = msg.progress + '…'; return; }
  if (msg.error) { status.textContent = 'Could not build: ' + msg.error; buildBtn.disabled = false; return; }
  lastResult = msg;
  lastLattice = currentLattice();
  showResult(lastLattice, msg);
  status.textContent = `Built ${fmt(lastLattice.cells.length)} dice in ${(msg.timings.total / 1000).toFixed(1)} s.`;
  buildBtn.disabled = false;
};

let showLevels = false;
function levelColourFn(): (t: number, n: number) => string {
  const pal = resolvePalette(lastTypes, { pipRadius: lastPip });
  let mn = Infinity, mx = -Infinity;
  for (const f of pal.faceLab) for (let n = 1; n <= 6; n++) { mn = Math.min(mn, f[n][0]); mx = Math.max(mx, f[n][0]); }
  return (t, n) => { const c = pal.faceLab[t][n]; const u = (c[0] - mn) / Math.max(1e-6, mx - mn); return linearToHex(oklabToLinear([0.06 + 0.9 * Math.pow(u, 1.15), c[1] * 1.4, c[2] * 1.4])); };
}
function applyAppearance(keepCamera: boolean) {
  if (!lastLattice || !lastResult) return;
  viewer.setMosaic(lastLattice, lastTypes, lastResult.type, lastResult.orient, lastPip, showLevels ? levelColourFn() : undefined, keepCamera);
}
$('#levels-toggle').addEventListener('click', () => {
  showLevels = !showLevels;
  $('#levels-toggle').classList.toggle('active', showLevels);
  $('#levels-toggle').textContent = showLevels ? 'Grey levels' : 'Pips';
  applyAppearance(true);
});
function showResult(lattice: Lattice, r: JobResult) {
  viewer.setMosaic(lattice, lastTypes, r.type, r.orient, lastPip, showLevels ? levelColourFn() : undefined);
  document.querySelectorAll('[data-snap]').forEach((x) => x.classList.toggle('active', (x as HTMLElement).dataset.snap === 'free'));
  // panels
  const panels = $('#panels'); panels.innerHTML = '';
  lattice.views.forEach((_, v) => {
    const p = document.createElement('div'); p.className = 'panel';
    const m = r.metrics[v];
    p.innerHTML = `<h3>Picture ${v + 1} <small>${slotNames[v] || 'placeholder'}</small></h3><div class="trio"></div><div class="cap"><span>Picture</span><span>Dice</span><span>Grey levels</span><span>From a distance</span></div><div class="metrics">Colour error ΔE ${m.meanDE.toFixed(3)} · lightness match ${(m.corrL * 100).toFixed(0)} % · PSNR ${m.psnrL.toFixed(1)} dB</div>`;
    const trio = p.querySelector('.trio')!;
    const mk = () => { const c = document.createElement('canvas'); c.width = c.height = 480; trio.appendChild(c); return c; };
    drawFlat(mk(), lattice, v, stretchLightness(r.targets[v]));
    drawDiceView(mk(), lattice, lastTypes, r.type, r.orient, v, lastPip);
    drawFlat(mk(), lattice, v, stretchLightness(r.shown[v]));
    drawFlat(mk(), lattice, v, stretchLightness(r.perceived[v]));
    panels.appendChild(p);
  });
  // bom
  const bom = $('#bom'); bom.innerHTML = '';
  for (const row of r.bom) {
    const t = lastTypes.find((x) => x.name === row.name)!;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><span class="dot" style="background:${t.body}"></span>${row.name}</td><td>${fmt(row.count)}</td>`;
    bom.appendChild(tr);
  }
  const tr = document.createElement('tr'); tr.innerHTML = `<td>Total</td><td>${fmt(lattice.cells.length)}</td>`; bom.appendChild(tr);
  $('#results').hidden = false;
}

// ---------- exports
function download(name: string, content: string, type = 'text/plain') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-export]')) b.addEventListener('click', () => {
  if (!lastLattice || !lastResult) return;
  const pal = resolvePalette(lastTypes, { pipRadius: lastPip });
  const asg = { type: lastResult.type, orient: lastResult.orient };
  switch (b.dataset.export) {
    case 'plan': download('chromadice-assembly-plan.csv', assemblyPlan(lastLattice, pal, asg), 'text/csv'); break;
    case 'bom': download('chromadice-shopping-list.csv', 'dice,count\n' + billOfMaterials(pal, asg).map((r) => `${r.name},${r.count}`).join('\n'), 'text/csv'); break;
    case 'json': download('chromadice-result.json', JSON.stringify({ mode, grid: gridDims(), pipRadius: lastPip, types: lastTypes, type: Array.from(lastResult.type), orient: Array.from(lastResult.orient), metrics: lastResult.metrics }), 'application/json'); break;
    case 'svg': {
      lastLattice.views.forEach((_, v) => download(`chromadice-view${v + 1}.svg`, renderViewSVG(lastLattice!, pal, asg, v, { scale: 10, pipRadius: lastPip }), 'image/svg+xml'));
      download('chromadice-top.svg', renderTopSVG(lastLattice, pal, asg, { scale: 10, pipRadius: lastPip }), 'image/svg+xml');
      break;
    }
  }
});

// ---------- go
renderSlots(); renderSwatches(); updateCount();
applyPreset(PRESETS[0]);
