# Terracotta Dusk

A warm desert theme of sun-baked canyon walls at golden hour, with terracotta, burnt sienna, and sagebrush greens.

## What it does

Terracotta Dusk repaints the whole app in earthy, sun-warmed colors. It ships both a canyon-shadow dark mode and a sun-washed adobe light mode, with a sandstone canyon-wall image set behind the workspace. You can dial the warmth of the surfaces, pick which accent stone tints the highlights, soften or strengthen the background art, and switch the interface typeface. It is for anyone who wants a calm, low-glare workspace with a warm earth-tone feel instead of the default look.

## Where it shows up

Appears in Settings > Appearance as a selectable theme. Once applied, its options are in the theme's settings.

## How to use it

1. Open Settings > Appearance and choose Terracotta Dusk.
2. The theme follows your light or dark mode automatically.
3. Open the theme's options to adjust the background, accent color, warmth, and font.

## Settings

- Show canyon: toggles the sun-baked canyon-wall artwork behind the workspace on or off.
- Canyon depth: how strongly the canyon walls show through (0 to 100). Only available when the canyon is shown.
- Accent stone: the accent color that runs through highlights, focus rings, and selection. Choose Copper, Turquoise, or Sandstone.
- Warmth: how sun-baked the surfaces feel (0 to 10). Higher values blend more of the accent color into the composer, assistant bubbles, borders, and shadows.
- Font: the typeface for the whole interface. Choose Mulish, Fraunces, Source Serif, Space Grotesk, or Bitter. All options load automatically.

## Permissions

- themes.provide: lets the extension add Terracotta Dusk to the theme list so you can apply it in Settings.

## How it's built

This is a theme-only extension with no runtime code. It contributes a single entry under `contributes.themes` and declares the `themes.provide` permission.

The theme maps app color tokens (`background.app`, `surface.*`, `color.text`, `color.primary`, semantic `color.success`/`warning`/`info`/`destructive`, and friends) with paired `light`/`dark` values, plus structural `variables` such as `--composer-radius`, `--bubble-radius`, and themed shadows. It sets `font.ui` and `font.mono` and uses `font.google` to preload the full family list (Mulish, Fraunces, Source Serif 4, Space Grotesk, Bitter, JetBrains Mono) so the font picker can switch instantly. Background art is wired through `assets.backgroundImageLight` / `assets.backgroundImageDark` (`static/terracotta-dusk-light.jpg` and `terracotta-dusk-dark.jpg`), with `static/terracotta-dusk-dark.jpg` also used as the `previewImage`.

The interactive options live in `settings.schema` and bind to CSS variables through `x-msty-theme`. Notable patterns:

- `showBackground` drives `--app-background-image` using the `{{backgroundImage}}` placeholder and clears `--app-bg-overlay` when off.
- `canyonStrength` uses `x-msty-control: "slider"` and `x-msty-visibleWhen: "showBackground"` so it only appears when the canyon is on, writing `--app-background-opacity` via `calc({{value}} / 100)`.
- `accentStone` is a segmented control that rewrites `--primary`, `--ring`, and `--selection` together for each stone.
- `warmth` fans a single slider value out across many variables using `color-mix(in oklch, ...)` and `color-mix(in srgb, ...)` with `calc({{value}} * N%)` to tint composer, assistant, border, and shadow surfaces.
- `uiFont` swaps `--font-sans` between the preloaded families.
