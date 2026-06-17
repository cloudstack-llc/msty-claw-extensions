# Team Clock

See the current time across your team's time zones and who is inside working hours right now.

## What it does

When your team is spread across time zones, it is hard to know who is awake and at their desk before you ping them. Team Clock keeps a small indicator in the status bar that shows how many of your configured zones are inside working hours, and opens a panel of live analog clocks so you can read each zone's local time at a glance. Every clock marks whether that zone is currently Working, in Off hours, or on a Weekend, and the dials shift to a night look outside daylight so the picture reads instantly.

## Where it shows up

- A Team Clock indicator in the bottom status bar. Its badge shows how many configured zones are inside working hours right now, and it turns a success tone when at least one teammate is working.
- A `/team-clock` slash command in the message box (and the command palette).
- Selecting either one opens a popup with the live clocks.

## How to use it

1. Open Settings and add your team's time zones under Team Clock (see Settings below).
2. Click the Team Clock indicator in the status bar, or run the `/team-clock` slash command.
3. Read the panel:
   - One analog clock per zone, with the city name, the local digital time, and a Working / Off hours / Weekend badge.
   - A summary at the top: how many zones are inside working hours, plus your own local time.
   - Clocks for zones in the night hours dim to a darker dial with a moon marker; daytime zones show a sun.

If a zone name is not recognized, the panel lists it under a "Not recognized" note so you can fix the spelling. The status bar indicator turns a warning tone whenever any configured zone is invalid.

## Settings

- Time zones: comma-separated time zone names, for example `America/New_York, Europe/London, Asia/Kolkata`. Defaults to Los Angeles, New York, London, and Kolkata.
- Work day starts (hour): the local hour working hours begin, 0 to 23. Defaults to 9.
- Work day ends (hour): the local hour working hours end, 0 to 23. Defaults to 17.

Working hours apply Monday through Friday in each zone's own local time. A zone counts as working when its local hour is at or after the start hour and before the end hour on a weekday.

## Permissions

- `commands.provide`: adds the `/team-clock` slash command.
- `settings.provide`: reads the time zones and working hours you configure.
- `ui.statusBar`: adds the Team Clock indicator to the status bar.
- `ui.popup`: shows the live clocks in a panel.

## How it's built

The slash command (`commands`) and popup (`popups`) are declared statically in `manifest.json` so the host can wire them up before the extension activates, while the status bar indicator (`statusBarPills`) is also registered at runtime. `activate(msty)` in `extension.js` calls `msty.ui.registerStatusBarPill` (guarded by a `typeof` check) so it can keep the badge live, then calls `refreshStatus` to set the initial count and tone, and tracks the returned dispose function for clean teardown.

`analyze(settings, now)` is the core: it splits the configured `zones` string, resolves each zone's weekday and hour with `Intl.DateTimeFormat` in `zoneInfo`, and buckets the rows into working, off-hours, and invalid (unrecognized zone names return `null`). `refreshStatus` feeds that into `msty.ui.update` to drive the badge count, the tone (`warning` when any zone is invalid, `success` when at least one is working, otherwise `default`), and the tooltip. The `run(command)` handler reads settings with `msty.settings.get`, opens the custom view with `msty.ui.openContribution` (falling back to `msty.ui.openPopup`), and passes only `entry` and `context` so the host renders this view instead of its own declarative blocks.

The popup view in `view.js` mounts a `requestAnimationFrame` loop that draws SVG analog clocks. Rather than re-querying `Intl` every frame, `zoneOffsetMs` computes each zone's wall-clock offset once and refreshes it every 60 seconds so DST stays correct. The second hand uses a Swiss railway "stop-to-go" sweep, the dial flips to an `is-night` look outside daylight hours, and per-frame work is minimized by only updating text and badges when the second changes. `view.css` maps every color onto the app's theme tokens on `:root` (`--background`, `--foreground`, `--primary`, `--extension-success`, and others) with `light-dark()` fallbacks, so the clocks track the selected theme and light/dark mode, and it honors `prefers-reduced-motion` by stepping the second hand instead of sweeping it. All host-rendered text is escaped through `escapeHtml`.
