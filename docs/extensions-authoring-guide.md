# Msty Claw Extensions Authoring Guide

This guide is for agents and users generating lightweight extensions without a TypeScript project.
An extension is a ZIP file with `manifest.json` at the root, optional JavaScript entry files, and
static assets such as icons or previews.

## Quick Start

In Msty Claw, use `/create-extension <what you want>` to have the included extension creator skill
scaffold, package, and validate a JavaScript-first extension from a short brief.

```text
my-extension/
  msty-extension-api.d.ts
  manifest.schema.json
  manifest.json
  extension.js
  static/
    icon.svg
```

Package the folder contents, not the parent folder:

```sh
cd my-extension
zip -r my-extension.zip manifest.json extension.js static
```

Packaging checklist:

- `manifest.json` is at the ZIP root, not inside a parent folder.
- The `entry` file exists when the manifest declares `entry`.
- The top-level `icon` path points to a packaged SVG or PNG file.
- Static assets referenced by contribution `icon` fields exist when they use asset paths such as
  `static/action.svg`.
- Slash commands use top-level `contributes.commands`.
- The manifest does not use the unsupported top-level `contributions` key.

Install the ZIP from `Extensions > Install ZIP`, then review the requested permissions.
Extensions do not run until required permissions are allowed.

Use packaged icons for extension identity. Put an SVG or PNG under `static/` and reference it from
the top-level manifest `icon`, usually `"icon": "static/icon.svg"`. Contribution `icon` fields
only style that specific button, menu item, or surface. Msty Claw validates that referenced files
exist and renders them from the installed package.

For editor help without a TypeScript project, keep `msty-extension-api.d.ts` and
`manifest.schema.json` beside the extension while authoring. They are contract files only: do not
import them, bundle a runtime SDK, or add npm dependencies. In JavaScript, start with `// @ts-check`
and a reference comment so editors understand the `msty` object.

## Minimal Manifest

```json
{
  "$schema": "./manifest.schema.json",
  "manifestVersion": 1,
  "id": "ai.example.quick-helper",
  "name": "Quick Helper",
  "version": "1.0.0",
  "description": "Adds a small helper to the status bar.",
  "icon": "static/icon.svg",
  "compatibility": {
    "extensionApi": "^1.0.0"
  },
  "permissions": [
    {
      "id": "ui.statusBar",
      "required": true,
      "reason": "Adds a status bar pill."
    }
  ],
  "entry": "extension.js",
  "contributes": {
    "statusBarPills": [
      {
        "id": "quick_helper_pill",
        "label": "Helper",
        "title": "Quick Helper",
        "entry": "extension.js"
      }
    ]
  }
}
```

## JavaScript Entry

Use `compatibility.extensionApi: "^1.0.0"` unless you need a newer documented API. Msty Claw
validates this range before install, so extensions targeting an unsupported future API will not run
accidentally on an older host.

```js
// @ts-check
/// <reference path="./msty-extension-api.d.ts" />

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  const unregister = msty.ui.registerStatusBarPill({
    id: "quick_helper_pill",
    label: "Helper",
    title: "Quick Helper",
    command: "quick-helper.open"
  });

  return {
    async run(command) {
      if (command !== "quick-helper.open") return;
      await msty.ui.openDrawer({
        id: "quick-helper.drawer",
        title: "Quick Helper",
        body: "Ready.",
        width: "small"
      });
    },
    dispose() {
      unregister();
    }
  };
}
```

## Runtime Lifecycle Hooks

An extension entry still exports `activate(msty)`. For runtime lifecycle work, return optional hook
methods from `activate`. Hooks are additive: omit the ones you do not need.

```js
// @ts-check
/// <reference path="./msty-extension-api.d.ts" />

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  return {
    async onInstall(event) {
      await msty.storage.local.set("installedAt", event.timestamp);
    },
    async onUpdate(event) {
      await msty.diagnostics.info("Updated extension", {
        from: event.previousVersion,
        to: event.version
      });
    },
    async onStartup(event) {
      await msty.ui.update({
        id: "status",
        surface: "statusBar",
        badge: event.reason === "install" ? "New" : null
      });
    },
    async onSettingsChanged(event) {
      await msty.diagnostics.info("Settings changed", {
        keys: event.data?.keys || []
      });
    },
    async onPermissionsChanged(event) {
      await msty.diagnostics.info("Permissions changed", {
        permissions: event.data?.permissions || []
      });
    },
    dispose() {
      // Clean up timers, subscriptions, and runtime registrations.
    }
  };
}
```

Lifecycle hooks are best for small bookkeeping: initializing storage, refreshing badges, recording
extension-local audit entries, and adapting to settings or permission changes. Use `dispose()` for
cleanup when the runtime stops. Msty Claw records hook failures in the extension Logs tab and keeps
the runtime active unless activation itself failed.

Hook payloads are metadata-only JSON. `onInstall`, `onUpdate`, and `onStartup` receive
`extensionId`, `name`, `version`, `previousVersion`, `installedAt`, `updatedAt`, `packageUpdatedAt`,
`lastActivatedAt`, `timestamp`, and a `type`. `onStartup` also includes `reason`: `install`,
`update`, or `startup`. `onSettingsChanged` receives the same `settings.changed` event that
`msty.events.subscribe` can observe for that extension. `onPermissionsChanged` receives the matching
`permissions.changed` event after the runtime has restarted with fresh permission state when a
restart is needed.

## Runtime Performance And Loading

Keep startup work small. `activate(msty)` should return handlers quickly; do not read many messages,
call models, scan files, fetch network resources, or import large domain modules just because the app
started. Put static chrome in `manifest.json`, then use runtime code only for commands, hooks,
subscriptions, and updates that actually need JavaScript.

For custom full views and drawers, show something visible before expensive work starts. A good command
opens the declared surface with a small loading context, returns promptly, then builds the snapshot and
updates the already-open surface:

```js
async function openWorkspace(msty) {
  const context = { loading: true };
  void msty.ui.openContribution({
    kind: "fullView",
    id: "workspace_view",
    context
  });

  void refreshWorkspace(msty);
  return { opened: true };
}

async function refreshWorkspace(msty) {
  const { buildSnapshot } = await import("./core.js");
  const snapshot = await buildSnapshot(msty);
  await msty.ui.updateSurface({
    kind: "fullView",
    id: "workspace_view",
    context: { loading: false, snapshot }
  });
}
```

Do not `await msty.ui.openContribution(...)` just to show a view from a command. Open promises resolve
when the user closes the surface, so awaiting them keeps the command running, delays repeat clicks,
and can make navigation feel stuck. Await the open promise only when the command really needs the
user's close result.

## Contribution Permissions

Declare the permission matching each contribution:

| Contribution | Permission |
| --- | --- |
| `rules` | `rules.provide` |
| `playbooks` | `playbooks.provide` |
| `tasks` | `tasks.provide` |
| `commands` | `commands.provide` |
| `tools` | `tools.provide` (and `tools.override` to replace a built-in) |
| `chatContextProviders` | `context.provide` |
| `agentHarnesses` | `agent.behavior` |
| `preSendHooks` | `messages.hooks` |
| `postMessageHooks` | `messages.hooks` |
| `themes` | `themes.provide` |
| `settings` | `settings.provide` |
| `fullViews` | `ui.fullView` |
| `dialogs` | `ui.dialog` |
| `drawers` | `ui.drawer` |
| `popups` | `ui.popup` |
| `workspaceItems` | `ui.workspace` |
| `toolboxItems` | `ui.toolbox` |
| `titleBarItems` | `ui.titleBar` |
| `statusBarPills` | `ui.statusBar` |
| `emptyPillItems` | `ui.emptyPill` |
| `pulseItems` | `ui.pulse` |
| `messageInlineItems` | `ui.messageInline` |
| `composerInlineItems` | `ui.composerInline` |

Use descriptor objects with a clear `reason`; the Extensions dashboard shows that reason to users.

## Permission Reference

Every permission an extension can declare. The description matches what users see when they review
access in Extensions. This table is enforced by a contract test in the app repo: a permission added
to the host must be documented here before the suite passes.

| Permission | Grants |
| --- | --- |
| `context.read` | Read current app context |
| `context.provide` | Read prompts and add context to chat |
| `chats.read` | Read chats |
| `chats.write` | Create or switch chats |
| `messages.read` | Read message history |
| `messages.write` | Add messages to chats |
| `messages.hooks` | Review messages and observe turn milestones |
| `messages.modify` | Change or stop outgoing drafts |
| `composer.read` | Read the message draft (also required for `composer.changed` events) |
| `composer.write` | Edit the message draft |
| `models.infer` | Ask models to respond |
| `models.provide` | Add model choices to the model picker |
| `models.local` | Download and run on-device models |
| `agent.behavior` | Change assistant behavior |
| `storage.local` | Save extension settings on this device |
| `storage.chat` | Save extension data for the current chat |
| `storage.workspace` | Save extension settings for this workspace |
| `secrets.read` | Use saved secrets |
| `secrets.write` | Save extension secrets |
| `files.read` | Choose and read local files |
| `files.write` | Save local files |
| `network.fetch` | Connect to allowed websites |
| `themes.provide` | Add themes |
| `settings.provide` | Add extension settings |
| `rules.provide` | Add rules |
| `playbooks.provide` | Add playbooks |
| `tasks.provide` | Add tasks |
| `triggers.provide` | Add task trigger sources |
| `commands.provide` | Add commands |
| `tools.provide` | Add tools the assistant can use |
| `tools.override` | Replace a built-in tool with its own |
| `ui.render` | Show extension interface |
| `ui.fullView` | Open full extension views |
| `ui.dialog` | Open dialogs |
| `ui.drawer` | Open drawers |
| `ui.popup` | Open popups |
| `ui.statusBar` | Add controls to the status bar |
| `ui.titleBar` | Add controls to the title bar |
| `ui.workspace` | Add Workspace items |
| `ui.toolbox` | Add toolbox items |
| `ui.emptyPill` | Add empty chat actions |
| `ui.messageInline` | Add controls around messages |
| `ui.composerInline` | Add controls around the message box |
| `ui.pulse` | Add Pulse items |
| `events.subscribe` | Listen for app events |
| `clipboard.write` | Copy text to the clipboard |
| `notifications.show` | Show notifications |

## Settings

Settings are declared in the manifest and rendered by Msty Claw in a consistent drawer.
Use JSON Schema fields with clear titles, descriptions, and defaults. Msty Claw renders strings,
numbers, booleans, enums, textareas, color fields, URL fields, JSON editors, secure secrets, and
extension model-assignment pickers. The drawer can reset fields to defaults, revert unsaved edits,
and show validation messages for required values, URL fields, colors, and numeric bounds.

