# TeqSlice — standalone image slicing tool (PWA)

A Photoshop-style Slice tool in a single offline web app.

## Run it
- **Quick**: open `index.html` in a browser (keep `jszip.min.js` beside it for ZIP export).
- **As an installable PWA**: host the folder over https (GitHub Pages works),
  open once, then "Install app". The service worker caches everything for offline use.

## Features
- Slice tool (C): drag to draw slices; Shift = square
- Slice Select (V): move, resize via 8 handles
- Hand (H) / hold Space to pan; wheel zooms at cursor
- Rulers → drag out guides; drag to move, double-click to delete;
  "Slices from guides" builds the full grid
- Grid slice: by row/column count, or by tile size with offset + spacing (sprite sheets)
- Divide slice: split selection into rows/columns by count or pixel size
- Snap to image edges, other slices, and guides
- Numbered badges (row-major like PS), dimmed non-slice area, pixelated zoom
- Rename slices, per-slice format override
- **Export destinations**: straight into a folder you pick (File System Access API,
  Chrome/Edge), a ZIP, or single-file download
- **Formats**: PNG, JPEG, WebP, BMP (32-bit + alpha), TGA (32-bit, game-engine friendly),
  TIFF (uncompressed RGBA), ICO (auto-fit to 256), and AVIF where the browser can encode it
- Scale 0.5–4×, quality slider, filename pattern tokens {img} {name} {i} {x} {y} {w} {h} (default: {img}_{i}); bulk exports go into a folder named after the source image
  — use `/` in the pattern to create subfolders (e.g. `tiles/{name}`)
- Optional slices.json with all rects (handy for Unity importers)
- Save/Load project (.teqslice.json — embeds image, slices, guides), uses the
  native save dialog when available
- Undo/redo, arrow-key nudge, duplicate, paste/drag-drop images

## Shortcuts
V / C / H tools · Space pan · Del delete · Ctrl+Z / Ctrl+Shift+Z undo/redo ·
Ctrl+D duplicate · Ctrl+S save project · Ctrl+O open image ·
Ctrl+E export all (folder if supported, else ZIP) ·
0 fit · 1 100% · +/- zoom · arrows nudge (Shift = 10px)
