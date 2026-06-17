# Workspace Scratchpad

Lets the assistant save, list, read, and delete short notes that stay with the current workspace.

## What it does

Workspace Scratchpad gives the assistant a small, persistent place to jot things down for the workspace you're in. The assistant can save a titled note, list the notes it has, read one back in full, or delete it. Notes are scoped to the workspace, so each workspace keeps its own set, and they stick around across chats and app restarts. It's handy for capturing decisions, snippets, names, or running context you want the assistant to remember beyond a single conversation. Notes are kept on this device and are not synced across devices.

## Where it shows up

There's no visible UI. The extension adds four tools the assistant calls on its own when they're relevant: `save_note`, `list_notes`, `get_note`, and `delete_note`.

## How to use it

Just ask in plain language and the assistant decides when to use the tools. For example:

- "Save a note titled 'API base URL' with the staging endpoint we just figured out."
- "What notes do you have for this workspace?"
- "Read back the note about the API base URL."
- "Delete the note about the staging endpoint."

When you save a note, the assistant stores a title and body and gets back a short id. Listing shows each note's id, title, and the date it was saved, and reading or deleting works by that id. Notes have to include both a title and a body, and the body is capped at 100,000 characters so the scratchpad stays for short notes rather than large documents.

## Permissions

- **tools.provide**: Adds the note-keeping tools the assistant can call.
- **storage.workspace**: Stores the notes for the current workspace.

## How it's built

The extension contributes four `tools` (declared statically in `manifest.json`), each mapped to a `scratchpad.*` command that the entry module routes in a single `run(command, input)` switch in `extension.js`. State is a single `notes` array kept in `msty.storage.workspace`, which scopes it per workspace and persists it across turns and restarts.

A few patterns worth noting for anyone studying the source:

- **Defensive JSON boundary handling.** Model-supplied arguments can be any type, so inputs are coerced (`String(input.title ?? "").trim()`) and validated before use, and reads tolerate a missing or malformed stored value via `readNotes`, which falls back to an empty array.
- **Structured tool results.** Each command returns a `{ content }` object, setting `isError: true` for validation failures (empty fields, over-length body, unknown id) so the host surfaces them as tool errors.
- **JSON-safe data.** Timestamps are stored as ISO strings and rendered with a `formatDate` helper that falls back to "unknown date", keeping values round-trippable through JSON.
- **Lightweight ids.** `newId` prefers `crypto.randomUUID()` (sliced to 8 chars) and falls back to a random base-36 string.
- **No teardown needed.** `dispose` is a no-op because the tools are declared in the manifest and storage needs no cleanup.
