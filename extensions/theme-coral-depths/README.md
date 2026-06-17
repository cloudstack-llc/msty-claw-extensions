# Coral Depths

A bioluminescent reef theme: living coral pink over deep ocean teal, with a deep-sea dark mode and a shallow-reef turquoise light mode.

## What it does

Coral Depths repaints the whole app as a reef at midnight. Living coral pink glows against deep ocean teal, with organic rounded shapes and soft frosted surfaces for the sidebar, composer, and message area. Dark mode dives into deep-sea teal; light mode rises to a shallow-reef turquoise. Reef artwork sits behind the workspace, and you can pick the accent creature, dial the glow, soften the corners, and choose a rounded display font.

## Where it shows up

Appears in Settings > Appearance as a selectable theme. Its options are in the theme's settings.

## How to use it

1. Open Settings > Appearance.
2. Select Coral Depths.
3. Adjust the theme's options to taste (see Settings below).

The theme follows your light or dark mode preference automatically.

## Settings

- Show reef: turns the living reef artwork behind the workspace on or off.
- Reef depth: how strongly the reef artwork shows through the water (0 to 100). Only applies when Show reef is on.
- Reef accent: the living color threading through the reef. Choose Coral (pink), Anemone (green), or Jellyfish (purple). Sets the primary, focus ring, and selection color.
- Bioluminescence: the living glow on buttons, pills, the composer, and message bubbles. Choose Off, Subtle, or Radiant.
- Current: how rounded every edge is, from coral-cut to wave-worn. Choose Reef (sharper), Soft, or Tide (most rounded).
- Font: the typeface for the whole interface. Choose Quicksand, Nunito, Varela Round, Comfortaa, or Baloo 2. All options load automatically.

## Permissions

- themes.provide: lets the extension add the Coral Depths theme you can apply in Settings.

## How it's built

A pure theme contribution. There is no entry script: everything lives in `manifest.json` under `contributes.themes[0]`.

- `tokens` maps the app's theme tokens, most with paired `light`/`dark` values (for example `background.app`, `color.primary`, `surface.sidebar`). Frosted surfaces come from `surface.*.backdrop` blur/saturate values plus `color-mix(...)` translucent fills for the sidebar, assistant area, and composer. `radius.control` sets the base corner rounding.
- `variables` declares raw CSS custom properties the tokens build on, such as `--composer-radius`, `--bubble-radius`, `--selection`, `--composer-shadow`, and `--button-shadow`, several with `light`/`dark` variants.
- `assets.backgroundImageLight` / `backgroundImageDark` provide the reef artwork in `static/`, surfaced to settings via the `{{backgroundImage}}` placeholder.
- `font.ui` and `font.mono` set the interface and monospace stacks; `font.google` lists every selectable family (Quicksand, Nunito, Varela Round, Comfortaa, Baloo 2, plus JetBrains Mono) so they load on demand.
- `settings.schema` drives the options panel. Each property uses `x-msty-theme` to bind a value to a CSS variable, so changing a setting rewrites variables live. Notable patterns: `x-msty-control` picks the widget (`slider`, `segmented`); `x-msty-visibleWhen: "showBackground"` hides Reef depth until the reef is on; `x-msty-enum-labels` gives friendly option names; and templated values such as `calc({{value}} / 100)` and `{{backgroundImage}}` compute from the chosen input. Bioluminescence and Reef accent layer `color-mix(in srgb, var(--primary) ...)` glows so the accent color flows through buttons, pills, bubbles, and the composer.
