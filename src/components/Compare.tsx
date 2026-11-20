import { useEffect, useMemo, useRef, useState } from 'react';
import type { Experiment, OriginalImage, SourceRef } from '../lib/types';
import { getDecoded, type Decoded } from '../lib/decode';
import { formatPercent, formatPsnr, fmtInt } from '../lib/format';
import { psnrRgb } from '../engine/core';
import { ViewPane, ZOOM_LEVELS, type View, type Zoom } from './ViewPane';

type Mode = 'side' | 'slider' | 'diff';
type DiffStyle = 'highlight' | 'amplify';

interface Props {
  original: OriginalImage;
  experiments: Experiment[];
  a: SourceRef;
  b: SourceRef;
  setA: (r: SourceRef) => void;
  setB: (r: SourceRef) => void;
  presenting: boolean;
}

export function refKey(r: SourceRef) {
  return r.kind === 'original' ? 'original' : r.kind === 'latest' ? `latest:${r.expId}` : `snap:${r.expId}:${r.iteration}`;
}

function parseKey(k: string): SourceRef {
  if (k === 'original') return { kind: 'original' };
  const [kind, expId, it] = k.split(':');
  return kind === 'latest' ? { kind: 'latest', expId } : { kind: 'snapshot', expId, iteration: Number(it) };
}

export function resolveRef(r: SourceRef, original: OriginalImage, experiments: Experiment[]): { blob: Blob; label: string } | null {
  if (r.kind === 'original') return { blob: original.blob, label: 'Original' };
  const e = experiments.find((x) => x.id === r.expId);
  if (!e) return null;
  const head = `${e.letter} · Q${e.quality}`;
  if (r.kind === 'latest') {
    if (!e.latestBlob) return null;
    const live = e.status === 'running' || e.status === 'paused';
    return { blob: e.latestBlob, label: `${head} · ${live ? 'live ' : ''}#${fmtInt(e.latestIteration)}` };
  }
  const s = e.snapshots.find((x) => x.iteration === r.iteration);
  return s ? { blob: s.blob, label: `${head} · #${fmtInt(s.iteration)}` } : null;
}

function useDecoded(blob: Blob | undefined) {
  const [d, setD] = useState<Decoded | null>(null);
  useEffect(() => {
    let alive = true;
    if (!blob) {
      setD(null);
      return;
    }
    getDecoded(blob).then((x) => alive && setD(x)).catch(() => alive && setD(null));
    return () => {
      alive = false;
    };
  }, [blob]);
  return d;
}

interface DiffResult {
  bitmap: ImageBitmap;
  changed: number;
  total: number;
  maxDiff: number;
  meanAbs: number;
  psnr: number;
}

async function computeDiff(a: Decoded, b: Decoded, style: DiffStyle, threshold: number, gain: number): Promise<DiffResult> {
  const pa = a.pixels();
  const pb = b.pixels();
  const out = new ImageData(a.width, a.height);
  const o = out.data;
  let changed = 0;
  let maxDiff = 0;
  let sumAbs = 0;
  for (let i = 0; i < pa.length; i += 4) {
    const dr = Math.abs(pa[i] - pb[i]);
    const dg = Math.abs(pa[i + 1] - pb[i + 1]);
    const db = Math.abs(pa[i + 2] - pb[i + 2]);
    const d = Math.max(dr, dg, db);
    sumAbs += dr + dg + db;
    if (d > maxDiff) maxDiff = d;
    const isChanged = d > threshold;
    if (isChanged) changed++;
    if (style === 'highlight') {
      if (isChanged) {
        const t = Math.min(1, d / 48);
        o[i] = 255;
        o[i + 1] = Math.round(220 * (1 - t));
        o[i + 2] = 0;
      } else {
        const g = (pa[i] * 0.299 + pa[i + 1] * 0.587 + pa[i + 2] * 0.114) * 0.35;
        o[i] = o[i + 1] = o[i + 2] = g;
      }
    } else {
      o[i] = Math.min(255, dr * gain);
      o[i + 1] = Math.min(255, dg * gain);
      o[i + 2] = Math.min(255, db * gain);
    }
    o[i + 3] = 255;
  }
  const total = pa.length / 4;
  return {
    bitmap: await createImageBitmap(out),
    changed,
    total,
    maxDiff,
    meanAbs: sumAbs / (total * 3),
    psnr: psnrRgb(pa, pb),
  };
}

