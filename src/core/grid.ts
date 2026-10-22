/** Dense per-view pixel grids (with a mask for cells outside the region). */

import type { Vec3 } from './color';
import type { Lattice } from './lattice';

export interface ViewGrid {
  w: number; h: number;
  /** cell index at each grid position, or -1 */
  cell: Int32Array;
  /** per cell: grid x/y */
  gx: Int32Array; gy: Int32Array;
}

export function viewGrid(lattice: Lattice, v: number): ViewGrid {
  const view = lattice.views[v];
  const w = view.maxPx - view.minPx + 1, h = view.maxPy - view.minPy + 1;
  const cell = new Int32Array(w * h).fill(-1);
  const gx = new Int32Array(lattice.cells.length), gy = new Int32Array(lattice.cells.length);
  for (const c of lattice.cells) {
    const x = c.px[v] - view.minPx, y = c.py[v] - view.minPy;
    cell[y * w + x] = c.index; gx[c.index] = x; gy[c.index] = y;
  }
  return { w, h, cell, gx, gy };
}

/** Normalised Gaussian kernel of radius r (size (2r+1)^2). */
export function gaussianKernel(sigma: number, r = Math.ceil(2.5 * sigma)): { r: number; k: Float32Array } {
  const size = 2 * r + 1;
  const k = new Float32Array(size * size);
  let sum = 0;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    const g = Math.exp(-(x * x + y * y) / (2 * sigma * sigma));
    k[(y + r) * size + (x + r)] = g; sum += g;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return { r, k };
}

/** Rasterise per-cell colours into a dense w*h*3 image (masked pixels = 0). */
export function rasterise(grid: ViewGrid, perCell: Vec3[]): Float32Array {
  const out = new Float32Array(grid.w * grid.h * 3);
  for (let i = 0; i < grid.cell.length; i++) {
    const c = grid.cell[i];
    if (c < 0) continue;
    const col = perCell[c];
    out[i * 3] = col[0]; out[i * 3 + 1] = col[1]; out[i * 3 + 2] = col[2];
  }
  return out;
}

/**
 * Blur a masked image with a kernel; masked-out pixels neither contribute
 * nor receive (normalised by the in-mask weight): "normalised convolution".
 */
export function blurMasked(grid: ViewGrid, img: Float32Array, kernel: { r: number; k: Float32Array }): Float32Array {
  const { w, h } = grid; const { r, k } = kernel; const size = 2 * r + 1;
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (grid.cell[y * w + x] < 0) continue;
    let s0 = 0, s1 = 0, s2 = 0, ws = 0;
    for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx; if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx; if (grid.cell[j] < 0) continue;
        const wt = k[(dy + r) * size + (dx + r)];
        s0 += img[j * 3] * wt; s1 += img[j * 3 + 1] * wt; s2 += img[j * 3 + 2] * wt; ws += wt;
      }
    }
    const o = (y * w + x) * 3;
    out[o] = s0 / ws; out[o + 1] = s1 / ws; out[o + 2] = s2 / ws;
  }
  return out;
}
