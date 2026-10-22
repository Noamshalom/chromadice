import sharp from 'sharp';
import { imageFromRGBA, type LinearImage } from '../src/core/image';

export async function loadImage(path: string, maxSide = 512): Promise<LinearImage> {
  const img = sharp(path).rotate().resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true });
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return imageFromRGBA(info.width, info.height, new Uint8Array(data.buffer, data.byteOffset, data.length));
}

export async function svgToPng(svg: string, out: string): Promise<void> {
  await sharp(Buffer.from(svg)).png().toFile(out);
}
