import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, useLab, type Settings } from './lib/useLab';
import type { SourceRef } from './lib/types';
import { parseIntListOrdered } from './lib/format';
import { Uploader } from './components/Uploader';
import { SettingsPanel } from './components/Settings';
import { LiveView } from './components/LiveView';
import { Compare } from './components/Compare';
import { Timeline } from './components/Timeline';
import { Experiments } from './components/Experiments';
import { Charts } from './components/Charts';
import { ExportPanel } from './components/ExportPanel';

function useWebpEncodeSupport() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    c.getContext('2d')!.fillRect(0, 0, 2, 2);
    c.toBlob((b) => setOk(!!b && b.type === 'image/webp'), 'image/webp', 0.5);
  }, []);
  return ok;
}

export default function App() {
  const lab = useLab();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [presenting, setPresenting] = useState(false);
  const [a, setA] = useState<SourceRef>({ kind: 'original' });
  const [b, setB] = useState<SourceRef>({ kind: 'original' });
  const [dragging, setDragging] = useState(false);
  const webp = useWebpEncodeSupport();
  const { original, experiments, active, running } = lab;

  // Follow the active experiment: A = original, B = its latest output.
  useEffect(() => {
    setA({ kind: 'original' });
    setB(lab.activeId ? { kind: 'latest', expId: lab.activeId } : { kind: 'original' });
  }, [lab.activeId]);

  // If a compared source disappears (experiment removed / reset), fall back to the original.
  useEffect(() => {
    if (!original) return;
    const exists = (r: SourceRef) => r.kind === 'original' || experiments.some((e) => e.id === r.expId);
    if (!exists(a)) setA({ kind: 'original' });
    if (!exists(b)) setB({ kind: 'original' });
  }, [experiments, original, a, b]);

  const start = useCallback(() => lab.start(settings), [lab, settings]);
  const runBatch = useCallback(() => lab.runBatch(settings, parseIntListOrdered(settings.batchText, 100)), [lab, settings]);

  // Keyboard shortcuts: P = presentation mode, Esc = leave it, Space = pause/resume.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, select, textarea')) return;
      if (e.key === 'p' || e.key === 'P') setPresenting((p) => !p);
      else if (e.key === 'Escape' && !document.fullscreenElement) setPresenting(false);
      else if (e.key === ' ' && running) {
        e.preventDefault();
        if (running.status === 'paused') lab.resume();
        else lab.pause();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, lab]);

  // Accept a dropped image anywhere on the page (when not mid-experiment).
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer?.files?.[0];
      if (f && !lab.isBusy) lab.loadImage(f);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [lab]);

  const paused = running?.status === 'paused';
  const liveExp = running ?? active;

  return (
    <div className={`app ${presenting ? 'presenting' : ''}`}>
      <header className="topbar">
        <div>
          <h1>Image Compression Lab</h1>
          <p className="muted">Re-encode an image again and again and watch what's lost. Everything runs in your browser.</p>
        </div>
        <button type="button" onClick={() => setPresenting(true)} disabled={!original} data-testid="btn-present">
          Presentation mode <kbd>P</kbd>
        </button>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <Uploader original={original} error={lab.loadError} disabled={lab.isBusy} onFile={lab.loadImage} onClear={lab.clearImage} />
          <SettingsPanel
            settings={settings}
            onChange={setSettings}
            webpSupported={webp}
            hasImage={!!original}
            running={running}
            isBusy={lab.isBusy}
            hasResults={experiments.length > 0}
            onStart={start}
            onPause={lab.pause}
            onResume={lab.resume}
            onStop={lab.stop}
            onReset={lab.reset}
            onRunBatch={runBatch}
          />
        </aside>

        <main className="main">
          {!original ? (
            <section className="card empty">
              <h2>Start by adding an image</h2>
              <p className="muted">
                Each compression decodes the previous result and encodes it again with your browser's real JPEG or WebP encoder:
                Original → 1 → 2 → 3 → … → N. The original is never re-used and stays untouched as the reference.
              </p>
            </section>
          ) : (
            <>
              <LiveView original={original} exp={liveExp} presenting={presenting} />
              <Compare original={original} experiments={experiments} a={a} b={b} setA={setA} setB={setB} presenting={presenting} />
              {active && <Timeline original={original} exp={active} a={a} b={b} setA={setA} setB={setB} />}
              <Experiments
                original={original}
                experiments={experiments}
                activeId={lab.activeId}
                onSelect={lab.setActiveId}
                onRemove={lab.removeExperiment}
                presenting={presenting}
              />
              <Charts original={original} experiments={experiments} />
              {!presenting && <ExportPanel original={original} experiments={experiments} active={active} />}
            </>
          )}
        </main>
      </div>

      {presenting && (
        <div className="present-bar" data-testid="present-bar">
          <button type="button" className="primary" disabled={!original || lab.isBusy} onClick={start}>Start</button>
          <button type="button" disabled={!running || paused} onClick={lab.pause}>Pause</button>
          <button type="button" disabled={!running || !paused} onClick={lab.resume}>Resume</button>
          <button type="button" disabled={!running} onClick={lab.stop}>Stop</button>
          <button type="button" onClick={() => setPresenting(false)} data-testid="btn-exit-present">Exit <kbd>Esc</kbd></button>
        </div>
      )}

      {dragging && !lab.isBusy && <div className="drop-overlay">Drop image to load it</div>}
    </div>
  );
}