```json
{
  "contributes": {
    "settings": [
      {
        "id": "preferences",
        "title": "Preferences",
        "schema": {
          "type": "object",
          "properties": {
            "tone": {
              "type": "string",
              "title": "Tone",
              "oneOf": [
                { "const": "brief", "title": "Brief" },
                { "const": "balanced", "title": "Balanced" },
                { "const": "detailed", "title": "Detailed" }
              ],
              "default": "balanced"
            },
            "instructions": {
              "type": "string",
              "title": "Instructions",
              "format": "textarea",
              "x-msty-rows": 5,
              "default": "Focus on concrete risks and next actions."
            },
            "reviewModel": {
              "type": "string",
              "title": "Review model",
              "format": "msty-model-assignment",
              "default": "reviewer"
            },
            "strictness": {
              "type": "integer",
              "title": "Strictness",
              "description": "How aggressively the extension should flag issues.",
              "minimum": 1,
              "maximum": 5,
              "default": 3,
              "x-msty-control": "slider"
            },
            "layout": {
              "type": "string",
              "title": "Layout",
              "oneOf": [
                { "const": "compact", "title": "Compact" },
                { "const": "comfortable", "title": "Comfortable" }
              ],
              "default": "comfortable",
              "x-msty-control": "segmented"
            },
            "showBadge": {
              "type": "boolean",
              "title": "Show badge",
              "default": true
            },
            "apiToken": {
              "type": "string",
              "title": "API token",
              "description": "Stored securely on this device.",
              "format": "password",
              "x-msty-secret": true
            }
          }
        }
      }
    ]
  }
}
```

Useful settings hints:

- Add `"x-msty-sections": [{ "id": "sources", "title": "Sources" }]` on a settings schema
  and `"x-msty-section": "sources"` on fields when a drawer needs clear groups.
- Add `"x-msty-visibleWhen"` to show a field only when a condition over other field values holds.
  It accepts a boolean (`true`/`false`), a short expression string such as `"style == 'review'"`, or
  a rule object such as `{ "field": "mode", "equals": "advanced" }`. Rule objects also support `all`,
  `any`, `not`, `notEquals`, `in`, `contains`, `truthy`, and `exists`.
- `format: "textarea"` or `"x-msty-control": "textarea"` for long text.
- `format: "uri"` or `format: "url"` for URL fields.
- `format: "color"` for color values such as `#f06f58`.
- `format: "json"` or `"x-msty-control": "json"` for editable JSON.
- `format: "msty-model-assignment"` for a picker backed by the extension's `modelAssignments`.
- `"x-msty-control": "slider"` with `minimum` and `maximum` for bounded numbers.
- `"x-msty-control": "segmented"` for short enums with two to four options.
- `format: "file"` or `format: "folder"` when the user should pick a local path.
- `oneOf: [{ "const": "...", "title": "..." }]` for labeled select menus.
- `minimum`, `maximum`, and `multipleOf` for numeric fields.

The installer validates settings schemas against the controls Msty Claw can render. Use an object
root with `properties`, keep field keys to letters, numbers, dots, underscores, dashes, or colons,
and avoid custom widgets that are not listed above. Sliders need numeric `minimum` and `maximum`.
Segmented controls need enum or `oneOf` options and work best with two to four choices.

Runtime access:

```js
const settings = await msty.settings.get();
await msty.settings.set({ ...settings, tone: "brief" });
```

Secret settings use `format: "password"` or `"x-msty-secret": true`. They are saved through the
host secrets store, not normal extension settings. Runtime code reads them through `msty.secrets`
after `secrets.read` is allowed.

```js
const token = await msty.secrets.get("apiToken");
const hasToken = await msty.secrets.has("apiToken");
const keys = await msty.secrets.keys();
```

## Commands

Command contributions appear in the slash menu after the extension is installed, enabled, and
allowed. Use a command when the user should be able to run an extension without hunting for a
specific button.

For slash commands:

- Declare them under top-level `contributes.commands`.
- The key is `contributes`, not `contributions`.
- Request `commands.provide`; without it, command contributions are rejected.
- Implement the runtime `run(command, payload)` handler in the file named by `entry`.
- Listening to `composer.changed` does not register a slash command and will not make `/foo`
  appear in the slash menu. Composer events are for reacting to draft/editor state.

Msty Claw turns the command contribution `id` into the slash name by replacing underscores with
hyphens. For example, `workspace_snapshot` becomes `/workspace-snapshot`. If you set `name` or
`slashName`, use the value users should type without the leading slash.

```json
{
  "permissions": [{ "id": "commands.provide", "required": true, "reason": "Adds a slash command." }],
  "entry": "extension.js",
  "contributes": {
    "commands": [
      {
        "id": "workspace_snapshot",
        "label": "Open workspace snapshot",
        "description": "Open a drawer with the current workspace and model context.",
        "command": "workspace-snapshot.open"
      }
    ]
  }
}
```

Command contributions must include a stable `id`, a visible `label`/`title`/`name`, and the
runtime `command` string handled by `extension.js`. Invalid command entries are rejected during
install instead of appearing as broken slash menu items.

### Minimal Slash Command Extension

This extension adds `/lorem`. Selecting it replaces the current draft with two paragraphs of lorem
ipsum text. The contribution `id` is `lorem`, so the slash name is `/lorem`.

`manifest.json`:

```json
{
  "$schema": "./manifest.schema.json",
  "manifestVersion": 1,
  "id": "com.example.lorem-buddy",
  "name": "Lorem Buddy",
  "version": "1.0.0",
  "description": "Inserts two paragraphs of lorem ipsum text.",
  "icon": "static/icon.svg",
  "compatibility": {
    "extensionApi": "^1.0.0"
  },
  "permissions": [
    {
      "id": "commands.provide",
      "required": true,
      "reason": "Adds a slash command."
    },
    {
      "id": "composer.write",
      "required": true,
      "reason": "Replaces the draft when you choose the command."
    }
  ],
  "entry": "extension.js",
  "contributes": {
    "commands": [
      {
        "id": "lorem",
        "label": "Insert lorem ipsum",
        "description": "Replace the draft with two paragraphs of placeholder text.",
        "command": "lorem.insert"
      }
    ]
  }
}
```

`extension.js`:

```js
// @ts-check
/// <reference path="./msty-extension-api.d.ts" />

const LOREM =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae justo at neque feugiat consequat. Suspendisse potenti. Donec a sem vel augue gravida facilisis.\n\n" +
  "Praesent non arcu sed mi luctus luctus. Curabitur sit amet lectus vitae mauris faucibus cursus. Aenean commodo, nibh at tempor luctus, erat orci blandit risus, in porta mi justo id nibh.";

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  return {
    async run(command) {
      if (command !== "lorem.insert") return;
      return {
        actions: [{ type: "setComposerText", text: LOREM, select: true }]
      };
    }
  };
}
```

`static/icon.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#111827"/>
  <path d="M18 18h28v6H18zm0 12h22v6H18zm0 12h28v6H18z" fill="#f9fafb"/>
</svg>
```

Runtime extensions can also register commands while active. Use this when the command label,
argument hint, or availability depends on settings or current state.

```js
const dispose = msty.commands.register({
  id: "team_clock",
  name: "team-clock",
  label: "Open team clock",
  description: "See current team times and working hours.",
  command: "team-clock.open"
});
```

### Slash Command Troubleshooting

If a slash command does not appear:

- Confirm the extension is installed and enabled.
- Review permissions in Extensions and allow required access.
- Use top-level `contributes.commands`; `contributions.commands` is unsupported.
- Include the `commands.provide` permission.
- Check that each command has `id`, a visible label such as `label`, and `command`.
- Check the slash name derived from the command `id`: `workspace_snapshot` appears as
  `/workspace-snapshot`. Set `name` or `slashName` only when you need a different typed name.
- Inspect the ZIP structure. `manifest.json` must be at the ZIP root beside `extension.js`, not
  inside a wrapper folder.

### Command Results And Declarative Actions

A `run(command, payload)` handler can return a `CommandResult` instead of doing the work itself.
Use this to keep the handler a pure function of its input while Msty Claw performs the visible
effects:

```js
return {
  message: "Draft prepared.",
  actions: [
    { type: "setComposerText", text: "Here is a revised draft.", select: true },
    {
      type: "openUi",
      kind: "drawer",
      request: { id: "draft_notes", title: "Draft Notes", body: "What changed and why." }
    }
  ],
  metadata: { source: "brief-check" }
};
```

A `CommandResult` is `{ message?, actions?, metadata? }`. `message` is shown to the user as a short
toast. `actions` are applied by the host in array order after the handler resolves. `metadata` is
recorded for diagnostics only and is never shown to the user.

Supported actions:

| Action | Effect |
| --- | --- |
| `{ type: "openUi", kind?, request }` | Open a host-managed `dialog`, `drawer`, `popup`, or `fullView` with the given open request. |
| `{ type: "insertComposerText", text, mode?, select? }` | Insert into the draft with `mode` of `insert`, `replace`, `append`, or `prepend`. |
| `{ type: "setComposerText", text, select? }` | Replace the whole draft with `text`. |
| `{ type: "clearComposer" }` | Clear the draft. |
| `{ type: "sendMessage", text }` | Send `text` as a user message. |
| `{ type: "showNotification", title, body?, tone? }` | Show a notification with `tone` of `default`, `success`, `warning`, or `error`. |
| `{ type: "copyText", text }` | Copy `text` to the clipboard. |

Each action mirrors a direct call you could make through `msty.composer.*`, `msty.ui.*`,
`msty.notifications.*`, or `msty.clipboard.*`. Returning actions is the pure-function alternative;
calling the APIs directly is equally valid. Use whichever reads better for the command. The same
permissions apply either way, so an action only runs when the matching permission is granted.

## Runtime Rules, Playbooks, And Tasks

Use manifest `rules`, `playbooks`, and `tasks` for simple packs. Use runtime registration when the
item is computed from settings, remote data, or current workspace context. Runtime registrations use
the same contribution shapes as the manifest and return a disposer.

Install validation enforces the same minimum shape the app needs to show these items: rules need
`id`, `name`, a supported `event`, and an action valid for that event; playbooks need `id` and
`name`; tasks need `id`, a visible name/label/title, and enough body content for their starter type:
`prompt`, `description`, `steps`, `checklist`, `message`, `details`, or `watchInstructions`.

