# Manga Vibe

A high-contrast ink-and-paper theme that makes the app look like a page torn from a manga panel.

## What it does

Manga Vibe restyles the whole app with bold inked borders, a single red spot color, halftone screentone, and converging speed-line artwork. Light mode reads as black ink on paper; dark mode shifts to a dramatic night-panel look with a red glow. Buttons, bubbles, and the composer carry hard offset "ink" shadows so controls feel stamped onto the page. It is a full theme, so you can also tune the artwork, ink intensity, panel corners, and typeface to dial the comic-book feel up or down.

## Where it shows up

Appears in Settings > Appearance as a selectable theme. Once applied, its options (artwork, ink style, panel corners, font) live in the theme's settings.

## How to use it

1. Open Settings > Appearance.
2. Choose Manga Vibe.
3. Adjust its options below the theme to taste. It works in both light and dark mode, so it follows your app's light/dark preference automatically.

## Settings

- Show panel artwork: Toggles the screentone and speed-line artwork behind the app. Turn it off for a plain inked surface.
- Artwork strength: How strongly the panel artwork blends into the workspace, from subtle to prominent. Only applies when artwork is shown.
- Ink style: How forcefully controls and bubbles carry the manga ink treatment. Clean removes the offset shadows, Bold is the default stamped look, and Dramatic pushes the shadows and sharpens the pills further.
- Font: The typeface for the whole interface. Choose from Figtree, Space Grotesk, Anton, Comic Neue, or Architects Daughter. All options load automatically.
- Panel corners: Square off panels for hard manga gutters (Sharp), keep the default framed corners (Framed), or soften everything into rounded frames (Rounded).

## Permissions

- `themes.provide`: Lets the extension add the Manga Vibe theme you can apply in Settings.

## How it's built

Theme-only extension: no entry script, just a single `themes` contribution in `manifest.json` (`id: manga_vibe`).

- Color and surface tokens are defined under `tokens`, each with paired `light`/`dark` values that map to the app's theme variables (for example `background.app`, `surface.sidebar`, `color.primary`, `color.ring`). Glassy surfaces use `color-mix(...)` and `backdrop` blur tokens (`surface.assistant`, `surface.composer`).
- The signature inked look comes from custom CSS variables under `variables` (`--button-shadow`, `--pill-shadow`, `--composer-shadow`, `--bubble-shadow`, and their focus/radius siblings), again light/dark paired, using hard `Npx Npx 0 0` offset shadows in ink black or red.
- `assets.backgroundImageLight` / `backgroundImageDark` point at the screentone and speed-line panel art in `static/`.
- Fonts are declared in `font.google`, which preloads Figtree, Space Grotesk, Anton, Comic Neue, Architects Daughter, and JetBrains Mono so the font picker can switch typefaces without a manual install.
- The `settings.schema` is plain JSON Schema with Msty `x-msty-*` extensions for the live controls. Each option binds to a CSS variable via `x-msty-theme` (single binding or an array): `showBackground` swaps `--app-background-image` / `--app-bg-overlay`, `imageStrength` drives `--app-background-opacity` through a `calc({{value}} / 100)` template, `inkStyle` rewrites the shadow and `--pill-radius` variables, `uiFont` sets `--font-sans`, and `panelCorners` sets `--radius`, `--composer-radius`, and `--bubble-radius`. `x-msty-control` picks the editor widget (`slider`, `segmented`), `x-msty-order` orders the fields, `x-msty-enum-labels` provides friendly enum names, and `x-msty-visibleWhen` hides Artwork strength unless Show panel artwork is on.