export function Compare({ original, experiments, a, b, setA, setB, presenting }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('slider');
  const [view, setView] = useState<View>({ zoom: 'fit', cx: original.width / 2, cy: original.height / 2 });
  const [split, setSplit] = useState(0.5);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [diffStyle, setDiffStyle] = useState<DiffStyle>('highlight');
  const [threshold, setThreshold] = useState(0);
  const [gain, setGain] = useState(10);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffBusy, setDiffBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const ra = resolveRef(a, original, experiments);
  const rb = resolveRef(b, original, experiments);
  const da = useDecoded(ra?.blob);
  const db = useDecoded(rb?.blob);

  useEffect(() => setView({ zoom: 'fit', cx: original.width / 2, cy: original.height / 2 }), [original]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    if (mode !== 'diff' || !da || !db) {
      setDiff(null);
      return;
    }
    let alive = true;
    setDiffBusy(true);
    const t = setTimeout(() => {
      computeDiff(da, db, diffStyle, threshold, gain)
        .then((r) => alive && setDiff(r))
        .finally(() => alive && setDiffBusy(false));
    }, 30);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [mode, da, db, diffStyle, threshold, gain]);

  const options = useMemo(() => {
    const opts: { key: string; label: string }[] = [{ key: 'original', label: 'Original' }];
    for (const e of experiments) {
      if (e.latestBlob) opts.push({ key: `latest:${e.id}`, label: `${e.letter} · Q${e.quality} · latest` });
      for (const s of e.snapshots) opts.push({ key: `snap:${e.id}:${s.iteration}`, label: `${e.letter} · Q${e.quality} · #${fmtInt(s.iteration)}${s.iteration === e.finalIteration ? ' (final)' : ''}` });
    }
    return opts;
  }, [experiments]);

  const setZoom = (z: Zoom) =>
    setView((v) => (z === 'fit' ? { zoom: 'fit', cx: original.width / 2, cy: original.height / 2 } : { zoom: z, cx: v.zoom === 'fit' ? original.width / 2 : v.cx, cy: v.zoom === 'fit' ? original.height / 2 : v.cy }));

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else root.current?.requestFullscreen?.();
  };

  const pixelAt = (d: Decoded | null, x: number, y: number) => {
    if (!d) return null;
    const p = d.pixels();
    const i = (y * d.width + x) * 4;
    return [p[i], p[i + 1], p[i + 2]] as const;
  };
  const pa = hover ? pixelAt(da, hover.x, hover.y) : null;
  const pb = hover ? pixelAt(db, hover.x, hover.y) : null;

  const W = original.width;
  const H = original.height;
  const labelA = ra?.label ?? '—';
  const labelB = rb?.label ?? '—';

  return (
    <section ref={root} className={`card compare ${fullscreen ? 'is-fullscreen' : ''} ${presenting ? 'compare-present' : ''}`} data-testid="compare">
      <div className="compare-bar">
        <h2>Comparison</h2>
        <div className="seg" role="tablist" aria-label="Comparison mode">
          {(['side', 'slider', 'diff'] as Mode[]).map((m) => (
            <button key={m} type="button" className={mode === m ? 'on' : ''} onClick={() => setMode(m)} data-testid={`mode-${m}`}>
              {m === 'side' ? 'Side by side' : m === 'slider' ? 'Slider' : 'Difference'}
            </button>
          ))}
        </div>
        <div className="seg" aria-label="Zoom">
          {ZOOM_LEVELS.map((z) => (
            <button key={String(z)} type="button" className={view.zoom === z ? 'on' : ''} onClick={() => setZoom(z)} data-testid={`zoom-${z}`}>
              {z === 'fit' ? 'Fit' : `${z * 100}%`}
            </button>
          ))}
        </div>
        <button type="button" onClick={toggleFullscreen} data-testid="btn-fullscreen">
          {fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        </button>
      </div>

      <div className="compare-pickers">
        <label>
          <span className="tag tag-a">A</span>
          <select value={refKey(a)} onChange={(e) => setA(parseKey(e.target.value))} data-testid="pick-a">
            {options.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="tag tag-b">B</span>
          <select value={refKey(b)} onChange={(e) => setB(parseKey(e.target.value))} data-testid="pick-b">
            {options.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => { setA(b); setB(a); }} title="Swap A and B">Swap</button>
      </div>

      <div className={`viewer viewer-${mode}`}>
        {mode === 'side' && (
          <>
            <ViewPane layers={[{ bitmap: da?.bitmap ?? null }]} imgW={W} imgH={H} view={view} setView={setView} onHover={setHover} testId="pane-a">
              <div className="pane-label left">A · {labelA}</div>
            </ViewPane>
            <ViewPane layers={[{ bitmap: db?.bitmap ?? null }]} imgW={W} imgH={H} view={view} setView={setView} onHover={setHover} testId="pane-b">
              <div className="pane-label left">B · {labelB}</div>
            </ViewPane>
          </>
        )}
        {mode === 'slider' && (
          <ViewPane
            layers={[
              { bitmap: da?.bitmap ?? null, clip: 'left' },
              { bitmap: db?.bitmap ?? null, clip: 'right' },
            ]}
            imgW={W}
            imgH={H}
            view={view}
            setView={setView}
            split={split}
            setSplit={setSplit}
            onHover={setHover}
            testId="pane-slider"
          >
            <div className="pane-label left">A · {labelA}</div>
            <div className="pane-label right">B · {labelB}</div>
          </ViewPane>
        )}
        {mode === 'diff' && (
          <ViewPane layers={[{ bitmap: diff?.bitmap ?? null }]} imgW={W} imgH={H} view={view} setView={setView} onHover={setHover} testId="pane-diff">
            <div className="pane-label left">
              {diffStyle === 'highlight' ? 'Changed pixels: yellow = small change → red = large (≥ 48 levels) · grey = unchanged' : `|A − B| per channel × ${gain} · black = identical`}
              {diffBusy ? ' · computing…' : ''}
            </div>
          </ViewPane>
        )}
      </div>

      {mode === 'diff' && (
        <div className="diff-controls">
          <div className="seg">
            <button type="button" className={diffStyle === 'highlight' ? 'on' : ''} onClick={() => setDiffStyle('highlight')}>Highlight</button>
            <button type="button" className={diffStyle === 'amplify' ? 'on' : ''} onClick={() => setDiffStyle('amplify')}>Amplified</button>
          </div>
          {diffStyle === 'highlight' ? (
            <label className="inline">
              Ignore changes ≤ <input type="number" min={0} max={254} className="num" value={threshold} onChange={(e) => setThreshold(Math.max(0, Math.min(254, Number(e.target.value) || 0)))} /> levels
            </label>
          ) : (
            <label className="inline">
              Gain <input type="range" min={1} max={50} value={gain} onChange={(e) => setGain(Number(e.target.value))} /> ×{gain}
            </label>
          )}
          {diff && (
            <span className="diff-stats" data-testid="diff-stats">
              Changed: <b>{formatPercent((diff.changed / diff.total) * 100, 2)}</b> ({fmtInt(diff.changed)} px) · max Δ {diff.maxDiff} · mean |Δ| {diff.meanAbs.toFixed(2)} · PSNR {formatPsnr(diff.psnr)}
            </span>
          )}
        </div>
      )}

      <div className="pixel-readout" data-testid="pixel-readout">
        {hover && pa && pb ? (
          <>
            <span>x {hover.x}, y {hover.y}</span>
            <span><span className="swatch" style={{ background: `rgb(${pa.join(',')})` }} /> A rgb({pa.join(', ')})</span>
            <span><span className="swatch" style={{ background: `rgb(${pb.join(',')})` }} /> B rgb({pb.join(', ')})</span>
            <span>Δ {Math.abs(pa[0] - pb[0])}, {Math.abs(pa[1] - pb[1])}, {Math.abs(pa[2] - pb[2])}</span>
          </>
        ) : (
          <span className="muted">Hover to inspect pixels · scroll to zoom · drag to pan{mode === 'slider' ? ' or move the slider' : ''} · {fmtInt(W)} × {fmtInt(H)} px</span>
        )}
      </div>
    </section>
  );
}