```js
const disposeRule = msty.rules.register({
  id: "release_owner_clarity",
  name: "Release owner clarity",
  event: "user_prompt_submit",
  matcher: { textIncludes: ["release", "deploy", "migration"] },
  action: {
    type: "add_guidance",
    guidance: "Include owner, rollback path, evidence checked, and next verification step."
  }
});

const disposePlaybook = msty.playbooks.register({
  id: "release_handoff_review",
  name: "Release Handoff Review",
  description: "Review ownership, risks, rollback, and verification before handoff.",
  bodyMarkdown: "# Release Handoff Review\n\n- Confirm owner\n- Check rollback\n- List evidence"
});

const disposeTask = msty.tasks.register({
  id: "weekday_release_radar",
  label: "Weekday Release Radar",
  description: "Review active release risks and owners each weekday morning.",
  cadence: "daily",
  prompt: "Return owners, open risks, missing evidence, and next verification steps."
});
```

Required permissions: `rules.provide`, `playbooks.provide`, and `tasks.provide`.

## Task Starters

Task contributions appear as starter templates in Tasks. They are good for reusable scheduled
workflows, weekly reviews, reminders, and recurring checks.

Set `taskType` to choose the starter kind. Omit it for the original scheduled prompt behavior.

| `taskType` | Use it for | Key fields |
| --- | --- | --- |
| `prompt` | A model prompt saved as a task | `prompt`, `steps`, `successCriteria`, manual, cron, or folder-change `trigger` |
| `reminder` | Plain, source-backed, or agent-assisted reminders | `message`, `details`, `reminderMode`, manual, cron, or one-time `trigger` |
| `watcher` | Recurring checks against a user-chosen source | `watchInstructions`, `sourceServerId`, `sourceToolName`, `sourceArguments` |
| `extension` | A task that runs one of this extension's actions | `command`, `commandTitle`, `arguments`, manual, cron, or folder-change `trigger` |

```json
{
  "permissions": [{ "id": "tasks.provide", "required": true, "reason": "Adds task starters." }],
  "contributes": {
    "tasks": [
      {
        "id": "weekly_reset",
        "taskType": "prompt",
        "name": "Weekly Reset",
        "description": "Review open work and choose next-week priorities.",
        "cadence": "weekly",
        "suggestedDay": "Friday",
        "steps": [
          { "title": "Review open work", "detail": "Decide whether to finish, defer, or drop each item." }
        ],
        "successCriteria": ["Every open item has a next state."]
      },
      {
        "id": "after_reset_followup",
        "taskType": "reminder",
        "name": "After-Reset Follow-up",
        "message": "Review follow-ups from the weekly reset.",
        "details": "Check owners, blocked decisions, and stale threads.",
        "trigger": { "kind": "once", "runAtOffsetMinutes": 60 }
      },
      {
        "id": "stale_followup_watcher",
        "taskType": "watcher",
        "name": "Stale Follow-up Watcher",
        "description": "Watch a chosen source for stale follow-ups.",
        "cadence": "daily",
        "watchInstructions": "Only report follow-ups that look stale, blocked, ownerless, or overdue."
      },
      {
        "id": "update_living_wiki",
        "taskType": "extension",
        "name": "Update Living Wiki",
        "description": "Keep the wiki current when source files change.",
        "command": "livingWiki.ingestChangedFiles",
        "commandTitle": "Update Living Wiki",
        "arguments": { "mode": "changed" },
        "trigger": {
          "kind": "manual"
        }
      }
    ]
  }
}
```

If a task contribution includes `prompt`, that text is used directly. Otherwise Msty Claw builds
a scheduled prompt from `description`, `steps`, and `successCriteria`. Reminder starters can use
`trigger: { "kind": "manual" }` for tasks that should run only when started, `trigger:
{ "kind": "once", "runAtOffsetMinutes": 30 }` for one-time reminders, or cron/cadence for repeating
reminders. Prompt and extension task starters can use `trigger: { "kind": "folder.changed", ... }`
to open the task editor on Folder changes with include/exclude patterns prefilled; users still choose
the folder when saving the task.
Extension tasks run the named `command` from the same extension. When the task runs, the command
receives one argument with `source: "automation"`, the saved `arguments`, task details, schedule
time, workspace path, and trigger event details when available.

## Trigger Providers

Trigger providers let an extension start tasks when something changes at an outside source, such as
a new feed item, a new GitHub event, or a new package release. The extension declares a trigger
provider, the user subscribes to it from a task, and Msty Claw polls the provider on its own
schedule. Trigger providers need the `triggers.provide` permission. The three official trigger
extensions (RSS or Atom feeds, GitHub work, and npm package releases) all follow this pattern.

A trigger-provider extension implements an `onTriggerCheck` handler on the object returned from
`activate()`. The host calls it once per enabled subscription on each poll:

```js
// @ts-check
/// <reference path="./msty-extension-api.d.ts" />

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  return {
    async onTriggerCheck(request) {
      const { subscription, cursor, maxEvents, deadlineMs } = request;
      const feedUrl = subscription.config.url;

      // First run: establish a baseline and return no (or only older) events.
      if (cursor == null) {
        const latest = await readLatestId(feedUrl);
        return {
          events: [],
          nextCursor: latest,
          health: { status: "ready", checkedAt: new Date().toISOString() }
        };
      }

      const items = await readItemsSince({ feedUrl, sinceId: cursor, limit: maxEvents });
      return {
        events: items.map((item) => ({
          providerId: subscription.providerId,
          triggerId: subscription.triggerId,
          subscriptionId: subscription.id,
          dedupeKey: item.id,
          occurredAt: item.publishedAt,
          title: item.title,
          summary: item.summary,
          source: { label: item.feedName, url: item.link },
          data: { id: item.id, link: item.link }
        })),
        nextCursor: items.at(-1)?.id ?? cursor,
        health: { status: "ready", checkedAt: new Date().toISOString() }
      };
    }
  };
}
```

`onTriggerCheck(request, msty)` receives:

- `subscription`: the user's enabled subscription, including its `config`, `providerId`, and
  `triggerId`.
- `cursor`: the provider cursor saved from the previous check. It is `null` on the first run.
- `since`: an optional lower-bound timestamp; items at or before it can be skipped.
- `maxEvents`: the most events to return from this check.
- `deadlineMs`: a soft time budget in milliseconds for the whole check.

It returns `{ events, nextCursor?, health? }`. Each event needs a stable `dedupeKey` so repeated
polls do not fire the same task twice. Return `nextCursor` to resume incremental polling on the next
check, or omit it to keep the current cursor. Report `health` so the user sees whether the source is
working: `status` is one of `ready`, `needs_setup`, `auth_expired`, `rate_limited`, `failing`, or
`paused`, with an optional user-facing `message` and `retryAfter`.

Good trigger checks treat the first run (cursor `null`) as a baseline, return no events or only
older ones, and save a starting cursor. After that, fetch only what is new, respect `maxEvents`, and
finish within `deadlineMs` so a slow source does not stall the poll schedule.

## Themes

Theme packages should prefer declarative `themes` contributions. Token names must use the safe
extension theme namespaces: `color.*`, `font.*`, `radius.*`, `density.*`, `background.*`,
`syntax.*`, and `surface.*`. Token values can be a single value or separate `dark` and `light`
values. Theme assets can safely provide packaged background images and packaged font files.

```json
{
  "permissions": [{ "id": "themes.provide", "required": true, "reason": "Adds a theme." }],
  "contributes": {
    "themes": [
      {
        "id": "warm_focus",
        "name": "Warm Focus",
        "previewImage": "static/preview.svg",
        "tokens": {
          "color.accent": { "dark": "oklch(0.68 0.16 32)", "light": "oklch(0.58 0.16 32)" },
          "background.app": { "dark": "oklch(0.18 0.03 32)", "light": "oklch(0.98 0.01 32)" },
          "surface.panel": { "dark": "oklch(0.22 0.03 32)", "light": "oklch(0.99 0.006 32)" },
          "surface.sidebar": { "dark": "oklch(0.15 0.03 32)", "light": "oklch(0.95 0.012 32)" },
          "color.success": "oklch(0.66 0.16 150)",
          "color.warning": "oklch(0.74 0.16 76)",
          "color.info": "oklch(0.68 0.14 232)",
          "font.ui": "Inter, ui-sans-serif, system-ui"
        },
        "assets": {
          "backgroundImage": "static/background.svg",
          "fontUi": "static/brand-ui.woff2",
          "fontMono": "static/brand-mono.woff2"
        }
      }
    ]
  }
}
```

Tokens follow a `namespace.name` pattern, and the host applies the ones it implements. The supported
high-level set is broader than the basics:

- `color.*`: `color.accent`, `color.primary`, `color.border`, `color.ring`, `color.focus`,
  `color.input`, `color.text`, `color.text.muted`, the status tones `color.success`, `color.warning`,
  `color.danger`, and `color.info`, plus each tone's `.foreground` variant, and the matching
  `color.accent.foreground` / `color.primary.foreground`.
- `surface.*`: `surface.panel`, `surface.sidebar`, `surface.card`, `surface.popover`, `surface.input`,
  `surface.muted`, `surface.assistant`, `surface.composer`, `surface.drawer`, `surface.overlay`,
  `surface.accent`, `surface.secondary`, their `.foreground` and `.border` variants, and accents such
  as `surface.sidebar.accent`.
- `background.*`: `background.app`, `background.panel`, `background.overlay`, and `background.opacity`.
- `radius.*`: `radius.control`, `radius.panel`, `radius.pill`, `radius.popover`, `radius.bubble`,
  `radius.composer`, and `radius.assistant`.
- `font.*`: `font.ui`, `font.mono`, `font.serif`, and `font.google`.

Any token value can be a single value or a `{ light, dark }` object, so a theme can supply different
values per color scheme.

The success, warning, info, and danger tokens also color extension chrome badges, Pulse cards, and
host-rendered extension content blocks.

Use `font.google` to load web fonts without packaging font files. Its value is a comma-separated list
of Google Font family specs that the host loads, then reference those families from `font.ui`,
`font.serif`, or `font.mono`:

```json
{
  "tokens": {
    "font.google": "Cormorant Garamond:wght@400;500;600;700, Playfair Display:wght@400;500;700",
    "font.serif": "Cormorant Garamond, ui-serif, Georgia, serif",
    "font.ui": "Playfair Display, ui-sans-serif, system-ui"
  }
}
```

