/**
 * Decoded images for the comparison viewer. Each source is decoded once into an ImageBitmap;
 * its RGBA pixels are read lazily (only when diffing or inspecting a pixel). Transparent
 * pixels are composited on white, exactly like the engine's reference image.
 */
export interface Decoded {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  pixels(): Uint8ClampedArray;
}

const cache = new Map<Blob, Promise<Decoded>>();
const MAX_ENTRIES = 8;

async function decode(blob: Blob): Promise<Decoded> {
  const raw = await createImageBitmap(blob);
  const { width, height } = raw;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(raw, 0, 0);
  raw.close();
  const bitmap = await createImageBitmap(canvas);
  let data: Uint8ClampedArray | null = null;
  return {
    bitmap,
    width,
    height,
    pixels() {
      if (!data) data = ctx.getImageData(0, 0, width, height).data;
      return data;
    },
  };
}

export function getDecoded(blob: Blob): Promise<Decoded> {
  let p = cache.get(blob);
  if (p) {
    cache.delete(blob);
    cache.set(blob, p); // LRU bump
    return p;
  }
  p = decode(blob);
  cache.set(blob, p);
  p.catch(() => cache.delete(blob));
  while (cache.size > MAX_ENTRIES) {
    // Evicted entries are not closed: a component may still be drawing them. GC reclaims them.
    cache.delete(cache.keys().next().value as Blob);
  }
  return p;
}

export function clearDecodeCache() {
  cache.clear();
}
