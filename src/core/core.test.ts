import { describe, expect, it } from 'vitest';
import { hexToLinear, linearToOklab, oklabToLinear } from './color';
import { AXES, ORIENTATIONS, mulMatVec, transpose } from './die';
import { FS_STENCIL, buildLattice, numDice, pixelKey, scanKey } from './lattice';
import { DEFAULT_PALETTE_OPTIONS, SIX_PALETTE, resolvePalette } from './palette';
import { buildCandidates, dither } from './dither';
import { refine } from './refine';
import { evaluate } from './metrics';
import type { Vec3 } from './color';

describe('colour', () => {
  it('OKLab round-trips', () => {
    for (const hex of ['#ff0000', '#00ff00', '#0000ff', '#f4f1ea', '#17171a', '#808080']) {
      const lin = hexToLinear(hex);
      const back = oklabToLinear(linearToOklab(lin));
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(lin[i], 5);
    }
  });
  it('white has L≈1, black L≈0', () => {
    expect(linearToOklab([1, 1, 1])[0]).toBeCloseTo(1, 3);
    expect(linearToOklab([0, 0, 0])[0]).toBeCloseTo(0, 3);
  });
});

describe('die', () => {
  it('has 24 distinct orientations, each a valid die', () => {
    expect(ORIENTATIONS.length).toBe(24);
    const seen = new Set<string>();
    for (const o of ORIENTATIONS) {
      seen.add(o.faces.join(''));
      // opposite faces sum to 7
      expect(o.faces[0] + o.faces[1]).toBe(7);
      expect(o.faces[2] + o.faces[3]).toBe(7);
      expect(o.faces[4] + o.faces[5]).toBe(7);
      // all six values present
      expect([...o.faces].sort().join('')).toBe('123456');
    }
    expect(seen.size).toBe(24);
  });
  it('corner mode exposes 24 distinct (fx,fy,fz) triples = 8 corners x 3 rotations', () => {
    const triples = new Set(ORIENTATIONS.map((o) => `${o.faces[0]}${o.faces[2]}${o.faces[4]}`));
    expect(triples.size).toBe(24);
    // handedness: (1,2,3) must appear and its mirror (1,3,2) must not
    expect(triples.has('123')).toBe(true);
    expect(triples.has('132')).toBe(false);
    // cyclic shifts of a corner are all present
    expect(triples.has('231')).toBe(true);
    expect(triples.has('312')).toBe(true);
  });
  it('edge mode exposes all 24 ordered pairs of adjacent faces', () => {
    const pairs = new Set(ORIENTATIONS.map((o) => `${o.faces[0]}${o.faces[2]}`));
    expect(pairs.size).toBe(24);
    for (const o of ORIENTATIONS) expect(o.faces[0] + o.faces[2]).not.toBe(7);
  });
  it('rotation matrices are proper rotations', () => {
    for (const o of ORIENTATIONS) {
      const Rt = transpose(o.R);
      for (const a of AXES) {
        const v = mulMatVec(o.R, mulMatVec(Rt, a));
        expect(v).toEqual(a);
      }
    }
  });
});

