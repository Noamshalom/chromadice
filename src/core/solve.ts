/** One call from images + settings to a dice assignment: what the web worker and the gallery script share. */
import { dither, DEFAULT_DITHER_OPTIONS, type DitherResult } from './dither';
import { harmonise, DEFAULT_HARMONISE, type HarmoniseOptions } from './harmonise';
import { imageToViewTargets, type Frame, type LinearImage } from './image';
import { buildCornerRect, buildEdgeRect, buildSingleLattice, type Lattice, type Mode } from './lattice';
import { resolvePalette, type DieType, type ResolvedPalette } from './palette';
import { refine, DEFAULT_REFINE_OPTIONS } from './refine';
import type { Vec3 } from './color';

export interface SolveOptions {
  mode: Mode;
  /** block size in dice: across x up */
  gridW: number;
  gridH: number;
  types: DieType[];
  pipRadius: number;
  frames: Frame[];
  fit: 'stretch' | 'crop' | 'auto';
  maxStretch: number;
  /** colour style: dithered (classic), smooth (colour-coherence penalty), poster (no diffusion) */
  style: 'dithered' | 'smooth' | 'poster';
  smoothWeight: number;
  harmonise: HarmoniseOptions['mode'];
  chromaWeight: number;
  hueWeight: number;
  sweeps: number;
  weights: number[];
  fitLightness: boolean;
  fitChroma: boolean;
  grey: boolean;
  /** tone curve after the lightness fit: > 1 darker midtones */
  gamma: number;
}

export const DEFAULT_SOLVE: Omit<SolveOptions, 'mode' | 'gridW' | 'gridH' | 'types' | 'frames'> = {
  pipRadius: 0.14, fit: 'auto', maxStretch: 1.25, style: 'smooth', smoothWeight: 0.003, harmonise: 'mean',
  chromaWeight: 0.6, hueWeight: 6, sweeps: 3, weights: [1, 1, 1], fitLightness: true, fitChroma: true, grey: false, gamma: 1,
};

export interface Solved {
  lattice: Lattice;
  palette: ResolvedPalette;
  /** per view: targets straight from the picture (what the metrics compare against) */
  raw: Vec3[][];
  /** per view: what the solver aimed at (harmonised across views when in colour) */
  targets: Vec3[][];
  res: DitherResult;
}

export function buildLatticeFor(mode: Mode, w: number, h: number): Lattice {
  return mode === 'single' ? buildSingleLattice(w, h) : mode === 'corner' ? buildCornerRect(w, h) : buildEdgeRect(w, h);
}

export function solve(images: LinearImage[], o: SolveOptions, progress: (stage: string) => void = () => {}): Solved {
  progress('Building lattice');
  const lattice = buildLatticeFor(o.mode, o.gridW, o.gridH);
  const palette = resolvePalette(o.types, { pipRadius: o.pipRadius });
  progress('Mapping images onto views');
  const raw = images.map((img, v) => imageToViewTargets(img, lattice, v, palette, {
    fitLightness: o.fitLightness, fitChroma: o.fitChroma, grey: o.grey, clipPercent: 1, frame: o.frames[v], fit: o.fit, maxStretch: o.maxStretch, gamma: o.gamma,
  }));
  const targets = (images.length > 1 && !o.grey) ? harmonise(lattice, raw, { ...DEFAULT_HARMONISE, mode: o.harmonise }) : raw;
  progress('Dithering');
  const diffusion = o.style === 'poster' ? 'none' : 'fs';
  const res = dither(lattice, palette, targets, { ...DEFAULT_DITHER_OPTIONS, chromaWeight: o.chromaWeight, hueWeight: o.hueWeight, weights: o.weights, diffusion, metric: o.grey ? 'lightness' : 'oklab' });
  if (o.sweeps > 0 && o.style !== 'poster') {
    progress(`Refining (${o.sweeps} sweeps)`);
    refine(lattice, targets, res, { ...DEFAULT_REFINE_OPTIONS, maxSweeps: o.sweeps, chromaWeight: o.chromaWeight, hueWeight: o.hueWeight, weights: o.weights, typeSmooth: o.style === 'smooth' ? o.smoothWeight : 0 });
  }
  return { lattice, palette, raw, targets, res };
}
