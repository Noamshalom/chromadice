/**
 * The dice lattice and its orthographic views.
 *
 * Corner mode (3 views): dice sit on a corner, body diagonal (1,1,1) up.
 *   Centres are the integer points of the plane x+y+z = 0 (the A2 root
 *   lattice, i.e. the (111) slice of Z^3). Unit cubes centred there tile the
 *   plane with regular hexagons when projected along (1,1,1), and each of the
 *   three axis views (+x, +y, +z) sees exactly one face per die, on a perfect
 *   square grid, with no occlusion.
 *
 * Edge mode (2 views): dice sit on an edge, (1,1,0) up. Centres are the
 *   integer points of the plane x+y = 0. Views +x and +y each see one face
 *   per die on a square grid.
 *
 * Every view has a pixel grid (px,py) chosen so that there is a single
 * total order on the cells (ascending `scanKey`) under which the
 * Floyd-Steinberg stencil (+1,0),(-1,+1),(0,+1),(+1,+1) is strictly causal
 * in all views simultaneously. See `scanKey` and the test suite.
 */

import type { Vec3 } from './color';

export type Mode = 'corner' | 'edge' | 'single';

export interface Cell {
  index: number;
  /** integer centre in Z^3 */
  pos: Vec3;
  /** per view: pixel coordinates in that view's grid */
  px: number[];
  py: number[];
  /** per view: screen coordinates (right, up) of the centre as seen by that viewer */
  sx: number[];
  sy: number[];
}

export interface View {
  /** index into AXES of the exposed face: 0 (+x), 2 (+y), 4 (+z) */
  axisIdx: number;
  /** viewer's screen basis in world coordinates */
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  /** pixel-grid bounds */
  minPx: number; maxPx: number; minPy: number; maxPy: number;
  /** screen bounds of all cell centres */
  minSx: number; maxSx: number; minSy: number; maxSy: number;
  /** lookup: key(px,py) -> cell index */
  lookup: Map<number, number>;
}

export interface Lattice {
  mode: Mode;
  radius: number;
  cells: Cell[];
  views: View[];
  up: Vec3;
  /** scan order: cell indices sorted by scanKey */
  order: number[];
}

export function pixelKey(px: number, py: number): number {
  return (px + 32768) * 65536 + (py + 32768);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a: Vec3): Vec3 { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; }

/** Scan key: cells are processed in ascending key (ties arbitrary). */
export function scanKey(mode: Mode, p: Vec3): number {
  // corner: f = y - 2z   (strictly increasing along every FS target in every view)
  // edge / single: f = i + 2j = x + 2z
  if (mode === 'corner') return p[1] - 2 * p[2];
  if (mode === 'edge') return p[2] * 65536 + p[0]; // row-major in the shared (x,z) grid
  // single: ordinary row-major raster, rows = -z (top to bottom), then y; FS stencil is causal by construction
  return -p[2] * 65536 + p[1];
}

/** Pixel coordinates of a lattice point in view v (signs chosen for causality). */
export function pixelCoords(mode: Mode, v: number, p: Vec3): [number, number] {
  const [x, y, z] = p;
  if (mode === 'corner') {
    if (v === 0) return [y, -z];     // +x view
    if (v === 1) return [-x, -z];    // +y view
    return [x, y];                   // +z view
  }
  if (mode === 'edge') return [x, z];
  return [y, -z]; // single: +x view; p = y runs right, q = -z runs down (image rows)
}

/**
 * Rectangular corner-mode lattice, as in the Technion build: a W x H block of
 * dice on the table (the plane x+y+z=0), measured along the plane's own axes
 * (a = (1,-1,0)/√2 across, b = (1,1,-2)/√6 up the table). Each viewer sees
 * the block foreshortened and skewed, and the pictures are stretched to fit,
 * exactly as the paper does ("the dithered image will be scaled to fit the jig").
 */
export function buildCornerRect(w: number, h: number): Lattice {
  const up: Vec3 = norm([1, 1, 1]);
  const a: Vec3 = [1 / Math.SQRT2, -1 / Math.SQRT2, 0];
  const b: Vec3 = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)];
  // in-plane extents in world units: neighbours are √2 apart along a; rows are √6/2 apart along b
  const halfW = (w * Math.SQRT2) / 2, halfH = (h * Math.sqrt(6) / 2) / 2;
  const m = Math.ceil(Math.max(w, h) * 1.2);
  const positions: Vec3[] = [];
  for (let x = -m; x <= m; x++)
    for (let y = -m; y <= m; y++) {
      const z = -x - y;
      const pa = x * a[0] + y * a[1] + z * a[2], pb = x * b[0] + y * b[1] + z * b[2];
      if (pa > -halfW - 1e-6 && pa <= halfW + 1e-6 && pb > -halfH - 1e-6 && pb <= halfH + 1e-6) positions.push([x, y, z]);
    }
  return fromPositions('corner', Math.max(w, h), positions, up, [0, 2, 4]);
}

