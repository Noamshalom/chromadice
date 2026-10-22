/**
 * 2D renderers (SVG) and exports (BOM, assembly plan).
 *
 * The SVG renderers project the actual 3D geometry: every die is placed at
 * its lattice centre with its chosen rotation, and the exposed face polygon
 * and pip circles are projected onto the viewer's screen basis. This is the
 * same picture a Three.js orthographic camera would show, computed exactly.
 */

import { linearToHex, oklabToLinear, type Vec3 } from './color';
import { AXES, faceCorners3D, mulMatVec, ORIENTATIONS, pipCentres3D, transpose } from './die';
import type { Assignment } from './dither';
import type { Lattice } from './lattice';
import type { ResolvedPalette } from './palette';

function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function add(a: Vec3, b: Vec3): Vec3 { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

export interface RenderOptions {
  /** pixels per die edge */
  scale: number;
  /** pip radius in die units (should match the palette option) */
  pipRadius: number;
  background: string;
  /** draw the hidden faces too (top-down view) */
  margin: number;
}

export const DEFAULT_RENDER: RenderOptions = { scale: 12, pipRadius: 0.12, background: '#777777', margin: 1 };

/**
 * Render what the viewer of view `v` sees. Only the face whose world normal is
 * the view axis is drawn (the other faces are edge-on in that view).
 */
export function renderViewSVG(lattice: Lattice, palette: ResolvedPalette, asg: Assignment, v: number, opt: Partial<RenderOptions> = {}): string {
  const o = { ...DEFAULT_RENDER, ...opt };
  const view = lattice.views[v];
  return renderProjectionSVG(lattice, palette, asg, view.right, view.up, [view.axisIdx], o);
}

/** Render the top-down (along the lattice's up vector) view: all three visible faces. */
export function renderTopSVG(lattice: Lattice, palette: ResolvedPalette, asg: Assignment, opt: Partial<RenderOptions> = {}): string {
  const o = { ...DEFAULT_RENDER, ...opt };
  const up = lattice.up;
  // screen basis: right = up x (some axis)
  const forward: Vec3 = [-up[0], -up[1], -up[2]];
  const ref: Vec3 = lattice.mode === 'corner' ? [1, -1, 0] : lattice.mode === 'edge' ? [0, 0, 1] : [0, 1, 0];
  const r = norm(ref);
  const u = norm(cross(r, forward));
  const faces = lattice.views.map((vw) => vw.axisIdx);
  return renderProjectionSVG(lattice, palette, asg, r, u, faces, o);
}

function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a: Vec3): Vec3 { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; }

function renderProjectionSVG(lattice: Lattice, palette: ResolvedPalette, asg: Assignment, right: Vec3, up: Vec3, worldFaceAxes: number[], o: RenderOptions): string {
  const pts: string[] = [];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const proj = (p: Vec3): [number, number] => [dot(p, right), -dot(p, up)];
  const forward = cross(up, right); // towards the viewer? we only use it for the cosine of pip ellipses
  for (const cell of lattice.cells) {
    const orient = ORIENTATIONS[asg.orient[cell.index]];
    const t = asg.type[cell.index];
    const Rt = transpose(orient.R);
    for (const axisIdx of worldFaceAxes) {
      const localN = mulMatVec(Rt, AXES[axisIdx]);
      let localIdx = -1;
      for (let i = 0; i < 6; i++) { const a = AXES[i]; if (a[0] === localN[0] && a[1] === localN[1] && a[2] === localN[2]) localIdx = i; }
      const faceValue = orient.faces[axisIdx];
      const corners = faceCorners3D(localIdx).map((c) => proj(add(mulMatVec(orient.R, c), cell.pos)));
      const body = palette.types[t].body, pip = palette.types[t].pip;
      for (const [x, y] of corners) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      pts.push(`<polygon points="${corners.map(([x, y]) => `${x.toFixed(3)},${y.toFixed(3)}`).join(' ')}" fill="${body}"/>`);
      const cosv = Math.abs(dot(AXES[axisIdx], forward));
      const pipsLocal = pipCentres3D(localIdx, 0.3);
      // the drawn pip radius: a circle on the face projects to an ellipse; approximate with a circle scaled by sqrt(cos)
      const rr = o.pipRadius * Math.sqrt(Math.max(cosv, 0.05));
      for (const pc of pipsLocal) {
        const [x, y] = proj(add(mulMatVec(orient.R, pc), cell.pos));
        pts.push(`<circle cx="${x.toFixed(3)}" cy="${y.toFixed(3)}" r="${rr.toFixed(3)}" fill="${pip}"/>`);
      }
      void faceValue;
    }
  }
  const m = o.margin;
  const w = (maxX - minX + 2 * m) * o.scale, h = (maxY - minY + 2 * m) * o.scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${h.toFixed(0)}" viewBox="${(minX - m).toFixed(3)} ${(minY - m).toFixed(3)} ${(maxX - minX + 2 * m).toFixed(3)} ${(maxY - minY + 2 * m).toFixed(3)}">` +
    `<rect x="${(minX - m).toFixed(3)}" y="${(minY - m).toFixed(3)}" width="${(maxX - minX + 2 * m).toFixed(3)}" height="${(maxY - minY + 2 * m).toFixed(3)}" fill="${o.background}"/>` +
    pts.join('') + '</svg>';
}

