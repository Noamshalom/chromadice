/** Canvas renderers for the per-view panels (same projection maths as core/render.ts). */
import { AXES, ORIENTATIONS, faceCorners3D, linearToHex, mulMatVec, oklabToLinear, pipCentres3D, transpose, type DieType, type Lattice, type Vec3 } from '../core';

function dot(a: Vec3, b: Vec3): number { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

function fitTransform(lattice: Lattice, v: number, canvas: HTMLCanvasElement, margin = 1.2) {
  const view = lattice.views[v];
  const W = view.maxSx - view.minSx + 2 * margin, H = view.maxSy - view.minSy + 2 * margin;
  const s = Math.min(canvas.width / W, canvas.height / H);
  const ox = (canvas.width - W * s) / 2 - (view.minSx - margin) * s;
  const oy = (canvas.height - H * s) / 2 + (view.maxSy + margin) * s;
  return { s, ox, oy };
}

export function drawDiceView(canvas: HTMLCanvasElement, lattice: Lattice, types: DieType[], typeOf: Int16Array, orientOf: Int8Array, v: number, pipRadius: number) {
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#f5f5f7'; g.fillRect(0, 0, canvas.width, canvas.height);
  const view = lattice.views[v];
  const { s, ox, oy } = fitTransform(lattice, v, canvas);
  const proj = (p: Vec3): [number, number] => [ox + dot(p, view.right) * s, oy - dot(p, view.up) * s];
  const axis = AXES[view.axisIdx];
  for (const cell of lattice.cells) {
    const o = ORIENTATIONS[orientOf[cell.index]];
    const localN = mulMatVec(transpose(o.R), axis);
    let li = 0; for (let i = 0; i < 6; i++) { const a = AXES[i]; if (a[0] === localN[0] && a[1] === localN[1] && a[2] === localN[2]) li = i; }
    const t = types[typeOf[cell.index]];
    g.fillStyle = t.body;
    g.beginPath();
    faceCorners3D(li).forEach((c, i) => {
      const w = mulMatVec(o.R, c);
      const [x, y] = proj([w[0] + cell.pos[0], w[1] + cell.pos[1], w[2] + cell.pos[2]]);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    });
    g.closePath(); g.fill();
    g.fillStyle = t.pip;
    for (const p of pipCentres3D(li, 0.3)) {
      const w = mulMatVec(o.R, p);
      const [x, y] = proj([w[0] + cell.pos[0], w[1] + cell.pos[1], w[2] + cell.pos[2]]);
      g.beginPath(); g.arc(x, y, pipRadius * s, 0, Math.PI * 2); g.fill();
    }
  }
}

export function drawFlat(canvas: HTMLCanvasElement, lattice: Lattice, v: number, lab: Float32Array) {
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#f5f5f7'; g.fillRect(0, 0, canvas.width, canvas.height);
  const { s, ox, oy } = fitTransform(lattice, v, canvas);
  const rot = lattice.mode === 'corner' ? Math.PI / 4 : 0;
  const half = s * 0.5 * 1.03;
  for (const cell of lattice.cells) {
    const i = cell.index * 3;
    g.fillStyle = linearToHex(oklabToLinear([lab[i], lab[i + 1], lab[i + 2]]));
    const x = ox + cell.sx[v] * s, y = oy - cell.sy[v] * s;
    g.save(); g.translate(x, y); g.rotate(rot); g.fillRect(-half, -half, 2 * half, 2 * half); g.restore();
  }
}

/**
 * Stretch lightness to the full display range (chroma scaled with it).
 * The eye adapts to the range an object actually spans; dice faces span a narrow
 * lightness band (white dice: about L 0.86-0.94), so the literal area average looks
 * washed out while the mosaic in the room does not. The paper's figures use the same
 * normalisation (face 1 = white ... face 6 = black).
 */
export function stretchLightness(lab: Float32Array, lo = 0.06, hi = 0.96, clip = 0.01, gamma = 1.15): Float32Array {
  const n = lab.length / 3;
  const Ls = new Float32Array(n);
  for (let i = 0; i < n; i++) Ls[i] = lab[i * 3];
  const sorted = Float32Array.from(Ls).sort();
  const mn = sorted[Math.floor(clip * (n - 1))], mx = sorted[Math.ceil((1 - clip) * (n - 1))];
  const span = Math.max(1e-6, mx - mn), k = (hi - lo) / span;
  const out = new Float32Array(lab.length);
  for (let i = 0; i < n; i++) {
    const t = Math.min(1, Math.max(0, (Ls[i] - mn) / span));
    out[i * 3] = lo + (hi - lo) * Math.pow(t, gamma);
    const c = Math.min(1.6, k * 0.5);
    out[i * 3 + 1] = lab[i * 3 + 1] * c; out[i * 3 + 2] = lab[i * 3 + 2] * c;
  }
  return out;
}
