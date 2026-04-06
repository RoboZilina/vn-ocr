# VN OCR — Public Version ⚡

Free, browser-only Japanese OCR for Visual Novels. No install, no backend, works anywhere.

## Features
- **Adaptive thresholding** (Otsu's algorithm — finds optimal contrast automatically)
- **Denoising** (3×3 median blur to remove JPEG/screen-capture artifacts)
- **Zoom slider** (1×–4× upscaling before OCR)
- **Language selector** (horizontal `jpn` or vertical `jpn_vert`)
- **History** with automatic clipboard copy

## Hosting
Just upload the 3 files to any web host:
- `index.html`
- `styles.css`
- `app.js`

Works on GitHub Pages, Netlify, itch.io, or any ISP static hosting.

## Preprocessing Modes

| Mode | Best For |
|---|---|
| 🎯 Adaptive (Recommended) | Most VNs — auto-detects optimal threshold |
| ⬛ High Contrast | Pure dark text on white/light backgrounds |
| 🔲 Grayscale + Upscale | Anti-aliased or colored fonts |
| 📷 Raw | Testing/debugging — no processing |

## Tips
- Start with **Adaptive** mode — it handles 80% of cases automatically
- Use **Zoom 3×** or **4×** for very small text
- Switch to `jpn_vert` for vertically written text boxes
- The debug thumbnail (next to Re-Capture) shows the exact image sent to OCR
