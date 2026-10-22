/**
 * Colour harmonisation across views.
 *
 * Since die colour is shared by all viewers (see consensus.ts), the views
 * can only show *one* chroma field. Rather than letting the solver average
 * conflicting hues per die (which looks like coloured noise), harmonise the
 * targets up front: build one smooth shared chroma field and give every view
 * its own lightness on top of it. All functions take and return OKLab
 * per-cell targets indexed by cell.
 */

import type { Vec3 } from './color';
import { blurMasked, gaussianKernel, rasterise, viewGrid } from './grid';
import type { Lattice } from './lattice';

export type HarmoniseMode = 'none' | 'mean' | 'brightest' | 'duotone';

export interface HarmoniseOptions {
  mode: HarmoniseMode;
  /** blur radius (in dice) of the shared chroma field; 0 = none */
  sigma: number;
  /** chroma gain applied to the shared field (compensates for averaging) */
  gain: number;
  /** duotone end colours in OKLab (a,b) for dark and light */
  duoDark: [number, number];
  duoLight: [number, number];
}

export const DEFAULT_HARMONISE: HarmoniseOptions = { mode: 'mean', sigma: 2, gain: 1.3, duoDark: [-0.03, -0.12], duoLight: [0.08, 0.12] };

/** Blur a per-cell (a,b) field in view 0's grid (all views share cells, so any grid works for smoothing). */
function smoothChroma(lattice: Lattice, ab: Vec3[], sigma: number): Vec3[] {
  if (sigma <= 0) return ab;
  const grid = viewGrid(lattice, 0);
  const B = blurMasked(grid, rasterise(grid, ab), gaussianKernel(sigma));
  const out: Vec3[] = new Array(ab.length);
  for (const c of lattice.cells) {
    const p = grid.gy[c.index] * grid.w + grid.gx[c.index];
    out[c.index] = [0, B[p * 3 + 1], B[p * 3 + 2]];
  }
  return out;
}

export function harmonise(lattice: Lattice, targets: Vec3[][], opt: HarmoniseOptions = DEFAULT_HARMONISE): Vec3[][] {
  const V = targets.length, N = targets[0].length;
  if (opt.mode === 'none') return targets;
  let shared: Vec3[] = new Array(N);
  if (opt.mode === 'duotone') {
    return targets.map((tv) => tv.map((c) => {
      const t = Math.min(1, Math.max(0, c[0]));
      return [c[0], opt.duoDark[0] + (opt.duoLight[0] - opt.duoDark[0]) * t, opt.duoDark[1] + (opt.duoLight[1] - opt.duoDark[1]) * t] as Vec3;
    }));
  }
  for (let i = 0; i < N; i++) {
    let a = 0, b = 0, w = 0;
    for (let v = 0; v < V; v++) {
      const c = targets[v][i];
      // 'brightest': weight each view by its lightness^2 (colour is seen where it is light)
      const wv = opt.mode === 'brightest' ? Math.max(1e-3, c[0]) ** 2 : 1;
      a += wv * c[1]; b += wv * c[2]; w += wv;
    }
    shared[i] = [0, (a / w) * opt.gain, (b / w) * opt.gain];
  }
  shared = smoothChroma(lattice, shared, opt.sigma);
  return targets.map((tv) => tv.map((c, i) => [c[0], shared[i][1], shared[i][2]] as Vec3));
}