/**
 * Rectangular edge-mode lattice: w columns along the edge direction (z) by h rows
 * across it. Both viewers see exactly a w x h grid of faces, upright, no skew.
 */
export function buildEdgeRect(w: number, h: number): Lattice {
  const positions: Vec3[] = [];
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
    const r = i - Math.floor(h / 2), c = j - Math.floor(w / 2);
    positions.push([r, -r, c]);
  }
  return fromPositions('edge', Math.max(w, h), positions, norm([1, 1, 0]), [0, 2]);
}

export function buildLattice(mode: Mode, radius: number): Lattice {
  const m = radius;
  const up: Vec3 = mode === 'corner' ? norm([1, 1, 1]) : mode === 'edge' ? norm([1, 1, 0]) : [0, 0, 1];
  const viewAxes = mode === 'corner' ? [0, 2, 4] : mode === 'edge' ? [0, 2] : [0];
  const positions: Vec3[] = [];
  if (mode === 'corner') {
    for (let x = -m; x <= m; x++)
      for (let y = -m; y <= m; y++) {
        const z = -x - y;
        if (Math.abs(z) <= m) positions.push([x, y, z]);
      }
  } else if (mode === 'edge') {
    for (let i = -m; i <= m; i++)
      for (let j = -m; j <= m; j++) positions.push([i, -i, j]);
  } else {
    // single: flat mosaic lying in the plane x = 0, viewer along +x, dice flat (ordinary dice art)
    for (let i = -m; i <= m; i++)
      for (let j = -m; j <= m; j++) positions.push([0, i, j]);
  }

  return fromPositions(mode, radius, positions, up, viewAxes);
}

function fromPositions(mode: Mode, radius: number, positions: Vec3[], up: Vec3, viewAxes: number[]): Lattice {
  const views: View[] = viewAxes.map((axisIdx) => {
    const n: Vec3 = [0, 0, 0];
    n[axisIdx / 2] = 1;
    const forward: Vec3 = [-n[0], -n[1], -n[2]];
    const right = norm(cross(forward, up));
    const upS = norm(cross(right, forward));
    return {
      axisIdx, forward, right, up: upS,
      minPx: Infinity, maxPx: -Infinity, minPy: Infinity, maxPy: -Infinity,
      minSx: Infinity, maxSx: -Infinity, minSy: Infinity, maxSy: -Infinity,
      lookup: new Map(),
    };
  });

  const cells: Cell[] = positions.map((pos, index) => {
    const px: number[] = [], py: number[] = [], sx: number[] = [], sy: number[] = [];
    views.forEach((view, v) => {
      const [a, b] = pixelCoords(mode, v, pos);
      px.push(a); py.push(b);
      const s0 = dot(pos, view.right), s1 = dot(pos, view.up);
      sx.push(s0); sy.push(s1);
      view.minPx = Math.min(view.minPx, a); view.maxPx = Math.max(view.maxPx, a);
      view.minPy = Math.min(view.minPy, b); view.maxPy = Math.max(view.maxPy, b);
      view.minSx = Math.min(view.minSx, s0); view.maxSx = Math.max(view.maxSx, s0);
      view.minSy = Math.min(view.minSy, s1); view.maxSy = Math.max(view.maxSy, s1);
      view.lookup.set(pixelKey(a, b), index);
    });
    return { index, pos, px, py, sx, sy };
  });

  const order = cells.map((c) => c.index).sort((a, b) => scanKey(mode, cells[a].pos) - scanKey(mode, cells[b].pos));
  return { mode, radius, cells, views, up, order };
}

/** Floyd-Steinberg stencil in pixel coordinates with weights (out of 16). */
export const FS_STENCIL: [number, number, number][] = [
  [1, 0, 7 / 16],
  [-1, 1, 3 / 16],
  [0, 1, 5 / 16],
  [1, 1, 1 / 16],
];

export function numDice(mode: Mode, radius: number): number {
  return mode === 'corner' ? 3 * radius * radius + 3 * radius + 1 : (2 * radius + 1) ** 2;
}

/** Non-square single-view lattice: w x h dice in the plane x = 0. */
export function buildSingleLattice(w: number, h: number): Lattice {
  const L = buildLattice('single', 0);
  const positions: Vec3[] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) positions.push([0, i - Math.floor(w / 2), j - Math.floor(h / 2)]);
  return fromPositions('single', Math.max(w, h), positions, L.up, [0]);
}
