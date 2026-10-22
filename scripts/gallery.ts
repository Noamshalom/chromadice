/** Render the gallery thumbnails: one PNG per preset in public/gallery/. Run with `npm run gallery`. */
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { loadImage } from './node-io';
import { CATALOG, DEFAULT_SOLVE, solve, renderViewSVG } from '../src/core';
import { PRESETS } from '../src/web/presets';

mkdirSync('public/gallery', { recursive: true });
for (const p of PRESETS) {
  const images = await Promise.all(p.pictures.map((pic) => loadImage(`public/samples/${pic.sample}.jpg`)));
  const types = CATALOG.filter((t) => p.colours.includes(t.name));
  const s = solve(images, {
    ...DEFAULT_SOLVE, mode: p.mode, gridW: p.w, gridH: p.h, types, style: p.style ?? DEFAULT_SOLVE.style, hueWeight: p.hue ?? DEFAULT_SOLVE.hueWeight, gamma: p.gamma ?? 1,
    frames: p.pictures.map((pic) => pic.frame ?? { cx: 0.5, cy: 0.5, zoom: 1 }), fit: p.mode === 'single' ? 'crop' : 'auto', weights: p.pictures.map(() => 1),
  });
  const svg = renderViewSVG(s.lattice, s.palette, s.res.assignment, p.mode === 'corner' ? 2 : 0, { scale: 10, pipRadius: DEFAULT_SOLVE.pipRadius, background: '#111113', margin: 0.5 });
  await sharp(Buffer.from(svg)).resize({ width: 480 }).png().toFile(`public/gallery/${p.id}.png`);
  console.log(p.id, s.lattice.cells.length, 'dice');
}
