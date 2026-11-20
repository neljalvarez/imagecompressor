import { zipSync, strToU8 } from 'fflate';
import type { Experiment, OriginalImage } from './types';
import { extFor, formatName } from './format';

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const slug = (s: string) => s.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'image';

export function experimentSlug(e: Experiment) {
  return `exp-${e.letter}_q${e.quality}_${formatName(e.mime).toLowerCase()}`;
}

export function snapshotFilename(original: OriginalImage, e: Experiment, iteration: number, isFinal = false) {
  const it = String(iteration).padStart(String(e.iterations).length, '0');
  return `${slug(original.name)}_${experimentSlug(e)}_iter-${it}${isFinal ? '_final' : ''}.${extFor(e.mime)}`;
}

/** Long-format CSV. Every number comes from the engine's measurements; unmeasured PSNR is left blank. */
export function statsCsv(original: OriginalImage, experiments: Experiment[]): string {
  const rows: string[] = [
    'experiment,quality,format,iteration,file_size_bytes,size_change_vs_original_pct,psnr_db,fixed_point',
  ];
  for (const e of experiments) {
    const psnrAt = new Map(e.psnr);
    const fmt = formatName(e.mime);
    rows.push([e.letter, e.quality, fmt, 0, original.size, '0.000', 'inf', ''].join(','));
    e.sizes.forEach((size, idx) => {
      const it = idx + 1;
      const change = ((size - original.size) / original.size) * 100;
      const p = psnrAt.get(it);
      const psnr = p === undefined ? '' : p === Infinity ? 'inf' : p.toFixed(4);
      const fixed = e.stableSince !== null && it >= e.stableSince ? 'true' : 'false';
      rows.push([e.letter, e.quality, fmt, it, size, change.toFixed(3), psnr, fixed].join(','));
    });
  }
  return rows.join('\n') + '\n';
}

export function downloadCsv(original: OriginalImage, experiments: Experiment[], name?: string) {
  const csv = statsCsv(original, experiments);
  const base = name ?? `${slug(original.name)}_compression-stats`;
  saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${base}.csv`);
}

export async function downloadZip(original: OriginalImage, experiments: Experiment[]) {
  const files: Record<string, Uint8Array> = {};
  const origExt = original.format === 'PNG' ? 'png' : original.format === 'WebP' ? 'webp' : 'jpg';
  files[`00_original_${slug(original.name)}.${origExt}`] = new Uint8Array(await original.blob.arrayBuffer());
  for (const e of experiments) {
    const folder = experimentSlug(e);
    for (const s of e.snapshots) {
      const isFinal = s.iteration === e.finalIteration;
      files[`${folder}/${snapshotFilename(original, e, s.iteration, isFinal)}`] = new Uint8Array(await s.blob.arrayBuffer());
    }
  }
  files['compression-stats.csv'] = strToU8(statsCsv(original, experiments));
  // Images are already compressed; store them as-is (level 0) so the ZIP is fast and byte-exact.
  const zipped = zipSync(files, { level: 0 });
  saveBlob(new Blob([zipped as BlobPart], { type: 'application/zip' }), `${slug(original.name)}_compression-snapshots.zip`);
}
