import type { Experiment, OriginalImage } from '../lib/types';
import { formatBytes, formatDuration, formatName, formatPsnr, fmtInt } from '../lib/format';
import { saveBlob, snapshotFilename } from '../lib/download';
import { seriesColor } from './Charts';

interface Props {
  original: OriginalImage;
  experiments: Experiment[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  presenting: boolean;
}

export function Experiments({ original, experiments, activeId, onSelect, onRemove, presenting }: Props) {
  if (experiments.length === 0) return null;
  return (
    <section className="card" data-testid="experiments">
      <div className="section-head">
        <h2>Experiments · final results</h2>
        <span className="muted small">Same original image for every experiment. Click a result to inspect it.</span>
      </div>
      <div className="exp-grid" style={{ gridTemplateColumns: `repeat(${presenting ? Math.min(Math.max(experiments.length, 3), 4) : 3}, minmax(0, 1fr))` }}>
        {experiments.map((e) => {
          const final = e.finalIteration != null ? e.snapshots.find((s) => s.iteration === e.finalIteration) : undefined;
          return (
            <div key={e.id} className={`exp-card ${e.id === activeId ? 'active' : ''}`} data-testid="exp-card">
              <button type="button" className="exp-img" onClick={() => onSelect(e.id)}>
                {e.latestUrl ? <img src={e.latestUrl} alt={`Quality ${e.quality}`} /> : <div className="placeholder">{e.status === 'queued' ? 'Queued' : '…'}</div>}
              </button>
              <div className="exp-title">
                <span className="dot" style={{ background: seriesColor(e.colorIndex) }} />
                <strong>Quality {e.quality}</strong>
                <span className="muted">· {e.letter}</span>
              </div>
              <div className="exp-meta">
                {fmtInt(e.iteration)} / {fmtInt(e.iterations)} × {formatName(e.mime)}
                <br />
                {Number.isFinite(e.currentSize) ? formatBytes(e.currentSize) : '—'} · PSNR {e.iteration ? formatPsnr(e.currentPsnr) : '—'}
                {!presenting && (
                  <>
                    <br />
                    {e.status} · {formatDuration(e.elapsedMs)}
                    {e.stableSince != null && ` · fixed at #${fmtInt(e.stableSince)}`}
                  </>
                )}
              </div>
              {!presenting && (
                <div className="row">
                  <button type="button" disabled={!final} onClick={() => final && saveBlob(final.blob, snapshotFilename(original, e, final.iteration, true))}>
                    Download final
                  </button>
                  <button type="button" onClick={() => onRemove(e.id)} title="Remove experiment">Remove</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
