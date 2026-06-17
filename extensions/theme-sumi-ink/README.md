# Sumi Ink

A serene East-Asian ink wash theme: flowing grays on warm washi paper with a single vermillion seal-stamp accent.

## What it does

Sumi Ink dresses the whole app in the look of a traditional ink wash painting. Light mode is warm rice paper; dark mode is moonlit ink. Borders are kept brushstroke-thin, a single seal-stamp color carries the accents, and an ink wash brushwork artwork sits softly behind the workspace. It pairs a serif interface typeface with several alternates, so the app reads more like a calm sheet of paper than a dashboard.

## Where it shows up

Appears in Settings > Appearance as a selectable theme. Once applied, its options live in the theme's settings. It ships matched light and dark variants, so it follows whichever appearance mode you use.

## How to use it

1. Open Settings > Appearance.
2. Select Sumi Ink from the theme list.
3. Open the theme's options to set the seal color, ink density, brush weight, and interface font.

## Settings

- **Show brushwork**: Turns the ink wash brushwork artwork behind the workspace on or off.
- **Ink density**: How strongly the brushwork shows through, from faint to full. Shown only when brushwork is on.
- **Seal stamp**: The accent color used across the app. Choose Vermillion, Indigo, or Gold.
- **Brush weight**: How bold borders and strokes appear, from Hairline to Fine to Bold.
- **Font**: The typeface for the whole interface. Choose Spectral, Cormorant Garamond, Frank Ruhl Libre, Marcellus, or Mulish. All options load automatically.

## Permissions

- **themes.provide**: Lets the extension add the Sumi Ink theme you can apply in Settings.

## How it's built

A pure theme contribution: one entry under `contributes.themes` with no entry script. It defines the palette through a `tokens` map (`background.app`, `surface.*`, `color.*`), each token carrying paired `light`/`dark` values. Theme-specific look is tuned with `variables` (for example `--bubble-radius`, `--composer-shadow`, `--selection`) and translucent surfaces composed with `color-mix` plus backdrop blur (`surface.assistant`, `surface.composer`).

Typography ships through `font.ui`/`font.mono` with a `font.google` string that preloads Spectral, Cormorant Garamond, Frank Ruhl Libre, Marcellus, Mulish, and JetBrains Mono, so the font setting can switch faces without extra loading.

The light and dark brushwork images are wired via `assets.backgroundImageLight`/`backgroundImageDark`. User options are a JSON Schema under `settings.schema`, where each property uses `x-msty-theme` bindings to write CSS variables live: `showBackground` toggles `--app-background-image`, `inkDensity` (an `x-msty-control: slider`, gated by `x-msty-visibleWhen: showBackground`) drives `--app-background-opacity`, and the segmented `sealColor` and `brushWeight` controls remap `--primary`/`--ring`/`--selection` and the border/shadow variables. No code runs at runtime; the host applies the tokens, variables, and bindings directly.
