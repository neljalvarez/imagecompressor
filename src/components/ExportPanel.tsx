import { useState } from 'react';
import type { Experiment, OriginalImage } from '../lib/types';
import { downloadCsv, downloadZip, experimentSlug, saveBlob, snapshotFilename } from '../lib/download';
import { fmtInt } from '../lib/format';

interface Props {
  original: OriginalImage;
  experiments: Experiment[];
  active: Experiment | null;
}

export function ExportPanel({ original, experiments, active }: Props) {
  const [zipping, setZipping] = useState(false);
  const finished = experiments.filter((e) => e.finalIteration != null);
  const activeFinal = active?.finalIteration != null ? active.snapshots.find((s) => s.iteration === active.finalIteration) : undefined;
  const snapshotCount = experiments.reduce((n, e) => n + e.snapshots.length, 0);

  return (
    <section className="card" data-testid="export">
      <h2>Export</h2>
      <div className="export-grid">
        <button
          type="button"
          disabled={!activeFinal}
          data-testid="dl-final"
          onClick={() => active && activeFinal && saveBlob(activeFinal.blob, snapshotFilename(original, active, activeFinal.iteration, true))}
        >
          Final image{active ? ` (${active.letter} · Q${active.quality})` : ''}
        </button>
        <button
          type="button"
          disabled={snapshotCount === 0 || zipping}
          data-testid="dl-zip"
          onClick={async () => {
            setZipping(true);
            try {
              await downloadZip(original, experiments);
            } finally {
              setZipping(false);
            }
          }}
        >
          {zipping ? 'Building ZIP…' : `All snapshots as ZIP (${fmtInt(snapshotCount)} images + CSV)`}
        </button>
        <button type="button" disabled={finished.length === 0} data-testid="dl-csv" onClick={() => downloadCsv(original, finished)}>
          Statistics CSV (all finished experiments)
        </button>
        <button
          type="button"
          disabled={!active || active.finalIteration == null}
          data-testid="dl-csv-active"
          onClick={() => active && downloadCsv(original, [active], `${experimentSlug(active)}_stats`)}
        >
          Statistics CSV{active ? ` (${active.letter} only)` : ''}
        </button>
      </div>
      <p className="muted small">Individual snapshots download from the ↓ button on each timeline card. File names include the experiment, quality and iteration.</p>
    </section>
  );
}
