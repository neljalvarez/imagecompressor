import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type Zoom = 'fit' | 1 | 2 | 4 | 8;
export const ZOOM_LEVELS: Zoom[] = ['fit', 1, 2, 4, 8];

export interface View {
  zoom: Zoom;
  /** Image-space point shown at the centre of the pane. */
  cx: number;
  cy: number;
}

export interface Layer {
  bitmap: ImageBitmap | null;
  clip?: 'left' | 'right';
}

interface Props {
  layers: Layer[];
  imgW: number;
  imgH: number;
  view: View;
  setView: (v: View) => void;
  split?: number;
  setSplit?: (s: number) => void;
  onHover?: (p: { x: number; y: number } | null) => void;
  children?: ReactNode;
  testId?: string;
}

export function scaleFor(view: View, w: number, h: number, iw: number, ih: number) {
  return view.zoom === 'fit' ? Math.min(w / iw, h / ih) : view.zoom;
}

/**
 * Canvas that draws one or two images with exact nearest-neighbour pixels when zoomed in.
 * All panes of a comparison share the same `view`, which keeps zoom and pan synchronised.
 */
export function ViewPane({ layers, imgW, imgH, view, setView, split = 0.5, setSplit, onHover, children, testId }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const drag = useRef<{ kind: 'pan' | 'split'; x: number; y: number; cx: number; cy: number } | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const effective = () => {
    const s = scaleFor(view, size.w, size.h, imgW, imgH);
    const cx = view.zoom === 'fit' ? imgW / 2 : view.cx;
    const cy = view.zoom === 'fit' ? imgH / 2 : view.cy;
    return { s, cx, cy, ox: size.w / 2 - cx * s, oy: size.h / 2 - cy * s };
  };

  // Draw
  useEffect(() => {
    const c = canvas.current;
    if (!c || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const { s, ox, oy } = effective();
    // Visible source rectangle, in whole image pixels.
    const sx = Math.max(0, Math.floor(-ox / s));
    const sy = Math.max(0, Math.floor(-oy / s));
    const ex = Math.min(imgW, Math.ceil((size.w - ox) / s));
    const ey = Math.min(imgH, Math.ceil((size.h - oy) / s));
    if (ex <= sx || ey <= sy) return;
    ctx.imageSmoothingEnabled = s < 1;
    ctx.imageSmoothingQuality = 'high';
    const splitX = split * size.w;
    for (const layer of layers) {
      if (!layer.bitmap) continue;
      ctx.save();
      if (layer.clip) {
        ctx.beginPath();
        if (layer.clip === 'left') ctx.rect(0, 0, splitX, size.h);
        else ctx.rect(splitX, 0, size.w - splitX, size.h);
        ctx.clip();
      }
      try {
        ctx.drawImage(layer.bitmap, sx, sy, ex - sx, ey - sy, ox + sx * s, oy + sy * s, (ex - sx) * s, (ey - sy) * s);
      } catch {
        /* bitmap may have been released; the next render will redraw */
      }
      ctx.restore();
    }
    // Pixel grid at 800% for pixel-level inspection.
    if (s >= 8) {
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = sx; x <= ex; x++) {
        const px = Math.round(ox + x * s) + 0.5;
        ctx.moveTo(px, Math.max(0, oy + sy * s));
        ctx.lineTo(px, Math.min(size.h, oy + ey * s));
      }
      for (let y = sy; y <= ey; y++) {
        const py = Math.round(oy + y * s) + 0.5;
        ctx.moveTo(Math.max(0, ox + sx * s), py);
        ctx.lineTo(Math.min(size.w, ox + ex * s), py);
      }
      ctx.stroke();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, view, size, split, imgW, imgH]);

  const clampView = (v: View): View => ({ ...v, cx: Math.min(imgW, Math.max(0, v.cx)), cy: Math.min(imgH, Math.max(0, v.cy)) });

  const toImage = (clientX: number, clientY: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const { s, ox, oy } = effective();
    return { mx: clientX - r.left, my: clientY - r.top, ix: (clientX - r.left - ox) / s, iy: (clientY - r.top - oy) / s };
  };

  // Keep the pixel readout correct after the view moves under a stationary cursor (pan / zoom).
  useEffect(() => {
    if (!onHover || !pointer.current || !size.w) return;
    const { ix, iy } = toImage(pointer.current.x, pointer.current.y);
    if (ix >= 0 && iy >= 0 && ix < imgW && iy < imgH) onHover({ x: Math.floor(ix), y: Math.floor(iy) });
    else onHover(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, size]);

  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelRef.current = (e: WheelEvent) => {
    e.preventDefault();
    const idx = ZOOM_LEVELS.indexOf(view.zoom);
    const next = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, idx + (e.deltaY < 0 ? 1 : -1)))];
    if (next === view.zoom) return;
    const { mx, my, ix, iy } = toImage(e.clientX, e.clientY);
    if (next === 'fit') return setView({ zoom: 'fit', cx: imgW / 2, cy: imgH / 2 });
    // Keep the image point under the cursor fixed while zooming.
    setView(clampView({ zoom: next, cx: ix - (mx - size.w / 2) / next, cy: iy - (my - size.h / 2) / next }));
  };
  useEffect(() => {
    const el = wrap.current!;
    const h = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  return (
    <div
      ref={wrap}
      className={`pane ${view.zoom === 'fit' ? '' : 'pannable'}`}
      data-testid={testId}
      onPointerDown={(e) => {
        const { mx } = toImage(e.clientX, e.clientY);
        const nearSplit = setSplit && (view.zoom === 'fit' || Math.abs(mx - split * size.w) < 16);
        const { cx, cy } = effective();
        drag.current = { kind: nearSplit ? 'split' : 'pan', x: e.clientX, y: e.clientY, cx, cy };
        (e.target as Element).setPointerCapture?.(e.pointerId);
        if (nearSplit) setSplit!(Math.min(1, Math.max(0, mx / size.w)));
      }}
      onPointerMove={(e) => {
        pointer.current = { x: e.clientX, y: e.clientY };
        const d = drag.current;
        const { mx, ix, iy } = toImage(e.clientX, e.clientY);
        if (d?.kind === 'split') setSplit?.(Math.min(1, Math.max(0, mx / size.w)));
        else if (d?.kind === 'pan' && view.zoom !== 'fit') {
          const s = view.zoom;
          setView(clampView({ zoom: view.zoom, cx: d.cx - (e.clientX - d.x) / s, cy: d.cy - (e.clientY - d.y) / s }));
        }
        if (onHover) {
          if (ix >= 0 && iy >= 0 && ix < imgW && iy < imgH) onHover({ x: Math.floor(ix), y: Math.floor(iy) });
          else onHover(null);
        }
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onPointerLeave={() => {
        pointer.current = null;
        onHover?.(null);
      }}
    >
      <canvas ref={canvas} style={{ width: size.w, height: size.h }} />
      {setSplit && (
        <div className="split-line" style={{ left: `${split * 100}%` }}>
          <div className="split-knob" />
        </div>
      )}
      {children}
    </div>
  );
}
