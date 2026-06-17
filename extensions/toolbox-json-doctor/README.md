# JSON Doctor

Checks configured JSON for parse errors and shape problems, then shows a readable report.

## What it does

JSON Doctor reads JSON from one of three places you choose: text you paste, a URL it fetches, or a local file you select. It parses the JSON and reports what it finds: whether it is valid, the top-level keys, the length of a top-level array, any required keys that are missing, and whether the value is an object when you expect one. The results open in a side panel with a pass or review status, a source preview, and a details list. The last result is remembered on this device, and you can optionally save a full report to a JSON file each time you run it.

## Where it shows up

- An item in the toolbox / More menu, labeled "JSON."
- Running it opens a side panel with the validation report. If you turn on saving, it also opens a save dialog for the report file.

## How to use it

1. Open Settings and fill in the JSON Doctor settings: pick a source (Pasted, URL, or File), then provide the JSON text, the URL, or leave File selected to choose a file at run time. List any required top-level keys.
2. Open the toolbox / More menu and choose JSON Doctor.
3. For URL mode it fetches the JSON (and uses your saved bearer token if you set one). For File mode it asks you to pick a file. The report opens in a side panel.
4. If you turned on saving, choose where to write the JSON report when prompted.

## Settings

- **Source**: Where to read JSON from. One of Pasted, URL, or File. Defaults to Pasted.
- **JSON text**: The JSON to check, used when Source is Pasted.
- **JSON URL**: The address to fetch JSON from, used when Source is URL.
- **Bearer token**: An optional token sent as an Authorization header for the JSON URL. Stored securely on this device.
- **Required top-level keys**: Comma-separated keys that should exist at the top level. Defaults to `name, version`.
- **Fetch limit**: The maximum response size, in kilobytes, when fetching from a URL. The same limit applies when reading a local file.
- **Require a top-level object**: When on, JSON Doctor flags a result whose top-level value is not an object. On by default.
- **Save report after checking**: When on, JSON Doctor asks where to save a JSON report each time it runs. Off by default.

## Permissions

- **settings.provide**: Reads the JSON text, optional URL, and required keys you configure.
- **secrets.read**: Uses a saved bearer token when the configured JSON URL needs one.
- **network.fetch**: Fetches JSON from the configured URL when you choose URL mode.
- **files.read**: Lets you choose and read a local JSON file.
- **files.write**: Saves a JSON Doctor report when you turn on report export.
- **storage.local**: Remembers the last validation result on this device.
- **ui.toolbox**: Adds JSON Doctor to the toolbox.
- **ui.drawer**: Shows validation details in a drawer.

## How it's built

The extension contributes `settings` and a single `toolboxItems` entry wired to the `json-doctor.inspect` command. The settings schema uses host control hints like `x-msty-control: segmented` for the source picker, `x-msty-control: slider` for the fetch limit, `x-msty-secret` plus `format: password` for the token, and `x-msty-visibleWhen` to show the text, URL, and token fields only for the relevant source mode.

`activate` registers the toolbox item with `msty.ui.registerToolboxItem` and returns a `run(command)` handler. The handler resolves the source through `loadJsonSource`, which branches on `sourceMode`: pasted text comes straight from settings, URL mode calls `msty.network.fetch` (with `responseType: "json"`, a `maxBytes` cap, and a bearer header from `msty.secrets.get`), and file mode uses `msty.resources.pickFile` and `msty.resources.readText`. `inspectJson` runs the checks, tracking pass or fail with an explicit `hasProblem` flag rather than re-parsing the human-readable detail strings, so a key or value containing a word like "Missing" never flips the result.

The report renders through `buildContent` as structured drawer blocks (`stats`, `progress`, `kv`, `callout`, `list`, and a `code` source preview), opened with `msty.ui.openDrawer`. The last result is stored with `msty.storage.local.set` under `last_result`, and `maybeSaveReport` writes an optional report via `msty.resources.saveJson`. Permission-gated paths call `ensurePermission` (`msty.permissions.ensure` with `openReview: true`) before fetching, reading, or saving, and return a clear in-report message when access is missing. Every host call is defensive: optional chaining throughout, plus `safeSettings`, `safeLog`, `safeLocalSet`, and `readSecret` wrappers that swallow optional-API failures, and a `disposeAll` cleanup in `dispose`.
