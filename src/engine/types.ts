export type OutputMime = 'image/jpeg' | 'image/webp';

export interface RunParams {
  /** 1–100. Mapped to the encoder's 0.01–1.00 quality argument. */
  quality: number;
  /** Number of sequential decode → re-encode cycles (1–10,000). */
  iterations: number;
  mime: OutputMime;
  /** Iterations at which the full encoded image is kept as a snapshot. The final iteration is always kept. */
  snapshotAt: number[];
  /** Measure PSNR every N iterations (iteration 1, snapshots and the final iteration are always measured). */
  psnrEvery: number;
  /** Minimum milliseconds between live-preview images sent to the UI. */
  previewIntervalMs: number;
}

/** Messages from the UI to the engine. */
export type EngineCommand =
  | { type: 'start'; source: Blob; params: RunParams }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' };

export interface StatsBatch {
  /** First iteration covered by `sizes`. */
  from: number;
  /** Encoded byte size for each iteration from `from` onward (no gaps). */
  sizes: number[];
  /** [iteration, psnrDb] pairs measured in this batch. Infinity means pixel-identical to the original. */
  psnr: [number, number][];
}

/** Messages from the engine to the UI. */
export type EngineEvent =
  | { type: 'ready'; width: number; height: number }
  | {
      type: 'progress';
      iteration: number;
      elapsedMs: number;
      size: number;
      stats: StatsBatch;
      preview?: Blob;
      /** First iteration whose encoded bytes were identical to the previous iteration's (a fixed point). */
      stableSince: number | null;
    }
  | { type: 'snapshot'; iteration: number; blob: Blob; psnr: number }
  | { type: 'paused'; elapsedMs: number }
  | { type: 'resumed' }
  | {
      type: 'done';
      reason: 'complete' | 'stopped';
      iteration: number;
      elapsedMs: number;
      stats: StatsBatch;
      stableSince: number | null;
    }
  | { type: 'error'; message: string };
