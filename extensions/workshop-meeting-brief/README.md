# Meeting Brief Workshop

Turns your rough meeting notes into a crisp, decision-ready brief before you walk into the room.

## What it does

Meeting Brief Workshop takes the meeting name, attendees, goal, and rough notes you configure, adds your current workspace context, and asks a model to rewrite it all into a clean brief covering purpose, context, decisions needed, risks, and next actions. The brief streams in live as the model writes it, so you watch it take shape. When it is ready you can save it for the workspace, copy it, or insert it straight into your message draft. If no model is available, it still produces a structured fallback brief from your notes so you are never left empty-handed.

## Where it shows up

- An item in the workspace navigation labeled "Meeting Brief."
- Opening that item launches a dedicated full view where the brief is generated and shown.

## How to use it

1. Open Settings and fill in the Meeting Brief fields: meeting name, attendees, goal, and your rough notes.
2. Click "Meeting Brief" in the workspace navigation. The full view opens and the model starts writing immediately.
3. Watch the brief stream in. Context tiles across the top show the attendees, workspace, current view, the assigned model, and the writing mode.
4. When the brief is ready, choose an action:
   - Rewrite: generate the brief again.
   - Save: keep this brief for the workspace (the latest brief is also saved automatically when generation finishes).
   - Copy: put the full brief on your clipboard.
   - Insert: drop the brief into your current message draft.
5. If you see "Choose a model," click "Choose model" to open model assignments and pick a model for the Meeting Brief Writer slot, then rewrite.

The right side of the view always shows your rough notes and a note about when a brief was last saved for this workspace.

## Settings

The "Meeting Brief" settings group has four fields:

- Meeting name: the title of the meeting (default "Weekly product review").
- Attendees: comma-separated names or roles (default "Product, Design, Engineering").
- Goal: what the meeting needs to decide (default "Decide what ships this week and what needs follow-up.").
- Rough notes: the raw bullets you want turned into a brief.

## Model

- Meeting Brief Writer: the model slot used to write the brief. Assign a concise model to it in Settings. Until one is assigned, the view shows guidance and uses a structured fallback brief built from your notes.

## Permissions

- `settings.provide`: reads the meeting goal, attendees, and notes you configure.
- `context.read`: adds the active workspace and view to the brief.
- `models.infer`: turns rough notes into a concise brief.
- `storage.workspace`: saves the most recent brief for this workspace.
- `ui.workspace`: adds the Meeting Brief item to the workspace navigation.
- `ui.fullView`: opens the generated brief in a full extension view.
- `composer.write` (optional): inserts the final brief into your draft when you choose Insert.
- `clipboard.write` (optional): copies the final brief when you choose Copy.
- `notifications.show` (optional): confirms when the brief is inserted.

## How it's built

The extension uses four contribution types declared in `manifest.json`: a `settings` group (`brief_config`), a `modelAssignments` slot (`meeting_brief_writer`), a `workspaceItems` entry, and a `fullViews` entry. Static declarations live in the manifest; behavior is split across `extension.js` (the activation and command handler) and `view.js` (the full-view surface).

`activate(msty)` in `extension.js` registers the workspace item and full view via `msty.ui.registerWorkspaceItem` and `msty.ui.registerFullView`, then exposes a `run(command)` handler for `meeting-brief.open`. On run it gathers state defensively (`safeSettings`, `safeContext`, `safeModelCapabilities`, `safeStorageGet`), builds the model prompt with `buildPrompt`, and calls `msty.ui.openFullView` with that data passed through the view's `context`. Every host call is wrapped in try/catch and optional chaining so missing APIs degrade to sensible defaults.

`view.js` exports `mount({ root, msty, context })` and renders the surface with plain template strings plus an inline SVG icon set, escaping all interpolated values through `escapeHtml`. The core flow is `startStream`: it checks `msty.models.getCapabilities` and `msty.models.getStatus({ modelAssignment: "meeting_brief_writer" })`, and if a model is ready it streams with `msty.models.stream`, updating only the brief node on each `text_delta` (via `updateBrief`) to avoid re-rendering the whole view during streaming. It falls back to `msty.models.infer` when the model cannot stream, and to a locally composed `fallbackBrief` when inference is unavailable or cancelled. Output length is clamped against `capabilities.limits.maxOutputTokens` by `modelOutputLimit`, and streaming is cancellable through the returned controller's `cancel`.

The completed brief is persisted with `msty.storage.workspace.set("last_brief", ...)` (read back as `previousBrief` on the next open). The action bar wires Copy and Insert through `msty.clipboard.writeText` and `msty.composer.insertText`, each gated by `ensurePermissions`, which prefers `msty.permissions.ensure` and falls back to `msty.permissions.request` plus `msty.app.openExtension` to open the permission review. "Choose model" calls `msty.app.openModelAssignments({ assignmentId: "meeting_brief_writer" })`. A lightweight toast helper surfaces success and error feedback, and `msty.notifications.show` confirms an insert. The file is annotated with `// @ts-check` against `../msty-extension-api.d.ts`.
