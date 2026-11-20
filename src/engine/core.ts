/**
 * The repeated-compression engine.
 *
 * Original → Compression 1 → Compression 2 → … → Compression N
 *
 * Every cycle takes the *decoded output of the previous cycle* and re-encodes it with
 * the browser's own lossy encoder (canvas.toBlob / OffscreenCanvas.convertToBlob).
 * Nothing else touches the pixels: no noise, no blur, no resizing. The canvas always has
 * the original image's dimensions, so the resolution never changes.
 *
 * This file is shared by the Web Worker (preferred) and the main-thread fallback.
 */
import type { EngineCommand, EngineEvent, RunParams, StatsBatch } from './types';

type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export interface Surface {
  ctx: Ctx2D;
  encode(mime: string, quality: number): Promise<Blob>;
}

export type SurfaceFactory = (width: number, height: number) => Surface;

export const UNSUPPORTED = '__ENGINE_UNSUPPORTED__';

/** Peak signal-to-noise ratio over the RGB channels of two equally sized RGBA buffers. */
export function psnrRgb(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let sse = 0;
  for (let i = 0; i < a.length; i += 4) {
    const dr = a[i] - b[i];
    const dg = a[i + 1] - b[i + 1];
    const db = a[i + 2] - b[i + 2];
    sse += dr * dr + dg * dg + db * db;
  }
  if (sse === 0) return Infinity;
  const mse = sse / ((a.length / 4) * 3);
  return 10 * Math.log10((255 * 255) / mse);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export interface EngineOptions {
  emit: (e: EngineEvent) => void;
  makeSurface: SurfaceFactory;
  /** Main-thread mode: yield to the event loop regularly so the page stays responsive. */
  cooperative?: boolean;
}

export function createEngine({ emit, makeSurface, cooperative = false }: EngineOptions) {
  let paused = false;
  let stopped = false;
  let running = false;
  let resume: (() => void) | null = null;

  // Elapsed time excludes time spent paused.
  let activeStart = 0;
  let accumulated = 0;
  const elapsed = () => accumulated + (paused ? 0 : performance.now() - activeStart);

  const yieldNow = () =>
    new Promise<void>((r) => {
      if (typeof MessageChannel !== 'undefined') {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => r();
        ch.port2.postMessage(null);
      } else setTimeout(r, 0);
    });

  async function run(source: Blob, p: RunParams) {
    running = true;
    stopped = false;
    paused = false;
    accumulated = 0;
    activeStart = performance.now();

    const quality = Math.min(100, Math.max(1, p.quality)) / 100;
    const total = Math.max(1, Math.floor(p.iterations));
    const snapshotSet = new Set(p.snapshotAt.filter((n) => n >= 1 && n <= total));
    const psnrEvery = Math.max(1, Math.floor(p.psnrEvery));

    // Decode the untouched original. Transparent pixels are composited onto white
    // (JPEG has no alpha channel); the composited pixels are the PSNR reference.
    const original = await createImageBitmap(source);
    const { width, height } = original;
    const surface = makeSurface(width, height);
    const { ctx } = surface;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(original, 0, 0);
    original.close();
    const reference = ctx.getImageData(0, 0, width, height).data;
    emit({ type: 'ready', width, height });

    let batch: StatsBatch = { from: 1, sizes: [], psnr: [] };
    const flush = (): StatsBatch => {
      const out = batch;
      batch = { from: out.from + out.sizes.length, sizes: [], psnr: [] };
      return out;
    };

    let prevBytes: Uint8Array | null = null;
    let stableSince: number | null = null;
    let lastProgress = 0;
    let lastPreview = -Infinity;
    let lastYield = performance.now();
    let lastBlob: Blob | null = null;
    let lastIteration = 0;
    let lastSnapshotIteration = 0;
    let lastPsnr = NaN;

    for (let i = 1; i <= total; i++) {
      if (paused) {
        emit({ type: 'paused', elapsedMs: elapsed() });
        await new Promise<void>((r) => (resume = r));
        if (!stopped) emit({ type: 'resumed' });
      }
      if (stopped) break;

      // 1) Encode whatever is on the canvas (the original for i = 1, otherwise decoded output i-1).
      const blob = await surface.encode(p.mime, quality);
      if (blob.type !== p.mime) {
        throw new Error(
          `This browser cannot encode ${p.mime} (it returned ${blob.type || 'nothing'}). Choose a different output format.`,
        );
      }

      // 2) Decode output i and paint it onto the canvas; it becomes the input of cycle i+1.
      const decoded = await createImageBitmap(blob);
      ctx.drawImage(decoded, 0, 0);
      decoded.close();

      // 3) Measurements (always real numbers from the actual bytes / pixels).
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (stableSince === null && prevBytes && bytesEqual(prevBytes, bytes)) stableSince = i;
      prevBytes = bytes;
      batch.sizes.push(blob.size);

      const isSnapshot = snapshotSet.has(i) || i === total;
      if (i === 1 || isSnapshot || i % psnrEvery === 0) {
        const pixels = ctx.getImageData(0, 0, width, height).data;
        lastPsnr = psnrRgb(reference, pixels);
        batch.psnr.push([i, lastPsnr]);
      }
      if (isSnapshot) {
        emit({ type: 'snapshot', iteration: i, blob, psnr: lastPsnr });
        lastSnapshotIteration = i;
      }

      lastBlob = blob;
      lastIteration = i;

      const now = performance.now();
      if (i === 1 || now - lastProgress >= 100) {
        const withPreview = now - lastPreview >= p.previewIntervalMs;
        if (withPreview) lastPreview = now;
        emit({
          type: 'progress',
          iteration: i,
          elapsedMs: elapsed(),
          size: blob.size,
          stats: flush(),
          preview: withPreview ? blob : undefined,
          stableSince,
        });
        lastProgress = now;
      }
      if (cooperative && now - lastYield > 12) {
        await yieldNow();
        lastYield = performance.now();
      }
    }

    // A stopped run still delivers its last completed iteration as the final snapshot.
    if (lastBlob && lastSnapshotIteration !== lastIteration) {
      if (batch.psnr.length === 0 || batch.psnr[batch.psnr.length - 1][0] !== lastIteration) {
        const pixels = ctx.getImageData(0, 0, width, height).data;
        lastPsnr = psnrRgb(reference, pixels);
        batch.psnr.push([lastIteration, lastPsnr]);
      }
      emit({ type: 'snapshot', iteration: lastIteration, blob: lastBlob, psnr: lastPsnr });
    }

    emit({
      type: 'done',
      reason: lastIteration === total ? 'complete' : 'stopped',
      iteration: lastIteration,
      elapsedMs: elapsed(),
      stats: flush(),
      stableSince,
    });
    running = false;
  }

  function handle(cmd: EngineCommand) {
    switch (cmd.type) {
      case 'start':
        if (running) return;
        run(cmd.source, cmd.params).catch((err: unknown) => {
          running = false;
          emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        });
        break;
      case 'pause':
        if (running && !paused) {
          accumulated += performance.now() - activeStart;
          paused = true;
        }
        break;
      case 'resume':
        if (paused) {
          paused = false;
          activeStart = performance.now();
          resume?.();
          resume = null;
        }
        break;
      case 'stop':
        stopped = true;
        if (paused) {
          paused = false;
          activeStart = performance.now();
          resume?.();
          resume = null;
        }
        break;
    }
  }

  return { handle };
}
