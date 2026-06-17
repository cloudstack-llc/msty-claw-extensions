# Hacker News Tools

Lets the assistant search Hacker News and pull up the current front page for you.

## What it does

This extension gives the assistant two abilities backed by the public Hacker News search API: searching stories and comments by keyword, and listing the stories currently on the front page. When you ask about something on Hacker News, the assistant can fetch real results and reply with titles, points, authors, and links instead of guessing. It is useful for catching up on tech discussion, finding past threads on a topic, or seeing what is trending right now.

## Where it shows up

No visible UI. The assistant calls these tools automatically when your request calls for it. Both appear under their own names, `hacker_news_search` and `hacker_news_top_stories`, and do not replace any built-in tool.

## How to use it

Just ask in plain language and the assistant decides when to call a tool. Some examples:

- "Search Hacker News for posts about Rust async."
- "What are the top stories on Hacker News right now?"
- "Find recent Hacker News discussion about Tauri."

Each tool accepts an optional `limit` (1 to 20, default 10) to control how many results come back. Search returns titles, points, authors, and links; the front-page tool returns the same for whatever is currently featured.

## Permissions

- `tools.provide`: Adds the two Hacker News tools the assistant can call.
- `network.fetch`: Queries the public Hacker News search API. Network access is restricted to `https://hn.algolia.com`.

## How it's built

This is a tools-only extension (`contributes.tools`) with no UI surface. `activate(msty)` returns a handler whose `run(command, input)` dispatches on the tool's `command`: `hn.search` and `hn.top`. Both call the Algolia HN search endpoint through `msty.network.fetch` with `responseType: "json"`, then format hits into a Markdown list.

Notable details for anyone studying the source:

- Tools are additive. Each declares its own `name` and `command`, so nothing overrides a built-in tool.
- Defensive parsing throughout: `clampLimit` coerces and bounds `limit` to 1 to 20 with a fallback, and `formatHit` falls back across `title`/`story_title`, derives a comment permalink from `objectID` when no `url` is present, and labels point-less items as a "discussion".
- Errors are returned as tool results (`{ content, isError: true }`) rather than thrown, so a failed fetch or empty query surfaces a readable message to the assistant.
- The front-page tool uses the `tags=front_page` query parameter; search uses `query=` with `hitsPerPage` matching the requested limit.

See `extension.js` for the handler and helpers, and `manifest.json` for the tool schemas and network allowlist.
