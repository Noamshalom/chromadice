/**
 * Images (linear RGB float) and the mapping of an input image onto the
 * cells of one view.
 *
 * In corner mode the face grid seen by a viewer is a square lattice rotated
 * by 45 degrees in the viewer's frame (the die edges are at 45 degrees to the
 * horizon when the body diagonal is vertical). We therefore resample the
 * input image at each cell's *screen* position rather than at its pixel-grid
 * position, so the picture is upright for the viewer.
 */

import { linearToOklab, srgbToLinear, type Vec3 } from './color';
import type { Lattice } from './lattice';
import { paletteLightnessRange, type ResolvedPalette } from './palette';

export interface LinearImage {
  width: number;
  height: number;
  /** RGB float triples, row-major, linear light */
  data: Float32Array;
}

/** From 8-bit RGBA (as from a canvas or sharp raw buffer). */
export function imageFromRGBA(width: number, height: number, rgba: Uint8Array | Uint8ClampedArray): LinearImage {
  const data = new Float32Array(width * height * 3);
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = srgbToLinear(i / 255);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    data[i * 3] = lut[rgba[j]];
    data[i * 3 + 1] = lut[rgba[j + 1]];
    data[i * 3 + 2] = lut[rgba[j + 2]];
  }
  return { width, height, data };
}

export function toGrey(img: LinearImage): LinearImage {
  const data = new Float32Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    const y = 0.2126 * img.data[i * 3] + 0.7152 * img.data[i * 3 + 1] + 0.0722 * img.data[i * 3 + 2];
    data[i * 3] = data[i * 3 + 1] = data[i * 3 + 2] = y;
  }
  return { width: img.width, height: img.height, data };
}

/** Area-averaging (box) downscale to exactly w x h. */
export function resampleBox(img: LinearImage, w: number, h: number): LinearImage {
  const out = new Float32Array(w * h * 3);
  const sx = img.width / w, sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const y0 = y * sy, y1 = (y + 1) * sy;
    for (let x = 0; x < w; x++) {
      const x0 = x * sx, x1 = (x + 1) * sx;
      let r = 0, g = 0, b = 0, wsum = 0;
      for (let yy = Math.floor(y0); yy < Math.min(img.height, Math.ceil(y1)); yy++) {
        const wy = Math.min(y1, yy + 1) - Math.max(y0, yy);
        if (wy <= 0) continue;
        for (let xx = Math.floor(x0); xx < Math.min(img.width, Math.ceil(x1)); xx++) {
          const wx = Math.min(x1, xx + 1) - Math.max(x0, xx);
          if (wx <= 0) continue;
          const wgt = wx * wy, k = (yy * img.width + xx) * 3;
          r += img.data[k] * wgt; g += img.data[k + 1] * wgt; b += img.data[k + 2] * wgt; wsum += wgt;
        }
      }
      const o = (y * w + x) * 3;
      out[o] = r / wsum; out[o + 1] = g / wsum; out[o + 2] = b / wsum;
    }
  }
  return { width: w, height: h, data: out };
}

/** Bilinear sample at continuous coordinates (u,v) in [0,1]^2 (v = 0 top). */
export function sampleBilinear(img: LinearImage, u: number, v: number): Vec3 {
  const fx = Math.min(Math.max(u * img.width - 0.5, 0), img.width - 1);
  const fy = Math.min(Math.max(v * img.height - 0.5, 0), img.height - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, img.width - 1), y1 = Math.min(y0 + 1, img.height - 1);
  const tx = fx - x0, ty = fy - y0;
  const out: Vec3 = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = img.data[(y0 * img.width + x0) * 3 + c], b = img.data[(y0 * img.width + x1) * 3 + c];
    const d = img.data[(y1 * img.width + x0) * 3 + c], e = img.data[(y1 * img.width + x1) * 3 + c];
    out[c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
  }
  return out;
}

export interface TargetOptions {
  /** Linearly remap the lightness range of the image into the palette's achievable range. */
  fitLightness: boolean;
  /** Scale chroma so the image's 99th-percentile chroma matches the palette's max chroma (only shrinks). */
  fitChroma: boolean;
  /** Convert to grey (luma) before mapping. */
  grey: boolean;
  /** Percentile clip used when measuring the image lightness range. */
  clipPercent: number;
  /** Which part of the picture to show: crop-window centre (0..1 in image coords) and zoom (>= 1). */
  frame?: Frame;
  /** 'stretch': the whole picture fills the view's bounding box (aspect not preserved, as in the Technion jig). 'crop' (default): keep aspect, use `frame`. */
  fit?: 'stretch' | 'crop' | 'auto';
  /**
   * 'screen' (default): the picture is upright for the viewer and fills what the viewer sees.
   * 'table': the picture is painted onto the table rectangle (axes a, b of the plane) and each
   * viewer sees that painted rectangle from their angle, rotated but undistorted. This is what
   * a physical jig with the picture "on the jig" looks like.
   */
  mapping?: 'screen' | 'table';
  /** For fit 'auto': the largest allowed stretch factor (default 1.3). */
  maxStretch?: number;
  /** Tone curve applied after the lightness fit: > 1 darkens the midtones, < 1 lightens them (default 1). */
  gamma?: number;
}

