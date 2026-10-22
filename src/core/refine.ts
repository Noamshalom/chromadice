/**
 * Direct-binary-search style refinement (Analoui & Allebach, 1992) adapted to
 * the coupled multi-view problem: starting from the error-diffusion result,
 * repeatedly replace a cell's (type, orientation) by the candidate that most
 * reduces the sum over views of the low-pass-filtered squared OKLab error.
 * Each trial change is evaluated incrementally in O(kernel size) per view.
 */

import type { Vec3 } from './color';
import { chromaDeficit2, scaleChroma, type Candidate, type DitherResult } from './dither';
import { gaussianKernel, rasterise, viewGrid, type ViewGrid } from './grid';
import type { Lattice } from './lattice';

export interface RefineOptions {
  sigma: number;
  maxSweeps: number;
  weights?: number[];
  /** stop a sweep early when fewer than this fraction of cells changed */
  minChangeFraction: number;
  /** weight of the chroma axes relative to lightness (match the dither option) */
  chromaWeight: number;
  /**
   * Colour-smoothness penalty: cost added per lattice neighbour whose die
   * TYPE differs from this die's, in squared-OKLab units. 0 = off. Encourages
   * coherent colour regions (pips still dither lightness freely).
   */
  typeSmooth: number;
  /** hue-identity term, see DitherOptions.hueWeight (match the dither option) */
  hueWeight: number;
}

export const DEFAULT_REFINE_OPTIONS: RefineOptions = { sigma: 1.0, maxSweeps: 8, minChangeFraction: 0.002, chromaWeight: 1, typeSmooth: 0, hueWeight: 0 };

/** 6 lattice neighbours (corner mode: A2; edge mode: 4-neighbours in (i,j)). */
function latticeNeighbours(lattice: Lattice): Int32Array[] {
  const key = (p: Vec3) => `${p[0]},${p[1]},${p[2]}`;
  const idx = new Map<string, number>();
  for (const c of lattice.cells) idx.set(key(c.pos), c.index);
  const deltas: Vec3[] = lattice.mode === 'corner'
    ? [[1, -1, 0], [-1, 1, 0], [1, 0, -1], [-1, 0, 1], [0, 1, -1], [0, -1, 1]]
    : lattice.mode === 'edge'
      ? [[1, -1, 0], [-1, 1, 0], [0, 0, 1], [0, 0, -1]]
      : [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  return lattice.cells.map((c) => {
    const out: number[] = [];
    for (const d of deltas) { const j = idx.get(key([c.pos[0] + d[0], c.pos[1] + d[1], c.pos[2] + d[2]])); if (j !== undefined) out.push(j); }
    return Int32Array.from(out);
  });
}

interface ViewState {
  grid: ViewGrid;
  /** filtered error image E = blur(S - T), 3 channels */
  E: Float32Array;
  /** per cell: flat list of (pixel index, weight) pairs for the normalised kernel */
  nbr: Int32Array[];
  nbw: Float32Array[];
  S: Vec3[];
}

function buildViewState(lattice: Lattice, v: number, target: Vec3[], shown: Vec3[], sigma: number): ViewState {
  const grid = viewGrid(lattice, v);
  const { r, k } = gaussianKernel(sigma);
  const size = 2 * r + 1;
  const { w, h } = grid;
  // in-mask weight sums
  const Wsum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (grid.cell[y * w + x] < 0) continue;
    let s = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || grid.cell[yy * w + xx] < 0) continue;
      s += k[(dy + r) * size + (dx + r)];
    }
    Wsum[y * w + x] = s;
  }
  const nbr: Int32Array[] = new Array(lattice.cells.length);
  const nbw: Float32Array[] = new Array(lattice.cells.length);
  for (const c of lattice.cells) {
    const x = grid.gx[c.index], y = grid.gy[c.index];
    const idx: number[] = [], wts: number[] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const q = yy * w + xx;
      if (grid.cell[q] < 0) continue;
      // contribution of pixel (x,y) to blurred pixel q: k[-d] / Wsum[q]; kernel symmetric
      idx.push(q); wts.push(k[(dy + r) * size + (dx + r)] / Wsum[q]);
    }
    nbr[c.index] = Int32Array.from(idx); nbw[c.index] = Float32Array.from(wts);
  }
  // E = blur(S - T)
  const S = shown.map((c) => [c[0], c[1], c[2]] as Vec3);
  const D = rasterise(grid, S.map((s, i) => [s[0] - target[i][0], s[1] - target[i][1], s[2] - target[i][2]] as Vec3));
  const E = new Float32Array(w * h * 3);
  for (const c of lattice.cells) {
    const p = grid.gy[c.index] * w + grid.gx[c.index];
    const d0 = D[p * 3], d1 = D[p * 3 + 1], d2 = D[p * 3 + 2];
    const ns = nbr[c.index], ws = nbw[c.index];
    for (let i = 0; i < ns.length; i++) {
      const q = ns[i], g = ws[i];
      E[q * 3] += g * d0; E[q * 3 + 1] += g * d1; E[q * 3 + 2] += g * d2;
    }
  }
  return { grid, E, nbr, nbw, S };
}