Each family spec in `font.google` must be comma-free. The host splits the list on commas to find
families, so a single family spec cannot itself contain a comma: request weights with `wght@…` and do
not use the variable-axis tuple form. Write `Fraunces:wght@400;500;600;700`, not
`Fraunces:opsz,wght@9..144,400;…` — the tuple form is split into broken families and silently fails to
load. A weight-only request still serves a variable font at its default optical size.

The host loads `font.google` families once through a stylesheet link and the webview caches the font
files, so there is no repeated download cost after first use. Fonts load with `display: swap`, so end
every `font.ui` / `font.serif` / `font.mono` value with a same-category system fallback — that fallback
shows for the moment before the web font arrives:

- Sans: `…, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
- Serif: `…, Georgia, "Times New Roman", serif`
- Mono: `…, ui-monospace, "SF Mono", monospace`

`font.ui`, `font.serif`, and `font.mono` set the app's `--font-sans`, `--font-serif`, and `--font-mono`
variables. To let users pick a font, load several families in `font.google`, then add a theme setting
that binds one of those variables (see Adjustable Theme Settings) to each choice — the host applies the
chosen font live:

```json
{
  "tokens": {
    "font.google": "Mulish:wght@400;500;600;700, Fraunces:wght@400;500;600;700, Space Grotesk:wght@400;500;600;700"
  },
  "settings": {
    "schema": {
      "type": "object",
      "properties": {
        "uiFont": {
          "type": "string",
          "title": "Font",
          "default": "mulish",
          "enum": ["mulish", "fraunces", "spaceGrotesk"],
          "x-msty-enum-labels": ["Mulish", "Fraunces", "Space Grotesk"],
          "x-msty-theme": {
            "variable": "--font-sans",
            "values": {
              "mulish": "'Mulish', ui-sans-serif, system-ui, sans-serif",
              "fraunces": "'Fraunces', Georgia, serif",
              "spaceGrotesk": "'Space Grotesk', ui-sans-serif, system-ui, sans-serif"
            }
          }
        }
      }
    }
  }
}
```

Packaged font assets are the alternative to `font.google`: use `assets.fontUi` or `assets.fontSans`
for the main UI font, `assets.fontMono` for code and compact metadata, and `assets.fontSerif` for
serif text. The host loads packaged fonts with scoped `@font-face` rules and keeps fallback fonts
from the theme token.

Runtime access:

```js
await msty.themes.preview("warm_focus");
await msty.themes.apply("warm_focus");
await msty.themes.resetPreview();
```

### Adjustable Theme Settings

A theme can expose its own controls in the extension's Settings drawer. Theme settings use the same
JSON Schema field model as extension settings, but a field can carry `x-msty-theme` binding metadata
that writes the saved value into one or more app CSS variables while the theme is active.

`x-msty-theme` is a single binding object or an array of them. Each binding is `{ variable, value?,
values? }`:

- `variable` is the app CSS variable to write, including the leading `--`.
- `value` is a template applied to the saved field value.
- `values` maps specific saved values to per-option templates, keyed by the stringified saved value.

Template placeholders are `{{value}}`, `{{percent}}`, `{{inversePercent}}`, and
`{{backgroundImage}}`. `{{percent}}` maps a `0..1` or `0..100` value to `0..100`, and
`{{backgroundImage}}` becomes `url("...")`.

```json
{
  "contributes": {
    "themes": [
      {
        "id": "warm_focus",
        "name": "Warm Focus",
        "tokens": { "color.accent": "oklch(0.68 0.16 32)" },
        "settings": {
          "title": "Warm Focus options",
          "schema": {
            "type": "object",
            "properties": {
              "panelOpacity": {
                "type": "number",
                "title": "Panel opacity",
                "minimum": 0,
                "maximum": 1,
                "default": 0.9,
                "x-msty-control": "slider",
                "x-msty-theme": { "variable": "--panel-opacity", "value": "{{percent}}%" }
              },
              "wallpaper": {
                "type": "string",
                "title": "Wallpaper",
                "format": "file",
                "x-msty-theme": { "variable": "--app-background", "value": "{{backgroundImage}}" }
              },
              "style": {
                "type": "string",
                "title": "Accent style",
                "oneOf": [
                  { "const": "calm", "title": "Calm" },
                  { "const": "review", "title": "Review" }
                ],
                "default": "calm",
                "x-msty-theme": {
                  "variable": "--accent",
                  "values": {
                    "calm": "oklch(0.68 0.16 32)",
                    "review": "oklch(0.7 0.19 25)"
                  }
                }
              },
              "reviewBorder": {
                "type": "boolean",
                "title": "Highlight review border",
                "default": false,
                "x-msty-visibleWhen": "style == 'review'"
              }
            }
          }
        }
      }
    ]
  }
}
```

Theme settings fields support `x-msty-visibleWhen` the same way other settings fields do, so a control
can appear only when another value makes it relevant.

## UI Surfaces

The host owns dialogs, drawers, popups, full views, and app chrome placement. Extensions can declare
UI items in the manifest and handle their commands in `extension.js`. Runtime registration is useful
for dynamic items. If an extension declares and registers the same contribution ID for the same
surface, Msty Claw shows one item and prefers the runtime details.

Pulse items also render inside the Pulse drawer as extension cards. Use `summary`, `detail`,
`actionLabel`, `badge`, `tone`, `updatedAt`, and `staleAfterMinutes` to make the card useful without
opening another view. Call `msty.ui.update({ id, surface: "pulse", ... })` after a refresh.
Users can dismiss extension Pulse cards or snooze them for 24 hours. A dismissed card becomes
visible again when the extension publishes a newer `updatedAt`, so refreshes should always set
`updatedAt` when the card represents new information.

```js
msty.ui.registerWorkspaceItem({
  id: "release_helper_workshop",
  title: "Release Helper",
  label: "Release Helper",
  icon: "static/icon.svg",
  command: "release-helper.open"
});

msty.ui.registerPulseItem({
  id: "deadline_watch",
  title: "Deadline Watch",
  label: "Deadlines",
  summary: "2 deadlines need a look this week.",
  detail: "One launch review is blocked on docs.",
  actionLabel: "Review deadlines",
  badge: "2",
  tone: "warning",
  command: "deadline-watch.open"
});

await msty.ui.openFullView({
  id: "release_helper_view",
  title: "Release Helper",
  content: [
    {
      type: "stats",
      title: "Release readiness",
      items: [
        { label: "Open risks", value: "2", tone: "warning" },
        { label: "Approvals", value: "3" }
      ]
    },
    {
      type: "barChart",
      title: "Coverage",
      description: "Show relative status without building custom UI.",
      items: [
        { label: "Docs", value: 8, max: 10, tone: "success" },
        { label: "Testing", value: 6, max: 10, tone: "warning" }
      ]
    },
    {
      type: "timeline",
      title: "Review path",
      items: [
        { title: "Draft created", timestamp: "09:00", tone: "info" },
        { title: "Approval", label: "Next", description: "Release lead checks the final diff." }
      ]
    },
    {
      type: "callout",
      title: "Next review",
      body: "Confirm rollback and support coverage before shipping.",
      tone: "info"
    }
  ]
});
```

Host-rendered content blocks support `text`, `markdown`, `code`, `callout`, `stats`, `barChart`,
`progress`, `kv`, `list`, `timeline`, `table`, `form`, and `divider`. Prefer these blocks for
dialogs, drawers, popups, and simple full views. Use custom UI only when the view needs bespoke
interaction, live layout, or richer client-side state.

When a dialog, drawer, popup, or full view is declared in the manifest, prefer opening it by
contribution ID. The manifest stays the source of truth for the title, entry file, and default size,
while runtime code supplies only the current content, actions, and context.

```js
await msty.ui.openContribution({
  kind: "drawer",
  id: "release_notes_drawer",
  content: [
    {
      type: "callout",
      title: "Draft ready",
      body: "Review the customer-facing notes before publishing.",
      tone: "info"
    }
  ],
  actions: [{ id: "copy", label: "Copy", variant: "primary" }]
});
```

`kind` is optional when the contribution ID is unique across declared dialogs, drawers, popups, and
full views. Use `msty.ui.openContribution("release_notes_drawer")` for simple opens.
For custom full views that need fresh data, open the view first with `context: { loading: true }`,
then call `msty.ui.updateSurface(...)` with the loaded snapshot. This keeps navigation immediate and
lets the view decide whether to show skeleton rows, cached data, or an empty state.

Chrome items can show lightweight state without opening a custom view. Manifest and runtime UI
items support `badge`, `tone`, `disabled`, and `disabledReason`. Use `msty.ui.update(...)` when a
runtime item needs to refresh its label, badge, tone, command, or disabled state.
Use `emptyPillItems` or `msty.ui.registerEmptyPillItem(...)` for compact starter actions that only
belong in empty or low-context chats. Keep labels short, and usually pair them with
`when: "chat.empty && composer.empty"` so they do not compete with an active draft.
Use `when` to keep controls out of the way until they fit the current context. Supported conditions
include `chat.active`, `chat.empty`, `chat.hasMessages`, `message.role == assistant`,
`message.role == user`, `composer.hasText`, `composer.empty`, `composer.canEdit`,
`composer.hasSelection`, `workspace.open`, and `view == extensions`. Combine simple conditions with
`&&`, `||`, and `!`. Unknown conditions stay hidden.

```js
await msty.ui.update({
  id: "focus_status",
  surface: "statusBar",
  label: "Focus",
  badge: "18m",
  tone: "success",
  tooltip: "18 min left in Deep work"
});
```

Host-managed dialogs, drawers, popups, and full views support either a simple `body` string or a
structured `content` array. Dialogs, drawers, and popups open as overlays. Full views open as a
dedicated app workspace so the extension has room for sustained work without covering the chat in a
modal. Use structured content when the extension needs a polished layout without owning a custom UI
runtime.

For long-running work, open the native surface immediately, then update it as progress changes.
`msty.ui.updateSurface(...)` patches the open surface with the same `id` and `kind`; it can replace
the title, body, content blocks, actions, close label, width, or context. `msty.ui.closeSurface(...)`
closes the surface with a JSON result. Both calls require the same UI permission as the surface.

```js
const opened = msty.ui.openDrawer({
  id: "readiness",
  title: "Readiness",
  content: [{ type: "progress", label: "Starting", value: 10, max: 100 }]
});
void Promise.resolve(opened).catch(() => undefined);

