/**
 * Die types (body colour + pip colour) and the colour each face value yields.
 *
 * A die type with body colour B and pip colour P exposes, on its face with
 * n pips, the area-weighted mixture (1-a_n) B + a_n P in linear RGB, where
 * a_n = n * pi * r^2 is the pip area fraction (r = pip radius, edge = 1).
 * The six faces of one die type therefore sample a straight segment in
 * linear RGB from B towards P. The palette is the union of K such segments.
 */

import { hexToLinear, linearToOklab, mix, type Vec3 } from './color';
import { pipAreaFraction } from './die';

export interface DieType {
  name: string;
  body: string; // sRGB hex
  pip: string;  // sRGB hex
}

export interface PaletteOptions {
  pipRadius: number;      // in units of die edge; 0.12 => six pips cover ~27 % of the face
}

export const DEFAULT_PALETTE_OPTIONS: PaletteOptions = { pipRadius: 0.12 };

/** A catalogue of commonly manufactured opaque dice. */
export const CATALOG: DieType[] = [
  { name: 'white',  body: '#f4f1ea', pip: '#1a1a1a' },
  { name: 'black',  body: '#17171a', pip: '#f2f2f2' },
  { name: 'red',    body: '#c8201e', pip: '#ffffff' },
  { name: 'blue',   body: '#1e4fb5', pip: '#ffffff' },
  { name: 'green',  body: '#1f8a3b', pip: '#ffffff' },
  { name: 'yellow', body: '#f2c21b', pip: '#1a1a1a' },
  { name: 'orange', body: '#ef7a1a', pip: '#ffffff' },
  { name: 'purple', body: '#5b2a8a', pip: '#ffffff' },
  { name: 'pink',   body: '#e8609a', pip: '#ffffff' },
  { name: 'ivory',  body: '#e9dcb8', pip: '#1a1a1a' },
  { name: 'grey',   body: '#8a8a8a', pip: '#ffffff' },
  { name: 'cyan',   body: '#1fa6c8', pip: '#ffffff' },
];

export const GREY_PALETTE: DieType[] = [CATALOG[0]];
export const SIX_PALETTE: DieType[] = ['white', 'black', 'red', 'blue', 'yellow', 'green'].map((n) => CATALOG.find((c) => c.name === n)!);

export interface ResolvedPalette {
  types: DieType[];
  options: PaletteOptions;
  /** faceLinear[t][n] for n = 1..6 (index 0 unused) */
  faceLinear: Vec3[][];
  /** faceLab[t][n] */
  faceLab: Vec3[][];
}

export function resolvePalette(types: DieType[], options: PaletteOptions = DEFAULT_PALETTE_OPTIONS): ResolvedPalette {
  const faceLinear: Vec3[][] = [];
  const faceLab: Vec3[][] = [];
  for (const t of types) {
    const B = hexToLinear(t.body), P = hexToLinear(t.pip);
    const lin: Vec3[] = [[0, 0, 0]];
    const lab: Vec3[] = [[0, 0, 0]];
    for (let n = 1; n <= 6; n++) {
      const a = pipAreaFraction(n, options.pipRadius);
      const c = mix(B, P, a);
      lin.push(c);
      lab.push(linearToOklab(c));
    }
    faceLinear.push(lin);
    faceLab.push(lab);
  }
  return { types, options, faceLinear, faceLab };
}

/** All 6K face colours of a palette, flattened. */
export function paletteColours(p: ResolvedPalette): Vec3[] {
  const out: Vec3[] = [];
  for (let t = 0; t < p.types.length; t++) for (let n = 1; n <= 6; n++) out.push(p.faceLab[t][n]);
  return out;
}

/** Lightness range achievable by the palette. */
export function paletteLightnessRange(p: ResolvedPalette): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const c of paletteColours(p)) { lo = Math.min(lo, c[0]); hi = Math.max(hi, c[0]); }
  return [lo, hi];
}

/**
 * Greedy forward selection of K die types from a catalogue.
 * Proxy objective: summed nearest-colour error of all target pixels (no
 * dithering), with the special property that one die must serve all views at
 * once ignored here; it is only used to pick a shopping list.
 */
export function selectPalette(
  targetsLab: Vec3[][],   // per view, list of OKLab targets
  catalog: DieType[],
  K: number,
  options: PaletteOptions = DEFAULT_PALETTE_OPTIONS,
  sampleStride = 1,
): DieType[] {
  const all = resolvePalette(catalog, options);
  const samples: Vec3[] = [];
  for (const view of targetsLab) for (let i = 0; i < view.length; i += sampleStride) samples.push(view[i]);
  const chosen: number[] = [];
  const best = new Float64Array(samples.length).fill(Infinity);
  for (let k = 0; k < Math.min(K, catalog.length); k++) {
    let bestT = -1, bestCost = Infinity;
    let bestVec: Float64Array | null = null;
    for (let t = 0; t < catalog.length; t++) {
      if (chosen.includes(t)) continue;
      const nb = new Float64Array(samples.length);
      let cost = 0;
      for (let i = 0; i < samples.length; i++) {
        let d = best[i];
        const s = samples[i];
        for (let n = 1; n <= 6; n++) {
          const c = all.faceLab[t][n];
          const d0 = s[0] - c[0], d1 = s[1] - c[1], d2 = s[2] - c[2];
          const dd = d0 * d0 + d1 * d1 + d2 * d2;
          if (dd < d) d = dd;
        }
        nb[i] = d; cost += d;
      }
      if (cost < bestCost) { bestCost = cost; bestT = t; bestVec = nb; }
    }
    chosen.push(bestT);
    best.set(bestVec!);
  }
  return chosen.map((t) => catalog[t]);
}
