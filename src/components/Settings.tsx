import type { Experiment } from '../lib/types';
import type { OutputMime } from '../engine/types';
import { MAX_ITERATIONS, psnrEveryFor, type PsnrMode, type Settings } from '../lib/useLab';
import { fmtInt, parseIntList, parseIntListOrdered } from '../lib/format';

const PRESETS = [1, 10, 50, 100, 500, 1000];

interface Props {
  settings: Settings;
  onChange: (s: Settings) => void;
  webpSupported: boolean | null;
  hasImage: boolean;
  running: Experiment | null;
  isBusy: boolean;
  hasResults: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onReset: () => void;
  onRunBatch: () => void;
}

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

export function SettingsPanel(p: Props) {
  const { settings: s, onChange } = p;
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch });
  const snapshots = parseIntList(s.snapshotText, s.iterations);
  const batch = parseIntListOrdered(s.batchText, 100);
  const paused = p.running?.status === 'paused';
  const active = !!p.running;
  const locked = p.isBusy;

  return (
    <>
      <section className="card">
        <h2>2 · Compression settings</h2>

        <label className="field">
          <span>Quality <small>(lower = stronger compression)</small></span>
          <div className="row">
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={s.quality}
              disabled={locked}
              onChange={(e) => set({ quality: Number(e.target.value) })}
              aria-label="Quality slider"
            />
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              className="num"
              value={s.quality}
              disabled={locked}
              data-testid="quality-input"
              onChange={(e) => e.target.value !== '' && set({ quality: clampInt(Number(e.target.value), 1, 100) })}
            />
          </div>
        </label>

        <label className="field">
          <span>Number of compressions <small>(1–{fmtInt(MAX_ITERATIONS)})</small></span>
          <input
            type="number"
            min={1}
            max={MAX_ITERATIONS}
            step={1}
            value={s.iterations}
            disabled={locked}
            data-testid="iterations-input"
            onChange={(e) => e.target.value !== '' && set({ iterations: clampInt(Number(e.target.value), 1, MAX_ITERATIONS) })}
          />
        </label>
        <div className="chips" role="group" aria-label="Preset compression counts">
          {PRESETS.map((n) => (
            <button
              type="button"
              key={n}
              disabled={locked}
              className={s.iterations === n ? 'chip on' : 'chip'}
              onClick={() => set({ iterations: n })}
            >
              {fmtInt(n)}
            </button>
          ))}
        </div>

        <label className="field">
          <span>Output format</span>
          <select value={s.mime} disabled={locked} data-testid="format-select" onChange={(e) => set({ mime: e.target.value as OutputMime })}>
            <option value="image/jpeg">JPEG</option>
            <option value="image/webp" disabled={p.webpSupported === false}>
              WebP{p.webpSupported === false ? ' (not supported by this browser)' : ''}
            </option>
          </select>
        </label>
        {s.mime === 'image/webp' && s.quality === 100 && (
          <p className="note">Chromium browsers encode WebP at quality 100 losslessly, so the image may not degrade at all.</p>
        )}

        <details className="advanced">
          <summary>Snapshots &amp; measurement</summary>
          <label className="field">
            <span>Save snapshots at iterations</span>
            <input
              type="text"
              value={s.snapshotText}
              disabled={locked}
              data-testid="snapshot-input"
              onChange={(e) => set({ snapshotText: e.target.value })}
            />
            <small className="muted">
              Original and final are always saved. This run keeps: {snapshots.length ? snapshots.map(fmtInt).join(', ') : 'none'}
            </small>
          </label>
          <label className="field">
            <span>Measure PSNR</span>
            <select value={s.psnrMode} disabled={locked} onChange={(e) => set({ psnrMode: e.target.value as PsnrMode })}>
              <option value="auto">Auto (every {fmtInt(psnrEveryFor('auto', s.iterations))})</option>
              <option value="1">Every iteration</option>
              <option value="10">Every 10 iterations</option>
              <option value="100">Every 100 iterations</option>
            </select>
            <small className="muted">File size is recorded for every iteration. PSNR is always measured at iteration 1, every snapshot and the final iteration.</small>
          </label>
        </details>
      </section>

      <section className="card controls">
        <h2>3 · Run</h2>
        <div className="btn-grid">
          <button type="button" className="primary" disabled={!p.hasImage || p.isBusy} onClick={p.onStart} data-testid="btn-start">
            Start
          </button>
          <button type="button" disabled={!active || paused} onClick={p.onPause} data-testid="btn-pause">
            Pause
          </button>
          <button type="button" disabled={!active || !paused} onClick={p.onResume} data-testid="btn-resume">
            Resume
          </button>
          <button type="button" disabled={!active} onClick={p.onStop} data-testid="btn-stop">
            Stop
          </button>
          <button type="button" disabled={!p.hasResults} onClick={p.onReset} data-testid="btn-reset" className="span2">
            Reset results
          </button>
        </div>
      </section>

      <section className="card">
        <h2>4 · Quality comparison</h2>
        <p className="muted small">Run the same image and compression count at several quality settings, one after another.</p>
        <label className="field">
          <span>Qualities</span>
          <input type="text" value={s.batchText} disabled={locked} data-testid="batch-input" onChange={(e) => set({ batchText: e.target.value })} />
        </label>
        <button
          type="button"
          disabled={!p.hasImage || p.isBusy || batch.length === 0}
          onClick={p.onRunBatch}
          data-testid="btn-batch"
          className="wide"
        >
          Run {batch.length} experiment{batch.length === 1 ? '' : 's'} × {fmtInt(s.iterations)} compressions
        </button>
      </section>
    </>
  );
}
