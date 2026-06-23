# Bonsai

A cultivated origami garden for the workspace — the **premium sibling to Boreal**. Same green heart (oklch hue ~158), lifted to something quietly expensive: hand-folded paper bonsai, jade-and-moss surfaces, gilded leaf veins, editorial Fraunces type, frosted porcelain panels, and layered shadows.

- **Dark mode** — lacquered moss and obsidian, a single warm lantern glow, gold filigree along the folds.
- **Light mode** — sun-warm rice paper and porcelain, soft jade and sage, restrained gold-leaf accents.

Built as a theme-contributing extension (pure data, no entry script). Mirrors the structure of `theme-ember-atelier` / `theme-rosewood`.

## Settings
- **Garden** — toggle the origami background artwork (light/dark).
- **Garden depth** — how strongly the backdrop shows through.
- **Leaf metal** — Jade (default) / Gold / Moss; re-casts the primary accent, ring, and selection.
- **Lantern glow** — warmth + weight of light on composer/buttons/bubbles.
- **Typeface** — Fraunces (signature editorial) / Spline Sans / Geist / Newsreader / Cormorant Garamond.
- **Code typeface** — Geist Mono / JetBrains Mono.

## Background artwork
Placeholder JPGs ship in `static/` (tiny, valid). Generate the real 16:10 backgrounds from the **Bonsai** prompts in [`../THEME_IMAGE_PROMPTS.md`](../THEME_IMAGE_PROMPTS.md) and replace:
- `static/bonsai-light.jpg`
- `static/bonsai-dark.jpg`

Keep filenames. Host injects `--app-background-image: url(dataurl)` + `--app-background-size: cover`.

## Tokens
Boreal green base (hue ~158) retuned for premium contrast. Full `color.*` / `surface.*` / `font.*` / `radius.*` token set, layered `--*-shadow` variables, frosted `surface.assistant` / `surface.composer` via `color-mix()`. See `manifest.json`.