await msty.ui.updateSurface({
  kind: "drawer",
  id: "readiness",
  content: [
    { type: "progress", label: "Drafting checklist", value: 60, max: 100 },
    { type: "text", text: "Checking context and release notes." }
  ]
});
```

For a dedicated extension-owned interface, pass an `entry` file without `body` or `content`. Msty
Claw mounts it in a sandboxed frame and calls `mount({ root, msty, context, extension })`. Use this
when the view needs local interaction, filtering, custom layout, or a richer workspace than content
blocks provide. If a request includes `body` or `content`, Msty Claw renders that host-managed
content instead of mounting the custom entry. The frame cannot access the app DOM. It can read the
supplied context, resolve a value back to the host, load packaged assets, and call permission-gated
host APIs through the `msty` bridge.
Custom UI frames receive the current theme as CSS variables such as `--background`,
`--foreground`, `--primary`, `--border`, `--font-sans`, `--extension-success`, and
`--extension-warning`. They can also read a snapshot with `msty.theme.getTokens()` or
`msty.surface.theme.tokens`.

Custom UI frames also get `msty.surface`, a small lifecycle API for native-feeling embedded views:

- `msty.surface.getSnapshot()` returns `{ id, requestId, title, context, theme, width, height, focused, visible }`.
- `msty.surface.on(type, handler)` listens for one lifecycle event. Use `"*"` or omit the type to listen to all surface events.
- `msty.surface.close(result)` closes the host-managed surface and returns `result` to the opener. Calling it with no value returns `{ dismissed: true }`.

Supported surface events are:

| Event | When it fires |
| --- | --- |
| `surface.ready` | The custom entry finished mounting. |
| `surface.hostReady` | The host frame is loaded and has current theme/frame metadata. |
| `surface.resize` | The embedded frame size changed. |
| `surface.focus` / `surface.blur` | The embedded frame gained or lost focus. |
| `surface.visibilityChanged` | The frame became visible or hidden. |
| `surface.themeChanged` | Msty Claw theme tokens changed while the view is open. |

```js
// extension.js
await msty.ui.openFullView({
  id: "prompt_library",
  title: "Prompt Library",
  entry: "ui.js",
  context: { snippets }
});
```

```js
// ui.js
// @ts-check
/// <reference path="./msty-extension-api.d.ts" />

import { escapeHtml } from "./ui-helpers.js";
import "./ui.css";

/** @param {Msty.SurfaceMountContext} params */
export async function mount({ root, msty, context }) {
  const disposeSurface = msty.surface.on("*", (event) => {
    if (event.type === "surface.themeChanged") {
      root.dataset.theme = event.surface.theme.colorScheme;
    }
  });
  const iconUrl = await msty.assets.url("static/icon.svg");
  root.innerHTML = context.snippets
    .map((snippet, index) => `
      <button data-index="${index}">
        <img src="${escapeHtml(iconUrl)}" alt="" />
        ${escapeHtml(snippet.name)}
      </button>
    `)
    .join("");

  root.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", async () => {
      const snippet = context.snippets[Number(button.dataset.index)];
      await msty.composer.insertText({
        text: snippet.prompt,
        mode: "insert"
      });
      await msty.storage.local.patch("usage", { lastPrompt: snippet.name });
      await msty.notifications.show({ title: "Prompt inserted", tone: "success" });
      msty.surface.close({ inserted: snippet.name });
    });
  });

  window.addEventListener("pagehide", disposeSurface, { once: true });
}
```

Custom UI entries can import relative JavaScript modules from the package. Side-effect CSS imports
such as `import "./ui.css";` are injected into the sandbox frame. Runtime workers and custom UI can
load images, text, JSON, and other static files with:

- `await msty.assets.url("static/icon.svg")`
- `await msty.assets.text("templates/review.md")`
- `await msty.assets.json("data/options.json")`

Custom UI frames also provide `await msty.assets.injectCss("ui.css")` for scoped packaged CSS.
Runtime worker code should use `url`, `text`, or `json`.

The custom UI bridge exposes the same permission checks as runtime extensions for context, chats,
messages, composer edits, model inference, storage, secrets, diagnostics, settings, clipboard,
notifications, network fetches, themes, live event subscriptions, and opening additional
host-managed UI surfaces. Use `msty.events.subscribe(handler, options)` inside custom UI when the
view should update as the active chat, composer, messages, or assistant turn changes.

Supported content blocks:

| Block | Use it for |
| --- | --- |
| `text` | Short prose, summaries, and generated notes |
| `callout` | Warnings, success notes, and next-step guidance |
| `markdown` | Safe formatted summaries, release notes, and brief reports |
| `code` | JSON, command output, snippets, and source previews |
| `progress` | Completion, readiness, or confidence status |
| `stats` | Compact counts and status metrics |
| `kv` | Labels and values such as workspace, model, owner, date |
| `list` | Ordered or unordered action lists |
| `table` | Small tabular summaries |
| `form` | Text, textarea, number, checkbox, and select inputs |
| `divider` | Separating related groups |

Form blocks return values with the selected action:

```js
const result = await msty.ui.openDialog({
  id: "risk_review",
  title: "Risk Review",
  content: [
    {
      type: "form",
      title: "Decision",
      fields: [
        { type: "text", id: "owner", label: "Owner", required: true },
        {
          type: "select",
          id: "decision",
          label: "Decision",
          required: true,
          options: [
            { label: "Accept", value: "accept" },
            { label: "Defer", value: "defer" }
          ]
        },
        { type: "textarea", id: "note", label: "Note" },
        { type: "checkbox", id: "notifyTeam", label: "Notify the team", defaultValue: true }
      ]
    }
  ],
  actions: [{ id: "save", label: "Save", variant: "primary" }]
});

if (result?.actionId === "save") {
  await msty.storage.workspace.set("latest_decision", result.values);
}
```

Use the small interaction helpers for common user-triggered choices. They all render Msty Claw-owned
dialogs and require `ui.dialog`.

```js
const confirm = await msty.ui.confirm({
  title: "Accept these risks?",
  body: "Save this review as accepted.",
  confirmLabel: "Accept risk",
  cancelLabel: "Keep reviewing",
  tone: "danger"
});

const note = await msty.ui.prompt({
  title: "Decision note",
  label: "Note",
  multiline: true,
  required: false
});

const filter = await msty.ui.pick({
  title: "Decision Log",
  label: "Show",
  options: [
    { label: "Open decisions", value: "open" },
    { label: "All decisions", value: "all" }
  ]
});
```

Prefer these helpers when an agent-generated extension only needs confirmation, one text value, or
one selected option. Use `openDialog`/`openDrawer` with content blocks for multi-step review screens.

When the choice is a model, never rebuild provider/model lists in extension UI. Use
`msty.ui.pickModel` so the user sees the app's own provider-grouped model picker, and the extension
receives only provider and model IDs — never credentials:

```js
const picked = await msty.ui.pickModel({
  title: "Choose a fallback model",
  defaultValue: current ?? undefined
});
if (picked.selected) {
  await saveTarget({ providerId: picked.providerId, model: picked.model });
}
```

Host-managed `form` content blocks accept the same control as a `model` field. Its submitted value
is a `{ providerId, model }` object, or `null` when nothing is chosen:

```js
{
  type: "form",
  fields: [
    { type: "model", id: "writer", label: "Writing model", required: true }
  ]
}
```

Inline message items use `placement: "message.before"` or `placement: "message.after"`.
When a user activates an inline item, command handlers receive a small activation context as the
first argument. It includes the surface, placement, message ID, and message role. Message content is
not included unless the extension requests `messages.read` and calls `msty.messages.get(messageId)`.
Add `summary`, `detail`, and `actionLabel` when the inline item should render as a richer card
instead of a compact action pill.

```json
{
  "contributes": {
    "messageInlineItems": [
      {
        "id": "source_check",
        "label": "Check sources",
        "summary": "Compare this answer with configured source notes.",
        "detail": "Returns a structured verdict.",
        "actionLabel": "Run check",
        "placement": "message.after",
        "command": "source-check.run"
      }
    ]
  }
}
```

```js
export async function activate(msty) {
  return {
    async run(command, context) {
      if (command !== "source-check.run") return;
      await msty.ui.openDrawer({
        id: "source-check.drawer",
        title: "Source Check",
        body: `Reviewing ${context.messageRole} message ${context.messageId}.`
      });
    }
  };
}
```

## Context, Model Inference, And Storage

Use `msty.platform.getCapabilities()` when an extension needs a safe snapshot of what this host and
this extension can currently do: granted and pending permissions, usable UI surfaces, supported
host-rendered content blocks, host-managed interaction helpers, storage quotas, network origins, declared themes, and always-on
features such as app navigation, permission recovery, jobs, job-runner helpers, and packaged assets. It does not expose other extensions or provider
credentials.

Prefer checking the matching capability over assuming an API exists. The snapshot groups permissions
by state (`granted`, `pending`, `denied`, `revoked`, `unavailable`, `required`, `optional`), reports
per-surface `canUse`, exposes storage limits (`maxValueBytes`, `maxScopeBytes`), and includes a
`features` map of boolean flags (`commands`, `rules`, `triggers`, `secretsRead`, `resources`,
`documents`, `clipboardWrite`, `notifications`, and more). It also reports the extension's
`trustLevel`. Treat the shape as additive and ignore unknown fields.

```js
const platform = await msty.platform.getCapabilities();
if (!platform.surfaces.fullView.canUse) {
  await msty.ui.showToast("Review extension access before opening the full view.");
  await msty.app.openExtension({ section: "permissions" });
  return;
}
if (!platform.features.clipboardWrite) {
  // Skip the Copy action instead of calling an unavailable API.
}
```

Use `msty.app` for fix-forward navigation into Msty Claw-owned screens. It does not open arbitrary
routes or other extensions; it can only open the calling extension's dashboard drawer sections and a
small set of safe Settings tabs.

```js
await msty.app.openExtension({ section: "permissions" });
await msty.app.openExtension({ section: "settings" });
await msty.app.openModelAssignments({ assignmentId: "meeting_brief_writer" });
await msty.app.open("settings.providers");
```

Prefer this when a user can immediately fix the issue: missing permissions, incomplete settings,
storage cleanup, extension logs, failed jobs, or an unassigned model slot.

Use `context.read` for the current app snapshot. The snapshot is host-owned and includes
the active conversation, recent messages, composer state, invocation source, workspace,
view, provider, and model when those are available.

```js
const context = await msty.context.getCurrent();
const latest = context.recentMessages?.at(-1);
```

Prefer `msty.context.getBrief()` when an extension needs a concise, user-safe summary of the
current work instead of raw message text. The default brief includes workspace, view, chat, model,
composer length, usage estimates, and recent message metadata only.

```js
const brief = await msty.context.getBrief({
  includeMessages: "metadata",
  maxMessages: 6
});
```

Use `includeMessages: "excerpts"` only when short text previews are necessary. Excerpts require
both `context.read` and `messages.read`; metadata-only briefs require only `context.read`.

Use `msty.context.getUsage()` when an extension needs to adapt to the visible context size before
opening a model-heavy workflow. Token counts are estimates, but they are stable enough for warnings,
summaries, and choosing a smaller `maxOutputTokens`.

```js
const usage = await msty.context.getUsage();
if (usage.guidance.shouldSummarize) {
  await msty.ui.openPopup({
    id: "context_size",
    title: "Large context",
    content: [
      {
        type: "callout",
        title: "Summarize first",
        body: usage.guidance.reason,
        tone: "warning"
      }
    ]
  });
}
```

The snapshot includes per-area breakdowns, not just a total and guidance, so an extension can show
where the context size comes from:

```ts
{
  timestamp;
  activeConversationId?; workspacePath?; providerId?; model?;
  messages: {
    recentCount; includedCount; characters; estimatedTokens;
    byRole: Array<{ role; count; characters; estimatedTokens }>;
  };
  composer: {
    characters; selectedCharacters; estimatedTokens; selectedEstimatedTokens;
    hasSelection; canEdit?;
  };
  total: { characters; estimatedTokens };
  guidance: {
    shouldSummarize; maxPromptCharacters; maxPromptTokens; maxOutputTokens; reason?;
  };
}
```

Use `messages.byRole` to show which roles dominate the context, `composer.selectedEstimatedTokens`
to size a rewrite of just the selection, and `guidance.maxOutputTokens` to clamp a request before
it starts.

Use `chats.read` and `messages.read` when an extension needs focused chat or message
lists instead of the compact context snapshot. Use `chats.write` only for explicit
user-triggered actions that create or switch chats.

```js
const currentChat = await msty.chats.getCurrent();
const messages = await msty.messages.list({
  roles: ["user", "assistant"],
  query: "release",
  limit: 10
});
const messageId = activationContext.messageId;
const clicked = messageId ? await msty.messages.get(messageId) : null;
await msty.messages.open({ messageId, chatId: clicked?.chatId, highlight: true });
```

Inline message items receive an activation context with `messageId`, `messageRole`, and placement.
Use `messages.get(messageId)` after requesting `messages.read` when the action needs the actual
clicked message content.
`context.getCurrentSelection()` can return `source: "message"` with selected text, `chatId`,
`messageId`, role, and best-effort offsets when the host can tie the current selection to a message.
Message snapshots include `chatId`, `index`, and `contentLength` when the host can provide them.
Use `includeContent: false` for metadata-only lists, and filters such as `roles`, `query`,
`beforeMessageId`, `afterMessageId`, `createdBefore`, `createdAfter`, `order`, and `offset` when
an extension only needs a focused slice of the active chat.

Create or switch chats through `msty.chats` only after the user chooses that action:

```js
await msty.chats.create({
  title: "Follow-up",
  draft: "Use this as the starting point.",
  switchTo: true
});

