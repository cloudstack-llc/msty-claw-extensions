# Focus Sprint

Start, check, and end a timed focus sprint right from the app chrome.

## What it does

Focus Sprint gives you a lightweight work timer that lives in the app, so you never leave your chat to track a focused work block. Start a sprint and a countdown badge shows how many minutes are left; the badge turns to a warning tone in the final five minutes so you can see the finish line at a glance. When the timer runs out it clears itself, and you can end a sprint early whenever you want. It is a simple, low-friction way to time-box deep work without a separate timer app.

## Where it shows up

- A Focus button in the title bar. Click it to start a sprint, or to review and end one that is already running.
- A Focus status pill in the bottom status bar. Click it to check the active sprint at any time.

Both show a "Ready" badge when idle and a live "Nm" countdown while a sprint is running.

## How to use it

1. Click the Focus button in the title bar to start a sprint. A popup confirms it started and shows the length and end time.
2. While a sprint runs, click the title bar button or the status pill to see remaining time, progress, and your break length.
3. To stop early, open the title bar button mid-sprint and choose End sprint. A popup confirms it stopped and suggests taking your break before the next one.
4. When the timer reaches zero, the sprint ends on its own and the badges return to "Ready".

## Settings

Configured under Focus Sprint in the extension's settings.

- Sprint label: the name shown for your sprint (default "Deep work").
- Sprint length in minutes: how long each sprint runs (default 25, allowed range 5 to 180).
- Break length in minutes: the break suggested after a sprint ends (default 5, allowed range 1 to 60).

## Permissions

- settings.provide: reads the sprint length, break length, and label you configure.
- storage.local: stores the active sprint timer on this device.
- ui.titleBar: adds the Focus button to the title bar.
- ui.statusBar: adds the Focus status pill to the bottom status bar.
- ui.popup: shows the sprint status and end-of-sprint summary in a popup.

## How it's built

The manifest declares two chrome contributions, `titleBarItems` (`focus_toggle`) and `statusBarPills` (`focus_status`), plus a `settings` schema (`focus_sprint_config`). In `extension.js`, `activate` registers both items via `msty.ui.registerTitleBarItem` and `msty.ui.registerStatusBarPill`, wiring each to a command (`focus-sprint.toggle` and `focus-sprint.status`). The returned `run(command)` handler reads settings and the stored sprint, then either starts a new sprint, opens the status popup, or ends the active one based on the popup's returned `actionId`/`action`.

State is a single `active_sprint` object (`label`, `startedAt`, `endsAt`) kept in `msty.storage.local`. A `setInterval` loop calls `updateChrome` every 30 seconds (and once on activate) to refresh the badge, tone, and tooltip on both surfaces through `msty.ui.update`; an expired sprint is detected with `isActive` and removed lazily. Popups are built with `msty.ui.openPopup` using `progress`, `kv`, `callout`, and `stats` content blocks.

The code is defensive throughout: every host call is feature-detected (`typeof msty.ui?.update === "function"`) and wrapped in `safe*` helpers that swallow errors, so missing optional capabilities degrade gracefully rather than throwing. Numeric settings pass through `clamp(value, min, max, fallback)` and the label through a `text` fallback, so invalid or empty config never breaks the timer. Disposables (the registrations and the interval) are tracked in an array and torn down in `dispose` via `disposeAll`.