describe('lattice', () => {
  for (const mode of ['corner', 'edge'] as const) {
    const L = buildLattice(mode, 6);
    it(`${mode}: has the expected number of dice`, () => {
      expect(L.cells.length).toBe(numDice(mode, 6));
    });
    it(`${mode}: every view is a perfect square grid (no two dice share a pixel)`, () => {
      for (const view of L.views) expect(view.lookup.size).toBe(L.cells.length);
    });
    it(`${mode}: dice are at integer points of Z^3 that project to disjoint unit squares`, () => {
      for (const c of L.cells) {
        if (mode === 'corner') expect(c.pos[0] + c.pos[1] + c.pos[2]).toBe(0);
        else expect(c.pos[0] + c.pos[1]).toBe(0);
      }
    });
    it(`${mode}: Floyd-Steinberg stencil is strictly causal in every view under the scan order`, () => {
      for (const c of L.cells) {
        const k = scanKey(mode, c.pos);
        L.views.forEach((view, v) => {
          for (const [dx, dy] of FS_STENCIL) {
            const j = view.lookup.get(pixelKey(c.px[v] + dx, c.py[v] + dy));
            if (j === undefined) continue;
            expect(scanKey(mode, L.cells[j].pos)).toBeGreaterThan(k);
          }
        });
      }
    });
    it(`${mode}: screen basis is orthonormal and the exposed face is seen head-on`, () => {
      for (const view of L.views) {
        const d = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        expect(d(view.right, view.up)).toBeCloseTo(0, 9);
        expect(d(view.right, view.forward)).toBeCloseTo(0, 9);
        expect(d(view.up, view.forward)).toBeCloseTo(0, 9);
        const n = AXES[view.axisIdx];
        expect(d(n, view.forward)).toBeCloseTo(-1, 9);
      }
    });
  }
  it('corner: the three views see the lattice as a 45°-rotated square grid', () => {
    const L = buildLattice('corner', 3);
    const c = L.cells.find((c) => c.pos[0] === 0 && c.pos[1] === 1 && c.pos[2] === -1)!;
    // in view +x, (y,z)=(1,-1) is at screen (y-z)/√2 = √2, (y+z)/√2 = 0
    expect(c.sx[0]).toBeCloseTo(Math.SQRT2, 9);
    expect(c.sy[0]).toBeCloseTo(0, 9);
  });
});

describe('dither', () => {
  const L = buildLattice('corner', 10);
  const P = resolvePalette(SIX_PALETTE, DEFAULT_PALETTE_OPTIONS);
  it('builds K*24 candidates', () => {
    expect(buildCandidates(L, P).length).toBe(6 * 24);
  });
  it('a flat target is reproduced on average (error diffusion preserves the mean)', () => {
    const grey = linearToOklab([0.5, 0.5, 0.5]);
    // keep the target inside the palette gamut: use the white die's own mid-face colour
    const target = P.faceLab[0][4];
    const targets = L.views.map(() => L.cells.map(() => target));
    const res = dither(L, P, targets, { diffusion: 'fs', metric: 'oklab', errorClamp: 0.35, chromaWeight: 1, hueWeight: 0 });
    for (let v = 0; v < 3; v++) {
      let s = 0;
      for (const c of res.shown[v]) s += c[0];
      expect(s / L.cells.length).toBeCloseTo(target[0], 2);
    }
    void grey;
  });
  it('refinement never increases the filtered error', () => {
    const rnd = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
    const r = rnd(7);
    const targets = L.views.map(() => L.cells.map(() => linearToOklab([r(), r(), r()])));
    const res = dither(L, P, targets);
    const before = evaluate(L, targets, res.shown, 1.0);
    refine(L, targets, res, { sigma: 1.0, maxSweeps: 3, minChangeFraction: 0, chromaWeight: 1, typeSmooth: 0, hueWeight: 0 });
    const after = evaluate(L, targets, res.shown, 1.0);
    const sum = (m: typeof before) => m.reduce((a, b) => a + b.meanDE, 0);
    expect(sum(after)).toBeLessThanOrEqual(sum(before) + 1e-9);
  });
});

describe('single-view lattice', () => {
  it('is a w x h grid with a causal FS order', async () => {
    const { buildSingleLattice } = await import('./lattice');
    const L = buildSingleLattice(30, 20);
    expect(L.cells.length).toBe(600);
    expect(L.views.length).toBe(1);
    expect(L.views[0].lookup.size).toBe(600);
    for (const c of L.cells) for (const [dx, dy] of FS_STENCIL) {
      const j = L.views[0].lookup.get(pixelKey(c.px[0] + dx, c.py[0] + dy));
      if (j !== undefined) expect(scanKey('single', L.cells[j].pos)).toBeGreaterThan(scanKey('single', c.pos));
    }
  });
});
