import type { Experiment, OriginalImage } from '../lib/types';
import { formatBytes, formatDuration, formatName, formatPercent, formatPsnr, fmtInt } from '../lib/format';

interface Props {
  original: OriginalImage;
  exp: Experiment | null;
  presenting: boolean;
}

const STATUS_LABEL: Record<Experiment['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  paused: 'Paused',
  complete: 'Complete',
  stopped: 'Stopped',
  error: 'Error',
};

export function LiveView({ original, exp, presenting }: Props) {
  const iteration = exp?.iteration ?? 0;
  const total = exp?.iterations ?? 0;
  const pct = total ? (iteration / total) * 100 : 0;
  const size = exp && iteration > 0 ? exp.currentSize : original.size;
  const reduction = exp && iteration > 0 ? (1 - exp.currentSize / original.size) * 100 : NaN;
  const rate = exp && exp.elapsedMs > 0 ? iteration / (exp.elapsedMs / 1000) : NaN;
  const eta = exp && (exp.status === 'running' || exp.status === 'paused') && rate > 0 ? ((total - iteration) / rate) * 1000 : NaN;
  const src = exp?.latestUrl ?? original.url;
  const shownIteration = exp?.latestUrl ? exp.latestIteration : 0;

  return (
    <section className={`card live ${presenting ? 'live-present' : ''}`} data-testid="live-view">
      <div className="live-head">
        <h2>
          {exp ? (
            <>
              Experiment {exp.letter} · Quality {exp.quality} · {formatName(exp.mime)}
            </>
          ) : (
            'Original image'
          )}
        </h2>
        {exp && <span className={`badge ${exp.status}`} data-testid="status-badge">{STATUS_LABEL[exp.status]}</span>}
      </div>

      <div className="live-stage">
        <img src={src} alt={shownIteration ? `After ${shownIteration} compressions` : 'Original'} data-testid="live-image" />
        <div className="stage-tag">{shownIteration ? `Compression ${fmtInt(shownIteration)}` : 'Original'}</div>
      </div>

      <div className="progress" aria-label="Progress">
        <div className="progress-bar" style={{ width: `${pct}%` }} />
      </div>

      <div className="stats-row">
        <div className="stat">
          <span className="label">Iteration</span>
          <span className="value" data-testid="iteration">
            {fmtInt(iteration)}
            <small> / {fmtInt(total)}</small>
          </span>
        </div>
        <div className="stat">
          <span className="label">Progress</span>
          <span className="value" data-testid="percent">{formatPercent(pct)}</span>
        </div>
        <div className="stat">
          <span className="label">Elapsed</span>
          <span className="value" data-testid="elapsed">{exp ? formatDuration(exp.elapsedMs) : '—'}</span>
        </div>
        <div className="stat">
          <span className="label">File size</span>
          <span className="value" data-testid="current-size">{formatBytes(size)}</span>
        </div>
        <div className="stat">
          <span className="label">vs original</span>
          <span className="value" data-testid="reduction">
            {Number.isFinite(reduction) ? (reduction >= 0 ? `−${formatPercent(reduction)}` : `+${formatPercent(-reduction)}`) : '—'}
          </span>
        </div>
        <div className="stat">
          <span className="label">PSNR</span>
          <span className="value" data-testid="psnr">{exp && iteration > 0 ? formatPsnr(exp.currentPsnr) : '—'}</span>
        </div>
      </div>

      {exp && !presenting && (
        <p className="muted small live-foot">
          {Number.isFinite(rate) && `${rate.toFixed(rate < 10 ? 1 : 0)} compressions/s`}
          {Number.isFinite(eta) && ` · about ${formatDuration(eta)} left`}
          {exp.engineMode && ` · engine: ${exp.engineMode === 'worker' ? 'Web Worker' : 'main thread (fallback)'}`}
          {` · original ${formatBytes(original.size)} ${original.format}`}
        </p>
      )}
      {exp?.stableSince != null && (
        <p className="stable" data-testid="stable-note">
          Fixed point: compression {fmtInt(exp.stableSince)} produced a file byte-identical to compression {fmtInt(exp.stableSince - 1)}. The image has stabilised, so every later compression returns the same file.
        </p>
      )}
      {exp?.error && <p className="error">{exp.error}</p>}
    </section>
  );
}
