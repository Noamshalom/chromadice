/**
 * Coupled multi-view colour error diffusion on the dice lattice.
 *
 * For every cell we choose one (die type, orientation) pair from the K*24
 * candidates. The pair fixes the colour seen in *every* view at once: the
 * body colour is shared by all faces, only the pip count differs per view.
 * The quantisation error of each view is then diffused, in that view's own
 * pixel grid, to not-yet-processed cells (Floyd-Steinberg weights). Because
 * the scan order is causal for all views simultaneously (see lattice.ts),
 * every unit of error lands on a cell that can still absorb it.
 */

import { type Vec3 } from './color';
import { ORIENTATIONS } from './die';
import { FS_STENCIL, pixelKey, type Lattice } from './lattice';
import type { ResolvedPalette } from './palette';

export interface Assignment {
  /** per cell: die type index */
  type: Int16Array;
  /** per cell: orientation id 0..23 */
  orient: Int8Array;
}

export interface DitherOptions {
  /** per-view weights (default all 1) */
  weights?: number[];
  /** 'fs' = Floyd-Steinberg error diffusion, 'none' = nearest candidate (no diffusion) */
  diffusion: 'fs' | 'none';
  /** distance: full OKLab or lightness only (grey-scale baseline) */
  metric: 'oklab' | 'lightness';
  /** clamp the accumulated error so limited gamuts don't blow up (OKLab units) */
  errorClamp: number;
  /** only allow these orientation ids (default: all 24) */
  orientationIds?: number[];
  /** weight of the chroma axes (a,b) relative to lightness in the cost (1 = plain OKLab) */
  chromaWeight: number;
  /**
   * Hue-identity term: penalty (times the squared "chroma deficit") for showing a coloured
   * spot with a die that has less chroma along the spot's hue than the spot itself, e.g. a
   * white die on a light-blue scarf. Plain OKLab distance alone prefers the white die there
   * because the lightness error is smaller than the chroma error, but to a viewer the scarf
   * has simply lost its colour. 0 = off. Measured on the picture's own colour, not the
   * error-corrected one, so diffusion can't talk a die out of its hue.
   */
  hueWeight: number;
}

export const DEFAULT_DITHER_OPTIONS: DitherOptions = { diffusion: 'fs', metric: 'oklab', errorClamp: 0.35, chromaWeight: 1, hueWeight: 0 };

export function scaleChroma(c: Vec3, w: number): Vec3 { return [c[0], c[1] * w, c[2] * w]; }

/** Squared chroma deficit of candidate colour `c` relative to target `t` (both unscaled OKLab). */
export function chromaDeficit2(t: Vec3, c: Vec3): number {
  const ct = Math.hypot(t[1], t[2]);
  // near-neutral targets (dark hair, a grey wall with a cast) carry no hue identity: ramp in from 0.025 to 0.06
  const wgt = Math.min(1, Math.max(0, (ct - 0.025) / 0.035));
  if (wgt === 0) return 0;
  const proj = (c[1] * t[1] + c[2] * t[2]) / ct;
  const d = ct - proj;
  return d > 0 ? wgt * d * d : 0;
}

export interface Candidate {
  type: number;
  orient: number;
  /** colour in each view (OKLab) */
  lab: Vec3[];
}

/** Enumerate all (type, orientation) candidates with their per-view colours. */
export function buildCandidates(lattice: Lattice, palette: ResolvedPalette, orientationIds?: number[]): Candidate[] {
  const out: Candidate[] = [];
  const ids = orientationIds ?? ORIENTATIONS.map((o) => o.id);
  for (let t = 0; t < palette.types.length; t++) {
    for (const id of ids) {
      const o = ORIENTATIONS[id];
      const lab = lattice.views.map((view) => palette.faceLab[t][o.faces[view.axisIdx]]);
      out.push({ type: t, orient: id, lab });
    }
  }
  return out;
}

export interface DitherResult {
  assignment: Assignment;
  /** per view, per cell: the OKLab colour actually shown */
  shown: Vec3[][];
  candidates: Candidate[];
}

/**
 * @param targets per view, per cell OKLab targets (index = cell index)
 */
export function dither(lattice: Lattice, palette: ResolvedPalette, targets: Vec3[][], options: DitherOptions = DEFAULT_DITHER_OPTIONS): DitherResult {
  const V = lattice.views.length;
  const N = lattice.cells.length;
  const w = options.weights ?? new Array(V).fill(1);
  const cands = buildCandidates(lattice, palette, options.orientationIds);
  const type = new Int16Array(N), orient = new Int8Array(N);
  const shown: Vec3[][] = lattice.views.map(() => new Array(N));
  // accumulated error per view per cell (3 channels)
  const err = lattice.views.map(() => new Float32Array(N * 3));
  const clamp = options.errorClamp;
  const lightnessOnly = options.metric === 'lightness';
  const cw = options.chromaWeight;
  const candScaled = cands.map((c) => c.lab.map((l) => scaleChroma(l, cw)));
  const targetsScaled = targets.map((tv) => tv.map((t) => scaleChroma(t, cw)));
  const cur: Vec3[] = lattice.views.map(() => [0, 0, 0]);
  const hw = lightnessOnly ? 0 : options.hueWeight;

  for (const ci of lattice.order) {
    const cell = lattice.cells[ci];
    for (let v = 0; v < V; v++) {
      const t = targetsScaled[v][ci], e = err[v];
      let e0 = e[ci * 3], e1 = e[ci * 3 + 1], e2 = e[ci * 3 + 2];
      const mag = Math.hypot(e0, e1, e2);
      if (mag > clamp) { const s = clamp / mag; e0 *= s; e1 *= s; e2 *= s; }
      cur[v][0] = t[0] + e0; cur[v][1] = t[1] + e1; cur[v][2] = t[2] + e2;
    }
    let best = -1, bestCost = Infinity;
    for (let k = 0; k < cands.length; k++) {
      const c = cands[k];
      let cost = 0;
      for (let v = 0; v < V; v++) {
        const a = candScaled[k][v], b = cur[v];
        const d0 = a[0] - b[0];
        cost += lightnessOnly ? w[v] * d0 * d0 : w[v] * (d0 * d0 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
        if (hw > 0) cost += w[v] * hw * chromaDeficit2(targets[v][ci], c.lab[v]);
      }
      if (cost < bestCost) { bestCost = cost; best = k; }
    }
    const c = cands[best];
    type[ci] = c.type; orient[ci] = c.orient;
    for (let v = 0; v < V; v++) {
      shown[v][ci] = c.lab[v];
      if (options.diffusion === 'none') continue;
      const cs = candScaled[best][v];
      const r0 = cur[v][0] - cs[0], r1 = cur[v][1] - cs[1], r2 = cur[v][2] - cs[2];
      const view = lattice.views[v], e = err[v];
      for (const [dx, dy, wt] of FS_STENCIL) {
        const j = view.lookup.get(pixelKey(cell.px[v] + dx, cell.py[v] + dy));
        if (j === undefined) continue;
        e[j * 3] += r0 * wt; e[j * 3 + 1] += r1 * wt; e[j * 3 + 2] += r2 * wt;
      }
    }
  }
  return { assignment: { type, orient }, shown, candidates: cands };
}
