import type { Frame, Mode } from '../core';

/** A gallery entry: everything needed to reproduce it with one click. Thumbnails are rendered by scripts/gallery.ts. */
export interface Preset {
  id: string;
  title: string;
  mode: Mode;
  /** block size in dice, across x up */
  w: number;
  h: number;
  /** sample pictures from public/samples, one per viewer */
  pictures: { sample: string; frame?: Frame }[];
  /** die colours from the catalog; one colour unless mode is 'single' */
  colours: string[];
  style?: 'smooth' | 'poster' | 'dithered';
  /** hue-identity weight ("Keep hues" in Advanced); default 6 */
  hue?: number;
  /** tone curve ("Darken" in Advanced): > 1 darker midtones; default 1 */
  gamma?: number;
}

const MONA_FACE: Frame = { cx: 0.5, cy: 0.3, zoom: 2 };
const GIRL: Frame = { cx: 0.47, cy: 0.45, zoom: 1 };
const FRIDA: Frame = { cx: 0.5, cy: 0.45, zoom: 1 };

export const PRESETS: Preset[] = [
  { id: 'frida', title: 'Frida Kahlo, six colours', mode: 'single', w: 72, h: 82, colours: ['black', 'green', 'pink', 'orange', 'red', 'ivory'],
    pictures: [{ sample: 'frida-kahlo', frame: FRIDA }] },
  { id: 'starry-night', title: 'The Starry Night, five colours', mode: 'single', w: 151, h: 79, colours: ['black', 'blue', 'cyan', 'yellow', 'white'],
    pictures: [{ sample: 'starry-night' }] },
  { id: 'great-wave', title: 'The Great Wave, four colours', mode: 'single', w: 96, h: 66, colours: ['black', 'blue', 'white', 'ivory'], hue: 20,
    pictures: [{ sample: 'great-wave' }] },
  { id: 'mona-black', title: 'Mona Lisa, black dice', mode: 'single', w: 91, h: 108, colours: ['black'], gamma: 1.35,
    pictures: [{ sample: 'mona-lisa', frame: MONA_FACE }] },
  { id: 'girl-black', title: 'Girl with a Pearl Earring, black dice', mode: 'single', w: 106, h: 88, colours: ['black'], gamma: 1.3,
    pictures: [{ sample: 'girl-with-a-pearl-earring', frame: { cx: 0.47, cy: 0.4, zoom: 1 } }] },
  { id: 'mona-duotone', title: 'Mona Lisa, black and yellow', mode: 'single', w: 91, h: 108, colours: ['black', 'yellow'],
    pictures: [{ sample: 'mona-lisa', frame: MONA_FACE }] },
  { id: 'two-pictures', title: 'Two pictures, one array', mode: 'edge', w: 72, h: 90, colours: ['black'], gamma: 1.25,
    pictures: [{ sample: 'mona-lisa', frame: { cx: 0.5, cy: 0.35, zoom: 1.4 } }, { sample: 'girl-with-a-pearl-earring', frame: GIRL }] },
  { id: 'three-pictures', title: 'Three pictures, dice on a corner', mode: 'corner', w: 90, h: 90, colours: ['white'],
    pictures: [{ sample: 'mona-lisa', frame: { cx: 0.5, cy: 0.3, zoom: 1.6 } }, { sample: 'girl-with-a-pearl-earring', frame: { cx: 0.47, cy: 0.42, zoom: 1.1 } }, { sample: 'frida-kahlo', frame: { cx: 0.5, cy: 0.4, zoom: 1.2 } }] },
];
