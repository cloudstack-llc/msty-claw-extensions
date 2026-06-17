# Catppuccin

A soothing pastel theme: the warm, cozy Mocha in the dark and the light, milky Latte in the day.

## What it does

Catppuccin recolors the entire app in the popular Catppuccin palette. In dark mode you get the warm, low-contrast Mocha flavor; in light mode you get the soft, milky Latte flavor. A mauve accent tints buttons, highlights, and selections, and a frosted pastel background image sits behind the workspace. Panels, the composer, and message bubbles pick up softly rounded corners and a gentle blur for a calm, cohesive look. You can adjust the background, roundness, accent color, and interface font to taste.

## Where it shows up

Appears in Settings > Appearance as a selectable theme. Once applied, its options live in the theme's settings.

## How to use it

1. Open Settings > Appearance.
2. Select Catppuccin from the list of themes.
3. The app follows your light/dark mode automatically: Latte in light, Mocha in dark.
4. Open the theme's settings to fine-tune the background, roundness, accent, and font.

## Settings

- Show background image: Turns the pastel background image on or off. When off, the workspace falls back to a flat color.
- Image strength: Blends the background image into the workspace color, from 0 (color only) to 100 (full image). Available when the background image is on.
- Surface roundness: Sets how soft panels, buttons, and message bubbles feel, from 4px (crisp) to 18px (very round).
- Accent flavor: Picks the pastel that tints buttons, highlights, and selections. Choose Mauve, Blue, or Peach.
- Font: Sets the typeface for the whole interface. Choose Figtree, Quicksand, Nunito Sans, Newsreader, or Comfortaa. All options load automatically.

## Permissions

- `themes.provide`: Lets the extension add the Catppuccin theme so you can apply it in Settings.

## How it's built

This is a declarative, code-free theme. It contributes a single entry under `contributes.themes` and ships no entry script.

- Tokens: The `tokens` map sets app-wide CSS variables, each with a `dark` (Mocha) and `light` (Latte) value, for example `background.app`, `color.primary`, `surface.sidebar`, and the status colors. A few tokens use single values and derive from others through `color-mix(in oklch, ...)` and `var(--card)` / `var(--border)`, which keeps the translucent sidebar, assistant, and composer surfaces consistent across both flavors.
- Fonts: `font.ui` and `font.mono` set the default stacks, and `font.google` lists every selectable family (Figtree, Quicksand, Nunito Sans, Newsreader, Comfortaa, JetBrains Mono) so the host loads them automatically.
- Assets: `assets.backgroundImageDark` and `assets.backgroundImageLight` provide the pastel backdrops in `static/`, and `previewImage` is the thumbnail shown in the theme list.
- Settings bindings: The `settings.schema` drives the in-app controls. Each property uses `x-msty-*` extensions to bind a setting to a CSS variable: `x-msty-control` chooses the widget (`slider`, `segmented`), `x-msty-order` orders the fields, and `x-msty-visibleWhen` conditionally shows Image strength only while the background is on. `x-msty-theme` is the binding itself, supporting a templated single `value` (for example `calc({{value}} / 100)` and `{{value}}px`), a `values` map keyed by the selected option (the accent and font enums), and the `{{backgroundImage}}` token for the toggle. A binding may target one variable or an array of variables, which is how Surface roundness drives `--radius`, `--composer-radius`, and `--bubble-radius` together.
