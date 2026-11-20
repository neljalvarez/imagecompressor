import type { OutputMime } from '../engine/types';

export interface OriginalImage {
  blob: Blob;
  name: string;
  url: string;
  width: number;
  height: number;
  size: number;
  format: 'JPEG' | 'PNG' | 'WebP';
  hasAlpha: boolean;
}

export interface Snapshot {
  iteration: number;
  blob: Blob;
  url: string;
  size: number;
  psnr: number;
}

export type ExperimentStatus = 'queued' | 'running' | 'paused' | 'complete' | 'stopped' | 'error';

export interface Experiment {
  id: string;
  letter: string;
  colorIndex: number;
  quality: number;
  iterations: number;
  mime: OutputMime;
  snapshotAt: number[];
  psnrEvery: number;
  status: ExperimentStatus;
  /** Last completed iteration. */
  iteration: number;
  elapsedMs: number;
  currentSize: number;
  currentPsnr: number;
  /** sizes[i - 1] = encoded byte size after compression i. Mutated in place; `version` bumps on change. */
  sizes: number[];
  /** [iteration, psnr] for every measured iteration. Mutated in place. */
  psnr: [number, number][];
  snapshots: Snapshot[];
  /** Most recent output (live preview while running, final image when done). */
  latestBlob: Blob | null;
  latestUrl: string | null;
  latestIteration: number;
  finalIteration: number | null;
  stableSince: number | null;
  engineMode: 'worker' | 'main-thread' | null;
  error?: string;
  version: number;
}

/** What a comparison pane shows. */
export type SourceRef =
  | { kind: 'original' }
  | { kind: 'latest'; expId: string }
  | { kind: 'snapshot'; expId: string; iteration: number };