await msty.chats.open("chat_123");
```

Use `msty.chats.startRun(...)` when a user action should create a new chat and start
work there without moving the user away from the current chat. This requires both
`chats.write` and `messages.write`.

```js
await msty.chats.startRun({
  title: "Follow-up",
  prompt: "Investigate the failing test and suggest the smallest fix.",
  switchTo: false
});
```

Use `messages.write` sparingly. It sends a user-visible prompt into the current chat.

```js
await msty.messages.append({
  role: "user",
  content: "Summarize the last decision and list the owner."
});
```

Use `preSendHooks` or `msty.messages.registerPreSendHook(...)` when an extension should review a
draft before it is sent. Hooks receive the exact outgoing text plus the current conversation,
workspace, provider, and model. They can allow the send, suggest a review note, replace the draft
for user approval, or block the send with a clear message.

```json
{
  "permissions": [{ "id": "messages.hooks", "required": true, "reason": "Reviews drafts before sending." }],
  "entry": "extension.js",
  "contributes": {
    "preSendHooks": [
      {
        "id": "brief_check",
        "title": "Brief Check",
        "command": "brief-check.review",
        "mode": "transform",
        "when": "composer.hasText"
      }
    ]
  }
}
```

```js
export async function activate() {
  return {
    async run(command, payload) {
      if (command !== "brief-check.review") return { decision: "allow" };
      if (payload.text.length > 80) return { decision: "allow" };
      return {
        decision: "replace",
        title: "Brief Check tightened the draft",
        message: "Review the clearer draft before sending.",
        text: `Please answer this with the goal, constraints, and next step:\n\n${payload.text}`
      };
    }
  };
}
```

Hook modes limit what the runtime can do: `observe` can only allow, `suggest` can pause with a
note, `transform` can replace the composer draft, and `block` can stop the send. Prefer
`transform` for helpful rewrites because the user reviews the new draft before sending.

Use `chatContextProviders` when an extension should make a knowledge source available from the
chat toolbar. When the source is enabled for a chat, the provider receives the next outgoing prompt
so it can find matching evidence. A provider returns bounded context and citations; the host keeps
the user's visible message unchanged, caps the combined knowledge packet, and adds the returned
context only to the model input. Use this for wikis, project notes, local search, or domain-specific
evidence. Do not use it to rewrite the user's prompt or to run a separate Ask flow.

```json
{
  "permissions": [{ "id": "context.provide", "required": true, "reason": "Reads your outgoing prompt when this source is on so it can add matching wiki pages." }],
  "entry": "extension.js",
  "contributes": {
    "chatContextProviders": [
      {
        "id": "wiki",
        "label": "Wiki",
        "description": "Use selected wiki pages in chat.",
        "command": "wiki.provideContext",
        "mode": "manual",
        "when": "composer.hasText"
      }
    ]
  }
}
```

```js
export async function activate() {
  return {
    async run(command, request) {
      if (command !== "wiki.provideContext") return null;
      return {
        title: "Wiki",
        content: "wiki/index.md\n\nRelevant page excerpts...",
        citations: ["wiki/index.md", "wiki/concepts/onboarding.md"],
        instructions: "Cite wiki paths when using this context."
      };
    }
  };
}
```

Use `agentHarnesses` when an extension should provide the assistant behavior prompt for normal
turns. This is still a regular extension permission: the user reviews `agent.behavior`, chooses
whether to use the behavior in Extensions, and the host remains responsible for actual tool
availability. The command receives `Msty.AgentHarnessInput` and should return either a string or
`{ systemPrompt }`.

Treat the command as a pure prompt renderer. The host may ask for the prompt while estimating
prompt size, retrying, or preparing the final model turn, so behavior commands should not write
storage, call models, send network requests, or mutate app state.

```json
{
  "permissions": [{ "id": "agent.behavior", "required": true, "reason": "Provides an assistant behavior prompt for chat turns." }],
  "entry": "extension.js",
  "contributes": {
    "agentHarnesses": [
      {
        "id": "careful-research",
        "label": "Careful Research",
        "description": "Uses a research-focused assistant behavior.",
        "command": "research.renderPrompt"
      }
    ]
  }
}
```

```js
export async function activate() {
  return {
    async run(command, input) {
      if (command !== "research.renderPrompt") return null;

      const webSearch = input.availability.web.search
        ? "Use web search when current facts matter."
        : "Do not claim current facts unless the user supplied them.";
      const computerUse = input.availability.computerUse.available
        ? "Use computer actions only when they are necessary for the user's task."
        : "Computer actions are unavailable in this turn.";

      return {
        systemPrompt: [
          "You are a careful research assistant.",
          "Prioritize primary sources, dated evidence, and clear uncertainty.",
          webSearch,
          computerUse,
          input.instructions.project
            ? `Project instructions:\n${input.instructions.project}`
            : "",
          input.instructions.custom
            ? `User instructions:\n${input.instructions.custom}`
            : ""
        ].filter(Boolean).join("\n\n")
      };
    }
  };
}
```

Use `postMessageHooks` or `msty.messages.registerPostMessageHook(...)` when an extension should
observe assistant turn milestones after the user sends. Post-message hooks receive metadata only:
phase, chat ID, workspace, provider, model, user/assistant message IDs, content lengths, duration,
and an error string for failed or stopped turns. They do not receive full prompt or answer text; use
`messages.read` separately when a user-triggered action genuinely needs message content.

Supported phases:

```text
message.sent
assistant.started
assistant.completed
assistant.failed
assistant.stopped
```

```json
{
  "permissions": [{ "id": "messages.hooks", "required": true, "reason": "Records assistant turn milestones." }],
  "entry": "extension.js",
  "contributes": {
    "postMessageHooks": [
      {
        "id": "turn_journal",
        "title": "Turn Journal",
        "command": "turn-journal.record",
        "phases": ["message.sent", "assistant.completed", "assistant.failed", "assistant.stopped"],
        "when": "chat.active"
      }
    ]
  }
}
```

```js
export async function activate(msty) {
  return {
    async run(command, payload) {
      if (command !== "turn-journal.record") return;
      const current = await msty.storage.local.get("turns") ?? [];
      await msty.storage.local.set("turns", [
        {
          phase: payload.phase,
          conversationId: payload.conversationId,
          model: payload.model,
          durationMs: payload.durationMs
        },
        ...current
      ].slice(0, 25));
    }
  };
}
```

Use `composer.read` and `composer.write` when an extension needs to help with the draft
the user is editing. Prefer inserting or replacing text so the user can review it before
sending.

```js
const composer = await msty.composer.getDraft();
await msty.composer.insertText({
  text: `\n\nFollow-up: ${composer.text}`,
  mode: "append"
});
```

Composer snapshots include `selectionStart`, `selectionEnd`, `selectedText`, `beforeSelection`,
`afterSelection`, `hasSelection`, `isFocused`, and `canEdit` when the host has those details. Use
`selectedText` for focused rewrite tools instead of making the extension slice the draft itself.

Use `models.infer` for independent model calls. Msty Claw controls provider credentials, privacy
settings, rate limits, cancellation, and logging.

```js
const result = await msty.models.infer({
  prompt: "Draft a concise release note from the current context.",
  modelAssignment: "release-notes",
  maxOutputTokens: 700
});
```

Use `models.stream` when the user is watching a custom UI, drawer, or full view and needs progress
plus cancellation. The handler receives `start`, `text_delta`, `reasoning_delta`, `complete`,
`cancelled`, and `error` events. `text_delta.text` is the accumulated text so the UI does not need
to reassemble chunks unless it wants to.

```js
const stream = msty.models.stream(
  {
    prompt: "Turn these rough notes into a meeting brief.",
    modelAssignment: "meeting_brief_writer",
    maxOutputTokens: 900
  },
  (event) => {
    if (event.type === "text_delta") {
      root.querySelector("[data-brief]").textContent = event.text;
    }
    if (event.type === "cancelled") {
      root.querySelector("[data-status]").textContent = "Stopped";
    }
  }
);

