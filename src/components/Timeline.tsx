import type { Experiment, OriginalImage, SourceRef } from '../lib/types';
import { formatBytes, formatName, formatPsnr, fmtInt } from '../lib/format';
import { saveBlob, snapshotFilename } from '../lib/download';
import { refKey } from './Compare';

interface Props {
  original: OriginalImage;
  exp: Experiment;
  a: SourceRef;
  b: SourceRef;
  setA: (r: SourceRef) => void;
  setB: (r: SourceRef) => void;
}

export function Timeline({ original, exp, a, b, setA, setB }: Props) {
  const ka = refKey(a);
  const kb = refKey(b);
  const pending = exp.snapshotAt.filter((n) => !exp.snapshots.some((s) => s.iteration === n));

  const card = (key: string, ref: SourceRef, url: string, title: string, sub: string, onDownload: () => void) => (
    <div key={key} className={`snap ${ka === key ? 'is-a' : ''} ${kb === key ? 'is-b' : ''}`} data-testid="snapshot-card">
      <button type="button" className="snap-img" onClick={() => setB(ref)} title="Show as B">
        <img src={url} alt={title} loading="lazy" />
      </button>
      <div className="snap-title">{title}</div>
      <div className="snap-sub">{sub}</div>
      <div className="snap-actions">
        <button type="button" className={ka === key ? 'on' : ''} onClick={() => setA(ref)} title="Use as A">A</button>
        <button type="button" className={kb === key ? 'on' : ''} onClick={() => setB(ref)} title="Use as B">B</button>
        <button type="button" onClick={onDownload} title="Download this snapshot" data-testid="snapshot-download">↓</button>
      </div>
    </div>
  );

  return (
    <section className="card" data-testid="timeline">
      <div className="section-head">
        <h2>Compression timeline · Experiment {exp.letter} (Q{exp.quality}, {formatName(exp.mime)})</h2>
        <span className="muted small">Click a snapshot to compare it; A/B buttons choose the side.</span>
      </div>
      <div className="timeline">
        {card('original', { kind: 'original' }, original.url, 'Original', `${formatBytes(original.size)} · ${original.format}`, () => saveBlob(original.blob, original.name))}
        {exp.snapshots.map((s) => {
          const isFinal = s.iteration === exp.finalIteration;
          const key = `snap:${exp.id}:${s.iteration}`;
          return card(
            key,
            { kind: 'snapshot', expId: exp.id, iteration: s.iteration },
            s.url,
            `${fmtInt(s.iteration)} ${s.iteration === 1 ? 'compression' : 'compressions'}${isFinal ? ' · final' : ''}`,
            `${formatBytes(s.size)} · ${formatPsnr(s.psnr)}`,
            () => saveBlob(s.blob, snapshotFilename(original, exp, s.iteration, isFinal)),
          );
        })}
        {pending.map((n) => (
          <div key={`p${n}`} className="snap pending">
            <div className="snap-img placeholder">{exp.status === 'running' || exp.status === 'paused' || exp.status === 'queued' ? 'waiting' : 'not reached'}</div>
            <div className="snap-title">{fmtInt(n)} compressions</div>
          </div>
        ))}
      </div>
    </section>
  );
}