/**
 * Outline of the dice footprint as viewer v sees it, as a convex polygon in the view's
 * bounding box, normalised to [0,1] x [0,1] with y = 0 at the top. The picture is mapped
 * onto the bounding box, so this is the part of the crop window that actually lands on dice
 * (a rectangle for the single and corner-axis views, a parallelogram for the other two).
 */
export function footprintPolygon(lattice: Lattice, v: number): [number, number][] {
  const view = lattice.views[v];
  const pts: [number, number][] = [];
  for (const c of lattice.cells) for (const dx of [-0.5, 0.5]) for (const dy of [-0.5, 0.5]) pts.push([c.sx[v] + dx, c.sy[v] + dy]);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  const W = view.maxSx - view.minSx + 1, H = view.maxSy - view.minSy + 1;
  return hull.map(([x, y]) => [(x - view.minSx + 0.5) / W, 1 - (y - view.minSy + 0.5) / H]);
}

/** In-plane axes of the corner lattice's table: a across, b up the table. */
export const TABLE_A: Vec3 = [1 / Math.SQRT2, -1 / Math.SQRT2, 0];
export const TABLE_B: Vec3 = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)];

export interface Frame { cx: number; cy: number; zoom: number }
export const DEFAULT_FRAME: Frame = { cx: 0.5, cy: 0.5, zoom: 1 };

/**
 * Crop window (in source pixels) for a view of aspect `aspect` (width / height):
 * the largest window of that aspect that fits in the image, shrunk by `zoom`,
 * centred at (cx, cy) and clamped to stay inside the image.
 */
export function cropWindow(imgW: number, imgH: number, aspect: number, frame: Frame = DEFAULT_FRAME): { x0: number; y0: number; w: number; h: number } {
  let w = Math.min(imgW, imgH * aspect), h = w / aspect;
  const z = Math.max(1, frame.zoom);
  w /= z; h /= z;
  const x0 = Math.min(Math.max(frame.cx * imgW - w / 2, 0), imgW - w);
  const y0 = Math.min(Math.max(frame.cy * imgH - h / 2, 0), imgH - h);
  return { x0, y0, w, h };
}

/** Width / height of view v's picture, in die units. */
export function viewAspect(lattice: Lattice, v: number): number {
  const view = lattice.views[v];
  return (view.maxSx - view.minSx + 1) / (view.maxSy - view.minSy + 1);
}

export const DEFAULT_TARGET_OPTIONS: TargetOptions = { fitLightness: true, fitChroma: true, grey: false, clipPercent: 1 };

/**
 * Map an input image onto the cells of view `v`: returns one OKLab target per
 * cell (indexed by cell index). The image is fitted to the view's screen
 * bounding box with "cover" semantics (centre crop, aspect preserved).
 */
export function imageToViewTargets(
  img: LinearImage, lattice: Lattice, v: number, palette: ResolvedPalette,
  options: TargetOptions = DEFAULT_TARGET_OPTIONS,
): Vec3[] {
  const view = lattice.views[v];
  if (options.mapping === 'table' && lattice.mode === 'corner') {
    // picture painted on the table: for each viewer the table's own axes are rotated in-plane by
    // 0, ±120°, so rotate the picture's axes with them. The b axis is foreshortened by the view
    // angle for every viewer equally, which the per-view square grid already absorbs.
    const dot = (x: Vec3, y: Vec3) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
    // in-plane rotation that takes the viewer's own "across" to the table's a axis:
    const ar = dot(TABLE_A, view.right), au = dot(TABLE_A, view.up);
    const ang = Math.atan2(au, ar);
    const c = Math.cos(ang), sn = Math.sin(ang);
    const right: Vec3 = [view.right[0] * c + view.up[0] * sn, view.right[1] * c + view.up[1] * sn, view.right[2] * c + view.up[2] * sn];
    const upv: Vec3 = [-view.right[0] * sn + view.up[0] * c, -view.right[1] * sn + view.up[1] * c, -view.right[2] * sn + view.up[2] * c];
    return imageToBasisTargets(img, lattice, right, upv, palette, options);
  }
  return imageToBasisTargets(img, lattice, view.right, view.up, palette, options);
}

