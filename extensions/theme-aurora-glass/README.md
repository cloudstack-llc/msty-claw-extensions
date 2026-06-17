# Aurora Glass

A frosted-glass theme that floats translucent chrome over a slow aurora gradient.

## What it does

Aurora Glass reskins the whole app with deep-blue, glassy surfaces layered over an aurora background image. The sidebar, composer, and assistant panels are translucent with a backdrop blur, so the aurora glows through them. It ships a northern-night dark mode and an icy frosted-day light mode, and it adds live controls so you can dial in the frost, the aurora's brightness, the accent hue, the corner shape, and the interface font without touching any other settings.

## Where it shows up

Appears in Settings > Appearance as a selectable theme called Aurora Glass. Once applied, its controls live in the theme's own settings panel ("Aurora Glass options").

## How to use it

1. Open Settings > Appearance and select Aurora Glass.
2. Open the theme's options to adjust it live:
   - Show the aurora: turn the aurora background image on or off.
   - Aurora strength: how bright the aurora shows through (only when the aurora is on).
   - Frost: how much backdrop blur sits on the sidebar and title bar.
   - Glass tint: the accent and selection hue (Aurora, Ice, or Rose).
   - Accent glow: how brightly the glass catches the accent light around the composer, buttons, and bubbles.
   - Corner shape: rounding of panels, bubbles, and the composer (Sharp, Soft, or Round).
   - Font: the typeface for the whole interface. All options load automatically.

Dark and light variants are chosen automatically to match your app appearance.

## Settings

- Show the aurora: toggles the aurora background image on or off.
- Aurora strength: sets the aurora's opacity from 0 to 100. Hidden when the aurora is off.
- Frost: backdrop blur on the sidebar and title bar, from 0 to 36 px.
- Glass tint: picks the accent and selection color: Aurora (blue), Ice (teal), or Rose (pink).
- Accent glow: from 0 to 10, controls how strongly the accent color glows in the shadows around the composer, buttons, message bubbles, assistant panels, and popovers.
- Corner shape: Sharp, Soft, or Round rounding for panels, bubbles, and the composer.
- Font: the interface typeface: Outfit, Spectral, Cormorant Garamond, Marcellus, or Sora.

## Permissions

- `themes.provide`: lets the extension register the Aurora Glass theme so you can apply it in Settings.

## How it's built

This is a theme-only extension. There is no entry script: everything is declared in `manifest.json` under `contributes.themes`, so all behavior is data, not code.

The single theme entry (`id: aurora_glass`) defines:

- `tokens`: the app's design tokens, most with separate `dark` and `light` values (for example `background.app`, `surface.sidebar`, `color.primary`). The translucent look comes from `rgba(...)` surface fills paired with backdrop tokens like `surface.sidebar.backdrop`, `surface.assistant.backdrop`, and `surface.composer.backdrop` (each a `blur(...) saturate(...)` filter). Several surfaces use `color-mix(in oklch, ...)` to derive translucent fills and borders from `--card` and `--border`.
- `font.google`: declares the Google Fonts to fetch (Outfit, Spectral, Cormorant Garamond, Marcellus, Sora, JetBrains Mono with their weights), so every font option in settings is available without manual installation.
- `variables`: raw CSS custom properties the app reads directly, such as `--composer-radius`, `--bubble-radius`, `--composer-shadow`, and `--selection`, some split into `dark`/`light` values.
- `assets`: `backgroundImageDark` and `backgroundImageLight` point at the bundled aurora images in `static/`.
- `settings`: a JSON Schema whose properties drive the live controls. Each property binds to CSS variables through `x-msty-theme`, using three patterns:
  - Static value maps via `values` keyed by the chosen enum or boolean (for example `tint` writing `--primary`, `--ring`, and `--selection`, and `corners` writing `--radius` and the per-surface radius variables).
  - Computed values via `value` with a `{{value}}` placeholder, so a slider feeds a `calc(...)` or `color-mix(...)` expression (for example `frost` writing `--sidebar-backdrop` and `glow` writing the shadow variables).
  - A `{{backgroundImage}}` placeholder used by `showBackground` to swap `--app-background-image` between the bundled image and `none`.
- Control and ordering hints (`x-msty-control` of `slider` or `segmented`, `x-msty-order`, `x-msty-enum-labels`) shape the settings UI, and `x-msty-visibleWhen: "showBackground"` hides Aurora strength when the aurora is off.

The extension is signed: `META-INF/` holds the author certificate and signature, and `static/icon.svg` is the listing icon.
