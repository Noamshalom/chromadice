/**
 * Quality metrics per view, evaluated after a Gaussian low-pass that stands
 * in for the viewer's optics at mosaic-viewing distance (as in model-based
 * halftoning). Reported in OKLab units.
 */

import type { Vec3 } from './color';
import { blurMasked, gaussianKernel, rasterise, viewGrid, type ViewGrid } from './grid';
import type { Lattice } from './lattice';

export interface ViewMetrics {
  /** mean OKLab distance after blur (DeltaE_ok) */
  meanDE: number;
  /** PSNR of blurred lightness (dB), lightness in [0,1] */
  psnrL: number;
  /** mean |delta L| after blur */
  meanDL: number;
  /** unblurred mean OKLab distance */
  meanDEraw: number;
  /** Pearson correlation between blurred shown lightness and blurred target lightness (structure, contrast-invariant) */
  corrL: number;
}

export function evaluateView(grid: ViewGrid, target: Vec3[], shown: Vec3[], sigma = 1.0): ViewMetrics {
  const k = gaussianKernel(sigma);
  const T = rasterise(grid, target), S = rasterise(grid, shown);
  const Tb = blurMasked(grid, T, k), Sb = blurMasked(grid, S, k);
  let sumDE = 0, sumDL = 0, sumL2 = 0, sumRaw = 0, n = 0;
  let sT = 0, sS = 0, sTT = 0, sSS = 0, sTS = 0;
  for (let i = 0; i < grid.cell.length; i++) {
    if (grid.cell[i] < 0) continue;
    const lt = Tb[i * 3], ls = Sb[i * 3];
    sT += lt; sS += ls; sTT += lt * lt; sSS += ls * ls; sTS += lt * ls;
    const d0 = Tb[i * 3] - Sb[i * 3], d1 = Tb[i * 3 + 1] - Sb[i * 3 + 1], d2 = Tb[i * 3 + 2] - Sb[i * 3 + 2];
    sumDE += Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2);
    sumDL += Math.abs(d0); sumL2 += d0 * d0;
    const r0 = T[i * 3] - S[i * 3], r1 = T[i * 3 + 1] - S[i * 3 + 1], r2 = T[i * 3 + 2] - S[i * 3 + 2];
    sumRaw += Math.sqrt(r0 * r0 + r1 * r1 + r2 * r2);
    n++;
  }
  return {
    meanDE: sumDE / n,
    psnrL: 10 * Math.log10(1 / (sumL2 / n)),
    meanDL: sumDL / n,
    meanDEraw: sumRaw / n,
    corrL: (n * sTS - sT * sS) / Math.sqrt(Math.max(1e-12, (n * sTT - sT * sT) * (n * sSS - sS * sS))),
  };
}

export function evaluate(lattice: Lattice, targets: Vec3[][], shown: Vec3[][], sigma = 1.0): ViewMetrics[] {
  return lattice.views.map((_, v) => evaluateView(viewGrid(lattice, v), targets[v], shown[v], sigma));
}

/** Per-cell low-pass of a colour field in view v (what a distant viewer perceives). */
export function perceived(lattice: Lattice, v: number, colours: Vec3[], sigma = 1.0): Vec3[] {
  const grid = viewGrid(lattice, v);
  const B = blurMasked(grid, rasterise(grid, colours), gaussianKernel(sigma));
  const out: Vec3[] = new Array(colours.length);
  for (const c of lattice.cells) {
    const p = grid.gy[c.index] * grid.w + grid.gx[c.index];
    out[c.index] = [B[p * 3], B[p * 3 + 1], B[p * 3 + 2]];
  }
  return out;
}
