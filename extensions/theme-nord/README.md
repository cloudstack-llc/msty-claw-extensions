# Nord

An arctic, north-bluish theme: cool Polar Night in the dark and clean Snow Storm in the light.

## What it does

Nord recolors the entire app in the Nord palette. In dark mode you get the deep, muted Polar Night blues; in light mode you get the crisp, airy Snow Storm grays. A frost-blue accent runs through buttons, focus rings, and selections, and an arctic background image sits behind the workspace. The sidebar, composer, and assistant panels are softly frosted with a backdrop blur for a calm, cohesive look. You can tune the background, the frost, the corner shape, the accent light, and the interface font to taste.

## Where it shows up

Appears in Settings > Appearance as a selectable theme called Nord. Once applied, its options live in the theme's own settings panel ("Nord options").

## How to use it

1. Open Settings > Appearance and select Nord.
2. The app follows your light/dark mode automatically: Snow Storm in light, Polar Night in dark.
3. Open the theme's options to adjust it live:
   - Show aurora image: turn the arctic background image on or off.
   - Aurora strength: how strongly the arctic image blends into the workspace color (only when the aurora image is on).
   - Frost: how much frosted depth sits on the sidebar (None, Light, or Deep).
   - Corner shape: rounding of panels, bubbles, and the composer (Sharp, Soft, or Round).
   - Accent light: the aurora hue for buttons, focus rings, and selections (Frost, Aurora green, or Aurora purple).
   - Font: the typeface for the whole interface. All options load automatically.

## Settings

- Show aurora image: turns the arctic background image on or off. When off, the workspace falls back to a flat color.
- Aurora strength: blends the arctic image into the workspace color, from 0 (color only) to 100 (full image), in steps of 10. Hidden when the aurora image is off.
- Frost: amount of frosted depth on the sidebar: None, Light, or Deep.
- Corner shape: Sharp, Soft, or Round rounding for panels, message bubbles, the composer, and assistant panels.
- Accent light: the hue that runs through buttons, focus rings, and selections: Frost (blue), Aurora green, or Aurora purple.
- Font: the interface typeface: Inter, Manrope, Work Sans, Spectral, or Space Grotesk. All options load automatically.

## Permissions

- `themes.provide`: lets the extension add the Nord theme so you can apply it in Settings.

## How it's built

This is a declarative, code-free theme. It contributes a single entry (`id: nord`) under `contributes.themes` and ships no entry script, so all behavior is data, not code.

- Tokens: the `tokens` map sets app-wide design tokens, most with separate `dark` (Polar Night) and `light` (Snow Storm) values, for example `background.app`, `surface.sidebar`, `color.primary`, and the status colors (`color.destructive`, `color.success`, `color.warning`, `color.info`). The frosted look comes from `color-mix(in oklch, ...)` surface fills paired with backdrop tokens like `surface.sidebar.backdrop`, `surface.assistant.backdrop`, and `surface.composer.backdrop` (each a `blur(...) saturate(...)` filter). Several single-value tokens derive from `var(--card)` and `var(--border)` so the translucent sidebar, assistant, and composer surfaces stay consistent across both modes.
- Fonts: `font.ui` and `font.mono` set the default stacks, and `font.google` lists every selectable family (Inter, Manrope, Work Sans, Spectral, Space Grotesk, JetBrains Mono with their weights) so the host loads them automatically.
- Assets: `assets.backgroundImageDark` points at the bundled arctic image in `static/nord.jpg`, `assets.backgroundImageLight` points at the lighter Snow Storm image in `static/nord-light.jpg`, and `previewImage` (also `static/nord.jpg`) is the thumbnail shown in the theme list. The listing icon is `static/nord-dark.svg`.
- Settings bindings: the `settings.schema` drives the in-app controls. Each property uses `x-msty-*` extensions to bind a setting to one or more CSS variables. `x-msty-control` chooses the widget (`slider`, `segmented`), `x-msty-order` orders the fields, `x-msty-enum-labels` provides the display labels, and `x-msty-visibleWhen: "showBackground"` hides Aurora strength while the background is off. `x-msty-theme` is the binding itself, supporting three patterns:
  - A templated single `value` with a `{{value}}` placeholder, so the Aurora strength slider feeds `calc({{value}} / 100)` into `--app-background-opacity`.
  - A `values` map keyed by the selected enum or boolean, which is how Frost writes `--sidebar-backdrop`, Corner shape writes `--radius`, `--composer-radius`, `--bubble-radius`, and `--assistant-radius` together, and Accent light writes `--primary`, `--ring`, and `--selection` together.
  - The `{{backgroundImage}}` placeholder used by Show aurora image to swap `--app-background-image` between the bundled image and `none`, alongside clearing `--app-bg-overlay`.
- The extension is signed: `META-INF/` holds the author certificate and signature.