/** Screen basis of the top-down view (looking along -up). */
export function topBasis(lattice: Lattice): { right: Vec3; up: Vec3 } {
  const u = lattice.up;
  const ref: Vec3 = lattice.mode === 'corner' ? [1, -1, 0] : lattice.mode === 'edge' ? [0, 0, 1] : [0, 1, 0];
  const l = Math.hypot(ref[0], ref[1], ref[2]);
  const right: Vec3 = [ref[0] / l, ref[1] / l, ref[2] / l];
  // up_screen = u x right  (right-handed with forward = -u)
  const up: Vec3 = [u[1] * right[2] - u[2] * right[1], u[2] * right[0] - u[0] * right[2], u[0] * right[1] - u[1] * right[0]];
  return { right, up };
}

/** Map an image onto the cells using an arbitrary screen basis (right, up) in world coordinates. */
export function imageToBasisTargets(
  img: LinearImage, lattice: Lattice, right: Vec3, up: Vec3, palette: ResolvedPalette,
  options: TargetOptions = DEFAULT_TARGET_OPTIONS,
): Vec3[] {
  const src = options.grey ? toGrey(img) : img;
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sxs = lattice.cells.map((c) => dot(c.pos, right)), sys = lattice.cells.map((c) => dot(c.pos, up));
  const view = { minSx: Math.min(...sxs), maxSx: Math.max(...sxs), minSy: Math.min(...sys), maxSy: Math.max(...sys) };
  const W = view.maxSx - view.minSx + 1, H = view.maxSy - view.minSy + 1; // in die units
  // crop window of the view's aspect, positioned by the frame, then scaled onto W x H dice;
  // or stretch: the whole picture onto W x H
  // 'auto': stretch at most 1.3x, crop the rest (keeps faces recognisable on very wide views)
  const srcA = src.width / src.height, viewA = W / H, maxStretch = options.maxStretch ?? 1.3;
  const autoA = Math.min(Math.max(viewA, srcA / maxStretch), srcA * maxStretch);
  const winA = options.fit === 'stretch' ? srcA : options.fit === 'auto' ? autoA : viewA;
  const win = cropWindow(src.width, src.height, winA, options.frame ?? DEFAULT_FRAME);
  const cw = win.w, ch = win.h, cx0 = win.x0, cy0 = win.y0;
  const scale = Math.min(W / cw, H / ch);
  // pre-filter to ~2 samples per die for anti-aliasing
  const k = 2 * scale;
  const pre = (k < 1)
    ? resampleBox(src, Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)))
    : src;

  const targets: Vec3[] = new Array(lattice.cells.length);
  for (const cell of lattice.cells) {
    const u = (sxs[cell.index] - view.minSx + 0.5) / W; // 0..1 left->right
    const t = 1 - (sys[cell.index] - view.minSy + 0.5) / H; // 0..1 top->bottom
    const srcX = (cx0 + u * cw) / src.width;  // normalised, identical for `pre`
    const srcY = (cy0 + t * ch) / src.height;
    targets[cell.index] = linearToOklab(sampleBilinear(pre, srcX, srcY));
  }
  return fitTargets(targets, palette, options);
}

/** Percentile of a numeric array (0..100). */
function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))));
  return s[i];
}

export function fitTargets(targets: Vec3[], palette: ResolvedPalette, options: TargetOptions): Vec3[] {
  let out = targets.map((c) => [c[0], c[1], c[2]] as Vec3);
  if (options.fitLightness) {
    const [plo, phi] = paletteLightnessRange(palette);
    const Ls = out.map((c) => c[0]);
    const ilo = percentile(Ls, options.clipPercent), ihi = percentile(Ls, 100 - options.clipPercent);
    const span = Math.max(1e-6, ihi - ilo);
    const g = options.gamma ?? 1;
    out = out.map((c) => [plo + Math.pow((Math.min(Math.max(c[0], ilo), ihi) - ilo) / span, g) * (phi - plo), c[1], c[2]]);
  }
  if (options.fitChroma) {
    let pmax = 0;
    for (let t = 0; t < palette.types.length; t++) for (let n = 1; n <= 6; n++) {
      const c = palette.faceLab[t][n]; pmax = Math.max(pmax, Math.hypot(c[1], c[2]));
    }
    const chromas = out.map((c) => Math.hypot(c[1], c[2]));
    const imax = percentile(chromas, 99);
    if (imax > pmax && imax > 0) {
      const k = pmax / imax;
      out = out.map((c) => [c[0], c[1] * k, c[2] * k]);
    }
  }
  return out;
}
