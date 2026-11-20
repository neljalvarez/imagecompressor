import type { OutputMime } from '../engine/types';

export function formatBytes(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 2 : 1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec.toFixed(1)} s`;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  if (m < 60) return `${m}:${String(s).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatPsnr(db: number | undefined): string {
  if (db === undefined || Number.isNaN(db)) return '—';
  if (db === Infinity) return '∞ dB';
  return `${db.toFixed(2)} dB`;
}

export function formatPercent(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return '—';
  return `${x.toFixed(digits)}%`;
}

export const fmtInt = (n: number) => n.toLocaleString('en-US');

export function extFor(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/png':
      return 'png';
    default:
      return 'bin';
  }
}

export function formatName(mime: OutputMime | string): string {
  return mime === 'image/webp' ? 'WebP' : mime === 'image/png' ? 'PNG' : 'JPEG';
}

/** Identify the real format from the file's magic bytes (more reliable than the extension). */
export async function sniffFormat(file: Blob): Promise<'JPEG' | 'PNG' | 'WebP' | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'JPEG';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'PNG';
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'WebP';
  return null;
}

/** Parse "1, 10, 50" into sorted unique positive integers. */
export function parseIntList(text: string, max = Infinity): number[] {
  const out = new Set<number>();
  for (const part of text.split(/[\s,;]+/)) {
    if (!part) continue;
    const n = Number(part.replace(/_/g, ''));
    if (Number.isInteger(n) && n >= 1 && n <= max) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** Like parseIntList but keeps the user's order (duplicates removed). */
export function parseIntListOrdered(text: string, max = Infinity): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const n = Number(part);
    if (part && Number.isInteger(n) && n >= 1 && n <= max && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}