root.querySelector("[data-stop]").addEventListener("click", () => stream.cancel());
const final = await stream.done;
```

For predictable model output, request structured JSON. The returned object is available on
`result.json`; `result.text` still contains the raw model text for debugging or fallback display.

```js
const result = await msty.models.infer({
  prompt: "Check this claim against the source notes.",
  responseFormat: {
    type: "json",
    name: "source_check",
    schema: {
      type: "object",
      properties: {
        verdict: { type: "string" },
        confidence: { type: "string" },
        saferRewrite: { type: "string" }
      },
      required: ["verdict", "confidence", "saferRewrite"]
    },
    strict: true
  }
});

const verdict = result.json?.verdict ?? "Needs review";
```

When an extension contributes `modelAssignments`, `models.infer` accepts either the local
contribution ID or the full host ID. `models.listAssignments()` returns the full IDs if the
extension wants to show or store the exact target. It also includes readiness fields when the host
can resolve them: `ready`, `configured`, `source`, `providerId`, `providerName`, `model`, and
`unavailableReason`. Users map extension slots in Settings under Model Assignments, in the
Extensions section.

Model assignment contributions must include `id` and a visible `label`. Use `description` to tell
the user what kind of model should be assigned to that slot.

```js
const assignments = await msty.models.listAssignments();
const writer = assignments.find((assignment) => assignment.contributionId === "release_notes");
const status = await msty.models.getStatus(writer?.id ?? "release_notes");
if (!status.ready) {
  await msty.ui.showToast(status.unavailableReason || "Choose a model for this extension.");
  return;
}

const result = await msty.models.infer({
  prompt: "Draft the release notes.",
  modelAssignment: writer?.id ?? "release_notes"
});
```

Use `models.getStatus()` before opening long-running custom UI or starting a model-heavy command.
It accepts no argument for the current fallback model, a local contribution ID, a full assignment
ID, or `{ modelAssignment }`.

Use `models.getCapabilities()` when the extension needs to choose between streaming and a single
response, clamp output size to host limits, or show a model readiness summary before work starts.
It returns booleans such as `canInfer` and `canStream`, host limits, the default model status, and
the extension's model assignment slots.

```js
const capabilities = await msty.models.getCapabilities();
const maxOutputTokens = Math.min(capabilities.limits.maxOutputTokens, 900);
if (!capabilities.canInfer) {
  await msty.ui.showToast(
    capabilities.guidance.unavailableReason || "Choose a model before running this extension."
  );
  await msty.app.openModelAssignments({ assignmentId: "release_notes" });
  return;
}

if (capabilities.canStream) {
  // Use msty.models.stream(...) for visible generation.
} else {
  // Use msty.models.infer(...) and show the final result at once.
}
```

### Virtual Models

With `models.provide`, an extension can register selectable model-picker entries that resolve to a
concrete model per request — routing entries like Smart Route packs. Register entries during
`activate` (they live while the runtime is active; `events.subscribe` gives startup activation) and
handle the resolve command the host calls when the user sends with that entry selected:

```js
const dispose = msty.models.registerVirtualModel({
  id: pack.id,
  label: pack.name,
  description: "Picks from 3 routes per message",
  group: "Smart Route",
  command: "smart-route.resolve"
});
```

The resolve command receives the entry ID, message text, available provider IDs, and any cached
decision, and returns `{ status: "resolved", providerId, model, reason }` or
`{ status: "unresolved", message }`. Always resolve to something when configuration allows it — an
unresolved entry blocks the user's send with your message.

Use `msty.models.listAvailableModels()` to offer model choices in extension config. It returns
provider and model IDs plus display names only, never credentials.

### Tools

With `tools.provide`, an extension can add tools the assistant can call. Declare them in
`contributes.tools`; the host exposes each one to the model and routes calls to your `run()` handler:

```js
// manifest.json
{
  "contributes": {
    "tools": [
      {
        "id": "wikiImageSearch",
        "name": "wiki_image_search",
        "description": "Search Wikipedia for images matching a query.",
        "command": "wiki.imageSearch",
        "inputSchema": {
          "type": "object",
          "properties": { "query": { "type": "string" } },
          "required": ["query"]
        }
      }
    ]
  }
}
```

When the assistant calls the tool, the host invokes `run(command, input)` with the model's
arguments. Return a string, a `{ content, isError }` object, or any JSON value (it is serialized for
the model):

```js
export async function activate(msty) {
  return {
    async run(command, input) {
      if (command === "wiki.imageSearch") {
        const results = await searchImages(input.query);
        return { content: formatResults(results) };
      }
    }
  };
}
```

Tools are discoverable: the assistant can search for one by capability, so a clear `name` and
`description` matter.

To replace a built-in tool, set `overrides` to its name and add the `tools.override` permission. The
tool then takes over that name. For example, an extension web search can supersede the built-in one:

```js
{
  "id": "myWebSearch",
  "name": "web_search",
  "description": "Search the web via Example.",
  "command": "search.run",
  "overrides": "web_search"
}
```

The host still applies the built-in's access checks by name, so an override of `web_search` stays
subject to the user's web-access setting. When two extensions claim the same name, the higher
`priority` wins.

An additive tool's `name` must be new: it cannot reuse a built-in's name (use `overrides` to take one
over). Capability built-ins like `web_search` and `web_fetch` can be overridden, but the control and
host tools the assistant relies on (`search_tools`, `todo_write`, `shell`, `computer_use`, and the
subagent tools) cannot. An override that targets one of those is ignored.

### On-Device Local Models

Declare models the extension needs on this device under `contributes.localModels` (runtime
`"ollama"` or `"mlx"`, plus the runtime's model ID and an approximate `sizeBytes`). The host owns
download, storage, and execution; the extension never ships native code. This needs the
`models.local` permission.

```js
const status = await msty.models.getLocalModelStatus({ localModel: "navigator" });
if (!status.installed && !status.downloading) {
  await msty.models.requestLocalModelDownload({ localModel: "navigator" });
}
```

Poll `getLocalModelStatus` while `downloading` to show progress (`progress` is a whole-number
percentage). Run the model with `msty.models.infer({ localModel: "navigator", ... })` once
`installed` and `runtimeReady` are true.

Declared local models are extension implementation details: the host keeps them out of user-facing
model pickers and out of `listAvailableModels`, while provider management screens still show them so
users can delete the files. Never show the underlying model ID in extension UI — use your
contribution's `label`.

Use `network.fetch` for permission-gated HTTP and HTTPS requests. Extension workers cannot call
ambient `fetch`; all network access goes through the host so permissions, timeouts, credentials, and
response limits stay consistent.

Extensions that request `network.fetch` must also declare allowed origins in the manifest. Use exact
origins when possible, and use `https://*` only for tools that intentionally fetch user-provided
URLs.

```js
// manifest.json
{
  "network": {
    "allowedOrigins": ["https://api.example.com"]
  }
}
```

```js
const response = await msty.network.fetch({
  url: "https://api.example.com/status.json",
  headers: {
    Accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  },
  responseType: "json",
  timeoutMs: 10000,
  maxBytes: 250000
});

if (response.ok && response.json) {
  await msty.storage.local.set("last_status", response.json);
}
```

Use `msty.resources` when an extension needs a user-selected local file or needs to save a
user-requested export. Request `files.read` or `files.write` as optional permissions unless local
file access is central to the extension. The host picker grants the extension a handle for the
chosen file; it does not grant broad filesystem access.

```js
const ready = await msty.permissions.ensure({
  permissions: ["files.read"],
  reason: "Choose and read the JSON file you want to validate.",
  openReview: true
});
if (!ready.ok) return;

const picked = await msty.resources.pickFile({
  title: "Choose JSON file",
  filters: [{ name: "JSON", extensions: ["json"] }]
});

if (!picked.cancelled && picked.resources[0]) {
  const file = picked.resources[0];
  const result = await msty.resources.readText({
    path: file.path,
    maxBytes: 250000
  });
  await msty.storage.local.set("last_file", {
    name: result.name,
    bytesRead: result.bytesRead,
    truncated: result.truncated
  });
}
```

`readJson(pathOrRequest)` is available for selected JSON files. Use `readText` when you need to
handle parse errors yourself or show a truncated preview.

Folder picks are persistent grants for that extension. `pickFolder()` includes nested files and
folders by default, which is what project-style tools usually need. After a user chooses a folder,
`msty.resources.list({ path, recursive, maxEntries })` can list files inside it, and
`readText`/`readJson` can read files under that folder. With `files.write`, `writeText`,
`writeJson`, and `remove` can update files inside a chosen folder. The host still rejects paths
outside the selected folder.

```js
const picked = await msty.resources.pickFolder({ title: "Choose wiki folder" });
if (picked.cancelled || !picked.resources[0]) return;

const root = picked.resources[0].path;
const files = await msty.resources.list({
  path: `${root}/sources`,
  recursive: true,
  maxEntries: 1000
});

await msty.resources.writeText({
  path: `${root}/wiki/index.md`,
  text: "# Index\n\nUpdated by Living Wiki.\n"
});
```

Use `msty.documents.extractText` when the extension needs readable text from a selected document.
It requires `files.read`, uses the same file or folder grant as `msty.resources`, and supports text
files and PDFs. PDF extraction runs through the host's local document extractor.

```js
const extracted = await msty.documents.extractText({
  path: `${root}/sources/onboarding-research.pdf`,
  kind: "pdf",
  maxPages: 50,
  ocr: "auto"
});

if (extracted.warnings.length > 0) {
  await msty.diagnostics.warn("Document had extraction warnings", {
    name: extracted.name,
    warnings: extracted.warnings
  });
}
```

Use `saveText` or `saveJson` only after the user chooses an export action. Saving opens the host
save dialog and requires `files.write`; it does not let the extension write arbitrary paths.

```js
const readyToSave = await msty.permissions.ensure({
  permissions: ["files.write"],
  reason: "Save the report you requested.",
  openReview: true
});
if (!readyToSave.ok) return;

const saved = await msty.resources.saveJson({
  title: "Save report",
  defaultPath: "extension-report.json",
  filters: [{ name: "JSON", extensions: ["json"] }],
  value: {
    checkedAt: new Date().toISOString(),
    summary: "Ready for review"
  },
  pretty: 2
});

if (!saved.cancelled) {
  await msty.diagnostics.info("Saved report", {
    name: saved.resource?.name,
    bytesWritten: saved.bytesWritten
  });
}
```

