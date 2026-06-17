# Prompt Library

Browse your saved prompts by name and tag, then drop one into your message draft with a click.

## What it does

Prompt Library turns a plain list of prompts you keep in Settings into a browsable page. Each prompt has a tag, a name, and the text itself. You write them once, then open the library to filter by tag, scan the cards, and add the one you want straight into your message box. It is a fast way to reuse the prompts you reach for often without retyping them or hunting through old chats.

## Where it shows up

- An item in the Extensions navigation labeled "Prompts."
- A full page titled "Prompt Library" that opens when you select that item.

## How to use it

Open "Prompts" from the Extensions navigation. The page shows your prompts as cards, grouped by the tags you gave them.

- Use the tag buttons across the top to filter, or pick "All" to see everything. If you set a default tag in Settings, the library opens already filtered to it.
- Each card shows the tag, the name, and a short preview of the prompt.
- Click "Use prompt" to add that prompt to your current message box. A confirmation appears, and the "Last inserted" line at the bottom remembers the most recent one.

If adding a prompt does not work, open a chat with an editable message box first, then try again. To add or change prompts, edit them in Settings > Extensions > Prompt Library.

## Settings

- Your prompts: one prompt per line, written as `tag :: name :: prompt`. The tag groups prompts, the name shows on the card, and the prompt is the text added to your draft.
- Default tag: the tag the library filters to when it opens. Leave blank to show all prompts.

## Permissions

- `settings.provide`: reads your saved prompts and default tag so the library shows the right prompts.
- `storage.local`: remembers your most recently inserted prompt and how often you open the library on this device.
- `composer.read`: checks whether your message box already has text before adding a prompt.
- `composer.write`: adds the prompt you pick to your message box.
- `notifications.show`: confirms when a prompt has been added (optional).
- `ui.workspace`: adds Prompt Library to the Extensions navigation.
- `ui.fullView`: opens the prompt library as a full page.

## How it's built

The extension splits static declarations from runtime behavior across three modules. The `manifest.json` declares the `settings` schema (`prompt_library_config`, with a `textarea`-formatted `snippets` field and an `activeTag` field), a `workspaceItems` contribution (`prompt_library`, labeled "Prompts"), and a `fullViews` contribution (`prompt_library_view`, entry `ui.js`), both bound to the `prompt-library.open` command.

`extension.js` is the entry. `activate(msty)` re-registers the workspace item via `msty.ui.registerWorkspaceItem` (only the dynamic fields; the manifest owns the rest) and returns a `run(command)` handler. On `prompt-library.open` it reads settings with `msty.settings.get`, bumps an `open_count` in `msty.storage.local`, parses the prompt lines with `parseSnippets`, and calls `msty.ui.openFullView` with the snippets, active tag, and open count passed through as `context`. The view owns insertion; the entry only opens it.

`ui.js` is the full view, mounted through `mount({ root, msty, context })`. It prefers the snippets handed in via `context` and falls back to re-parsing settings, so the view still works if opened without that context. It renders plain HTML strings into `root`: a hero with the icon (loaded via `msty.assets.url`), tag-filter buttons, a card grid, and a "Last inserted" footer read from the `usage` object in `msty.storage.local`. The composer state comes from `msty.composer.get`. Clicking "Use prompt" calls `msty.composer.insertText({ mode: "insert", select: true })`, then on success patches `usage` via `msty.storage.local.patch`, logs through `msty.diagnostics.info`, and shows a `success`-toned `msty.notifications.show`.

`ui-helpers.js` holds the shared pure functions: `parseSnippets` (splits each line on `::` into tag, name, and prompt, rejoining any extra `::` back into the prompt and applying `general`/`Untitled` defaults), `promptPreview` (collapses whitespace and truncates to 180 chars), `formatWhen` (formats an ISO timestamp, returning an empty string for invalid input so the caller can omit it), and `escapeHtml` (escapes interpolated values before they go into the HTML strings). `ui.css` themes the page entirely with system color keywords (`Canvas`, `CanvasText`) and `color-mix` so it follows light and dark automatically.

Every host call is wrapped in a defensive `safe()` helper plus optional chaining, so a missing API or a thrown error degrades to sensible defaults rather than breaking the view. Both runtime files are annotated with `// @ts-check` against `../msty-extension-api.d.ts`.
