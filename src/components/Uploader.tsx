import { useRef, useState } from 'react';
import type { OriginalImage } from '../lib/types';
import { formatBytes, fmtInt } from '../lib/format';

const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

interface Props {
  original: OriginalImage | null;
  error: string | null;
  disabled: boolean;
  onFile: (f: File) => void;
  onClear: () => void;
}

export function Uploader({ original, error, disabled, onFile, onClear }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(f);
  };

  return (
    <section className="card">
      <h2>1 · Image</h2>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        hidden
        data-testid="file-input"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = '';
        }}
      />
      {!original ? (
        <button
          type="button"
          className={`dropzone ${over ? 'over' : ''}`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOver(false);
            pick(e.dataTransfer.files);
          }}
        >
          <strong>Drop an image here</strong>
          <span>or click to choose · JPG, PNG, WebP</span>
        </button>
      ) : (
        <div className="original-info">
          <img src={original.url} alt="Original" className="thumb" />
          <dl className="kv">
            <dt>File</dt>
            <dd title={original.name} className="ellipsis">{original.name}</dd>
            <dt>Resolution</dt>
            <dd data-testid="orig-resolution">{fmtInt(original.width)} × {fmtInt(original.height)}</dd>
            <dt>File size</dt>
            <dd data-testid="orig-size">{formatBytes(original.size)}</dd>
            <dt>Format</dt>
            <dd data-testid="orig-format">{original.format}{original.hasAlpha ? ' (transparent)' : ''}</dd>
          </dl>
          <div className="row">
            <button type="button" disabled={disabled} onClick={() => input.current?.click()}>Replace</button>
            <button type="button" disabled={disabled} onClick={onClear}>Remove</button>
          </div>
          {original.hasAlpha && (
            <p className="note">Transparent areas are flattened onto white, since JPEG has no alpha channel. The flattened image is the reference for all measurements.</p>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
