# Tokyo Night

A clean dark theme inspired by Tokyo's neon-lit streets at night, with a full daytime color palette for bright rooms.

## What it does

Tokyo Night repaints the whole app in deep indigo with soft blue accents. Dark mode is a rainy night skyline behind the workspace, with frosted glass on the sidebar, composer, and message area; light mode uses a softer painted Tokyo backdrop. You can show or hide the skyline and dial its strength, set how much glassy depth the panels use, pick the neon accent color, soften the corners, and choose the interface font. The theme follows your light or dark mode preference automatically.

## Where it shows up

Appears in Settings > Appearance as a selectable theme. Its options are in the theme's settings.

## How to use it

1. Open Settings > Appearance.
2. Select Tokyo Night.
3. Adjust the theme's options to taste (see Settings below).

The skyline follows the app mode: rainy neon in dark mode and a lighter painted Tokyo scene in light mode.

## Settings

- Show skyline: turns the Tokyo night skyline behind the workspace on or off. Dark mode only.
- Skyline strength: how strongly the skyline shows through the workspace color (0 to 100). Only applies when Show skyline is on.
- City glow: how much glassy depth the sidebar and pop-up panels use. Choose Off, Soft, or Bright.
- Neon accent: the streetlight color that lights up buttons, focus, and selections. Choose Blue, Purple, or Cyan. Sets the primary, focus ring, and selection color.
- Corner shape: how sharp or rounded the panels, bubbles, and composer feel. Choose Sharp, Soft, or Round.
- Font: the typeface for the whole interface. Choose Inter, Space Grotesk, Sora, JetBrains Mono, or Orbitron. All options load automatically.

## Permissions

- themes.provide: lets the extension add the Tokyo Night theme you can apply in Settings.

## How it's built

A pure theme contribution. There is no entry script: everything lives in `manifest.json` under `contributes.themes[0]`.

- `tokens` maps the app's theme tokens, most with paired `dark`/`light` values (for example `background.app`, `color.primary`, `surface.sidebar`). Frosted surfaces come from `surface.*.backdrop` blur/saturate values plus `color-mix(in oklch, ...)` translucent fills; the assistant and composer surfaces build on `var(--card)` and `var(--border)`. `radius.control` sets the base corner rounding. Status colors (`color.destructive`, `color.success`, `color.warning`, `color.info`) carry the Tokyo Night accent palette in both modes.
- `font.ui` and `font.mono` set the interface and monospace stacks; `font.google` lists every selectable family (Inter, Space Grotesk, Sora, JetBrains Mono, Orbitron) so they load on demand.
- `assets.backgroundImageDark` provides the rainy skyline artwork (`static/tokyo-night.jpg`), while `assets.backgroundImageLight` provides the lighter Tokyo artwork (`static/tokyo-night-light.jpg`). Both are surfaced to settings via the `{{backgroundImage}}` placeholder.
- `settings.schema` drives the options panel. Each property uses `x-msty-theme` to bind a value to a CSS variable, so changing a setting rewrites variables live. Notable patterns: `x-msty-control` picks the widget (`slider`, `segmented`); `x-msty-visibleWhen: "showBackground"` hides Skyline strength until the skyline is on; `x-msty-enum-labels` gives friendly option names; `x-msty-order` sets the layout order; and templated values such as `calc({{value}} / 100)` and `{{backgroundImage}}` compute from the chosen input. A single setting can rewrite several variables at once: Neon accent drives `--primary`, `--ring`, and `--selection` together, and Corner shape drives `--radius`, `--composer-radius`, `--bubble-radius`, and `--assistant-radius`.
