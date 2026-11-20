# Image Compression Lab

A browser-only lab for the YouTube experiment **"I Compressed an Image 1,000 Times."**
Upload an image, choose a quality and a number of compressions (1–10,000), and watch generation loss happen live. Every number on screen is measured from the real encoded files and pixels.

No backend, no paid APIs. It's built with React, TypeScript and Vite and deploys to Vercel's free tier as a static site.

## How the engine works

```
Original → Compression 1 → Compression 2 → … → Compression N
```

For every cycle, the engine:

1. Encodes the pixels currently on the canvas with the browser's own lossy encoder (`OffscreenCanvas.convertToBlob`, or `canvas.toBlob` as a fallback) at the chosen quality.
2. Decodes those bytes (`createImageBitmap`) and paints them back onto the canvas. That output becomes the input for the next cycle.
3. Records the file's byte size and, when scheduled, the PSNR against the original.

Guarantees:

- **The original is never compressed twice.** Cycle 1 encodes the original and every later cycle encodes the previous output. The original file stays untouched as the reference.
- **Nothing extra touches the pixels.** There is no added noise, blur or resizing, and the canvas always has the original's dimensions.
- **Real encoders only.** If a browser silently swaps formats (Safari returns PNG when asked for WebP), the run stops with an error instead of reporting wrong data, and WebP is disabled in that browser.
- **Stabilisation is kept as it happens.** JPEG re-encoding often reaches a *fixed point* where cycle *n* produces a file byte-identical to cycle *n − 1*. The lab detects this, reports it, marks it in the CSV, and keeps running genuinely. It never makes the image worse to keep the curve moving.
- **Non-blocking.** Runs happen in a Web Worker, so the UI stays responsive at 10,000 iterations. Browsers without Worker + OffscreenCanvas fall back to a cooperative main-thread loop.

Transparent PNG/WebP inputs are flattened onto white first, because JPEG has no alpha channel. That flattened image is the PSNR reference.

## Features

| Area | What you get |
| --- | --- |
| Upload | Drag-and-drop (anywhere on the page) or file picker. JPG, JPEG, PNG and WebP are accepted. Format is detected from the file's bytes, and resolution and size are shown. |
| Settings | Quality 1–100 (slider and number), compressions 1–10,000 with presets (1, 10, 50, 100, 500, 1,000), JPEG or WebP output, custom snapshot iterations, and PSNR sampling. |
| Live view | Current image, iteration, progress bar and %, elapsed time (excluding pauses), current size, change vs original, PSNR, speed and ETA. Buttons: Start, Pause, Resume, Stop and Reset. Space toggles pause. |
| Comparison | Side-by-side, draggable before/after slider, and difference view. The difference view either highlights changed pixels (with a threshold) or amplifies \|A−B\|. Zoom levels are Fit, 100%, 200%, 400% and 800%, synchronised across panes, with scroll-to-zoom, drag-to-pan, a pixel grid at 800%, and a per-pixel RGB readout for A and B. There's also a fullscreen mode. |
| Timeline | Snapshots of the Original, 1, 10, 50, 100, 500 and 1,000 compressions, plus the final one (editable list). Any snapshot from any experiment can be set as A or B. |
| Quality experiments | Queue several qualities (e.g. 90, 50, 10) with the same image and count. Final results appear side by side, labelled by quality. |
| Statistics | File size and PSNR vs compression count as SVG charts, with all experiments overlaid, a log/linear x-axis and hover tooltips. |
| Export | Final image, individual snapshots, a ZIP of all snapshots (plus the original and the CSV), and a CSV of statistics. |
| Presentation mode | Press **P**. Hides the sidebar and settings, enlarges the visuals, and keeps a minimal floating Start/Pause/Resume/Stop bar. **Esc** exits. |

### About the statistics

- **File size** is recorded for **every** iteration.
- **PSNR** is computed over RGB against the original: `10·log10(255² / MSE)`. In *Auto* mode it is measured every ⌈N/1000⌉ iterations, so a 1,000-iteration run is measured every iteration and a 10,000-iteration run every 10. PSNR is always measured at iteration 1, at every snapshot, and at the final iteration. You can also choose "every iteration".
- In the CSV, iterations that weren't measured have an empty `psnr_db` cell. Nothing is interpolated.

CSV columns: `experiment, quality, format, iteration, file_size_bytes, size_change_vs_original_pct, psnr_db, fixed_point`. Row `iteration = 0` is the original.

## Run locally

Requires Node.js 18+ (20 or 22 recommended).

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
npm run preview    # serve the production build
```

## Deploy to Vercel (free)

1. Push this repository to GitHub (already done if you're reading this there).
2. On [vercel.com](https://vercel.com), click **Add New → Project** and import the repository.
3. Vercel detects Vite automatically. The build command is `npm run build` and the output directory is `dist` (also pinned in `vercel.json`).
4. Click **Deploy**.

CLI alternative: `npm i -g vercel && vercel --prod`.

## Project structure

```
src/
  engine/
    core.ts        repeated decode → encode loop, PSNR, pause/resume/stop, fixed-point detection
    worker.ts      Web Worker host (OffscreenCanvas)
    client.ts      starts the worker, falls back to main thread if unsupported
    types.ts       engine message types
  lib/
    useLab.ts      experiment state, queue, settings
    decode.ts      decoded-image cache for the comparison viewer
    download.ts    file names, CSV, ZIP (fflate)
    format.ts      formatting and format sniffing
  components/      Uploader, Settings, LiveView, Compare, ViewPane, Timeline, Experiments, Charts, ExportPanel
```

## Browser support

Recent Chrome, Edge, Firefox and Safari are supported. WebP **encoding** isn't available in Safari, so the WebP option is disabled there automatically. Chromium encodes WebP at quality 100 losslessly, so such a run may show no degradation at all. That is real encoder behaviour, and the lab shows it as it is.

Different browsers ship different JPEG encoders, so the same settings give slightly different (but each genuine) results in Chrome vs Firefox vs Safari. For a video, record all runs in the same browser.

## Verified behaviour

Before release, the build was exercised end-to-end in headless Chrome:

- Snapshots #1 and #10 are **byte-identical** to an independent decode→encode chain run separately in the page, which shows the engine is a true sequential re-encode.
- 1,000 and 10,000-iteration runs completed with a CSV row for every iteration. The final file size in the CSV matches the downloaded file.
- Pause freezes the iteration count and elapsed time, Resume continues, and Stop keeps the last completed iteration as the final snapshot.
- A quality batch (90, 50, 10) ran: lower quality gave smaller files.
- Tested outputs: WebP, a transparent PNG input, a WebP input, and a 12-megapixel (4000×3000) image whose dimensions were kept.
- The comparison modes, zoom levels, pan, slider, pixel readout, and ZIP, CSV and image downloads all worked.
- The main-thread fallback works when Workers/OffscreenCanvas are unavailable.