Use `storage.local` for device-local extension data, `storage.chat` for data scoped to the active
chat, and `storage.workspace` for workspace-scoped data. Storage values must be JSON. Each value can
be up to 256 KB, and each storage scope can hold up to 2 MB per extension. Chat storage requires an
open chat and automatically separates the same key across chats.
Users can inspect and clear an extension's saved storage from its drawer in Extensions.
Do not store tokens, API keys, or private credentials here; use secret settings and `msty.secrets`
for sensitive values.

```js
await msty.storage.local.set("preferences", { tone: "brief" });
const preferences = await msty.storage.local.get("preferences");
await msty.storage.local.patch("preferences", { tone: "direct" });
await msty.storage.chat.set("pins", { items: [] });
const chatPins = await msty.storage.chat.get("pins");
const keys = await msty.storage.local.keys();
await msty.storage.workspace.remove("draft");
```

Use `msty.storage.local.migrate(...)`, `msty.storage.chat.migrate(...)`, or
`msty.storage.workspace.migrate(...)` when saved records need a schema change. Migration callbacks
run inside the extension's JavaScript runtime; the final write still goes through
permission-checked storage.

```js
const result = await msty.storage.local.migrate({
  key: "journal",
  version: 2,
  defaults: { entries: [], archivedCount: 0 },
  migrate(value, info) {
    if (info.fromVersion < 2) {
      value.archivedCount = Number(value.archivedCount || 0);
    }
    return value;
  }
});

if (result.migrated) {
  await msty.diagnostics.info("Updated saved journal", {
    fromVersion: result.previousVersion,
    toVersion: result.version
  });
}
```

Use `diagnostics` for local extension logs that users can inspect from the Extensions drawer.
Log useful milestones and failures, not every small internal step. Msty Claw stores recent logs per
extension and redacts common secret-like fields such as tokens, passwords, API keys, and
authorization headers.

```js
await msty.diagnostics.info("Fetched JSON source", {
  url: response.url,
  status: response.status
});

await msty.diagnostics.warn("Validation needs review", {
  detailCount: report.details.length
});
```

Use `msty.diagnostics.getReport()` when an extension needs to show a support snapshot, debug a
custom UI, or decide where to send the user next. The report is scoped to the calling extension and
includes permission groups, contribution counts, capability flags, recent logs, recent activity,
jobs, optional recent events, storage key counts, and short recommendations.

```js
const report = await msty.diagnostics.getReport({
  logsLimit: 20,
  includeStorageKeys: true,
  includeJobs: true
});

if (report.permissions.pending.length > 0) {
  await msty.app.openExtension({ section: "permissions" });
}
```

The Logs tab also shows Msty Claw-authored entries for runtime lifecycle and failures, such as
startup failures, stopped runtimes, failed commands, failed hooks, and failed host API calls. These
entries are labeled as Msty Claw so users can separate platform diagnostics from extension-authored
logs.

The Activity tab is host-authored history for important extension actions: permission requests, UI
opens, model calls, storage writes, theme changes, notifications, and jobs. Do not duplicate this as
your own audit log unless the extension has domain-specific records the user needs to keep.

Use `jobs` for multi-step extension work that should be trackable across a command, drawer, full
view, or custom UI. A job is owned by the extension, does not require an extra permission, and keeps
the current title, detail, progress, step counts, terminal state, result, and cancellation flag.
Users can inspect recent jobs from the extension's Jobs tab and stop cancellable running jobs there.
Long-running code should check `isCancellationRequested` between expensive steps and call `cancel`
when it stops cleanly.

For most generated extensions, use `msty.jobs.run(...)`. It handles start, success, failure, and
cancellation bookkeeping while the handler focuses on real work:

```js
await msty.jobs.run(
  {
    id: "release-readiness",
    title: "Release readiness",
    detail: "Reading context",
    completedSteps: 0,
    totalSteps: 3
  },
  async (job) => {
    await job.step("Drafting checklist", {
      progress: 0.6,
      completedSteps: 2
    });

    await job.throwIfCancellationRequested("Stopped before model review.");

    const result = await msty.models.infer({
      prompt: "Draft a concise release readiness checklist."
    });

    await job.step("Ready", {
      progress: 1,
      completedSteps: 3
    });

    return { summaryLength: result.text.length };
  }
);
```

Inside the handler, use `job.update(patch)` for full patches, `job.step(detail, patch?)` for common
step updates, `job.throwIfCancellationRequested(reason?)` between expensive operations, and
`job.cancel(reason?)` when the extension decides to stop cleanly. `jobs.run` defaults `cancellable`
to `true`; pass `cancellable: false` when the work should not show a stop control.

Model calls are host-limited. Keep prompts within
`msty.models.getCapabilities().limits.maxPromptCharacters`, expect `maxOutputTokens` to be capped
at the host limit, and handle structured `RATE_LIMITED` errors by stopping the action and asking the
user to try again later. Visible long-running generation should use `msty.models.stream(...)` and a
Stop control instead of starting repeated inference calls.

Use the primitive API directly when you need a custom terminal flow:

```js
const job = await msty.jobs.start({
  id: "release-readiness",
  title: "Release readiness",
  detail: "Reading context",
  progress: 0,
  completedSteps: 0,
  totalSteps: 3,
  cancellable: true
});

await msty.jobs.update(job.id, {
  detail: "Drafting checklist",
  progress: 0.6,
  completedSteps: 2
});

if (await msty.jobs.isCancellationRequested(job.id)) {
  await msty.jobs.cancel(job.id, { reason: "Stopped before model review." });
  return;
}

await msty.jobs.finish(job.id, {
  detail: "Ready",
  result: { summaryLength: summary.length }
});
```

Optional permissions should be requested at the moment the user asks for the optional action. If a
permission was denied or revoked earlier, requesting it again returns it to pending review with the
new reason. The action should stop and ask the user to review access in Extensions unless the
returned permission state is already `granted`.

```js
const ready = await msty.permissions.ensure({
  permissions: ["clipboard.write"],
  reason: "Copy the generated brief when you choose Copy.",
  openReview: true
});

if (!ready.ok) {
  showNotice(
    ready.reviewOpened
      ? "Review access in Extensions, then try again."
      : "Allow the missing access in Extensions, then try again."
  );
  return;
}
```

Use `permissions.request` directly when you need raw permission records. Use `permissions.ensure`
for ordinary optional user actions because it gives agents a stable `ok` boolean plus grouped missing
permission IDs.

Use `events.subscribe` for lightweight host events such as context, composer, message activity,
extension lifecycle, settings, and permission changes. Event subscriptions are useful for local
status pills, journals, and dashboards that should stay fresh while the app is open. Runtime workers
and sandboxed custom UI frames both support the same handler shape.

```js
const dispose = await msty.events.subscribe((event) => {
  console.log(event.type, event.data);
}, { types: ["context.changed", "composer.changed", "messages.changed"] });
```

Useful lifecycle event types include `settings.changed`, `permissions.changed`,
`extension.activated`, `extension.disposed`, `extension.installed`, `extension.removed`, and
`extension.enabled.changed`. Event payloads are metadata-only; draft and message text are not sent
through events.

`composer.changed` is permission gated. It reports typing activity as metadata (`textLength`,
`hasText`, selection offsets, `isFocused`) without the draft text, but typing cadence and draft
length are still user activity, so it is only delivered while `composer.read` is granted. The same
gate applies to `events.getRecent`. Pair the event with `msty.composer.get` when an action needs
the actual draft, for example a live word counter or draft linter that refreshes on each
`composer.changed` event.

Use composer events when the extension needs to react to draft or editor state. Use command
contributions when the extension should appear in the slash menu. A `composer.changed` subscription
does not create a slash command.

Commands may also return a `CommandResult` instead of opening UI or editing the draft themselves,
so the host performs those effects consistently. See [Command Results And Declarative
Actions](#command-results-and-declarative-actions) for the full action set.

## Choosing What To Build

The most useful extensions are **declarative** - they add a contribution and the app
wires it into a feature you already have. No JavaScript needed.

- **Rules** (`rules`) - inject guidance into the assistant, or block a risky tool call,
  when a prompt or command matches. This changes how the assistant answers.
- **Playbooks** (`playbooks`) - add a runnable workflow to the Playbooks feature, with a
  real input form. Use this whenever you need the user to type something in.
- **Tasks** (`tasks`) - add starter templates to Tasks so users can create scheduled workflows.
- **Commands** (`commands`) - add extension slash commands to the composer command menu.
- **Knowledge sources** (`chatContextProviders`) - add selected evidence to normal chat answers.
- **Themes** (`themes`) - add a theme the user can apply in Settings.
- **Model assignments** (`modelAssignments`) - add named model slots the user maps to models.

A JavaScript `entry` is needed when the extension needs to run code: command handlers, model calls,
storage, dynamic UI registration, or host-managed dialogs, drawers, popups, and full views. For
host-owned panels, prefer structured `content` blocks over one long `body` string when the extension
needs tables, stats, callouts, or small forms. Use a **playbook** when the workflow should become a
saved, reusable app workflow rather than a one-off extension panel.
For declared UI surfaces, use `msty.ui.openContribution(...)` from runtime code instead of
duplicating title, entry, and size details in `openDialog`, `openDrawer`, `openPopup`, or
`openFullView` calls.

## Samples

Sample packages live in the public
[`cloudstack-llc/msty-claw-extensions`](https://github.com/cloudstack-llc/msty-claw-extensions)
project. Each is hand-written and wires into a real app feature.

The sample catalog covers the platform surfaces agents are expected to generate:

- Declarative rules for writing, SQL safety, secrets, accessibility, model cost, and data retention
- Runnable playbooks for bug triage, incident review, research synthesis, and contract review
- Static task packs, trigger providers, and model assignment packs
- Polling trigger providers for RSS or Atom feeds, GitHub work, and npm package releases
- Workshop and full-view examples for meeting briefs, project health, and prompt libraries
- Toolbox, title bar, status bar, empty chat, Pulse, message inline, and composer inline examples
- Pre-send and post-message hook examples that review drafts and record assistant turn milestones
- Dialog, drawer, and popup examples with settings, storage, context reads, and model inference

Use the public examples project as the source of truth for sample code. Maintainers validate each
sample before publishing updates.
