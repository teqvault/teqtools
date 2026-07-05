# teqxus.com — TeqVault Tools

The official tools hub for **Teq Vault LLC**, hosted at [teqxus.com](https://teqxus.com).

This repo powers the landing page and hosts standalone utilities built alongside our games. Every tool here runs offline, requires no account, and is free to use.

---

## Structure

```
teqtools/
├── index.html          # Tools hub landing page (teqxus.com)
├── TeqSlice/           # Image slicing PWA (teqxus.com/TeqSlice)
│   ├── index.html
│   ├── jszip.min.js
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── icon-192.png
│   └── icon-512.png
├── CNAME               # teqxus.com
└── README.md
```

---

## Tools

| Tool | Status | URL |
|---|---|---|
| **TeqSlice** | ✅ Live | [teqxus.com/TeqSlice](https://teqxus.com/TeqSlice) |
| **TeqXus AI** | ✅ Live | [teqxus.app](https://teqxus.app) |
| **TeqDocs** | ✅ Live | [teqxus.app/teqdocs](https://teqxus.app/teqdocs) |
| **TeqCarve** | ✅ Live | GitHub Releases |
| **TeqStudy** | ✅ Live | [teqvault.study](https://teqvault.study) |
| **TeqDocs Military** | 🔧 In Development | — |

---

## TeqSlice

A Photoshop-style image slicing tool that runs entirely in the browser with no installation required.

**Features:**
- Draw slices manually or grid-cut sprite sheets in one step
- Uniform tile mode — equal-sized frames, remainder trimmed cleanly at edges
- Divide slice into rows/columns by count or pixel size
- Guides: drag from rulers, snap-to-grid, "Slices from guides" auto-builds the grid
- Resize image (with aspect lock) and Canvas size (crop/expand with 9-point anchor) — both undoable
- Export formats: PNG, JPEG, WebP, TGA, BMP, TIFF, ICO, AVIF (where supported)
- Bulk export straight into a folder you pick (File System Access API) or as a ZIP
- Exports create their own subfolder named after the source image
- Default filename pattern: `{img}_{i}` (e.g. `sharpening_01.png`)
- Tokens: `{img}` `{name}` `{i}` `{x}` `{y}` `{w}` `{h}` — use `/` for subfolders
- Scale 0.5× – 4×, quality slider for lossy formats
- Optional `slices.json` export with all rects (Unity importer friendly)
- Save/load project as `.teqslice.json` (embeds image + slices + guides)
- Full undo/redo including image operations
- Installable as a PWA — works fully offline after first visit
- Pixelated zoom toggle for pixel art

**Shortcuts:**
```
V           Slice Select tool
C           Slice tool
H           Hand tool
Space       Hold to pan temporarily
Del         Delete selected slice
Ctrl+Z      Undo
Ctrl+Shift+Z Redo
Ctrl+D      Duplicate slice
Ctrl+S      Save project
Ctrl+O      Open image
Ctrl+E      Export all (folder if supported, ZIP otherwise)
0           Fit to window
1           100% zoom
+ / -       Zoom in / out
Arrows      Nudge slice 1px (Shift = 10px)
Escape      Deselect
```

## Related

- **Studio:** [teqvault.online](https://teqvault.online)
- **AI Platform:** [teqxus.app](https://teqxus.app)
- **IP Universe:** [eyuforyia.com](https://eyuforyia.com)
- **Games:** Quetiemals, Forge & Ruin, Connect 4 — Google Play

---

© Teq Vault LLC · Bossier City, Louisiana