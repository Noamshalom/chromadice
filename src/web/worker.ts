/// <reference lib="webworker" />
import { solve, evaluate, billOfMaterials, perceived, type SolveOptions, type Vec3 } from '../core';

export interface JobRequest extends SolveOptions {
  id: number;
  images: { width: number; height: number; data: Float32Array }[];
}

export interface JobResult {
  id: number;
  type: Int16Array;
  orient: Int8Array;
  targets: Float32Array[];   // per view, N*3 OKLab
  shown: Float32Array[];
  perceived: Float32Array[];
  metrics: { meanDE: number; psnrL: number; corrL: number }[];
  bom: { name: string; count: number }[];
  timings: Record<string, number>;
}

function flat(a: Vec3[]): Float32Array {
  const out = new Float32Array(a.length * 3);
  for (let i = 0; i < a.length; i++) { out[i * 3] = a[i][0]; out[i * 3 + 1] = a[i][1]; out[i * 3 + 2] = a[i][2]; }
  return out;
}

self.onmessage = (ev: MessageEvent<JobRequest>) => {
  const req = ev.data;
  const post = (stage: string) => (self as unknown as Worker).postMessage({ id: req.id, progress: stage });
  try {
    const t0 = performance.now();
    const { lattice, palette, raw, res } = solve(req.images, req, post);
    post('Measuring');
    const metrics = evaluate(lattice, raw, res.shown, 1.25).map((m) => ({ meanDE: m.meanDE, psnrL: m.psnrL, corrL: m.corrL }));
    const perc = lattice.views.map((_, v) => flat(perceived(lattice, v, res.shown[v], 1.25)));
    const out: JobResult = {
      id: req.id,
      type: res.assignment.type,
      orient: res.assignment.orient,
      targets: raw.map(flat),
      shown: res.shown.map(flat),
      perceived: perc,
      metrics,
      bom: billOfMaterials(palette, res.assignment),
      timings: { total: performance.now() - t0 },
    };
    (self as unknown as Worker).postMessage(out, [out.type.buffer, out.orient.buffer, ...out.targets.map((t) => t.buffer), ...out.shown.map((t) => t.buffer), ...out.perceived.map((t) => t.buffer)]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ id: req.id, error: String(e) });
  }
};
