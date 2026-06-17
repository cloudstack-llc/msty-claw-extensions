# Keep Nearby

Gives each chat a small side drawer for the assistant replies, snippets, and notes you want to keep handy, without turning them into global memory.

## What it does

Some replies in a chat are worth holding onto: a good answer, a snippet of code, a decision you want to remember. Keep Nearby gives every chat its own drawer where you can pin those replies and jot quick notes. Everything you save stays tied to that one chat, so it never leaks into other conversations or into the app's long-term memory. You can mark items as reviewed, jump back to the original message, and ask a focused question that is answered using only this chat, its pins, and its notes.

## Where it shows up

- A **Keep Nearby** button in the title bar that opens or closes the drawer.
- A **Keep** item in the chat tools (More) menu.
- A **Keep nearby** action under each assistant reply, which saves that reply (or your selected text from it) and opens the drawer.
- A `/keep-nearby` slash command in the message box (and command palette) that opens the drawer.
- A **Keep Nearby Assistant** model slot in Settings that you assign the model used for the drawer's focused questions.
- The drawer itself, a wide side panel with your pins, notes, reviewed items, and an "Ask about this chat" box.

## How to use it

1. Open any chat and find an assistant reply worth keeping. Optionally select just the part you want.
2. Choose **Keep nearby** under the reply. The drawer opens with the snippet pinned. Selected text is saved on its own; otherwise the full reply is kept.
3. Add free-form notes with **Add a note**, and edit them later inline.
4. Use the buttons on each item to open the original message, mark it reviewed (it moves to the collapsible Reviewed section), or remove it. Most changes show a short "Undo" toast.
5. Type a question in the box at the bottom and press **Ask** (or Cmd/Ctrl+Enter). The answer uses only this chat plus your pins and notes. From the answer you can Copy, Save as note, Send to chat, or start a New chat.

To assign which model answers those questions, open Settings and set the **Keep Nearby Assistant** slot.

## Permissions

- **context.read**: read the current chat and any selected text so saved items stay tied to the right place.
- **chats.read**: show the current chat's name and a saved item's source chat.
- **chats.write**: create or switch chats, only when you choose the "New chat" result action.
- **messages.read**: read the assistant reply you keep and reopen its source later.
- **messages.write**: send an answer to the current chat, only when you choose "Send to chat".
- **models.infer**: answer your question using only this chat, its pins, and notes.
- **storage.chat**: save pins, notes, drafts, and reviewed state for the current chat.
- **events.subscribe**: refresh the drawer when the active chat or its messages change.
- **ui.toolbox**: add Keep to the chat tools menu.
- **ui.titleBar**: add the Keep Nearby button in the title bar.
- **ui.messageInline**: add the Keep nearby action under assistant replies.
- **ui.drawer**: show Keep Nearby in a side drawer.
- **commands.provide** (optional): add the `/keep-nearby` command.
- **clipboard.write** (optional): copy an answer when you choose Copy.
- **notifications.show** (optional): confirm saved, reviewed, restored, and removed items.

Keep Nearby does not request filesystem, network, global chat history, or durable memory permissions.

## How it's built

The extension splits into a runtime entry (`extension.js`) and a drawer view (`view.js`), with `view.css` mapping the UI onto host theme tokens.

`extension.js` is the runtime. In `activate`, it registers four contributions with optional-chaining guards (`msty.ui?.registerToolboxItem`, `registerTitleBarItem`, `registerMessageInlineItem`, and `msty.commands?.register`), pushing each disposable so `dispose()` can tear them down. The returned `run(command, activationContext)` routes the two commands: `keep-nearby.pin-message` calls `pinMessage` then opens the drawer, and `keep-nearby.open` toggles it. `pinMessage` reads the message via `msty.messages.get`, checks `msty.context.getCurrentSelection()` for a message-scoped selection (saving the selected text and a normalized `sourceRange` when present, otherwise the full content), dedupes against existing pins, and persists. `openDrawer` tracks an open promise to support toggle, prefers `msty.ui.openContribution` and falls back to `msty.ui.openDrawer`, and uses `msty.ui.closeSurface` to close, recovering if the host reports the drawer is already gone.

State lives in chat-scoped storage. Both modules share a `loadState`/`normalizeState` pair keyed by `STATE_KEY` at `SCHEMA_VERSION`, preferring `msty.storage.chat.migrate` (with a `migrate` callback) and falling back to `msty.storage.chat.get`. Every read and write runs through `normalizeState`/`normalizePin`/`normalizeNote`, which defensively coerce stored shapes, so a malformed value never breaks the drawer.

`view.js` is a single-file vanilla DOM view mounted via the `SurfaceMountContext` `mount({ root, msty, context })`. It uses delegated `click`/`input`/`keydown`/`submit` listeners on `root` plus a `data-action` dispatch table, re-rendering with `innerHTML` while preserving scroll position. The "Ask about this chat" flow builds a context package from `msty.context.getCurrentChat({ includeMessages: "recent", maxMessages: 8 })` plus active and reviewed pins/notes, sends it through the `keep_nearby_assistant` model assignment, and prefers `msty.models.stream` (updating the result text node directly without a full re-render) with `msty.models.infer` as a fallback. The system prompt in `promptForContext` constrains the model to the supplied context and forbids claiming it changed any state. Result actions call `msty.clipboard.writeText`, `msty.messages.send`, and `msty.chats.create`; `openSource` reopens a pin's origin via `msty.messages.open({ highlight: true })`. A lightweight `deriveActionIntents` heuristic scans the prompt for "add note" / "mark reviewed" phrasing and offers one-click chips that apply locally. Prompt drafts are debounced to storage via `scheduleSaveDraft`, and `msty.events.subscribe` (for `context.changed` / `messages.changed`) drives `refresh`, switching state when the active chat changes. Icons are inline SVG path strings, and a self-managed toast helper provides confirmations with an optional Undo.

`view.css` themes everything through `:root` variables that read host tokens (un-prefixed core tokens like `--background`, `--card`, `--primary`, and `--extension-*` tones for success/warning/danger) with `light-dark()` fallbacks, so the drawer tracks the selected theme and appearance.
