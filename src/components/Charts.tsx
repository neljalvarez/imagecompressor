import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Experiment, OriginalImage } from '../lib/types';
import { formatBytes, formatPsnr, fmtInt } from '../lib/format';

// Categorical palette (dark-surface steps), assigned to experiments in fixed order.
const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'];
export const seriesColor = (i: number) => PALETTE[i % PALETTE.length];

interface Series {
  id: string;
  name: string;
  color: string;
  points: [number, number][]; // sorted by x
}

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function nearest(points: [number, number][], x: number): [number, number] | null {
  if (!points.length) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] < x) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo][0] - x) <= Math.abs(points[hi][0] - x) ? points[lo] : points[hi];
}

interface ChartProps {
  title: string;
  subtitle?: string;
  series: Series[];
  xMax: number;
  logX: boolean;
  formatY: (v: number) => string;
  tickY: (v: number, step: number) => string;
  testId?: string;
}

const M = { l: 64, r: 16, t: 12, b: 34 };
const H = 260;

function LineChart({ title, subtitle, series, xMax, logX, formatY, tickY, testId }: ChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hoverX, setHoverX] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const iw = Math.max(50, w - M.l - M.r);
  const ih = H - M.t - M.b;
  const x0 = 1;
  const x1 = Math.max(2, xMax);
  const sx = (x: number) => M.l + (logX ? (Math.log10(Math.max(x, 1)) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0)) : (x - x0) / (x1 - x0)) * iw;
  const invX = (px: number) => {
    const t = Math.min(1, Math.max(0, (px - M.l) / iw));
    return logX ? Math.pow(10, Math.log10(x0) + t * (Math.log10(x1) - Math.log10(x0))) : x0 + t * (x1 - x0);
  };

  let yMin = Infinity;
  let yMax = -Infinity;
  for (const s of series) for (const [, y] of s.points) if (Number.isFinite(y)) { if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
  if (!Number.isFinite(yMin)) { yMin = 0; yMax = 1; }
  if (yMax - yMin < 1e-9) { yMin -= 1; yMax += 1; }
  const pad = (yMax - yMin) * 0.08;
  const yTicks = niceTicks(yMin - pad, yMax + pad, 5);
  const lo = Math.min(yTicks[0], yMin - pad);
  const hi = Math.max(yTicks[yTicks.length - 1], yMax + pad);
  const sy = (y: number) => M.t + ih - ((y - lo) / (hi - lo)) * ih;

  const xTicks = logX
    ? [1, 10, 100, 1000, 10000].filter((t) => t <= x1)
    : niceTicks(x0, x1, Math.max(2, Math.floor(iw / 90))).filter((t) => t >= x0);

  const paths = useMemo(
    () =>
      series.map((s) => {
        // Bucket by pixel column (keeping min & max) so 10,000 points draw fast without losing shape.
        const pts = s.points.filter(([, y]) => Number.isFinite(y));
        let d = '';
        if (pts.length > iw * 2) {
          let col = -1;
          let mn = 0;
          let mx = 0;
          let first = true;
          const flushCol = () => {
            if (col < 0) return;
            d += `${first ? 'M' : 'L'}${col},${sy(mn).toFixed(1)}L${col},${sy(mx).toFixed(1)}`;
            first = false;
          };
          for (const [x, y] of pts) {
            const c = Math.round(sx(x));
            if (c !== col) {
              flushCol();
              col = c;
              mn = mx = y;
            } else {
              if (y < mn) mn = y;
              if (y > mx) mx = y;
            }
          }
          flushCol();
        } else {
          pts.forEach(([x, y], i) => (d += `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`));
        }
        return { ...s, d, single: pts.length === 1 ? pts[0] : null };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, iw, lo, hi, logX, x1],
  );

  const hx = hoverX != null ? Math.round(invX(hoverX)) : null;
  const hoverPts = hx != null ? series.map((s) => ({ s, p: nearest(s.points.filter(([, y]) => Number.isFinite(y)), hx) })) : [];

  return (
    <div className="chart" data-testid={testId}>
      <div className="chart-head">
        <h3>{title}</h3>
        {subtitle && <span className="muted small">{subtitle}</span>}
      </div>
      <div ref={wrap} className="chart-wrap">
        <svg
          width={w}
          height={H}
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = e.clientX - r.left;
            setHoverX(px >= M.l && px <= M.l + iw ? px : null);
          }}
          onMouseLeave={() => setHoverX(null)}
          role="img"
          aria-label={title}
        >
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={M.l} x2={M.l + iw} y1={sy(t)} y2={sy(t)} className="grid" />
              <text x={M.l - 8} y={sy(t)} className="tick" textAnchor="end" dominantBaseline="middle">{tickY(t, yTicks.length > 1 ? yTicks[1] - yTicks[0] : 1)}</text>
            </g>
          ))}
          {xTicks.map((t) => (
            <text key={`x${t}`} x={sx(t)} y={H - M.b + 18} className="tick" textAnchor="middle">{fmtInt(t)}</text>
          ))}
          <line x1={M.l} x2={M.l + iw} y1={M.t + ih} y2={M.t + ih} className="axis" />
          <text x={M.l + iw / 2} y={H - 2} className="axis-label" textAnchor="middle">Compression count{logX ? ' (log scale)' : ''}</text>
          {paths.map((p) =>
            p.single ? (
              <circle key={p.id} cx={sx(p.single[0])} cy={sy(p.single[1])} r={4} fill={p.color} />
            ) : (
              <path key={p.id} d={p.d} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ),
          )}
          {hoverX != null && hx != null && (
            <g pointerEvents="none">
              <line x1={sx(hx)} x2={sx(hx)} y1={M.t} y2={M.t + ih} className="crosshair" />
              {hoverPts.map(({ s, p }) => p && <circle key={s.id} cx={sx(p[0])} cy={sy(p[1])} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />)}
            </g>
          )}
        </svg>
        {hoverX != null && hx != null && hoverPts.some((h) => h.p) && (
          <div className="tooltip" style={{ left: Math.min(hoverX + 12, w - 200), top: 8 }}>
            {hoverPts.map(({ s, p }) =>
              p ? (
                <div key={s.id}>
                  <span className="dot" style={{ background: s.color }} /> {s.name}: <b>{formatY(p[1])}</b> <span className="muted">@ {fmtInt(p[0])}</span>
                </div>
              ) : null,
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface Props {
  original: OriginalImage;
  experiments: Experiment[];
}

export function Charts({ original, experiments }: Props) {
  const [logX, setLogX] = useState(true);
  const versions = experiments.map((e) => `${e.id}:${e.version}`).join('|');

  const { sizeSeries, psnrSeries, xMax, unmeasuredInf } = useMemo(() => {
    const sizeSeries: Series[] = [];
    const psnrSeries: Series[] = [];
    let xMax = 1;
    let unmeasuredInf = false;
    for (const e of experiments) {
      const name = `${e.letter} · Q${e.quality}`;
      const color = seriesColor(e.colorIndex);
      sizeSeries.push({ id: e.id, name, color, points: e.sizes.map((s, i) => [i + 1, s] as [number, number]) });
      psnrSeries.push({ id: e.id, name, color, points: e.psnr.map(([i, p]) => [i, p] as [number, number]) });
      if (e.psnr.some(([, p]) => p === Infinity)) unmeasuredInf = true;
      xMax = Math.max(xMax, e.iterations);
    }
    return { sizeSeries, psnrSeries, xMax, unmeasuredInf };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions]);

  if (experiments.length === 0) return null;

  return (
    <section className="card" data-testid="charts">
      <div className="section-head">
        <h2>Statistics</h2>
        <div className="row">
          {experiments.length > 1 && (
            <div className="legend">
              {experiments.map((e) => (
                <span key={e.id}>
                  <span className="dot" style={{ background: seriesColor(e.colorIndex) }} /> {e.letter} · Q{e.quality}
                </span>
              ))}
            </div>
          )}
          <label className="inline">
            <input type="checkbox" checked={logX} onChange={(e) => setLogX(e.target.checked)} /> Log x-axis
          </label>
        </div>
      </div>
      <div className="charts">
        <LineChart
          title="File size vs compression count"
          subtitle={`Original: ${formatBytes(original.size)} (${original.format})`}
          series={sizeSeries}
          xMax={xMax}
          logX={logX}
          formatY={(v) => formatBytes(v)}
          tickY={(v, step) => {
            const mb = v >= 1024 * 1024;
            const unit = mb ? 1024 * 1024 : 1024;
            const dec = Math.min(3, Math.max(0, Math.ceil(-Math.log10(step / unit))));
            return `${(v / unit).toFixed(dec)} ${mb ? 'MB' : 'KB'}`;
          }}
          testId="chart-size"
        />
        <LineChart
          title="PSNR vs compression count"
          subtitle="Relative to the original · higher = closer to the original"
          series={psnrSeries}
          xMax={xMax}
          logX={logX}
          formatY={(v) => formatPsnr(v)}
          tickY={(v, step) => `${v.toFixed(Math.min(3, Math.max(0, Math.ceil(-Math.log10(step)))))} dB`}
          testId="chart-psnr"
        />
      </div>
      {unmeasuredInf && <p className="muted small">Some iterations are pixel-identical to the original (PSNR = ∞) and are not plotted.</p>}
    </section>
  );
}
