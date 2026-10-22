/**
 * Die geometry: the 24 proper rotations of the cube, the face values they
 * expose along each world axis, and the pip layout of each face.
 *
 * Canonical (unrotated) die, right-handed: +x = 1, +y = 2, +z = 3 and
 * opposite faces sum to 7 (so -x = 6, -y = 5, -z = 4). Seen from the
 * (+,+,+) corner the faces 1, 2, 3 run counter-clockwise, as on a standard
 * western die.
 */

import type { Vec3 } from './color';

export type Mat3 = [number, number, number, number, number, number, number, number, number]; // row-major

export const AXES: Vec3[] = [
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
];

/** Face value exposed on each canonical local axis: index = axis index into AXES. */
export const CANON_FACE: number[] = [1, 6, 2, 5, 3, 4];

export function axisIndex(v: Vec3): number {
  for (let i = 0; i < 6; i++) {
    const a = AXES[i];
    if (a[0] === v[0] && a[1] === v[1] && a[2] === v[2]) return i;
  }
  throw new Error('not an axis vector: ' + v);
}

function det3(m: Mat3): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

export function mulMatVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function transpose(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

export interface Orientation {
  /** Index 0..23 */
  id: number;
  /** Rotation applied to the canonical die (world = R * local). */
  R: Mat3;
  /** Face value visible along each world axis, indexed like AXES (+x,-x,+y,-y,+z,-z). */
  faces: number[];
}

/** Enumerate the 24 signed permutation matrices with determinant +1. */
function buildOrientations(): Orientation[] {
  const out: Orientation[] = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) {
    for (let s = 0; s < 8; s++) {
      const signs = [s & 1 ? -1 : 1, s & 2 ? -1 : 1, s & 4 ? -1 : 1];
      const R: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let row = 0; row < 3; row++) R[row * 3 + p[row]] = signs[row];
      if (det3(R) !== 1) continue;
      // world axis e_k corresponds to local axis R^T e_k = row k of R
      const Rt = transpose(R);
      const faces: number[] = [];
      for (const a of AXES) {
        const local = mulMatVec(Rt, a);
        faces.push(CANON_FACE[axisIndex(local)]);
      }
      out.push({ id: out.length, R, faces });
    }
  }
  if (out.length !== 24) throw new Error('expected 24 orientations, got ' + out.length);
  return out;
}

export const ORIENTATIONS: Orientation[] = buildOrientations();

/** Pip centres of face n on the unit square [-0.5,0.5]^2 (face-local 2D coords). */
export function pipLayout2D(n: number, off = 0.3): [number, number][] {
  const c: [number, number] = [0, 0];
  const tl: [number, number] = [-off, off], tr: [number, number] = [off, off];
  const bl: [number, number] = [-off, -off], br: [number, number] = [off, -off];
  const ml: [number, number] = [-off, 0], mr: [number, number] = [off, 0];
  switch (n) {
    case 1: return [c];
    case 2: return [tl, br];
    case 3: return [tl, c, br];
    case 4: return [tl, tr, bl, br];
    case 5: return [tl, tr, c, bl, br];
    case 6: return [tl, tr, ml, mr, bl, br];
    default: throw new Error('bad face ' + n);
  }
}

/**
 * In-plane basis (u, v) of the face with local normal `normal`, such that
 * (u, v, normal) is right-handed. Used to place pips in 3D on the canonical die.
 */
export function faceBasis(normal: Vec3): { u: Vec3; v: Vec3 } {
  // pick a fixed convention per axis
  const [x, y, z] = normal;
  if (x !== 0) return { u: [0, x, 0], v: [0, 0, 1] };        // ±x: u = ±y, v = z
  if (y !== 0) return { u: [0, 0, y], v: [1, 0, 0] };        // ±y: u = ±z, v = x
  return { u: [z, 0, 0], v: [0, 1, 0] };                      // ±z: u = ±x, v = y
}

/** 3D pip centres (local die coords) of the canonical face sitting on local axis `axisIdx`. */
export function pipCentres3D(axisIdx: number, pipOffset = 0.3): Vec3[] {
  const n = AXES[axisIdx];
  const { u, v } = faceBasis(n);
  const value = CANON_FACE[axisIdx];
  return pipLayout2D(value, pipOffset).map(([a, b]) => [
    0.5 * n[0] + a * u[0] + b * v[0],
    0.5 * n[1] + a * u[1] + b * v[1],
    0.5 * n[2] + a * u[2] + b * v[2],
  ]);
}

/** 3D corners (local die coords) of the canonical face on local axis `axisIdx`, counter-clockwise. */
export function faceCorners3D(axisIdx: number): Vec3[] {
  const n = AXES[axisIdx];
  const { u, v } = faceBasis(n);
  const sq: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  return sq.map(([a, b]) => [
    0.5 * n[0] + a * u[0] + b * v[0],
    0.5 * n[1] + a * u[1] + b * v[1],
    0.5 * n[2] + a * u[2] + b * v[2],
  ]);
}

/** Fraction of a face covered by pips for a face value n and pip radius r (edge = 1). */
export function pipAreaFraction(n: number, pipRadius: number): number {
  return n * Math.PI * pipRadius * pipRadius;
}
