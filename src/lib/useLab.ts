import { useCallback, useEffect, useRef, useState } from 'react';
import { EngineClient } from '../engine/client';
import type { EngineEvent, OutputMime, RunParams } from '../engine/types';
import type { Experiment, OriginalImage, Snapshot } from './types';
import { clearDecodeCache } from './decode';
import { parseIntList, sniffFormat } from './format';

export type PsnrMode = 'auto' | '1' | '10' | '100';

export interface Settings {
  quality: number;
  iterations: number;
  mime: OutputMime;
  snapshotText: string;
  psnrMode: PsnrMode;
  batchText: string;
}

export const DEFAULT_SETTINGS: Settings = {
  quality: 50,
  iterations: 1000,
  mime: 'image/jpeg',
  snapshotText: '1, 10, 50, 100, 500, 1000',
  psnrMode: 'auto',
  batchText: '90, 50, 10',
};

export const MAX_ITERATIONS = 10_000;

export function psnrEveryFor(mode: PsnrMode, iterations: number): number {
  if (mode === 'auto') return Math.max(1, Math.ceil(iterations / 1000));
  return Number(mode);
}

function letterFor(n: number): string {
  let s = '';
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

async function loadOriginal(file: File): Promise<OriginalImage> {
  const format = await sniffFormat(file);
  if (!format) throw new Error('Unsupported file. Please choose a JPG, PNG or WebP image.');
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  // Detect transparency (sampled on a downscaled copy for speed on huge images).
  let hasAlpha = false;
  if (format !== 'JPEG') {
    const scale = Math.min(1, 1024 / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) { hasAlpha = true; break; }
  }
  bitmap.close();
  return { blob: file, name: file.name, url: URL.createObjectURL(file), width, height, size: file.size, format, hasAlpha };
}

export function useLab() {
  const [original, setOriginal] = useState<OriginalImage | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const clientRef = useRef<EngineClient | null>(null);
  const runningIdRef = useRef<string | null>(null);
  const counterRef = useRef(0);
  const latestUrlRef = useRef(new Map<string, string>());
  const expRef = useRef(new Map<string, Experiment>());
  const originalRef = useRef<OriginalImage | null>(null);
  originalRef.current = original;

  const patch = useCallback((id: string, fn: (e: Experiment) => Partial<Experiment>) => {
    setExperiments((list) => list.map((e) => (e.id === id ? { ...e, ...fn(e), version: e.version + 1 } : e)));
  }, []);

  const setLatest = useCallback((id: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const old = latestUrlRef.current.get(id);
    latestUrlRef.current.set(id, url);
    if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);
    return url;
  }, []);

  const finishRun = useCallback(() => {
    clientRef.current?.dispose();
    clientRef.current = null;
    runningIdRef.current = null;
  }, []);

  const onEvent = useCallback(
    (id: string, ev: EngineEvent) => {
      const exp = expRef.current.get(id);
      if (!exp) return;
      switch (ev.type) {
        case 'ready':
          patch(id, () => ({ engineMode: clientRef.current?.mode ?? null }));
          break;
        case 'progress': {
          exp.sizes.push(...ev.stats.sizes); // shared array, mutated here (never inside a state updater)
          exp.psnr.push(...ev.stats.psnr);
          const lastPsnr = ev.stats.psnr.length ? ev.stats.psnr[ev.stats.psnr.length - 1][1] : undefined;
          const latest = ev.preview ? { latestBlob: ev.preview, latestUrl: setLatest(id, ev.preview), latestIteration: ev.iteration } : {};
          patch(id, (e) => ({
            iteration: ev.iteration,
            elapsedMs: ev.elapsedMs,
            currentSize: ev.size,
            currentPsnr: lastPsnr ?? e.currentPsnr,
            stableSince: ev.stableSince,
            engineMode: clientRef.current?.mode ?? e.engineMode,
            ...latest,
          }));
          break;
        }
        case 'snapshot': {
          const snap: Snapshot = { iteration: ev.iteration, blob: ev.blob, url: URL.createObjectURL(ev.blob), size: ev.blob.size, psnr: ev.psnr };
          patch(id, (e) => ({
            snapshots: [...e.snapshots.filter((s) => s.iteration !== snap.iteration), snap].sort((a, b) => a.iteration - b.iteration),
          }));
          break;
        }
        case 'paused':
          patch(id, () => ({ status: 'paused', elapsedMs: ev.elapsedMs }));
          break;
        case 'resumed':
          patch(id, () => ({ status: 'running' }));
          break;
        case 'done': {
          exp.sizes.push(...ev.stats.sizes);
          exp.psnr.push(...ev.stats.psnr);
          finishRun();
          patch(id, (e) => {
            const final = e.snapshots.find((s) => s.iteration === ev.iteration);
            const lastPsnr = ev.stats.psnr.length ? ev.stats.psnr[ev.stats.psnr.length - 1][1] : e.currentPsnr;
            return {
              status: ev.reason === 'complete' ? 'complete' : 'stopped',
              iteration: ev.iteration,
              elapsedMs: ev.elapsedMs,
              finalIteration: ev.iteration > 0 ? ev.iteration : null,
              stableSince: ev.stableSince,
              currentPsnr: final?.psnr ?? lastPsnr,
              currentSize: final?.size ?? e.currentSize,
              latestBlob: final?.blob ?? e.latestBlob,
              latestUrl: final?.url ?? e.latestUrl,
              latestIteration: final?.iteration ?? e.latestIteration,
            };
          });
          break;
        }
        case 'error':
          finishRun();
          patch(id, () => ({ status: 'error', error: ev.message }));
          break;
      }
    },
    [patch, setLatest, finishRun],
  );

  // Keep a lookup of experiments by id for the event handler.
  useEffect(() => {
    const m = new Map<string, Experiment>();
    for (const e of experiments) m.set(e.id, e);
    expRef.current = m;
  }, [experiments]);

  // Queue runner: start the next queued experiment when nothing is running.
  useEffect(() => {
    if (runningIdRef.current || !original) return;
    const next = experiments.find((e) => e.status === 'queued');
    if (!next) return;
    runningIdRef.current = next.id;
    expRef.current.set(next.id, next);
    const client = new EngineClient((ev) => onEvent(next.id, ev));
    clientRef.current = client;
    const params: RunParams = {
      quality: next.quality,
      iterations: next.iterations,
      mime: next.mime,
      snapshotAt: next.snapshotAt,
      psnrEvery: next.psnrEvery,
      previewIntervalMs: 120,
    };
    patch(next.id, () => ({ status: 'running' }));
    client.start(original.blob, params);
  }, [experiments, original, onEvent, patch]);

  const makeExperiment = (s: Settings, quality: number): Experiment => {
    const n = counterRef.current++;
    const iterations = Math.min(MAX_ITERATIONS, Math.max(1, Math.floor(s.iterations)));
    return {
      id: `exp-${Date.now()}-${n}`,
      letter: letterFor(n),
      colorIndex: n % 8,
      quality,
      iterations,
      mime: s.mime,
      snapshotAt: parseIntList(s.snapshotText, iterations),
      psnrEvery: psnrEveryFor(s.psnrMode, iterations),
      status: 'queued',
      iteration: 0,
      elapsedMs: 0,
      currentSize: NaN,
      currentPsnr: NaN,
      sizes: [],
      psnr: [],
      snapshots: [],
      latestBlob: null,
      latestUrl: null,
      latestIteration: 0,
      finalIteration: null,
      stableSince: null,
      engineMode: null,
      version: 0,
    };
  };

  const isBusy = experiments.some((e) => e.status === 'running' || e.status === 'paused' || e.status === 'queued');

  const start = useCallback(
    (s: Settings) => {
      if (!originalRef.current) return null;
      const e = makeExperiment(s, s.quality);
      setExperiments((l) => [...l, e]);
      setActiveId(e.id);
      return e;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const runBatch = useCallback((s: Settings, qualities: number[]) => {
    if (!originalRef.current || qualities.length === 0) return null;
    const list = qualities.map((q) => makeExperiment(s, q));
    setExperiments((l) => [...l, ...list]);
    setActiveId(list[0].id);
    return list[0];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pause = useCallback(() => clientRef.current?.pause(), []);
  const resume = useCallback(() => clientRef.current?.resume(), []);
  const stop = useCallback(() => {
    // Stop the running experiment and cancel anything still queued.
    setExperiments((l) => l.filter((e) => e.status !== 'queued'));
    clientRef.current?.stop();
  }, []);

  const revokeExperiment = (e: Experiment) => {
    for (const s of e.snapshots) URL.revokeObjectURL(s.url);
    const u = latestUrlRef.current.get(e.id);
    if (u) URL.revokeObjectURL(u);
    latestUrlRef.current.delete(e.id);
  };

  const reset = useCallback(() => {
    finishRun();
    setExperiments((l) => {
      l.forEach(revokeExperiment);
      return [];
    });
    setActiveId(null);
    counterRef.current = 0;
    clearDecodeCache();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishRun]);

  const removeExperiment = useCallback(
    (id: string) => {
      if (runningIdRef.current === id) finishRun();
      setExperiments((l) => {
        const e = l.find((x) => x.id === id);
        if (e) revokeExperiment(e);
        return l.filter((x) => x.id !== id);
      });
      setActiveId((a) => (a === id ? null : a));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finishRun],
  );

  const loadImage = useCallback(
    async (file: File) => {
      setLoadError(null);
      try {
        const img = await loadOriginal(file);
        reset();
        if (originalRef.current) URL.revokeObjectURL(originalRef.current.url);
        counterRef.current = 0;
        setOriginal(img);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Could not read that image.');
      }
    },
    [reset],
  );

  const clearImage = useCallback(() => {
    reset();
    if (originalRef.current) URL.revokeObjectURL(originalRef.current.url);
    counterRef.current = 0;
    setOriginal(null);
  }, [reset]);

  const running = experiments.find((e) => e.id === runningIdRef.current) ?? experiments.find((e) => e.status === 'running' || e.status === 'paused') ?? null;

  return {
    original,
    experiments,
    activeId,
    setActiveId,
    active: experiments.find((e) => e.id === activeId) ?? null,
    running,
    isBusy,
    loadError,
    loadImage,
    clearImage,
    start,
    runBatch,
    pause,
    resume,
    stop,
    reset,
    removeExperiment,
  };
}
