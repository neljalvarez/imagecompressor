import { createEngine, UNSUPPORTED, type Surface } from './core';
import type { EngineCommand, EngineEvent, RunParams } from './types';

/** Main-thread surface, used only if Web Worker + OffscreenCanvas is unavailable. */
function mainThreadSurface(width: number, height: number): Surface {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (ctx && typeof canvas.convertToBlob === 'function') {
      return { ctx, encode: (type, quality) => canvas.convertToBlob({ type, quality }) };
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!ctx) throw new Error('Could not create a 2D canvas.');
  return {
    ctx,
    encode: (type, quality) =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed.'))), type, quality),
      ),
  };
}

/**
 * One compression run. Runs in a dedicated Web Worker so the UI never freezes;
 * transparently falls back to a cooperative main-thread loop on old browsers.
 */
export class EngineClient {
  private worker: Worker | null = null;
  private inline: ReturnType<typeof createEngine> | null = null;
  private disposed = false;
  mode: 'worker' | 'main-thread' = 'worker';

  constructor(private onEvent: (e: EngineEvent) => void) {}

  start(source: Blob, params: RunParams) {
    const cmd: EngineCommand = { type: 'start', source, params };
    try {
      this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<EngineEvent>) => {
        if (ev.data.type === 'error' && ev.data.message === UNSUPPORTED) {
          this.worker?.terminate();
          this.worker = null;
          this.startInline(cmd);
          return;
        }
        if (!this.disposed) this.onEvent(ev.data);
      };
      this.worker.onerror = (ev) => {
        ev.preventDefault();
        this.worker?.terminate();
        this.worker = null;
        this.startInline(cmd);
      };
      this.worker.postMessage(cmd);
    } catch {
      this.startInline(cmd);
    }
  }

  private startInline(cmd: EngineCommand) {
    if (this.disposed) return;
    this.mode = 'main-thread';
    this.inline = createEngine({
      emit: (e) => !this.disposed && this.onEvent(e),
      makeSurface: mainThreadSurface,
      cooperative: true,
    });
    this.inline.handle(cmd);
  }

  send(cmd: EngineCommand) {
    if (this.worker) this.worker.postMessage(cmd);
    else this.inline?.handle(cmd);
  }

  pause() { this.send({ type: 'pause' }); }
  resume() { this.send({ type: 'resume' }); }
  stop() { this.send({ type: 'stop' }); }

  dispose() {
    this.disposed = true;
    this.inline?.handle({ type: 'stop' });
    this.worker?.terminate();
    this.worker = null;
  }
}