export interface RefineStats { sweeps: number; changes: number[]; }

export function refine(lattice: Lattice, targets: Vec3[][], result: DitherResult, options: RefineOptions = DEFAULT_REFINE_OPTIONS): RefineStats {
  const V = lattice.views.length;
  const w = options.weights ?? new Array(V).fill(1);
  const cw = options.chromaWeight;
  const states = lattice.views.map((_, v) => buildViewState(lattice, v, targets[v].map((t) => scaleChroma(t, cw)), result.shown[v].map((s) => scaleChroma(s, cw)), options.sigma));
  const cands: Candidate[] = result.candidates.map((c) => ({ ...c, lab: c.lab.map((l) => scaleChroma(l, cw)) }));
  const { type, orient } = result.assignment;
  // map (type, orient) -> candidate index for the current assignment
  const candIndex = new Map<number, number>();
  cands.forEach((c, i) => candIndex.set(c.type * 32 + c.orient, i));
  const stats: RefineStats = { sweeps: 0, changes: [] };
  const nbrs = options.typeSmooth > 0 ? latticeNeighbours(lattice) : null;
  const lam = options.typeSmooth, hw = options.hueWeight;
  // visit cells in a fixed pseudo-random order so the refinement has no scan direction
  const visit = Int32Array.from(lattice.order);
  let seed = 0x9e3779b9;
  for (let i = visit.length - 1; i > 0; i--) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; const j = seed % (i + 1); const t = visit[i]; visit[i] = visit[j]; visit[j] = t; }

  for (let sweep = 0; sweep < options.maxSweeps; sweep++) {
    let changes = 0;
    for (const ci of visit) {
      const curIdx = candIndex.get(type[ci] * 32 + orient[ci])!;
      let best = curIdx, bestDelta = -1e-9;
      // smoothness: count neighbours of each type once per cell
      let curMismatch = 0;
      const nbTypeCount = nbrs ? new Int16Array(cands.length > 0 ? 64 : 1) : null;
      if (nbrs) { for (const j of nbrs[ci]) { nbTypeCount![type[j]]++; if (type[j] !== type[ci]) curMismatch++; } }
      for (let k = 0; k < cands.length; k++) {
        if (k === curIdx) continue;
        let delta = 0;
        if (nbrs) { const n = nbrs[ci].length; delta += lam * ((n - nbTypeCount![cands[k].type]) - curMismatch); }
        for (let v = 0; v < V; v++) {
          const st = states[v];
          if (hw > 0) delta += w[v] * hw * (chromaDeficit2(targets[v][ci], result.candidates[k].lab[v]) - chromaDeficit2(targets[v][ci], result.candidates[curIdx].lab[v]));
          const cur = st.S[ci], nw = cands[k].lab[v];
          const d0 = nw[0] - cur[0], d1 = nw[1] - cur[1], d2 = nw[2] - cur[2];
          const dd = d0 * d0 + d1 * d1 + d2 * d2;
          if (dd === 0) continue;
          const ns = st.nbr[ci], ws = st.nbw[ci], E = st.E;
          let acc = 0;
          for (let i = 0; i < ns.length; i++) {
            const q = ns[i] * 3, g = ws[i];
            acc += g * (2 * (E[q] * d0 + E[q + 1] * d1 + E[q + 2] * d2) + g * dd);
          }
          delta += w[v] * acc;
        }
        if (delta < bestDelta) { bestDelta = delta; best = k; }
      }
      if (best !== curIdx) {
        changes++;
        const c = cands[best];
        for (let v = 0; v < V; v++) {
          const st = states[v];
          const cur = st.S[ci], nw = c.lab[v];
          const d0 = nw[0] - cur[0], d1 = nw[1] - cur[1], d2 = nw[2] - cur[2];
          const ns = st.nbr[ci], ws = st.nbw[ci], E = st.E;
          for (let i = 0; i < ns.length; i++) {
            const q = ns[i] * 3, g = ws[i];
            E[q] += g * d0; E[q + 1] += g * d1; E[q + 2] += g * d2;
          }
          st.S[ci] = nw;
          result.shown[v][ci] = result.candidates[best].lab[v];
        }
        type[ci] = c.type; orient[ci] = c.orient;
      }
    }
    stats.sweeps++; stats.changes.push(changes);
    if (changes < options.minChangeFraction * lattice.cells.length) break;
  }
  return stats;
}