/** Render a per-cell colour field (e.g. the targets) as flat squares in view v's screen frame. */
export function renderFlatSVG(lattice: Lattice, v: number, colours: Vec3[], opt: Partial<RenderOptions> = {}, labInput = true): string {
  const o = { ...DEFAULT_RENDER, ...opt };
  const view = lattice.views[v];
  const rot = lattice.mode === 'corner' ? 45 : 0;
  const parts: string[] = [];
  for (const cell of lattice.cells) {
    const c = colours[cell.index];
    const hex = linearToHex(labInput ? oklabToLinear(c) : c);
    const x = cell.sx[v], y = -cell.sy[v];
    parts.push(`<rect x="-0.5" y="-0.5" width="1.02" height="1.02" fill="${hex}" transform="translate(${x.toFixed(3)} ${y.toFixed(3)}) rotate(${rot})"/>`);
  }
  const m = o.margin;
  const minX = view.minSx - 0.75 - m, maxX = view.maxSx + 0.75 + m, minY = -view.maxSy - 0.75 - m, maxY = -view.minSy + 0.75 + m;
  const w = (maxX - minX) * o.scale, h = (maxY - minY) * o.scale;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${h.toFixed(0)}" viewBox="${minX.toFixed(3)} ${minY.toFixed(3)} ${(maxX - minX).toFixed(3)} ${(maxY - minY).toFixed(3)}">` +
    `<rect x="${minX}" y="${minY}" width="${maxX - minX}" height="${maxY - minY}" fill="${o.background}"/>` + parts.join('') + '</svg>';
}

/** Bill of materials: dice per type. */
export function billOfMaterials(palette: ResolvedPalette, asg: Assignment): { name: string; count: number }[] {
  const counts = new Array(palette.types.length).fill(0);
  for (let i = 0; i < asg.type.length; i++) counts[asg.type[i]]++;
  return palette.types.map((t, i) => ({ name: t.name, count: counts[i] }));
}

/** Assembly plan rows: one per die, with lattice position, type and the face value exposed in each view. */
export function assemblyPlan(lattice: Lattice, palette: ResolvedPalette, asg: Assignment): string {
  const header = ['index', 'x', 'y', 'z', 'type', ...lattice.views.map((_, v) => `face_view${v + 1}`), 'orientation'];
  const rows = [header.join(',')];
  for (const c of lattice.cells) {
    const o = ORIENTATIONS[asg.orient[c.index]];
    rows.push([c.index, c.pos[0], c.pos[1], c.pos[2], palette.types[asg.type[c.index]].name, ...lattice.views.map((vw) => o.faces[vw.axisIdx]), o.id].join(','));
  }
  return rows.join('\n');
}
