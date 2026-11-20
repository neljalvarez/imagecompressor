/// <reference lib="webworker" />
import { createEngine, UNSUPPORTED } from './core';
import type { EngineCommand, EngineEvent } from './types';

const scope = self as unknown as DedicatedWorkerGlobalScope;

function supported(): boolean {
  try {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return false;
    const c = new OffscreenCanvas(1, 1);
    return !!c.getContext('2d') && typeof c.convertToBlob === 'function';
  } catch {
    return false;
  }
}

const engine = createEngine({
  emit: (e: EngineEvent) => scope.postMessage(e),
  makeSurface: (w, h) => {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!ctx) throw new Error('Could not create a 2D canvas in the worker.');
    return { ctx, encode: (type, quality) => canvas.convertToBlob({ type, quality }) };
  },
});

scope.onmessage = (ev: MessageEvent<EngineCommand>) => {
  if (ev.data.type === 'start' && !supported()) {
    scope.postMessage({ type: 'error', message: UNSUPPORTED } satisfies EngineEvent);
    return;
  }
  engine.handle(ev.data);
};
