# Team Clock

See the current time across your team's time zones and who is inside working hours right now.

## What it does

When your team is spread across time zones, it is hard to know who is awake and at their desk before you ping them. Team Clock keeps a small indicator in the status bar that shows how many of your configured zones are inside working hours, and opens a panel of live analog clocks so you can read each zone's local time at a glance. A compact status line at the top tells you at a glance how many zones are working right now, each clock shows its offset from your local time (hover for its UTC offset), and every clock marks whether that zone is currently Working, in Off hours, or on a Weekend. The dials shade to a night look outside daylight, and Weekend gets its own distinct badge so a Saturday reads differently from a quiet evening.

## Where it shows up

- A Team Clock indicator in the bottom status bar. Its badge shows how many configured zones are inside working hours right now, and it turns a success tone when at least one teammate is working.
- A `/team-clock` slash command in the message box (and the command palette).
- Selecting either one opens a popup with the live clocks.

## How to use it

1. Open Settings and add your team's time zones under Team Clock (see Settings below).
2. Click the Team Clock indicator in the status bar, or run the `/team-clock` slash command.
3. Read the panel:
   - A compact status line at the top: a live dot plus how many zones are inside working hours, and your own local time.
   - One analog clock per zone — a Swiss-style dial with the city name, its offset from your time (e.g. −3h, +5:30; hover for the UTC offset), the local digital time, and a Working / Off hours / Weekend badge.
   - Clocks in night hours shade to a darker dial. Weekend zones get their own distinct badge so you can tell a Saturday from a quiet evening.

If a zone name is not recognized, the panel lists it under a "Not recognized" note so you can fix the spelling. The status bar indicator turns a warning tone whenever any configured zone is invalid.

## Settings

- Time zones: one IANA time zone name per line, for example `America/New_York`, `Europe/London`, `Asia/Kolkata`. Defaults to Los Angeles, New York, London, and Kolkata. Unrecognized names are listed in a warning note in the panel so you can fix the spelling.
- Work day starts (hour): the local hour working hours begin, from 0 (midnight) to 23 (11 PM). Defaults to 9.
- Work day ends (hour): the local hour working hours end, from 0 (midnight) to 23 (11 PM). Defaults to 17.

Working hours apply Monday through Friday in each zone's own local time. A zone counts as working when its local hour is at or after the start hour and before the end hour on a weekday.

## Permissions

- `commands.provide`: adds the `/team-clock` slash command.
- `settings.provide`: reads the time zones and working hours you configure.
- `ui.statusBar`: adds the Team Clock indicator to the status bar.
- `ui.popup`: shows the live clocks in a panel.

## How it's built

The slash command (`commands`) and popup (`popups`) are declared statically in `manifest.json` so the host can wire them up before the extension activates, while the status bar indicator (`statusBarPills`) is also registered at runtime. `activate(msty)` in `extension.js` calls `msty.ui.registerStatusBarPill` (guarded by a `typeof` check) so it can keep the badge live, then calls `refreshStatus` to set the initial count and tone, and tracks the returned dispose function for clean teardown.

`analyze(settings, now)` is the core: it splits the configured `zones` string, resolves each zone's weekday and hour with `Intl.DateTimeFormat` in `zoneInfo`, and buckets the rows into working, off-hours, and invalid (unrecognized zone names return `null`). `refreshStatus` feeds that into `msty.ui.update` to drive the badge count, the tone (`warning` when any zone is invalid, `success` when at least one is working, otherwise `default`), and the tooltip. The `run(command)` handler reads settings with `msty.settings.get`, opens the custom view with `msty.ui.openContribution` (falling back to `msty.ui.openPopup`), and passes only `entry` and `context` so the host renders this view instead of its own declarative blocks.

The popup view in `view.js` mounts a `requestAnimationFrame` loop that draws SVG analog clocks. Rather than re-querying `Intl` every frame, `zoneOffsetMs` computes each zone's wall-clock offset once and refreshes it every 60 seconds so DST stays correct; the per-zone offset chip is computed relative to the viewer's own local offset and refreshed on the same 60-second cadence (hover the chip for the zone's absolute UTC offset). The second hand uses a Swiss railway "stop-to-go" sweep that clamps at 360° so the minute rollover is seamless, and the dial flips to an `is-night` look outside daylight hours. Per-frame work is minimized so that only the second-hand transform runs each frame (in motion-reduced mode it steps once per second like everything else), and the render loop pauses on `visibilitychange` while the popup is hidden to save CPU. The dials borrow a watch vocabulary — a bezel ring, subtle radial depth, and 12/3/6/9 numerals — and Weekend zones get their own badge tone so they read distinctly from Off hours. `view.css` maps every color onto the app's theme tokens on `:root` (`--background`, `--foreground`, `--primary`, `--extension-success`, `--extension-info`, and others) with `light-dark()` fallbacks, so the clocks track the selected theme and light/dark mode, and it honors `prefers-reduced-motion` by stepping the second hand instead of sweeping it. All host-rendered text is escaped through `escapeHtml`.
