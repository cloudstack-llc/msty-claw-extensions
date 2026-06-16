/*
 * Msty Claw Extension API
 * -----------------------
 * This file is an editor contract for plain JavaScript extensions. It is not a
 * runtime SDK, and extensions should not import it. Reference it from JavaScript:
 *
 *   // @ts-check
 *   /// <reference path="../msty-extension-api.d.ts" />
 *
 * Then annotate entry points with Msty.ExtensionApi or Msty.SurfaceMountContext.
 */

/**
 * Public types for Msty Claw extensions.
 *
 * The host provides these APIs at runtime. This namespace only teaches editors
 * what exists, what values mean, and which shape to return from extension entry
 * points. Keep extension code plain JavaScript; do not import this namespace.
 */
declare namespace Msty {
  /** Primitive values that can cross the extension boundary safely. */
  type JsonPrimitive = string | number | boolean | null;

  /**
   * JSON-compatible data accepted by host APIs.
   *
   * Extension calls are serialized across a worker/frame boundary, so avoid
   * functions, class instances, Dates, Maps, Sets, DOM nodes, and cyclic data.
   * Use ISO strings for dates and plain objects for structured state.
   */
  type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

  /** Plain JSON object with string keys and JSON-compatible values. */
  interface JsonObject {
    [key: string]: JsonValue;
  }

  /** Host callbacks may return a value immediately or resolve one later. */
  type MaybePromise<T> = T | Promise<T>;

  /** Cleanup function returned by runtime registrations and subscriptions. */
  type Disposable = () => void;

  /**
   * Permission IDs understood by Msty Claw.
   *
   * Declare required permissions in `manifest.json`. Request optional
   * permissions at runtime only when the user invokes the feature that needs
   * them. Host APIs still enforce permissions even when TypeScript accepts a
   * call, so always handle denied or unavailable states.
   */
  type PermissionId =
    | "context.read"
    | "context.provide"
    | "chats.read"
    | "chats.write"
    | "messages.read"
    | "messages.write"
    | "messages.hooks"
    | "messages.modify"
    | "composer.read"
    | "composer.write"
    | "models.infer"
    | "models.provide"
    | "models.local"
    | "agent.behavior"
    | "storage.local"
    | "storage.chat"
    | "storage.workspace"
    | "secrets.read"
    | "secrets.write"
    | "files.read"
    | "files.write"
    | "network.fetch"
    | "themes.provide"
    | "settings.provide"
    | "rules.provide"
    | "playbooks.provide"
    | "tasks.provide"
    | "triggers.provide"
    | "commands.provide"
    | "tools.provide"
    | "tools.override"
    | "ui.render"
    | "ui.fullView"
    | "ui.dialog"
    | "ui.drawer"
    | "ui.popup"
    | "ui.statusBar"
    | "ui.titleBar"
    | "ui.workspace"
    | "ui.toolbox"
    | "ui.emptyPill"
    | "ui.messageInline"
    | "ui.composerInline"
    | "ui.pulse"
    | "events.subscribe"
    | "clipboard.write"
    | "notifications.show";

  /** Current review state for a permission requested by this extension. */
  type PermissionState =
    | "granted"
    | "denied"
    | "pending"
    | "revoked"
    | "unavailable";

  /** Host chrome location where a compact extension item can appear. */
  type UiSurface =
    | "statusBar"
    | "titleBar"
    | "toolbox"
    | "workspace"
    | "pulse"
    | "emptyPill"
    | "messageInline"
    | "composerInline"
    | "fullView";

  /** Semantic visual tone used by host-rendered UI. */
  type UiTone = "default" | "success" | "warning" | "danger" | "info";

  /** Host-managed overlay/view kind. */
  type OverlayKind = "dialog" | "drawer" | "popup" | "fullView";

  /** Placement for inline items that render around messages or the composer. */
  type UiPlacement = "message.before" | "message.after" | "composer.before" | "composer.after";

  /** Metadata-only event delivered through `msty.events` and lifecycle hooks. */
  interface ExtensionEvent {
    /** Event name, for example `settings.changed` or `permissions.changed`. */
    type: string;
    /** ISO timestamp from the host. */
    timestamp: string;
    /** Optional host-defined event source. */
    source?: string;
    /** Event payload. Values are JSON-only and may be omitted. */
    data?: JsonObject;
  }

  /** Activation lifecycle payload for install, update, and startup hooks. */
  interface LifecycleEvent extends JsonObject {
    /** Lifecycle event name. */
    type: "install" | "update" | "startup" | "settings.changed" | string;
    /** Why the runtime is starting, when applicable. */
    reason?: "install" | "update" | "startup" | string;
    /** Extension ID from the manifest. */
    extensionId?: string;
    /** Current package version. */
    version?: string;
    /** Previous package version for update events. */
    previousVersion?: string | null;
    /** ISO timestamp for first install. */
    installedAt?: string;
    /** ISO timestamp for last manifest/package update. */
    updatedAt?: string;
    /** ISO timestamp for the package file currently installed. */
    packageUpdatedAt?: string;
    /** ISO timestamp for the previous activation, if known. */
    lastActivatedAt?: string | null;
    /** ISO timestamp for this event. */
    timestamp: string;
  }

  /**
   * Object returned from `activate(msty)`.
   *
   * Return only the hooks your extension needs. The host keeps the runtime
   * alive while these handlers are registered and calls `dispose()` before the
   * runtime shuts down.
   */
  interface ExtensionRuntime {
    /**
     * Runs manifest commands and host surface commands for this extension.
     *
     * Return a {@link CommandResult} to show a toast and let the host apply
     * declarative follow-ups (composer edits, overlays, notifications) after the
     * handler resolves, or return any JSON value / nothing. You can also perform
     * those effects directly with the `msty.*` APIs instead of returning actions.
     */
    run?(command: string, payload?: JsonValue, ...args: JsonValue[]): MaybePromise<CommandResult | JsonValue | void>;
    /** Runs once after a fresh install, then onStartup runs afterward. */
    onInstall?(event: LifecycleEvent, msty: ExtensionApi): MaybePromise<JsonValue | void>;
    /** Runs after a package/version update, then onStartup runs afterward. */
    onUpdate?(event: LifecycleEvent, msty: ExtensionApi): MaybePromise<JsonValue | void>;
    /** Runs each time the extension activates. */
    onStartup?(event: LifecycleEvent, msty: ExtensionApi): MaybePromise<JsonValue | void>;
    /** Runs after this extension's settings change while the runtime is active. */
    onSettingsChanged?(event: ExtensionEvent, msty: ExtensionApi): MaybePromise<JsonValue | void>;
    /** Runs after this extension's permission state changes while the runtime is active. */
    onPermissionsChanged?(event: ExtensionEvent, msty: ExtensionApi): MaybePromise<JsonValue | void>;
    /**
     * Runs on the host polling schedule for each enabled trigger subscription
     * owned by this extension's trigger providers. Return the events found since
     * `request.cursor`, an optional next cursor, and optional health. Only
     * trigger-provider extensions need this hook; the host ignores it otherwise.
     */
    onTriggerCheck?(request: TriggerCheckRequest, msty: ExtensionApi): MaybePromise<TriggerCheckResult>;
    /** Cleans up timers, subscriptions, and host registrations. */
    dispose?(): MaybePromise<void>;
  }

  /**
   * Declarative follow-up the host applies after a command's `run()` handler
   * resolves. Returning actions lets a command stay a pure function of its input
   * while the host performs the side effects in order. Each action mirrors a
   * `msty.*` call you could make yourself, so use whichever style reads best.
   */
  type CommandResultAction =
    | { type: "openUi"; kind?: OverlayKind; request: UiOpenRequest }
    | { type: "insertComposerText"; text: string; mode?: ComposerEditRequest["mode"]; select?: boolean }
    | { type: "setComposerText"; text: string; select?: boolean }
    | { type: "clearComposer" }
    | { type: "sendMessage"; text: string }
    | { type: "showNotification"; title: string; body?: string; tone?: NotificationRequest["tone"] }
    | { type: "copyText"; text: string };

  /** Structured value a command's `run()` handler may return. */
  interface CommandResult {
    /** Short toast/status message shown to the user after the command runs. */
    message?: string;
    /** Declarative follow-ups the host applies in array order. */
    actions?: CommandResultAction[];
    /** JSON metadata recorded in diagnostics; never user-visible. */
    metadata?: JsonObject;
  }

  /**
   * Runtime entry point exported from the manifest `entry` file.
   *
   * Example:
   *
   * ```js
   * /** @param {Msty.ExtensionApi} msty *\/
   * export async function activate(msty) {
   *   return {
   *     async run(command) {
   *       if (command === "example.open") await msty.ui.openDrawer({ id: "main", title: "Example" });
   *     }
   *   };
   * }
   * ```
   */
  type Activate = (msty: ExtensionApi) => MaybePromise<ExtensionRuntime | void>;

  /**
   * Shape of `manifest.json`.
   *
   * The manifest declares identity, compatibility, permissions, and
   * contributions. Runtime code can add or update some UI dynamically, but the
   * manifest should describe the extension's stable user-facing surface.
   */
  interface Manifest {
    /** Optional editor-only schema URL/path. The host ignores it at runtime. */
    $schema?: string;
    /** Manifest format version. Use `1` for this extension API generation. */
    manifestVersion: 1;
    /** Stable reverse-DNS ID, for example `ai.example.my-extension`. */
    id: string;
    /** Short user-facing extension name. */
    name: string;
    /** Package version shown to users and used for update lifecycle hooks. */
    version: string;
    /** One clear sentence explaining what the extension does. */
    description: string;
    /** Optional author metadata displayed in extension details. */
    author?: { name: string; url?: string };
    /** Host compatibility range. Prefer `^1.0.0` unless using newer documented APIs. */
    compatibility: { extensionApi: string; mstyClaw?: string };
    /** Required or optional permissions requested by the extension. */
    permissions?: Array<PermissionId | PermissionDescriptor>;
    /** JavaScript runtime entry file relative to the extension root. */
    entry?: string;
    /** Declarative items the host should contribute on the extension's behalf. */
    contributes?: Partial<Contributions>;
    /** SVG or PNG package asset used as the extension's identity icon in Extensions. */
    icon?: string;
    /** Optional license string, for example `MIT`. */
    license?: string;
    /** Search/discovery keywords. */
    keywords?: string[];
    /** Optional marketplace or organization categories. */
    categories?: string[];
    /** Public homepage for the extension. */
    homepage?: string;
    /** Source repository URL. */
    repository?: string;
    /** Support or issue tracker URL. */
    supportUrl?: string;
    /** Network origins allowed when using `msty.network.fetch`. */
    network?: { allowedOrigins: string[] };
    /** Package asset paths for marketplace/detail screenshots. */
    screenshots?: string[];
    /** Short privacy summary or a privacy policy URL shown in extension details. */
    privacy?: string;
    /** Update feed URL for distribution outside the catalog. */
    updateUrl?: string;
    /** Package signature. Added by the signing pipeline; authors leave this unset. */
    signature?: string;
  }

  /** Manifest permission declaration. */
  interface PermissionDescriptor {
    /** Permission ID being requested. */
    id: PermissionId;
    /** Required permissions block activation until granted. Optional permissions can be requested later. */
    required: boolean;
    /** User-facing reason shown in permission review UI. Keep it short and specific. */
    reason?: string;
  }

  /** Host record for the extension's current permission state. */
  interface PermissionRecord extends PermissionDescriptor {
    /** Current decision state. */
    state: PermissionState;
    /** Whether this permission came from install/update review or runtime request. */
    source: "install" | "update" | "runtime";
    /** ISO timestamp for the original request. */
    requestedAt: string;
    /** ISO timestamp for the latest state change. */
    updatedAt: string;
  }

  /**
   * Declarative extension contributions.
   *
   * Every contribution kind has a matching permission. Declare the permission
   * that matches each array you use; package validation catches mismatches.
   */
  interface Contributions {
    /** Policy-like guidance or guardrails for app events. */
    rules: RuleContribution[];
    /** Reusable workflow documents. */
    playbooks: PlaybookContribution[];
    /** Starter tasks, reminders, watchers, or extension-backed task templates. */
    tasks: TaskContribution[];
    /** Trigger providers that can wake tasks from external or polled events. */
    triggerProviders: TriggerProviderContribution[];
    /** Slash commands and command palette entries handled by `run()`. */
    commands: CommandContribution[];
    /** Hooks that inspect or modify drafts before sending. */
    preSendHooks: PreSendHookContribution[];
    /** Hooks that observe assistant turn lifecycle after messages are sent. */
    postMessageHooks: PostMessageHookContribution[];
    /** Context providers that add extension-owned context to a chat. */
    chatContextProviders: ChatContextProviderContribution[];
    /** Theme token packs. */
    themes: ThemeContribution[];
    /** Settings sections rendered by the host. */
    settings: SettingsContribution[];
    /** Named model slots users assign in Settings. */
    modelAssignments: ModelAssignmentContribution[];
    /** Selectable model-picker entries the extension resolves to a model per request. */
    virtualModels: VirtualModelContribution[];
    /** Tools the assistant can call, optionally replacing a built-in tool. */
    tools: ToolContribution[];
    /** On-device models the host downloads and runs for the extension. */
    localModels: LocalModelContribution[];
    /** Assistant behavior providers that render a system prompt for a turn. */
    agentHarnesses: AgentHarnessContribution[];
    /** Dedicated app views opened by the extension. */
    fullViews: UiContribution[];
    /** Modal dialogs. */
    dialogs: UiContribution[];
    /** Side drawers. */
    drawers: UiContribution[];
    /** Compact contextual popups. */
    popups: UiContribution[];
    /** Workspace navigation items. */
    workspaceItems: UiContribution[];
    /** Toolbox items. */
    toolboxItems: UiContribution[];
    /** Title bar action items. */
    titleBarItems: UiContribution[];
    /** Status bar pills. */
    statusBarPills: UiContribution[];
    /** Empty-state starter items. */
    emptyPillItems: UiContribution[];
    /** Pulse cards. */
    pulseItems: UiContribution[];
    /** Inline message actions. */
    messageInlineItems: UiContribution[];
    /** Inline composer actions. */
    composerInlineItems: UiContribution[];
  }

  /** Shared fields for manifest contribution records. */
  interface BaseContribution {
    /** Stable ID unique within this contribution kind. */
    id: string;
    /** User-facing title. Often shown in tooltips, drawers, or details. */
    title?: string;
    /** Compact label for chrome items and menus. */
    label?: string;
    /** Short explanation shown where space allows. */
    description?: string;
    /** Package asset path for an SVG/PNG icon. */
    icon?: string;
    /** Optional visibility condition, such as `composer.hasText`. */
    when?: string;
    /** Runtime command sent to `run(command, payload)`. */
    command?: string;
  }

  /** Manifest shape for host chrome items, inline items, and host-managed views. */
  interface UiContribution extends BaseContribution {
    /** Custom UI entry file. Omit when using host-managed `body` or `content`. */
    entry?: string;
    /** Default overlay size for drawers, dialogs, popups, and views. */
    size?: "small" | "medium" | "wide" | "full";
    /** Inline placement around a message or composer. */
    placement?: UiPlacement;
    /** Short status text for Pulse or inline cards. */
    summary?: string;
    /** Longer status text for cards or details. */
    detail?: string;
    /** Label for the primary action in host-rendered cards. */
    actionLabel?: string;
    /** ISO timestamp for freshness indicators. */
    updatedAt?: string;
    /** Minutes before host UI can mark the item stale. */
    staleAfterMinutes?: number;
    /** Compact badge text. Keep it very short. */
    badge?: string;
    /** Semantic tone for state. */
    tone?: UiTone;
    /** Hide interaction while still showing the item. */
    disabled?: boolean;
    /** User-facing explanation for disabled state. */
    disabledReason?: string;
    /** Ordering hint within the host surface. Higher priority may appear first. */
    priority?: number;
  }

  /** Slash command or command palette contribution. */
  interface CommandContribution extends BaseContribution {
    /** Required menu label. */
    label: string;
    /** Command ID delivered to `run(command, payload)`. */
    command: string;
    /** Optional slash-command name without the leading slash. */
    name?: string;
    /** Alias for slash-command name. */
    slashName?: string;
    /** Hint text shown after the command name. */
    argumentHint?: string;
    /** Ordering hint among commands. */
    priority?: number;
  }

  /** Hook that runs before a user draft is sent. */
  interface PreSendHookContribution extends BaseContribution {
    /** Command delivered to `run()` with the draft payload. */
    command: string;
    /** How the hook participates in sending. */
    mode?: "observe" | "suggest" | "transform" | "block";
    /** Ordering hint when multiple hooks match. */
    priority?: number;
  }

  /** Hook that observes assistant turn milestones after a message is sent. */
  interface PostMessageHookContribution extends BaseContribution {
    /** Command delivered to `run()` with phase metadata. */
    command: string;
    /** Phases this hook wants to receive. Omit for the default supported set. */
    phases?: Array<"message.sent" | "assistant.started" | "assistant.completed" | "assistant.failed" | "assistant.stopped">;
    /** Ordering hint when multiple hooks match. */
    priority?: number;
  }

  /** Provider that can add extension-owned context to the current chat. */
  interface ChatContextProviderContribution extends BaseContribution {
    /** Label shown to users when selecting the provider. */
    label: string;
    /** Command delivered to `run()` when context is requested. */
    command: string;
    /** Whether context appears only by user action or automatically when matching. */
    mode?: "manual" | "automatic";
    /** Ordering hint among context providers. */
    priority?: number;
  }

  /** Settings section rendered by the host from JSON Schema. */
  interface SettingsContribution {
    /** Stable settings section ID. */
    id: string;
    /** User-facing section title. */
    title: string;
    /**
     * JSON Schema object. Msty-specific `x-msty-*` fields control richer widgets.
     *
     * Use `x-msty-control: "action"` on a field with `x-msty-action` when a
     * settings row should render a button that calls this extension's `run()`
     * handler instead of saving a value.
     */
    schema: JsonObject;
  }

  /** Button metadata accepted on a settings field as `x-msty-action`. */
  interface SettingsActionMetadata extends JsonObject {
    /** Command delivered to this extension's `run()` handler. */
    command: string;
    /** Button label. Defaults to the field title. */
    label?: string;
    /** Button label while the command is running. */
    runningLabel?: string;
    /** Toast message shown when the command returns without its own message. */
    successMessage?: string;
    /** Optional JSON object passed as the first command argument. */
    payload?: JsonObject;
  }

  /** User-assignable model slot for model-powered extensions. */
  interface ModelAssignmentContribution extends BaseContribution {
    /** User-facing model slot label. */
    label: string;
    /** Explanation of when the extension uses this model. */
    description?: string;
  }

  /**
   * Manifest entry for a virtual model: a model-picker entry that does not map
   * to a fixed model. When the user selects it and sends a message, the host
   * calls `run(command, request)` with a `VirtualModelResolveRequest` and
   * delegates the turn to the model the extension returns.
   *
   * Requires the `models.provide` permission. The extension never receives
   * provider credentials; it only names a configured provider/model pair, and
   * the host validates readiness before running it.
   */
  interface VirtualModelContribution extends BaseContribution {
    /** User-facing entry label shown in the model picker. */
    label: string;
    /** Short explanation shown under the label. */
    description?: string;
    /** Command delivered to `run()` when the host needs a model decision. */
    command: string;
    /** Picker group heading. Defaults to the extension name. */
    group?: string;
    /** Ordering hint within the group. */
    priority?: number;
  }

  /**
   * A tool the assistant can call. The host exposes it to the model and routes
   * each call to `run(command, input)`, where `input` is the model's arguments.
   *
   * Requires the `tools.provide` permission. A tool's `name` must be new — it
   * cannot reuse a built-in's name. To replace a built-in, set `overrides` to
   * its name and add the `tools.override` permission. Capability built-ins such
   * as `web_search` and `web_fetch` can be overridden; the control and host
   * built-ins the assistant relies on (`search_tools`, `todo_write`, `shell`,
   * `computer_use`, and the subagent tools) cannot, and an override targeting
   * one is ignored. When two tools claim the same name, the higher `priority`
   * wins.
   */
  interface ToolContribution extends BaseContribution {
    /** Model-facing tool name. Must be unique and not a built-in's name. */
    name: string;
    /** Description shown to the model so it knows when to use the tool. */
    description: string;
    /** Command delivered to `run()` when the assistant calls the tool. */
    command: string;
    /** JSON Schema for the tool's arguments. Defaults to an empty object. */
    inputSchema?: JsonObject;
    /**
     * Built-in tool name this replaces (requires `tools.override`). Omit for a
     * new, additive tool. Control and host built-ins cannot be overridden.
     */
    overrides?: string;
    /** Ordering hint used to resolve name conflicts; higher wins. */
    priority?: number;
  }

  /** Request passed to a virtual model's resolve command. */
  interface VirtualModelResolveRequest {
    /** Full ID of the entry being resolved, so one command can serve many entries. */
    entryId: string;
    /** IDs of currently configured providers; treat targets outside this list as missing. */
    availableProviderIds: string[];
    /** Chat the message belongs to. Null when the chat is not created yet. */
    conversationId: string | null;
    /** The outgoing user message. */
    text: string;
    /** True for follow-up steps of a multi-step run; keep the cached model. */
    isContinuation: boolean;
    /** The decision previously cached for this chat, if any. */
    cachedDecision: VirtualModelDecision | null;
  }

  /** A concrete model decision returned by a virtual model resolve command. */
  interface VirtualModelDecision {
    /** Configured provider ID that should run the request. */
    providerId: string;
    /** Model ID on that provider. */
    model: string;
    /** User-facing reason shown in the chat, e.g. the matched route name. */
    reason?: string;
    /** True when the resolver fell back instead of matching. */
    usedFallback?: boolean;
    /** Allow the host to reuse this decision for the conversation. Defaults to true. */
    cacheable?: boolean;
  }

  /** Result of a virtual model resolve command. */
  type VirtualModelResolution =
    | ({ status?: "resolved" } & VirtualModelDecision)
    | { status: "unresolved"; message?: string };

  /**
   * Runtime registration for a virtual model entry. Use this for entries the
   * user creates while the app runs (e.g. one entry per saved pack); use
   * `contributes.virtualModels` for entries that never change. Registered
   * entries last while the extension is active — register them again during
   * `activate`. Requires the `models.provide` permission.
   */
  interface VirtualModelRegistration {
    /** Stable ID within the extension, e.g. a pack ID. */
    id: string;
    /** User-facing entry label shown in the model picker. */
    label: string;
    /** Short explanation shown under the label. */
    description?: string;
    /** Picker group heading. Defaults to the extension name. */
    group?: string;
    /** Ordering hint within the group. */
    priority?: number;
    /** Command delivered to `run()` with a `VirtualModelResolveRequest`. */
    command: string;
  }

  /** One configured provider and its models, as shown to the user. */
  interface AvailableModelsProvider {
    providerId: string;
    providerName: string;
    models: string[];
  }

  /**
   * Manifest entry for an on-device model. The host owns download, storage,
   * versioning, and execution — the extension never ships or runs native
   * code. Use `msty.models.getLocalModelStatus` to check install state,
   * `msty.models.requestLocalModelDownload` to fetch it with a visible
   * download experience, and `msty.models.infer({ localModel })` to run it.
   *
   * Requires the `models.local` permission. Prefer quantized builds and set
   * `sizeBytes` so users see the download size up front.
   */
  interface LocalModelContribution extends BaseContribution {
    /** User-facing model label. */
    label: string;
    /** What the extension uses this model for. */
    description?: string;
    /** Host runtime that serves the model. */
    runtime: "ollama" | "mlx";
    /** Model ID understood by the runtime, e.g. "qwen3:0.6b". */
    model: string;
    /** Approximate download size in bytes, shown before downloading. */
    sizeBytes?: number;
  }

  /** Names a declared on-device model. */
  interface LocalModelRequest {
    /** Contribution ID from `contributes.localModels`. */
    localModel: string;
  }

  /** Runtime for an app-managed on-device model install. */
  type LocalModelInstallRuntime = "onnx";

  /** Identifies an app-managed on-device model by runtime and model id. */
  interface LocalModelInstallRequest {
    /** Runtime used by the host to manage the model. */
    runtime: LocalModelInstallRuntime;
    /** Hugging Face model id or URL. */
    model: string;
  }

  /** One candidate for local text classification. */
  interface LocalTextClassificationCandidate {
    /** Extension-owned candidate id returned in the result. */
    id: string;
    /** Plain-English candidate label or description. */
    label: string;
  }

  /** Scores text against candidate labels using an app-managed on-device model. */
  interface LocalTextClassificationRequest extends LocalModelInstallRequest {
    /** Text to classify on device. */
    input: string;
    /** Candidate labels to score against the input. */
    candidates: LocalTextClassificationCandidate[];
    /** Optional zero-shot template. Use `{label}` where the candidate label should be inserted. */
    hypothesisTemplate?: string;
    /** Optional token cap for the local classifier input. */
    maxInputTokens?: number;
  }

  /** One local text classification score. */
  interface LocalTextClassificationScore {
    candidateId: string;
    label: string;
    score: number;
  }

  /** Local text classification result. */
  interface LocalTextClassificationResult {
    runtime: LocalModelInstallRuntime;
    model: string;
    bestCandidateId: string | null;
    confidence?: number;
    scores: LocalTextClassificationScore[];
  }

  /** Declared on-device model plus its current state. */
  interface LocalModelInfo {
    id: string;
    label: string;
    description?: string;
    runtime: "ollama" | "mlx";
    model: string;
    sizeBytes?: number;
    /** True when the model is downloaded and usable. */
    installed: boolean;
    /** True when the on-device runtime that hosts the model is set up. */
    runtimeReady: boolean;
    /** True while the host is downloading the model. */
    downloading: boolean;
    /** Download progress percentage when known. */
    progress?: number;
    /** Provider that serves the model when ready. */
    providerId?: string | null;
    /** Short user-facing status note. */
    message?: string;
  }

  /** Result of asking the host to download an on-device model. */
  interface LocalModelDownloadResult {
    /** True when this call started a download. */
    started: boolean;
    /** True when the model was already installed. */
    alreadyInstalled: boolean;
    message?: string;
  }

  /** Current install state for an app-managed on-device model. */
  interface LocalModelInstallStatus {
    runtime: LocalModelInstallRuntime;
    model: string;
    /** True when the model is downloaded and available on this device. */
    installed: boolean;
    /** True while the host is downloading the model. */
    downloading: boolean;
    /** Download progress percentage when known. */
    progress?: number;
    bytes?: number;
    totalBytes?: number;
    currentFile?: string;
    /** Local model cache path when installed. */
    path?: string | null;
    /** Short user-facing status note. */
    message?: string;
  }

  /** Result of asking the host to install an app-managed on-device model. */
  interface LocalModelInstallResult extends LocalModelInstallStatus {
    /** True when a download was started by this call. */
    started: boolean;
    /** True when the model was already installed before this call. */
    alreadyInstalled: boolean;
  }

  /**
   * Manifest entry for an assistant behavior provider.
   *
   * Use this when the extension should render the assistant's system prompt for
   * a chat turn. The extension receives `AgentHarnessInput` as the first
   * runtime payload for `command` and returns `AgentHarnessRenderResult` or a
   * plain prompt string.
   *
   * Important: the returned prompt is only instructions. It does not grant
   * tools. Shell, web, subagents, computer use, and data-protection behavior
   * remain controlled by the host and are described under `input.availability`.
   *
   * Keep the command deterministic and side-effect-free. The host may render a
   * behavior prompt while estimating prompt size, retrying, or preparing the
   * final model turn. Do not write storage, call models, send network requests,
   * or mutate app state from the behavior command.
   */
  interface AgentHarnessContribution extends BaseContribution {
    /** User-facing label shown in Extensions. */
    label: string;
    /** Command delivered to `run(command, input)` when the host needs a prompt. */
    command: string;
    /** Ordering hint when an extension contributes more than one behavior. */
    priority?: number;
  }

  /** Where the assistant turn came from. */
  type AgentHarnessRunSource =
    | "chat"
    | "queue"
    | "playbook"
    | "contextScout"
    | "agent"
    | "internal";

  /** Prompt size profile selected by the host for the current model budget. */
  type AgentHarnessSystemPromptMode = "full" | "compact" | "minimal";

  /** Shell environment the host would expose if shell access is available. */
  type AgentHarnessShellEnvironment = "windows-host" | "posix-host" | "container";

  /** Directory access granted to the conversation or agent. */
  interface AgentHarnessDirectoryAccessEntry {
    /** Absolute host path or mounted workspace path. */
    path: string;
    /** Whether the assistant can write to this directory when shell/file tools are available. */
    access: "read_only" | "read_write";
  }

  /** Workspace profile file status passed to prompt renderers. */
  interface AgentHarnessWorkspaceProfileFile {
    /** Profile file name, for example `SOUL.md`, `IDENTITY.md`, or `USER.md`. */
    name: string;
    /** Full file path. */
    path: string;
    /** Whether the file exists on disk. */
    exists: boolean;
    /** Whether the host loaded file content into this input. */
    loaded: boolean;
    /** File content when loaded; otherwise `null`. */
    content: string | null;
    /** True when content was shortened by the host. */
    truncated: boolean;
    /** User-safe load error, or `null` when there is no error. */
    error: string | null;
  }

  /** Workspace profile context that the built-in prompt would normally include. */
  interface AgentHarnessWorkspaceProfileFiles {
    /** Whether workspace profile loading is enabled. */
    enabled: boolean;
    /** Active workspace path, or `null` when there is no workspace. */
    workspacePath: string | null;
    /** Per-file load status and content. */
    files: AgentHarnessWorkspaceProfileFile[];
  }

  /** Attached memory pack content selected by the host for this prompt. */
  interface AgentHarnessMemoryPack {
    id: string;
    title: string;
    summary: string;
    tags: string[];
    facts: string[];
    constraints: string[];
    decisions: string[];
    openTasks: string[];
    artifacts: string[];
  }

  /** Skills visible in the current prompt profile. */
  interface AgentHarnessSkillSummary {
    /** Skill invocation name without the leading slash. */
    name: string;
    /** Short description from the skill frontmatter. */
    description: string;
    /** Where the skill came from. */
    source: "built-in" | "personal" | "project";
  }

  /**
   * Host-provided capability availability for this turn.
   *
   * Treat these fields as facts about what the host will actually expose to the
   * model. A prompt may recommend behavior, but it cannot enable disabled
   * capabilities.
   */
  interface AgentHarnessAvailability {
    /** Shell availability and target syntax. */
    shell: {
      available: boolean;
      environment: AgentHarnessShellEnvironment;
      reason?: string;
    };
    /** Web browsing and web search availability. */
    web: {
      browse: boolean;
      search: boolean;
      reason?: string;
    };
    /** Whether subagent tools are available for this model/context. */
    subagents: {
      available: boolean;
      reason?: string;
    };
    /** Whether computer-use tools are available and whether image input is supported. */
    computerUse: {
      available: boolean;
      imageInput: boolean;
      reason?: string;
    };
    /** Data-protection state already decided by the host/user. */
    dataProtection: {
      promptWasProtected: boolean;
      toolOutputsProtected: boolean;
    };
  }

  /**
   * Payload passed to an assistant behavior command.
   *
   * The host builds this immediately before constructing the model request, so
   * it reflects the chosen model, prompt budget, permissions, workspace, memory,
   * and data-protection state for the current turn.
   */
  interface AgentHarnessInput {
    /** Contract version for this payload shape. */
    apiVersion: 1;
    /** ISO timestamp when the host prepared this input. */
    timestamp: string;
    /** Current turn identity and prompt profile. */
    run: {
      source: AgentHarnessRunSource;
      conversationId: string;
      providerId?: string | null;
      model: string;
      systemPromptMode: AgentHarnessSystemPromptMode;
      containerBotId?: string | null;
    };
    /** Host metadata. */
    app: {
      name: "Msty Claw";
      harnessFallbackId: "msty.builtin.default";
      hostPlatform?: string | null;
    };
    /** Capability availability enforced by the host. */
    availability: AgentHarnessAvailability;
    /** Workspace and profile context selected for this turn. */
    workspace: {
      path?: string | null;
      directoryAccess: AgentHarnessDirectoryAccessEntry[];
      profileFiles: AgentHarnessWorkspaceProfileFiles | null;
    };
    /** User/workspace instructions that the built-in prompt would include. */
    instructions: {
      custom?: string | null;
      project?: string | null;
      projectSourceCount: number;
      workingStyle?: string | null;
      cavemanTalkEnabled: boolean;
    };
    /** Memory context selected by the host for this turn. */
    memory: {
      workingBrief?: string | null;
      attachedPacks: AgentHarnessMemoryPack[];
      compactionSummary?: string | null;
      compactedContext?: JsonObject | null;
    };
    /** Skills that should be mentioned in the prompt profile. */
    skills: {
      loaded: AgentHarnessSkillSummary[];
      omittedNames: string[];
      omittedCount: number;
    };
  }

  /** Return value from an assistant behavior command. */
  interface AgentHarnessRenderResult {
    /** Complete system prompt to send to the model for this turn. */
    systemPrompt: string;
    /** Optional JSON metadata for future host diagnostics. */
    metadata?: JsonObject;
  }

  /** Declarative theme contribution. */
  interface ThemeContribution {
    /** Stable theme ID. */
    id: string;
    /** User-facing theme name. */
    name: string;
    /** Optional short theme description. */
    description?: string;
    /** Package asset preview image. */
    previewImage?: string;
    /** Theme token map. Values can be fixed or light/dark variants. */
    tokens: Record<string, string | { light?: string; dark?: string }>;
    /**
     * Raw CSS custom-property overrides keyed by full variable name (e.g.
     * "--radius", "--my-glow"). Sets any app CSS variable directly, beyond the
     * curated token namespace, and wins over tokens targeting the same variable.
     */
    variables?: Record<string, string | { light?: string; dark?: string }>;
    /** Optional named assets used by the theme. */
    assets?: Record<string, string>;
    /**
     * Optional controls shown in the extension's Settings drawer. The theme
     * picker shows a settings button for configurable extension themes.
     *
     * Theme settings use the same JSON-schema field model as extension settings,
     * but each field can include `x-msty-theme` binding metadata that writes the
     * saved value into one or more app CSS variables while this theme is active.
     */
    settings?: ThemeSettingsContribution;
  }

  /** Settings shown for one contributed theme. */
  interface ThemeSettingsContribution {
    /** Optional heading shown above the theme's controls. */
    title?: string;
    /** Short user-facing description shown with the theme's controls. */
    description?: string;
    /** JSON schema for this theme's adjustable options. */
    schema: JsonObject;
  }

  /** Binding metadata accepted on a theme settings field as `x-msty-theme`. */
  interface ThemeSettingBinding {
    /** App CSS variable to write, including the leading `--`. */
    variable: string;
    /**
     * Template used for the field value. Supported placeholders:
     * `{{value}}`, `{{percent}}`, `{{inversePercent}}`, `{{backgroundImage}}`.
     */
    value?: string;
    /** Per-option templates keyed by stringified saved values. */
    values?: Record<string, string>;
  }

  /** Rule contribution for app events and guardrails. */
  interface RuleContribution extends BaseContribution {
    /** User-facing rule name. */
    name: string;
    /** Whether the rule is enabled by default. */
    enabled?: boolean;
    /** Host event that triggers this rule. */
    event: "session_start" | "user_prompt_submit" | "pre_tool_use" | "post_tool_use";
    /** Simple matcher for text, command, tool, or result content. */
    matcher?: JsonObject & {
      /** Match when event text contains any of these strings. */
      textIncludes?: string[];
      /** Match tool-use events by tool name. */
      toolNames?: string[];
      /** Match command text. */
      commandIncludes?: string[];
      /** Match text in a tool result. */
      resultIncludes?: string[];
    };
    /** Action the host performs when this rule matches. */
    action:
      | (JsonObject & { type: "add_guidance"; guidance: string })
      | (JsonObject & { type: "block_tool"; message: string })
      | (JsonObject & { type: "append_tool_result"; message: string })
      | (JsonObject & { type: "request_follow_up"; message: string })
      | (JsonObject & { type: "run_command"; command: string; cwd?: string; timeoutMs?: number });
  }

  /** Reusable playbook document. */
  interface PlaybookContribution extends BaseContribution {
    /** User-facing playbook name. */
    name: string;
    /** Whether the playbook is personal or workspace-scoped. */
    scope?: "personal" | "workspace";
    /** Workspace path when scoped to a workspace. */
    workspacePath?: string;
    /** Optional structured playbook metadata. */
    manifest?: JsonObject;
    /** Markdown body shown to users. */
    bodyMarkdown?: string;
  }

  /** Declarative task template or extension-backed task. */
  interface TaskContribution extends BaseContribution {
    /** Kind of task the host should create. */
    taskType?: "prompt" | "reminder" | "watcher" | "extension";
    /** User-facing task name. */
    name?: string;
    /** Prompt body for prompt-style tasks. */
    prompt?: string;
    /** Reminder or watcher message. */
    message?: string;
    /** Longer detail text. */
    details?: string;
    /** Extension command for extension-backed tasks. */
    command?: string;
    /** User-facing command action title. */
    commandTitle?: string;
    /** JSON arguments passed to the command. */
    arguments?: JsonObject;
    /** Suggested recurrence cadence. */
    cadence?: "daily" | "weekly" | "monthly";
    /** Suggested weekday/month day label. */
    suggestedDay?: string;
    /** Trigger configuration for watcher tasks. */
    trigger?: JsonObject;
    /** Step list shown in task details. */
    steps?: Array<string | { title: string; detail?: string }>;
    /** Checklist shown in task details. */
    checklist?: Array<string | { title: string; detail?: string }>;
    /** Criteria that describe successful completion. */
    successCriteria?: Array<string | { title: string; detail?: string }>;
    /** Whether the task is especially relevant in workspace contexts. */
    recommendedForWorkspace?: boolean;
    /** Whether this task suggests shell access. */
    allowShellAccess?: boolean;
    /** Whether this task suggests web access. */
    allowWebAccess?: boolean;
    /** Whether this task suggests web search. */
    allowWebSearch?: boolean;
  }

  /** Group of triggers provided by this extension. */
  interface TriggerProviderContribution extends BaseContribution {
    /** User-facing provider name. */
    name: string;
    /** Trigger definitions this provider can emit. */
    triggers: TriggerDefinitionContribution[];
  }

  /** Trigger definition available to tasks/watchers. */
  interface TriggerDefinitionContribution extends BaseContribution {
    /** User-facing trigger name. */
    name: string;
    /** Delivery mechanisms. Currently only polling is supported. */
    delivery: Array<"polling">;
    /** JSON Schema for trigger configuration. */
    configSchema: JsonObject;
    /** JSON Schema for emitted event data. */
    eventSchema: JsonObject;
    /** Optional default task policy for events from this trigger. */
    defaultPolicy?: JsonObject & {
      /** Cap event-triggered task runs per hour. */
      maxRunsPerHour?: number;
      /** Require user review before running the triggered task. */
      requiresReview?: boolean;
      /** Notify when polling or event handling fails. */
      notifyOnFailure?: boolean;
    };
  }

  /**
   * Host API passed to `activate(msty)`.
   *
   * This object is permission-aware. Methods can fail or return limited data
   * when the extension lacks permission, the app has no active chat, or the user
   * cancels a picker. Treat all returned host data as optional and user-owned.
   */
  interface ExtensionApi {
    /** Platform information and permission-derived capabilities for this extension. */
    platform: {
      /** Returns API version, available permissions, and feature flags visible to this extension. */
      getCapabilities(): Promise<PlatformCapabilities>;
    };
    /** Navigation helpers for opening first-party app settings and extension detail screens. */
    app: {
      /** Opens a first-party target such as extension details or app settings. */
      open(request: AppOpenRequest | AppOpenTarget): Promise<AppOpenResult>;
      /** Opens this extension's details drawer, optionally focused on a section. */
      openExtension(request?: { section?: "details" | "permissions" | "settings" | "storage" | "jobs" | "activity" | "logs" }): Promise<AppOpenResult>;
      /** Opens model assignment settings, optionally focused on one assignment. */
      openModelAssignments(request?: { assignmentId?: string }): Promise<AppOpenResult>;
    };
    /** Permission review and runtime permission helpers. */
    permissions: {
      /** Returns every permission record known for this extension. */
      getState(): Promise<PermissionRecord[]>;
      /** Requests optional permissions at runtime for a specific user action. */
      request(request: PermissionRequest): Promise<PermissionRecord[]>;
      /** Checks permissions and optionally opens review UI when access is missing. */
      ensure(request: PermissionEnsureRequest): Promise<PermissionEnsureResult>;
    };
    /** Current app context, active chat metadata, selection, and usage estimates. */
    context: {
      /** Returns a broad snapshot of the current app state visible to this extension. */
      getCurrent(): Promise<ContextSnapshot>;
      /** Returns the active chat and, when requested, recent message metadata/content. */
      getCurrentChat(request?: CurrentChatRequest): Promise<CurrentChatSnapshot>;
      /** Returns a compact context summary suited for model prompts. */
      getBrief(request?: ContextBriefRequest): Promise<ContextBriefSnapshot>;
      /** Returns current selected composer or message text, when available. */
      getCurrentSelection(): Promise<SelectionSnapshot>;
      /** Returns workspace path and related workspace metadata. */
      getWorkspace(): Promise<WorkspaceSnapshot>;
      /** Returns approximate character/token usage and prompt guidance. */
      getUsage(): Promise<ContextUsageSnapshot>;
    };
    /** Chat metadata and chat creation/opening helpers. */
    chats: ChatsApi;
    /** Message reads, writes, navigation, and send lifecycle hooks. */
    messages: MessagesApi;
    /** Current composer draft reads and edits. */
    composer: ComposerApi;
    /** Host-mediated model inference and model assignment status. */
    models: ModelsApi;
    /** Extension-owned JSON storage. Never store secrets here. */
    storage: {
      /** Device-local storage for this extension. */
      local: StorageArea;
      /** Storage scoped to the active chat. */
      chat: StorageArea;
      /** Storage scoped to the active workspace. */
      workspace: StorageArea;
    };
    /** User-selected files/folders and safe package file reads/writes. */
    resources: ResourcesApi;
    /** Text extraction helpers for documents such as PDFs. */
    documents: DocumentsApi;
    /** Secret setting values. Prefer settings schema secret fields plus this API. */
    secrets: SecretsApi;
    /** Extension logs, activity-adjacent diagnostics, and support reports. */
    diagnostics: DiagnosticsApi;
    /** Visible long-running work owned by the extension. */
    jobs: JobsApi;
    /** Host-rendered extension settings values and schema. */
    settings: SettingsApi;
    /** Clipboard writes requested by explicit user action. */
    clipboard: {
      /** Writes text to the clipboard when `clipboard.write` is granted. */
      writeText(text: string): Promise<void>;
    };
    /** User-visible notifications and toasts. */
    notifications: {
      /** Shows a notification/toast with a title, optional body, and tone. */
      show(request: NotificationRequest | string): Promise<void>;
    };
    /** Host-mediated network access constrained by manifest `network.allowedOrigins`. */
    network: {
      /** Fetches a text or JSON response with size and timeout limits. */
      fetch(request: NetworkFetchRequest | string): Promise<NetworkFetchResponse>;
    };
    /** Metadata-only event stream while the app is open. */
    events: {
      /**
       * Subscribes to extension-visible app events. Call the returned disposable on cleanup.
       * Permission-gated events are delivered only while their gating permission is granted:
       * `composer.changed` requires `composer.read` because it reveals typing activity and
       * draft length even though draft text is never included.
       */
      subscribe(handler: (event: ExtensionEvent) => MaybePromise<void>, options?: EventSubscriptionOptions): Promise<Disposable>;
      /** Reads recent extension-visible events for diagnostics or catch-up UI. Applies the same permission gating as live delivery. */
      getRecent(request?: { limit?: number }): Promise<ExtensionEvent[]>;
    };
    /** Reads package assets such as icons, CSS, and small JSON files. */
    assets: AssetsApi;
    /** Theme preview/apply helpers for theme extensions. */
    themes: {
      /** Temporarily previews a contributed theme. */
      preview(themeId: string): Promise<void>;
      /** Applies a contributed theme. */
      apply(themeId: string): Promise<void>;
      /** Clears a temporary preview. */
      resetPreview(): Promise<void>;
    };
    /** Runtime UI registration, host-managed overlays, prompts, and toasts. */
    ui: RuntimeUiApi;
    /** Dynamically registers a command while the runtime is active. */
    commands: { register(registration: CommandRegistration): Disposable };
    /** Dynamically registers a rule while the runtime is active. */
    rules: { register(registration: RuleContribution): Promise<Disposable> };
    /** Dynamically registers a playbook while the runtime is active. */
    playbooks: { register(registration: PlaybookContribution): Promise<Disposable> };
    /** Dynamically registers a task while the runtime is active. */
    tasks: { register(registration: TaskContribution): Promise<Disposable> };
    /** Trigger provider runtime API. */
    triggers: TriggersApi;
  }

  /**
   * Host API passed to custom UI `mount({ root, msty, context, extension })`.
   *
   * Custom UI runs in a sandboxed frame, so registration-only runtime APIs are
   * omitted. Use `msty.surface` to close or resolve the host-managed view.
   */
  interface SurfaceApi extends Omit<ExtensionApi, "commands" | "rules" | "playbooks" | "tasks" | "triggers"> {
    /** Metadata about the extension and current surface request. */
    extension: SurfaceExtension;
    /** Package asset helpers plus CSS injection for the sandbox frame. */
    assets: SurfaceAssetsApi;
    /** Current host theme tokens. */
    theme: SurfaceTheme;
    /** Surface lifecycle and close/resolve helpers. */
    surface: SurfaceBridge;
    /** UI helpers available inside custom UI. */
    ui: SurfaceUiApi;
  }

  /**
   * Arguments passed to a custom UI module's `mount` function.
   *
   * Render only inside `root`. The frame cannot access the app DOM.
   *
   * The frame ships a shared SVG icon sprite themed to currentColor. Use
   * `<svg><use href="#msty-icon-NAME" /></svg>` with one of: plus, x, check,
   * alert, search, trash, download, upload, chevron-down, pencil, settings,
   * refresh, sparkles. Scrollbars are themed by the host; do not restyle them.
   */
  interface SurfaceMountContext {
    /** Root element owned by this surface. Replace or append children here. */
    root: HTMLElement;
    /** Permission-aware API bridge for custom UI. */
    msty: SurfaceApi;
    /** JSON context supplied when the runtime opened this surface. */
    context: JsonObject;
    /** Extension and surface metadata. */
    extension: SurfaceExtension;
  }

  /** Metadata describing the extension surface currently mounted. */
  interface SurfaceExtension {
    /** Extension manifest ID. */
    id: string;
    /** Extension display name. */
    name: string;
    /** Surface contribution or runtime ID. */
    surfaceId: string;
    /** Host request ID for this open surface instance. */
    requestId: string;
    /** Current surface title. */
    title: string;
  }

  /** Current theme tokens exposed to a custom UI frame. */
  interface SurfaceTheme {
    /** Host color scheme. */
    colorScheme: "light" | "dark";
    /** CSS-token values available to the frame. */
    tokens: Record<string, string>;
    /** Returns a fresh copy of current tokens. */
    getTokens(): Record<string, string>;
  }

  /** Live metadata snapshot for a mounted custom UI surface. */
  interface SurfaceSnapshot {
    /** Surface contribution/runtime ID. */
    id: string;
    /** Host request ID for this open instance. */
    requestId: string;
    /** Current title. */
    title: string;
    /** JSON context supplied by the opener. */
    context: JsonObject;
    /** Current theme snapshot. */
    theme: SurfaceTheme;
    /** Frame width in pixels. */
    width: number;
    /** Frame height in pixels. */
    height: number;
    /** Whether the frame currently has focus. */
    focused: boolean;
    /** Whether the frame is visible. */
    visible: boolean;
  }

  /** Lifecycle event emitted by `msty.surface.on(...)`. */
  interface SurfaceEvent {
    /** Event name, such as `surface.resize` or `surface.themeChanged`. */
    type: string;
    /** ISO timestamp. */
    timestamp: string;
    /** JSON-only event payload. */
    data: JsonObject;
    /** Surface snapshot after the event. */
    surface: SurfaceSnapshot;
  }

  /** Lifecycle and host-result bridge for custom UI frames. */
  interface SurfaceBridge {
    /** Original context passed when the surface opened. */
    context: JsonObject;
    /** Current theme snapshot. */
    theme: SurfaceTheme;
    /** Returns the latest surface metadata. */
    getSnapshot(): SurfaceSnapshot;
    /** Subscribes to a specific surface event. Use `"*"` for all events. */
    on(type: string, handler: (event: SurfaceEvent) => MaybePromise<void>): Disposable;
    /** Subscribes to all surface events. */
    on(handler: (event: SurfaceEvent) => MaybePromise<void>): Disposable;
    /** Resolves the surface with a value for the opener, then closes it. */
    resolve(value?: JsonValue | JsonObject): void;
    /** Closes the surface, optionally returning a value. */
    close(value?: JsonValue | JsonObject): void;
    /** Sends a JSON message to the host frame. Reserved for advanced integrations. */
    postMessage(value: JsonValue): void;
  }

  /**
   * Runtime UI API for chrome registrations and host-managed views.
   *
   * Register dynamic chrome only when manifest declarations are not enough.
   * For dialogs, drawers, popups, and full views, either provide host-managed
   * `body`/`content` or provide a custom `entry`; do not rely on both.
   */
  interface RuntimeUiApi {
    /** Registers or replaces a status bar pill while the runtime is active. */
    registerStatusBarPill(registration: UiRegistration): Disposable;
    /** Registers or replaces a title bar action while the runtime is active. */
    registerTitleBarItem(registration: UiRegistration): Disposable;
    /** Registers or replaces a toolbox item while the runtime is active. */
    registerToolboxItem(registration: UiRegistration): Disposable;
    /** Registers or replaces a workspace navigation item while the runtime is active. */
    registerWorkspaceItem(registration: UiRegistration): Disposable;
    /** Registers or replaces a Pulse card while the runtime is active. */
    registerPulseItem(registration: UiRegistration): Disposable;
    /** Registers or replaces an empty-state starter item while the runtime is active. */
    registerEmptyPillItem(registration: UiRegistration): Disposable;
    /** Registers or replaces an inline message action while the runtime is active. */
    registerMessageInlineItem(registration: UiRegistration): Disposable;
    /** Registers or replaces an inline composer action while the runtime is active. */
    registerComposerInlineItem(registration: UiRegistration): Disposable;
    /** Registers or replaces a full view contribution while the runtime is active. */
    registerFullView(registration: UiRegistration): Disposable;
    /** Updates a manifest or runtime UI item by ID and surface. */
    update(registration: UiUpdateRequest): void;
    /** Opens a host-managed dialog. */
    openDialog(request: UiOpenRequest): Promise<JsonValue>;
    /** Opens a host-managed side drawer. */
    openDrawer(request: UiOpenRequest): Promise<JsonValue>;
    /** Opens a host-managed contextual popup. */
    openPopup(request: UiOpenRequest): Promise<JsonValue>;
    /** Opens a host-managed full view. */
    openFullView(request: UiOpenRequest): Promise<JsonValue>;
    /** Opens a manifest-declared dialog, drawer, popup, or full view by ID. */
    openContribution(request: UiOpenContributionRequest | string): Promise<JsonValue>;
    /** Updates an already-open host-managed surface. */
    updateSurface(request: UiSurfacePatchRequest): Promise<UiSurfacePatchResult>;
    /** Closes an already-open host-managed surface. */
    closeSurface(request: UiSurfaceCloseRequest): Promise<UiSurfaceCloseResult>;
    /** Shows a confirmation dialog and returns the user's decision. */
    confirm(request: ConfirmRequest | string): Promise<ConfirmResult>;
    /** Shows a prompt dialog and returns entered text. */
    prompt(request: PromptRequest | string): Promise<PromptResult>;
    /** Shows a picker dialog and returns the selected option. */
    pick(request: PickRequest): Promise<PickResult>;
    /** Shows the host's model picker and returns the chosen provider/model. */
    pickModel(request?: PickModelRequest): Promise<PickModelResult>;
    /** Shows a short user-visible toast. */
    showToast(request: NotificationRequest | string): Promise<void>;
  }

  /** UI helpers available inside custom UI frames. */
  interface SurfaceUiApi extends Omit<RuntimeUiApi, "registerStatusBarPill" | "registerTitleBarItem" | "registerToolboxItem" | "registerWorkspaceItem" | "registerPulseItem" | "registerEmptyPillItem" | "registerMessageInlineItem" | "registerComposerInlineItem" | "registerFullView"> {
    /** Resolves the current surface with a value for the opener, then closes it. */
    resolve(value?: JsonValue | JsonObject): void;
    /** Closes the current surface, optionally returning a value. */
    close(value?: JsonValue | JsonObject): void;
  }

  /** Runtime registration for a chrome item or view. */
  interface UiRegistration extends Omit<UiContribution, "surface"> {
    /** Tooltip shown for compact icon-only controls. */
    tooltip?: string;
    /** Host surface this registration belongs to. */
    surface?: UiSurface;
  }

  /** Patch for an existing manifest or runtime UI item. */
  interface UiUpdateRequest extends UiRegistration {
    /** Contribution or runtime registration ID. */
    id: string;
    /** Surface containing the item. */
    surface: UiSurface;
    /** New badge text; use `null` to clear. */
    badge?: string | null;
    /** New disabled reason; use `null` to clear. */
    disabledReason?: string | null;
    /** New summary text; use `null` to clear. */
    summary?: string | null;
    /** New detail text; use `null` to clear. */
    detail?: string | null;
    /** New action label; use `null` to clear. */
    actionLabel?: string | null;
    /** New freshness timestamp; use `null` to clear. */
    updatedAt?: string | null;
  }

  /** Request for opening a runtime-only host-managed view. */
  interface UiOpenRequest {
    /** Stable surface ID. Reopening the same ID updates/reuses the surface when possible. */
    id: string;
    /** User-facing title. */
    title: string;
    /** Optional extension ID override; normally inferred by the host. */
    extensionId?: string;
    /** Optional extension name override; normally inferred by the host. */
    extensionName?: string;
    /** Custom UI entry file. Do not combine with `body` or `content`. */
    entry?: string;
    /** Plain body text for simple host-managed content. */
    body?: string;
    /** Structured host-rendered content blocks. */
    content?: UiContentBlock[];
    /** Host surface width. */
    width?: "small" | "medium" | "wide";
    /** JSON context passed to a custom UI entry. */
    context?: JsonObject;
    /** Label for the default close action. */
    closeLabel?: string;
    /** Optional action buttons shown by the host. */
    actions?: UiAction[];
  }

  /** Request for opening a manifest-declared contribution by ID. */
  interface UiOpenContributionRequest {
    /** Contribution ID from the manifest. */
    id: string;
    /** Contribution kind. Omit when the host can infer it from the ID. */
    kind?: OverlayKind;
    /** Optional title override. */
    title?: string;
    /** Optional plain body override. */
    body?: string;
    /** Optional structured content override. */
    content?: UiContentBlock[];
    /** Optional width override. */
    width?: UiOpenRequest["width"];
    /** JSON context passed to a custom UI entry. */
    context?: JsonObject;
    /** Label for the default close action. */
    closeLabel?: string;
    /** Optional action buttons shown by the host. */
    actions?: UiAction[];
  }

  /** Patch for an already-open host-managed surface. */
  interface UiSurfacePatchRequest extends Partial<UiOpenRequest> {
    /** Open surface ID. */
    id: string;
    /** Open surface kind. */
    kind: OverlayKind;
    /** Replacement content; use `null` to clear. */
    content?: UiContentBlock[] | null;
    /** Replacement body; use `null` to clear. */
    body?: string | null;
    /** Replacement custom UI context; use `null` to clear. */
    context?: JsonObject | null;
    /** Replacement close label; use `null` to clear. */
    closeLabel?: string | null;
    /** Replacement action buttons; use `null` to clear. */
    actions?: UiAction[] | null;
  }

  /** Result from updating an open surface. */
  interface UiSurfacePatchResult {
    /** Whether a matching open surface was found and updated. */
    updated: boolean;
    /** Surface ID. */
    id: string;
    /** Surface kind. */
    kind: OverlayKind;
  }

  /** Request to close an open host-managed surface. */
  interface UiSurfaceCloseRequest {
    /** Open surface ID. */
    id: string;
    /** Open surface kind. */
    kind: OverlayKind;
    /** Optional result returned to the opener. */
    result?: JsonValue;
  }

  /** Result from closing an open surface. */
  interface UiSurfaceCloseResult {
    /** Whether a matching open surface was found and closed. */
    closed: boolean;
    /** Surface ID. */
    id: string;
    /** Surface kind. */
    kind: OverlayKind;
  }

  /** Button shown in a host-managed dialog, drawer, popup, or prompt. */
  interface UiAction {
    /** Action ID returned in the surface result. */
    id: string;
    /** User-facing button label. */
    label: string;
    /** Visual treatment. */
    variant?: "primary" | "secondary" | "danger";
  }

  /** Confirmation dialog request. */
  interface ConfirmRequest {
    /** Stable dialog ID. */
    id?: string;
    /** Dialog title. */
    title?: string;
    /** Body text. */
    body?: string;
    /** Alias for body text. */
    message?: string;
    /** Structured body content. */
    content?: UiContentBlock[];
    /** Confirm button label. */
    confirmLabel?: string;
    /** Cancel button label. */
    cancelLabel?: string;
    /** Use danger for destructive confirmation. */
    tone?: "default" | "danger";
    /** Dialog width. */
    width?: UiOpenRequest["width"];
  }

  /** Confirmation dialog result. */
  interface ConfirmResult {
    /** True when the user confirmed. */
    confirmed: boolean;
    /** ID of the chosen action, when custom actions were used. */
    actionId?: string;
    /** True when the user dismissed without choosing. */
    dismissed?: boolean;
  }

  /** Text prompt dialog request. */
  interface PromptRequest {
    /** Stable dialog ID. */
    id?: string;
    /** Dialog title. */
    title?: string;
    /** Body text. */
    body?: string;
    /** Alias for body text. */
    message?: string;
    /** Field label. */
    label?: string;
    /** Field placeholder. */
    placeholder?: string;
    /** Initial field value. */
    defaultValue?: string;
    /** Whether empty input is disallowed. */
    required?: boolean;
    /** Use a textarea instead of a single-line input. */
    multiline?: boolean;
    /** Submit button label. */
    submitLabel?: string;
    /** Cancel button label. */
    cancelLabel?: string;
    /** Dialog width. */
    width?: UiOpenRequest["width"];
  }

  /** Text prompt dialog result. */
  interface PromptResult {
    /** True when the user submitted. */
    submitted: boolean;
    /** Submitted value, or the current/empty value on dismissal. */
    value: string;
    /** ID of the chosen action, when custom actions were used. */
    actionId?: string;
    /** True when the user dismissed without submitting. */
    dismissed?: boolean;
  }

  /** Option for a host-managed picker. */
  interface PickOption {
    /** User-facing option label. */
    label: string;
    /** Stable value returned when selected. */
    value: string;
    /** Optional supporting text. */
    description?: string;
  }

  /** Picker dialog request. */
  interface PickRequest {
    /** Stable dialog ID. */
    id?: string;
    /** Dialog title. */
    title?: string;
    /** Body text. */
    body?: string;
    /** Alias for body text. */
    message?: string;
    /** Field label. */
    label?: string;
    /** Search/filter placeholder. */
    placeholder?: string;
    /** Options to show. */
    options: PickOption[];
    /** Initial selected value. */
    defaultValue?: string;
    /** Whether selection is required. */
    required?: boolean;
    /** Submit button label. */
    submitLabel?: string;
    /** Cancel button label. */
    cancelLabel?: string;
    /** Dialog width. */
    width?: UiOpenRequest["width"];
  }

  /** Picker dialog result. */
  interface PickResult {
    /** True when the user selected/submitted an option. */
    selected: boolean;
    /** Selected option value. */
    value?: string;
    /** Full selected option. */
    option?: PickOption;
    /** ID of the chosen action, when custom actions were used. */
    actionId?: string;
    /** True when the user dismissed without selecting. */
    dismissed?: boolean;
  }

  /**
   * Model picker dialog request. The host shows its own provider-grouped
   * model picker; extensions receive only provider and model IDs, never
   * credentials.
   */
  interface PickModelRequest {
    /** Stable dialog ID. */
    id?: string;
    /** Dialog title. */
    title?: string;
    /** Body text. */
    body?: string;
    /** Alias for body text. */
    message?: string;
    /** Field label. */
    label?: string;
    /** Trigger placeholder while nothing is chosen. */
    placeholder?: string;
    /** Initially selected model. */
    defaultValue?: { providerId: string; model: string };
    /** Whether a selection is required to submit. Defaults to true. */
    required?: boolean;
    /** Submit button label. */
    submitLabel?: string;
    /** Cancel button label. */
    cancelLabel?: string;
    /** Dialog width. */
    width?: UiOpenRequest["width"];
  }

  /** Model picker dialog result. */
  interface PickModelResult {
    /** True when the user chose a model. */
    selected: boolean;
    /** Chosen provider ID. */
    providerId?: string;
    /** Chosen model ID. */
    model?: string;
    /** ID of the chosen action, when custom actions were used. */
    actionId?: string;
    /** True when the user dismissed without choosing. */
    dismissed?: boolean;
  }

  /**
   * Structured content block rendered by host-managed UI.
   *
   * Use blocks when a simple drawer/dialog/popup should feel native without
   * owning custom UI. Use a custom `entry` only when you need local interaction,
   * complex layout, or streaming updates inside the frame.
   */
  type UiContentBlock =
    | { type: "text"; text: string; title?: string; tone?: UiTone }
    | { type: "markdown"; text: string; title?: string; tone?: UiTone }
    | { type: "callout"; title: string; body?: string; tone?: UiTone }
    | { type: "code"; code: string; title?: string; language?: string; wrap?: boolean }
    | { type: "progress"; title?: string; label?: string; value: number; max?: number; description?: string; tone?: UiTone }
    | { type: "barChart"; title?: string; description?: string; items: Array<{ label: string; value: number; max: number; description?: string; tone?: UiTone }> }
    | { type: "stats"; title?: string; items: Array<{ label: string; value: string; description?: string; tone?: UiTone }> }
    | { type: "kv"; title?: string; items: Array<{ label: string; value: string; tone?: UiTone }> }
    | { type: "list"; title?: string; ordered?: boolean; items: Array<{ title: string; description?: string; tone?: UiTone }> }
    | { type: "timeline"; title?: string; items: Array<{ title: string; description?: string; timestamp?: string; label?: string; tone?: UiTone }> }
    | { type: "table"; title?: string; columns: Array<{ key: string; label: string }>; rows: JsonObject[] }
    | { type: "form"; title?: string; description?: string; fields: UiFormField[] }
    | { type: "divider" };

  /** Field description for `UiContentBlock` form blocks. */
  type UiFormField =
    | { type: "text" | "textarea"; id: string; label: string; description?: string; placeholder?: string; defaultValue?: string; required?: boolean }
    | { type: "number"; id: string; label: string; description?: string; placeholder?: string; defaultValue?: number | string; min?: number; max?: number; step?: number; required?: boolean }
    | { type: "checkbox"; id: string; label: string; description?: string; defaultValue?: boolean; required?: boolean }
    | { type: "select"; id: string; label: string; description?: string; placeholder?: string; defaultValue?: string; options: Array<{ label: string; value: string }>; required?: boolean }
    | { type: "model"; id: string; label: string; description?: string; placeholder?: string; defaultValue?: { providerId: string; model: string }; required?: boolean };

  /** Chat metadata and explicit chat navigation helpers. */
  interface ChatsApi {
    /** Returns the active chat, or `null` when no chat is active. */
    getCurrent(): Promise<Conversation | null>;
    /** Returns a chat by ID when visible to this extension. */
    get(chatId: string): Promise<Conversation | null>;
    /** Lists recent chats visible to this extension. */
    list(request?: { limit?: number }): Promise<Conversation[]>;
    /** Creates a chat, optionally inserts a draft, and optionally switches to it. */
    create(request?: ChatCreateRequest): Promise<ChatCreateResult>;
    /** Opens a chat by ID after an explicit user action. */
    open(request: { chatId: string } | string): Promise<{ opened: boolean; chatId: string; chat?: Conversation | null }>;
  }

  /** Message reads, writes, navigation, and send lifecycle hook registration. */
  interface MessagesApi {
    /** Returns the active/focused message, when available. */
    getActive(): Promise<Message | null>;
    /** Reads one message by ID when `messages.read` is granted. */
    get(messageId: string): Promise<Message | null>;
    /** Lists messages matching filters. Use `includeContent: false` for metadata-only reads. */
    list(request?: MessageListRequest): Promise<Message[]>;
    /** Convenience wrapper for recent messages. */
    listRecent(request?: MessageListRequest): Promise<Message[]>;
    /** Sends text as a user-visible message in the active chat. */
    send(request: { text: string } | string): Promise<void>;
    /** Appends a message-like record when the host allows the target chat/write mode. */
    append(request: { chatId?: string; role?: "user" | "assistant"; content?: string; text?: string } | string): Promise<void>;
    /** Opens a message in the app, optionally highlighting it. */
    open(request: { messageId: string; chatId?: string; highlight?: boolean } | string): Promise<{ opened: boolean; messageId: string; chatId?: string | null; highlighted?: boolean; reason?: string }>;
    /** Dynamically registers a pre-send hook while the runtime is active. */
    registerPreSendHook(registration: { id: string; command: string; title?: string; label?: string; description?: string; mode?: "observe" | "suggest" | "transform" | "block"; when?: string; priority?: number }): Disposable;
    /** Dynamically registers a post-message hook while the runtime is active. */
    registerPostMessageHook(registration: { id: string; command: string; title?: string; label?: string; description?: string; phases?: PostMessagePhase[]; when?: string; priority?: number }): Disposable;
  }

  /** Message author role. */
  type MessageRole = "user" | "assistant" | "tool";

  /** Assistant-turn lifecycle phases observable by post-message hooks. */
  type PostMessagePhase = "message.sent" | "assistant.started" | "assistant.completed" | "assistant.failed" | "assistant.stopped";

  /** Chat metadata. Message content is intentionally separate. */
  interface Conversation {
    /** Stable chat ID. */
    id: string;
    /** User-visible chat title. */
    title?: string;
    /** Workspace path associated with the chat. */
    workspacePath?: string | null;
    /** Provider ID used by the chat, when known. */
    providerId?: string | null;
    /** Model ID/name used by the chat, when known. */
    model?: string | null;
    /** Bot/persona ID, when known. */
    botId?: string | null;
    /** Bot/persona display name, when known. */
    botName?: string | null;
    /** Approximate message count. */
    messageCount?: number;
    /** ISO creation timestamp. */
    createdAt?: string;
    /** ISO last-update timestamp. */
    updatedAt?: string;
  }

  /** Message snapshot visible to this extension. */
  interface Message {
    /** Stable message ID. */
    id: string;
    /** Owning chat ID. */
    chatId?: string | null;
    /** Message index in the chat, when known. */
    index?: number;
    /** Message role. */
    role: MessageRole;
    /** Message text content. Requires `messages.read` when reading existing messages. */
    content: string;
    /** Content length, useful when content is omitted or truncated. */
    contentLength?: number;
    /** ISO creation timestamp. */
    createdAt?: string;
    /** ISO last-update timestamp. */
    updatedAt?: string;
    /** Model used for assistant messages, when known. */
    model?: string;
    /** Provider ID, when known. */
    providerId?: string;
    /** Provider display name, when known. */
    providerName?: string;
    /** Host or provider metadata. */
    metadata?: JsonObject;
  }

  /** Filters for listing messages. */
  interface MessageListRequest {
    /** Chat to read from. Defaults to the active chat when omitted. */
    chatId?: string;
    /** Single role filter. */
    role?: MessageRole;
    /** Multiple role filter. */
    roles?: MessageRole[];
    /** Text query. */
    query?: string;
    /** Return messages before this ID. */
    beforeMessageId?: string;
    /** Return messages after this ID. */
    afterMessageId?: string;
    /** Return messages created before this ISO timestamp. */
    createdBefore?: string;
    /** Return messages created after this ISO timestamp. */
    createdAfter?: string;
    /** Sort order. */
    order?: "asc" | "desc";
    /** Offset for pagination. */
    offset?: number;
    /** Maximum number of messages. */
    limit?: number;
    /** Include message content. Set false for metadata-only reads. */
    includeContent?: boolean;
  }

  /** Request for creating a new chat. */
  interface ChatCreateRequest {
    /** Optional chat title. */
    title?: string;
    /** Optional draft inserted into the new chat. */
    draft?: string;
    /** Whether to switch the app to the new chat. */
    switchTo?: boolean;
    /** Workspace path for the chat. */
    workspacePath?: string | null;
    /** Provider ID to use, when allowed. */
    providerId?: string | null;
    /** Model ID/name to use, when allowed. */
    model?: string | null;
    /** Optional folder ID. */
    folderId?: string | null;
  }

  /** Result from creating a chat. */
  interface ChatCreateResult {
    /** Created chat metadata. */
    chat: Conversation;
    /** Whether the app opened/switched to the chat. */
    opened: boolean;
    /** Whether a draft was inserted. */
    draftInserted?: boolean;
  }

  /** API for reading and editing the current composer draft. */
  interface ComposerApi {
    /** Returns current composer text and selection metadata. */
    get(): Promise<ComposerSnapshot>;
    /** Alias for `get()`. */
    getDraft(): Promise<ComposerSnapshot>;
    /** Replaces the current draft with text. */
    setText(text: string): Promise<void>;
    /** Replaces the current draft with text. */
    setDraft(text: string): Promise<void>;
    /** Replaces the current draft with text. */
    replaceDraft(text: string): Promise<void>;
    /** Inserts, replaces, appends, or prepends text according to request mode. */
    insertText(request: ComposerEditRequest | string): Promise<void>;
    /** Clears the current draft. */
    clear(): Promise<void>;
  }

  /** Current composer state. */
  interface ComposerSnapshot {
    /** Full draft text. */
    text: string;
    /** Selection start offset, when known. */
    selectionStart?: number;
    /** Selection end offset, when known. */
    selectionEnd?: number;
    /** Selected text, when known. */
    selectedText?: string;
    /** Text before the selection/cursor. */
    beforeSelection?: string;
    /** Text after the selection/cursor. */
    afterSelection?: string;
    /** Whether text is selected. */
    hasSelection?: boolean;
    /** Whether the composer has focus. */
    isFocused?: boolean;
    /** Whether the composer can currently be edited. */
    canEdit?: boolean;
  }

  /** Composer edit request. */
  interface ComposerEditRequest {
    /** Text to insert or use as replacement. */
    text?: string;
    /** Edit mode. Defaults to insert at selection/cursor when possible. */
    mode?: "insert" | "replace" | "append" | "prepend";
    /** Whether inserted text should remain selected. */
    select?: boolean;
  }

  /** Broad current app context snapshot. */
  interface ContextSnapshot {
    /** ISO timestamp for this snapshot. */
    timestamp?: string;
    /** Active chat ID. */
    activeConversationId?: string | null;
    /** Active/focused message ID. */
    activeMessageId?: string | null;
    /** Current workspace path. */
    workspacePath?: string | null;
    /** Current host view name. */
    currentView?: string | null;
    /** Active provider ID, when known. */
    providerId?: string | null;
    /** Active model ID/name, when known. */
    model?: string | null;
    /** Active chat metadata. */
    conversation?: Conversation | null;
    /** Active message snapshot, when visible. */
    activeMessage?: Message | null;
    /** Recent message snapshots, depending on permissions and request mode. */
    recentMessages?: Message[];
    /** Composer snapshot. */
    composer?: ComposerSnapshot;
    /** Context about the command/surface invocation. */
    invocation?: JsonObject | null;
    /** Additional host metadata. */
    metadata?: JsonObject;
  }

  /** Request for active chat context. */
  interface CurrentChatRequest {
    /** Whether to include no messages or recent messages. */
    includeMessages?: "none" | "recent";
    /** Maximum recent messages to include. */
    maxMessages?: number;
  }

  /** Active chat plus optional message context. */
  interface CurrentChatSnapshot {
    /** Active chat metadata. */
    chat: Conversation | null;
    /** Included messages. Empty when not requested or unavailable. */
    messages: Message[];
    /** Optional joined text representation. */
    text?: string;
  }

  /** Request for compact prompt-oriented context. */
  interface ContextBriefRequest {
    /** Message detail level. `metadata` avoids full content; `excerpts` includes short snippets. */
    includeMessages?: "none" | "metadata" | "excerpts";
    /** Maximum number of recent messages to include. */
    maxMessages?: number;
    /** Maximum characters per excerpt. */
    maxExcerptCharacters?: number;
  }

  /** Compact context summary intended for prompts and quick summaries. */
  interface ContextBriefSnapshot extends JsonObject {
    /** ISO timestamp for this brief. */
    timestamp: string;
    /** Human-readable summary line. */
    summary: string;
    /** Additional context lines suitable for prompts. */
    lines: string[];
    /** Active chat metadata. */
    chat: Conversation | null;
    /** Recent message metadata with optional excerpts. */
    recentMessages: Array<Omit<Message, "content"> & { excerpt?: string; contentLength: number }>;
  }

  /** Current selected text, either from composer or a message. */
  interface SelectionSnapshot {
    /** Where the selection came from. */
    source: "composer" | "message";
    /** Selected text. */
    text: string;
    /** Selection start offset, when known. */
    selectionStart?: number;
    /** Selection end offset, when known. */
    selectionEnd?: number;
    /** Text before the selection, when known. */
    beforeSelection?: string;
    /** Text after the selection, when known. */
    afterSelection?: string;
    /** Whether there is a real selection. */
    hasSelection: boolean;
    /** Chat ID for message selections. */
    chatId?: string | null;
    /** Message ID for message selections. */
    messageId?: string;
    /** Message role for message selections. */
    role?: MessageRole;
  }

  /** Current workspace snapshot. */
  interface WorkspaceSnapshot {
    /** Workspace path, when one is open. */
    path?: string | null;
    /** Current host view name. */
    currentView?: string | null;
    /** Additional workspace metadata. */
    metadata?: JsonObject;
  }

  /** Per-role message usage breakdown. */
  interface ContextRoleUsage extends JsonObject {
    /** Message role this row counts. */
    role: MessageRole;
    /** Number of messages with this role. */
    count: number;
    /** Combined character count for the role. */
    characters: number;
    /** Approximate token count for the role. */
    estimatedTokens: number;
  }

  /** Approximate prompt/context usage broken down by area, with prompt guidance. */
  interface ContextUsageSnapshot extends JsonObject {
    /** ISO timestamp for this estimate. */
    timestamp: string;
    /** Active chat ID, when one is open. */
    activeConversationId?: string | null;
    /** Current workspace path, when one is open. */
    workspacePath?: string | null;
    /** Active provider ID, when known. */
    providerId?: string | null;
    /** Active model ID/name, when known. */
    model?: string | null;
    /** Recent message usage feeding the estimate. */
    messages: {
      /** Recent messages considered. */
      recentCount: number;
      /** Messages actually included in the estimate. */
      includedCount: number;
      /** Combined message character count. */
      characters: number;
      /** Approximate message token count. */
      estimatedTokens: number;
      /** Per-role breakdown. */
      byRole: ContextRoleUsage[];
    };
    /** Current composer draft usage. */
    composer: {
      /** Draft character count. */
      characters: number;
      /** Selected character count within the draft. */
      selectedCharacters: number;
      /** Approximate draft token count. */
      estimatedTokens: number;
      /** Approximate token count of the current selection. */
      selectedEstimatedTokens: number;
      /** Whether text is currently selected. */
      hasSelection: boolean;
      /** Whether the composer can currently be edited. */
      canEdit?: boolean;
    };
    /** Total context size estimate (messages plus composer). */
    total: { characters: number; estimatedTokens: number };
    /** Host guidance for prompt construction. */
    guidance: {
      /** Whether the extension should summarize or trim before prompting. */
      shouldSummarize: boolean;
      /** Suggested max prompt characters. */
      maxPromptCharacters: number;
      /** Suggested max prompt tokens. */
      maxPromptTokens: number;
      /** Suggested max output tokens. */
      maxOutputTokens: number;
      /** Optional explanation for the guidance. */
      reason?: string;
    };
  }

  /** Host-mediated model calls using user-configured model assignments. */
  interface ModelsApi {
    /**
     * Runs a complete inference request and resolves when finished.
     *
     * Needs the `models.infer` permission, except when `localModel` targets a
     * declared on-device model — those calls are covered by `models.local`
     * alone, so fully local extensions never request cloud inference access.
     */
    infer(request: ModelInferenceRequest): Promise<ModelInferenceResult>;
    /** Streams model output into a handler and returns a cancellable controller. */
    stream(request: ModelInferenceRequest, onEvent: (event: ModelStreamEvent) => MaybePromise<void>): ModelStreamController;
    /** Checks whether a model assignment is ready before starting work. */
    getStatus(request?: ModelStatusRequest | string): Promise<ModelStatus>;
    /** Lists model assignments contributed by this extension. */
    listAssignments(): Promise<ModelAssignmentInfo[]>;
    /** Sets or clears one model choice declared by this extension. */
    setAssignment(assignmentId: string, selection: ModelAssignmentSelection | null): Promise<ModelAssignmentInfo>;
    /** Returns model API capabilities visible to this extension. */
    getCapabilities(): Promise<ModelCapabilities>;
    /** Lists this extension's declared on-device models with install state. */
    listLocalModels(): Promise<LocalModelInfo[]>;
    /** Checks one declared on-device model. */
    getLocalModelStatus(request: LocalModelRequest | string): Promise<LocalModelInfo>;
    /** Asks the host to download a declared on-device model. */
    requestLocalModelDownload(request: LocalModelRequest | string): Promise<LocalModelDownloadResult>;
    /** Checks an app-managed on-device model by runtime and model id. */
    getLocalModelInstallStatus(request: LocalModelInstallRequest): Promise<LocalModelInstallStatus>;
    /** Asks the host to install an app-managed on-device model. */
    installLocalModel(request: LocalModelInstallRequest): Promise<LocalModelInstallResult>;
    /** Scores text against candidate labels using an installed app-managed on-device model. */
    classifyLocalText(request: LocalTextClassificationRequest): Promise<LocalTextClassificationResult>;
    /** Adds a model-picker entry that resolves to a model per request. Returns an unregister function. */
    registerVirtualModel(registration: VirtualModelRegistration): () => void;
    /** Lists configured providers and models (IDs and names only, never credentials). */
    listAvailableModels(): Promise<AvailableModelsProvider[]>;
  }

  /** Model inference request. */
  interface ModelInferenceRequest {
    /** Single prompt string. Use `messages` when role separation matters. */
    prompt?: string;
    /** Chat-style messages for model calls. */
    messages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    /** Model assignment ID declared in the manifest. */
    modelAssignment?: string;
    /** Declared on-device model ID from `contributes.localModels`. */
    localModel?: string;
    /** Sampling temperature. Host/provider may clamp unsupported values. */
    temperature?: number;
    /** Requested max output tokens. Host/provider may cap this. */
    maxOutputTokens?: number;
    /** Text or JSON response preference. Use schema for structured JSON. */
    responseFormat?: "text" | "json" | { type: "text" | "json"; name?: string; schema?: JsonObject; strict?: boolean };
    /** JSON metadata included in diagnostics. */
    metadata?: JsonObject;
  }

  /** Completed model result. */
  interface ModelInferenceResult {
    /** Full text output. */
    text: string;
    /** Parsed JSON output when `responseFormat` requested JSON and parsing succeeded. */
    json?: JsonValue;
    /** Provider used by the host. */
    providerId?: string;
    /** Model used by the host. */
    model?: string;
    /** Best-effort token usage from the provider. */
    usage?: { inputTokens?: number; outputTokens?: number };
    /** Provider finish reason. */
    finishReason?: string;
    /** Additional provider/host metadata. */
    metadata?: JsonObject;
  }

  /** Streaming model event. */
  type ModelStreamEvent =
    | { type: "start"; providerId?: string; model?: string; metadata?: JsonObject }
    | { type: "text_delta"; delta: string; text: string }
    | { type: "reasoning_delta"; delta: string }
    | { type: "complete"; result: ModelInferenceResult }
    | { type: "error"; message: string }
    | { type: "cancelled"; text: string; message?: string };

  /** Controller returned by `msty.models.stream(...)`. */
  interface ModelStreamController {
    /** Host-generated stream/job ID. */
    id: string;
    /** Resolves with the final result, or rejects/returns cancellation depending on host state. */
    done: Promise<ModelInferenceResult>;
    /** Requests cancellation of the stream. */
    cancel(): Promise<void>;
  }

  /** Model assignment status request. */
  interface ModelStatusRequest {
    /** Assignment ID. Omit to check the default/fallback model path. */
    modelAssignment?: string;
  }

  /** Readiness information for a model assignment. */
  interface ModelStatus {
    /** True when inference can start now. */
    ready: boolean;
    /** True when the user has configured the assignment/provider path. */
    configured: boolean;
    /** Where the model choice came from. */
    source: "assignment" | "fallback" | "unavailable";
    /** Provider ID, when known. */
    providerId?: string | null;
    /** Provider display name, when known. */
    providerName?: string | null;
    /** Model ID/name, when known. */
    model?: string | null;
    /** Assignment ID that was checked. */
    modelAssignment?: string;
    /** Short user-facing status message. */
    message?: string;
    /** User-facing explanation when `ready` is false. */
    unavailableReason?: string;
  }

  /** Model assignment declared by this extension plus current status. */
  interface ModelAssignmentInfo extends ModelStatus {
    /** Assignment ID. */
    id: string;
    /** Manifest contribution ID. */
    contributionId: string;
    /** User-facing label. */
    label: string;
    /** User-facing description. */
    description?: string;
  }

  /** Concrete model selected for an extension model choice. */
  interface ModelAssignmentSelection extends JsonObject {
    /** Provider ID. */
    providerId: string;
    /** Model ID/name. */
    model: string;
  }

  /** Capability snapshot for model APIs. */
  interface ModelCapabilities extends JsonObject {
    /** Whether `infer` is available. */
    canInfer: boolean;
    /** Whether `stream` is available. */
    canStream: boolean;
    /** Whether `getStatus` is available. */
    canCheckStatus: boolean;
    /** Whether assignments can be listed. */
    canListAssignments: boolean;
    /** Whether this extension can add model choices to the model picker. */
    canProvideModels: boolean;
    /** Whether this extension can use on-device model APIs. */
    canUseLocalModels: boolean;
    /** Current contributed assignments. */
    assignments: ModelAssignmentInfo[];
  }

  /** Storage scope names. */
  type StorageScope = "local" | "chat" | "workspace";

  /** Extension-owned JSON key/value storage area. */
  interface StorageArea {
    /** Reads one key. Returns `undefined` when missing. */
    get(key: string): Promise<JsonValue | undefined>;
    /** Writes one JSON-compatible value. */
    set(key: string, value: JsonValue): Promise<void>;
    /** Shallow-patches an object value and returns the next object. */
    patch(key: string, value: JsonObject): Promise<JsonObject>;
    /** Removes one key. */
    remove(key: string): Promise<void>;
    /** Lists keys in this storage scope. */
    keys(): Promise<string[]>;
    /** Clears all keys in this storage scope for this extension. */
    clear(): Promise<void>;
    /** Initializes or upgrades a versioned JSON object. */
    migrate(request: StorageMigrationRequest): Promise<StorageMigrationResult>;
  }

  /** Request for versioned storage migration. */
  interface StorageMigrationRequest {
    /** Storage key to migrate. */
    key: string;
    /** Current schema version. Prefer `targetVersion`; `version` is accepted for brevity. */
    version?: number;
    /** Desired schema version. */
    targetVersion?: number;
    /** Default object used when the key is missing. */
    defaults?: JsonObject;
    /** Field name storing the version inside the object. Defaults to a host-defined schema field. */
    versionField?: string;
    /** Migration callback. Return a replacement object or mutate and return void. */
    migrate?(value: JsonObject, info: StorageMigrationInfo): MaybePromise<JsonObject | void>;
  }

  /** Metadata passed to a storage migration callback. */
  interface StorageMigrationInfo {
    /** Storage key being migrated. */
    key: string;
    /** Storage scope being migrated. */
    scope: StorageScope;
    /** Previous schema version. */
    fromVersion: number;
    /** Target schema version. */
    toVersion: number;
    /** Field that stores the version. */
    versionField: string;
    /** True when defaults were used because the key was missing. */
    isNew: boolean;
  }

  /** Result from storage migration. */
  interface StorageMigrationResult extends StorageMigrationInfo {
    /** Final stored version. */
    version: number;
    /** Requested target version. */
    targetVersion: number;
    /** Version before migration. */
    previousVersion: number;
    /** Whether the stored value changed. */
    migrated: boolean;
    /** Final stored object. */
    value: JsonObject;
  }

  /** User-mediated file/folder access plus safe reads and writes. */
  interface ResourcesApi {
    /** Opens a file/folder picker. */
    pick(request?: ResourcePickRequest): Promise<ResourcePickResult>;
    /** Opens a file picker. */
    pickFile(request?: Omit<ResourcePickRequest, "kind">): Promise<ResourcePickResult>;
    /** Opens a folder picker. */
    pickFolder(request?: Omit<ResourcePickRequest, "kind" | "filters">): Promise<ResourcePickResult>;
    /** Lists entries under a previously selected/allowed folder. */
    list(request: ResourceListRequest | string): Promise<ResourceListResult>;
    /** Reads text from a previously selected/allowed file. */
    readText(request: ResourceReadTextRequest | string): Promise<ResourceTextResult>;
    /** Reads and parses JSON from a previously selected/allowed file. */
    readJson(request: ResourceReadTextRequest | string): Promise<JsonValue>;
    /** Writes text to an allowed path. */
    writeText(request: ResourceWriteTextRequest): Promise<ResourceWriteResult>;
    /** Writes JSON to an allowed path. */
    writeJson(request: ResourceWriteJsonRequest): Promise<ResourceWriteResult>;
    /** Removes an allowed file/folder path. */
    remove(request: ResourceRemoveRequest | string): Promise<ResourceRemoveResult>;
    /** Opens a save dialog and writes text to the chosen path. */
    saveText(request: ResourceSaveTextRequest | string): Promise<ResourceWriteResult>;
    /** Opens a save dialog and writes JSON to the chosen path. */
    saveJson(request: ResourceSaveJsonRequest | JsonValue): Promise<ResourceWriteResult>;
  }

  /** File picker filter. */
  interface ResourceFilter {
    /** User-facing filter name, such as `Markdown`. */
    name: string;
    /** Extensions without leading dots. */
    extensions: string[];
  }

  /** File/folder picker request. */
  interface ResourcePickRequest {
    /** Whether to pick files or folders. */
    kind?: "file" | "folder";
    /** Allow selecting more than one item. */
    multiple?: boolean;
    /** Picker title. */
    title?: string;
    /** Suggested starting path. */
    defaultPath?: string;
    /** File filters. Ignored for folder pickers. */
    filters?: ResourceFilter[];
    /** Whether folder picks should grant recursive access. */
    recursive?: boolean;
  }

  /** Handle for a user-selected file or folder. */
  interface ResourceHandle {
    /** Absolute local path selected by the user. */
    path: string;
    /** Base file/folder name. */
    name: string;
    /** Resource kind. */
    kind: "file" | "folder";
    /** File extension without leading dot, when known. */
    extension?: string;
    /** ISO timestamp when the user selected this handle. */
    selectedAt: string;
  }

  /** Picker result. */
  interface ResourcePickResult {
    /** True when the user cancelled. */
    cancelled: boolean;
    /** Selected resources. Empty when cancelled. */
    resources: ResourceHandle[];
  }

  /** Directory listing request. */
  interface ResourceListRequest {
    /** Folder path to list. */
    path: string;
    /** Whether to include nested entries. */
    recursive?: boolean;
    /** Maximum entries before truncation. */
    maxEntries?: number;
  }

  /** Directory listing result. */
  interface ResourceListResult {
    /** Listed folder path. */
    path: string;
    /** Folder name. */
    name: string;
    /** Entries found under the folder. */
    entries: Array<{ path: string; relativePath: string; name: string; kind: "file" | "folder"; extension?: string; sizeBytes?: number; modifiedAt?: string }>;
    /** True when `maxEntries` cut off the result. */
    truncated: boolean;
  }

  /** Text/JSON read request. */
  interface ResourceReadTextRequest {
    /** File path to read. */
    path: string;
    /** Maximum bytes to read before truncation. */
    maxBytes?: number;
  }

  /** Text file read result. */
  interface ResourceTextResult {
    /** File path read. */
    path: string;
    /** File name. */
    name: string;
    /** Text content read. */
    text: string;
    /** Bytes read from disk. */
    bytesRead: number;
    /** True when `maxBytes` cut off the result. */
    truncated: boolean;
  }

  /** Text write request. */
  interface ResourceWriteTextRequest {
    /** Destination path. */
    path: string;
    /** Text to write. */
    text: string;
    /** Create parent directories when needed. */
    createDirs?: boolean;
  }

  /** JSON write request. */
  interface ResourceWriteJsonRequest extends Omit<ResourceWriteTextRequest, "text"> {
    /** JSON value to write. */
    value?: JsonValue;
    /** Alias for `value`. */
    data?: JsonValue;
    /** Pretty-print option. Use a number for indentation spaces. */
    pretty?: boolean | number;
  }

  /** Remove request. */
  interface ResourceRemoveRequest {
    /** Path to remove. */
    path: string;
    /** Allow removing a non-empty folder. */
    recursive?: boolean;
  }

  /** Remove result. */
  interface ResourceRemoveResult {
    /** Whether a resource was removed. */
    removed: boolean;
    /** Path requested for removal. */
    path: string;
  }

  /** Save-dialog text write request. */
  interface ResourceSaveTextRequest {
    /** Text to write. */
    text: string;
    /** Save dialog title. */
    title?: string;
    /** Suggested file path/name. */
    defaultPath?: string;
    /** File filters shown in the save dialog. */
    filters?: ResourceFilter[];
  }

  /** Save-dialog JSON write request. */
  interface ResourceSaveJsonRequest {
    /** JSON value to write. */
    value?: JsonValue;
    /** Alias for `value`. */
    data?: JsonValue;
    /** Save dialog title. */
    title?: string;
    /** Suggested file path/name. */
    defaultPath?: string;
    /** File filters shown in the save dialog. */
    filters?: ResourceFilter[];
    /** Pretty-print option. Use a number for indentation spaces. */
    pretty?: boolean | number;
  }

  /** File write result. */
  interface ResourceWriteResult {
    /** True when a save dialog was cancelled. */
    cancelled: boolean;
    /** Written resource, when available. */
    resource?: ResourceHandle;
    /** Bytes written. */
    bytesWritten: number;
  }

  /** Document extraction helpers. */
  interface DocumentsApi {
    /** Extracts text from a text file or PDF selected/allowed through resources. */
    extractText(request: DocumentExtractTextRequest | string): Promise<DocumentExtractTextResult>;
  }

  /** Document extraction request. */
  interface DocumentExtractTextRequest {
    /** File path to read. */
    path: string;
    /** File kind. Use `auto` to infer from extension/content. */
    kind?: "auto" | "text" | "pdf";
    /** Maximum raw bytes to read. */
    maxBytes?: number;
    /** Maximum extracted characters. */
    maxChars?: number;
    /** Maximum PDF pages to process. */
    maxPages?: number;
    /** Optional page range/selector for PDFs. */
    targetPages?: string;
    /** OCR behavior for scanned PDFs. */
    ocr?: "auto" | "on" | "off";
  }

  /** Extracted document text result. */
  interface DocumentExtractTextResult {
    /** File path read. */
    path: string;
    /** File name. */
    name: string;
    /** Detected document kind. */
    kind: "text" | "pdf";
    /** Extracted text. */
    text: string;
    /** Extracted character count. */
    chars: number;
    /** Bytes read, when reported. */
    bytesRead?: number;
    /** PDF page count, when known. */
    pageCount?: number;
    /** True when extraction was capped by limits. */
    truncated: boolean;
    /** Non-fatal extraction warnings. */
    warnings: string[];
    /** Additional extraction metadata. */
    metadata?: JsonObject;
  }

  /** Secret values from secret settings. Never log secret values. */
  interface SecretsApi {
    /** Reads a secret by key. */
    get(key: string): Promise<string | undefined>;
    /** Checks whether a secret exists without revealing it. */
    has(key: string): Promise<boolean>;
    /** Stores or replaces a secret value. */
    set(key: string, value: string): Promise<void>;
    /** Removes a secret. */
    remove(key: string): Promise<void>;
    /** Lists secret keys visible to this extension. */
    keys(): Promise<string[]>;
  }

  /** Extension diagnostics visible in the extension details UI. */
  interface DiagnosticsApi {
    /** Writes a log entry. */
    log(request: LogRequest | string): Promise<LogEntry>;
    /** Writes a debug log entry. */
    debug(message: string, data?: JsonObject): Promise<LogEntry>;
    /** Writes an info log entry. */
    info(message: string, data?: JsonObject): Promise<LogEntry>;
    /** Writes a warning log entry. */
    warn(message: string, data?: JsonObject): Promise<LogEntry>;
    /** Writes an error log entry. */
    error(message: string, data?: JsonObject): Promise<LogEntry>;
    /** Reads recent log entries. */
    getLogs(request?: { limit?: number }): Promise<LogEntry[]>;
    /**
     * Builds a support/debug report for this extension: a health summary plus
     * the sections you opt into. Each `include*` flag defaults to true except
     * `includeRecentEvents`, which is off by default.
     */
    getReport(request?: { logsLimit?: number; activityLimit?: number; eventsLimit?: number; jobsLimit?: number; includeLogs?: boolean; includeActivity?: boolean; includeRecentEvents?: boolean; includeJobs?: boolean; includeStorageKeys?: boolean }): Promise<JsonObject>;
    /** Clears this extension's diagnostic logs. */
    clear(): Promise<void>;
  }

  /** Diagnostic log write request. */
  interface LogRequest {
    /** Log level. Defaults to `info` when omitted. */
    level?: "debug" | "info" | "warn" | "error";
    /** Log message. Avoid secrets and private user content. */
    message: string;
    /** JSON metadata. Secret-like keys are redacted by the host. */
    data?: JsonObject;
  }

  /** Stored diagnostic log entry. */
  interface LogEntry extends LogRequest {
    /** Log entry ID. */
    id: string;
    /** Owning extension ID. */
    extensionId: string;
    /** Stored log level. */
    level: "debug" | "info" | "warn" | "error";
    /** ISO timestamp. */
    timestamp: string;
  }

  /** Visible job lifecycle API for long-running extension work. */
  interface JobsApi {
    /** Starts a visible job. */
    start(request: JobStartRequest): Promise<JobSnapshot>;
    /** Updates a running job. */
    update(jobId: string, request: JobUpdateRequest): Promise<JobSnapshot>;
    /** Marks a job succeeded. */
    finish(jobId: string, request?: { detail?: string; result?: JsonValue }): Promise<JobSnapshot>;
    /** Marks a job failed. */
    fail(jobId: string, request: { message: string; detail?: string; data?: JsonObject }): Promise<JobSnapshot>;
    /** Marks a job cancelled. */
    cancel(jobId: string, request?: { reason?: string }): Promise<JobSnapshot>;
    /** Reads one job by ID. */
    get(jobId: string): Promise<JobSnapshot | null>;
    /** Lists recent jobs. */
    list(request?: { states?: JobState[]; limit?: number }): Promise<JobSnapshot[]>;
    /** Checks whether the user requested cancellation. */
    isCancellationRequested(jobId: string): Promise<boolean>;
    /** Runs a handler with a managed job controller and finishes/fails around it. */
    run(request: JobStartRequest, handler: (job: JobRunController) => MaybePromise<JsonValue | void>): Promise<JobSnapshot>;
  }

  /** Job lifecycle state. */
  type JobState = "running" | "succeeded" | "failed" | "cancelled";

  /** Current visible job state. */
  interface JobSnapshot {
    /** Job ID, either supplied by the extension or generated by the host. */
    id: string;
    /** Owning extension ID. */
    extensionId: string;
    /** User-facing job title. */
    title: string;
    /** Current detail/status line. */
    detail?: string;
    /** Current job state. */
    state: JobState;
    /** Progress from 0 to 1. */
    progress?: number;
    /** Completed step count. */
    completedSteps?: number;
    /** Total step count. */
    totalSteps?: number;
    /** Whether the user can request cancellation. */
    cancellable: boolean;
    /** True when cancellation has been requested but not yet handled. */
    cancelRequested?: boolean;
    /** JSON result for succeeded jobs. */
    result?: JsonValue;
    /** Error payload for failed jobs. */
    error?: { message: string; detail?: string; data?: JsonObject };
    /** Extension-owned metadata. */
    metadata?: JsonObject;
    /** ISO start timestamp. */
    startedAt: string;
    /** ISO last-update timestamp. */
    updatedAt: string;
    /** ISO finish timestamp. */
    finishedAt?: string;
  }

  /** Request for starting a job. */
  interface JobStartRequest {
    /** Stable job ID. Reuse when one logical job should replace or be found later. */
    id?: string;
    /** User-facing title. */
    title: string;
    /** Initial detail/status line. */
    detail?: string;
    /** Initial progress from 0 to 1. */
    progress?: number;
    /** Initial completed step count. */
    completedSteps?: number;
    /** Total step count. */
    totalSteps?: number;
    /** Whether users may request cancellation. */
    cancellable?: boolean;
    /** Extension-owned metadata. */
    metadata?: JsonObject;
  }

  /** Request for updating a job. */
  interface JobUpdateRequest {
    /** Replacement title. */
    title?: string;
    /** Replacement detail; use `null` to clear. */
    detail?: string | null;
    /** Replacement progress; use `null` to clear. */
    progress?: number | null;
    /** Replacement completed step count; use `null` to clear. */
    completedSteps?: number | null;
    /** Replacement total step count; use `null` to clear. */
    totalSteps?: number | null;
    /** Replacement metadata; use `null` to clear. */
    metadata?: JsonObject | null;
  }

  /** Controller passed to `msty.jobs.run(...)`. */
  interface JobRunController {
    /** Snapshot from job start. Call `getSnapshot()` for latest state. */
    readonly job: JobSnapshot;
    /** Returns latest job snapshot. */
    getSnapshot(): JobSnapshot;
    /** Updates the job. */
    update(request: JobUpdateRequest): Promise<JobSnapshot>;
    /** Convenience helper for updating detail and optional progress/steps. */
    step(detailOrRequest: string | JobUpdateRequest, request?: Omit<JobUpdateRequest, "detail">): Promise<JobSnapshot>;
    /** Checks whether the user requested cancellation. */
    isCancellationRequested(): Promise<boolean>;
    /** Throws if cancellation was requested. */
    throwIfCancellationRequested(reason?: string): Promise<void>;
    /** Cancels the job. */
    cancel(reason?: string): Promise<JobSnapshot>;
  }

  /** Extension settings values and schema. */
  interface SettingsApi {
    /** Reads current settings with defaults applied when available. */
    get(): Promise<JsonObject>;
    /** Replaces all settings for this extension. */
    set(settings: JsonObject): Promise<void>;
    /** Patches current settings and returns the next value. */
    patch(settings: JsonObject): Promise<JsonObject>;
    /** Returns settings contributions declared by this extension. */
    getSchema(): Promise<SettingsContribution[]>;
  }

  /** Host-mediated network fetch request. */
  interface NetworkFetchRequest {
    /** Absolute URL. Origin must be allowed by the manifest. */
    url: string;
    /** HTTP method. Defaults to GET. */
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
    /** Request headers. */
    headers?: Record<string, string>;
    /** String request body. */
    body?: string;
    /** Request timeout in milliseconds. */
    timeoutMs?: number;
    /** Maximum response bytes to read. */
    maxBytes?: number;
    /** Parse response as text or JSON. */
    responseType?: "text" | "json";
  }

  /** Host-mediated network fetch response. */
  interface NetworkFetchResponse {
    /** Final URL after redirects, when reported. */
    url: string;
    /** HTTP status code. */
    status: number;
    /** HTTP status text. */
    statusText?: string;
    /** True for 2xx responses. */
    ok: boolean;
    /** Response headers. */
    headers: Record<string, string>;
    /** Response text. */
    text: string;
    /** Parsed JSON when requested and parseable. */
    json?: JsonValue;
  }

  /** User-visible notification/toast request. */
  interface NotificationRequest {
    /** Short title. */
    title: string;
    /** Optional body text. */
    body?: string;
    /** Semantic tone. */
    tone?: "default" | "success" | "warning" | "error";
  }

  /** Event subscription filter. */
  interface EventSubscriptionOptions {
    /**
     * Event names to receive. Omit for all extension-visible events.
     * `composer.changed` is only delivered while `composer.read` is granted.
     */
    types?: string[];
  }

  /** Package asset helpers for runtime workers. */
  interface AssetsApi {
    /** Returns a host-safe URL for a package asset, or null when unavailable. */
    url(path: string): Promise<string | null>;
    /** Reads a package text asset. */
    text(path: string): Promise<string | null>;
    /** Reads and parses a package JSON asset. */
    json(path: string): Promise<JsonValue | null>;
  }

  /** Package asset helpers for custom UI frames. */
  interface SurfaceAssetsApi extends AssetsApi {
    /** Injects a packaged CSS file into the custom UI frame. */
    injectCss(path: string): Promise<true>;
  }

  /** Runtime API for trigger providers. */
  interface TriggersApi {
    /** Registers a trigger provider while the runtime is active. */
    registerProvider(registration: TriggerProviderContribution): Disposable;
    /** Emits an event for a subscribed trigger. */
    emit(event: TriggerEvent): Promise<TriggerEmitResult>;
    /** Updates health for a provider or one subscription. */
    setHealth(update: { providerId: string; subscriptionId?: string; health: TriggerHealth }): Promise<void>;
    /** Lists trigger subscriptions for this extension. */
    listSubscriptions(): Promise<TriggerSubscription[]>;
    /** Resolves dynamic config options for trigger settings UI. */
    resolveOptions(request: TriggerOptionRequest): Promise<{ options: PickOption[] }>;
  }

  /** Health status for a trigger provider/subscription. */
  interface TriggerHealth extends JsonObject {
    /** Current health state. */
    status: "ready" | "needs_setup" | "auth_expired" | "rate_limited" | "failing" | "paused";
    /** User-facing status message. */
    message?: string;
    /** ISO timestamp for this health check. */
    checkedAt: string;
    /** ISO timestamp or duration hint for retry, when rate-limited/failing. */
    retryAfter?: string;
  }

  /** A user's configured trigger subscription. */
  interface TriggerSubscription {
    /** Subscription ID. */
    id: string;
    /** Owning task ID. */
    taskId: string;
    /** Owning extension ID. */
    extensionId: string;
    /** Provider ID. */
    providerId: string;
    /** Trigger definition ID. */
    triggerId: string;
    /** Whether this subscription currently runs. */
    enabled: boolean;
    /** User-provided trigger config. */
    config: JsonObject;
    /** Delivery mode. */
    delivery: "polling";
    /** Provider cursor for incremental polling. */
    cursor?: string | null;
    /** ISO creation timestamp. */
    createdAt: string;
    /** ISO last-update timestamp. */
    updatedAt: string;
    /** ISO last poll/check timestamp. */
    lastCheckedAt?: string | null;
    /** ISO last accepted event timestamp. */
    lastEventAt?: string | null;
    /** Latest health status. */
    health?: TriggerHealth;
  }

  /** Event emitted by a trigger provider. */
  interface TriggerEvent {
    /** Provider ID. */
    providerId: string;
    /** Trigger definition ID. */
    triggerId: string;
    /** Subscription receiving this event. */
    subscriptionId: string;
    /** Stable key used to dedupe repeated events. */
    dedupeKey: string;
    /** ISO timestamp when the event happened at the source. */
    occurredAt: string;
    /** ISO timestamp when the extension received it. */
    receivedAt?: string;
    /** User-facing event title. */
    title: string;
    /** Short event summary. */
    summary?: string;
    /** Source label/link shown to users. */
    source?: { label: string; url?: string };
    /** Event payload that should match the trigger event schema. */
    data: JsonObject;
    /** Additional user-facing links. */
    links?: Array<{ label: string; url: string }>;
  }

  /** Result from emitting a trigger event. */
  type TriggerEmitResult =
    | { accepted: true; runId?: string; deduped?: boolean }
    | { accepted: false; code: "subscription_disabled" | "schema_invalid" | "deduped" | "rate_limited" | "permission_missing" | "provider_unavailable"; message: string };

  /**
   * Request passed to `onTriggerCheck` once per enabled subscription on each
   * poll. Use `cursor` (or `since`) to fetch only what is new, cap output at
   * `maxEvents`, and aim to finish within `deadlineMs`.
   */
  interface TriggerCheckRequest {
    /** Subscription being polled, including its user config. */
    subscription: TriggerSubscription;
    /** Provider cursor saved from the previous check; `null` on the first run. */
    cursor?: string | null;
    /** ISO lower bound the host can supply; items at or before it may be skipped. */
    since?: string | null;
    /** Maximum number of events to return from this check. */
    maxEvents: number;
    /** Soft time budget in milliseconds for the whole check. */
    deadlineMs: number;
  }

  /** Result returned from `onTriggerCheck`. */
  interface TriggerCheckResult {
    /** New events found since the cursor. Return an empty array when nothing changed. */
    events: TriggerEvent[];
    /** Cursor to resume from on the next check. Omit to keep the current cursor. */
    nextCursor?: string | null;
    /** Updated health for this subscription, shown to the user. */
    health?: TriggerHealth;
  }

  /** Request for dynamic trigger config options. */
  interface TriggerOptionRequest {
    /** Provider ID. */
    providerId: string;
    /** Trigger definition ID. */
    triggerId: string;
    /** Field ID whose options are needed. */
    fieldId: string;
    /** User-entered filter query. */
    query?: string;
    /** Current trigger config. */
    currentConfig?: JsonObject;
    /** Maximum options to return. */
    limit: number;
  }

  /** Runtime command registration. */
  interface CommandRegistration extends CommandContribution {}

  /** First-party app target that an extension can open. */
  type AppOpenTarget =
    | "extension.details"
    | "extension.permissions"
    | "extension.settings"
    | "extension.storage"
    | "extension.jobs"
    | "extension.activity"
    | "extension.logs"
    | "settings.modelAssignments"
    | "settings.providers"
    | "settings.general";

  /** Request to open a first-party app target. */
  interface AppOpenRequest {
    /** Target screen. */
    target: AppOpenTarget;
    /** Model assignment to focus when opening model assignment settings. */
    assignmentId?: string;
  }

  /** Result from opening a first-party app target. */
  interface AppOpenResult {
    /** Whether the host opened the target. */
    opened: boolean;
    /** Target requested. */
    target: AppOpenTarget;
    /** Calling extension ID. */
    extensionId: string;
    /** Focused assignment ID, when applicable. */
    assignmentId?: string;
  }

  /** Runtime permission request. */
  interface PermissionRequest {
    /** Permissions needed for the current user action. */
    permissions: PermissionId[];
    /** User-facing reason for this request. */
    reason: string;
  }

  /** Permission check/request that can open permission review UI. */
  interface PermissionEnsureRequest extends PermissionRequest {
    /** Open review UI when permissions are missing or pending. */
    openReview?: boolean;
  }

  /** Result from `msty.permissions.ensure(...)`. */
  interface PermissionEnsureResult {
    /** True only when every requested permission is granted. */
    ok: boolean;
    /** Requested permissions that are granted. */
    granted: PermissionId[];
    /** Requested permissions with no current grant. */
    missing: PermissionId[];
    /** Requested permissions awaiting review. */
    pending: PermissionId[];
    /** Requested permissions denied by the user. */
    denied: PermissionId[];
    /** Requested permissions previously granted but later revoked. */
    revoked: PermissionId[];
    /** Requested permissions unavailable in this host/version. */
    unavailable: PermissionId[];
    /** Full permission records for requested permissions. */
    records: PermissionRecord[];
    /** Whether the host opened permission review UI. */
    reviewOpened?: boolean;
  }

  /** Trust level the host assigns to an installed extension package. */
  type TrustLevel =
    | "local-unsigned"
    | "local-signed"
    | "verified-publisher"
    | "marketplace-reviewed"
    | "official";

  /** Per-surface capability derived from the matching UI permission. */
  interface PlatformSurfaceCapability extends JsonObject {
    /** Permission that gates this surface. */
    permission: PermissionId;
    /** Current state of that permission. */
    state: PermissionState;
    /** Number of items the manifest declares for this surface. */
    declaredCount: number;
    /** Whether the extension can use this surface right now. */
    canUse: boolean;
  }

  /** Storage capability and limits for one storage scope. */
  interface PlatformStorageScopeCapability extends JsonObject {
    /** Whether this scope is usable right now. */
    canUse: boolean;
    /** Maximum bytes allowed for a single stored value. */
    maxValueBytes: number;
    /** Maximum total bytes allowed for this scope. */
    maxScopeBytes: number;
    /** Whether versioned storage migrations are supported. */
    migrations: boolean;
  }

  /** Feature flags exposed by this host, each gated by its permission. */
  interface PlatformFeatureCapabilities extends JsonObject {
    appNavigation: boolean;
    chatWrite: boolean;
    messageOpen: boolean;
    permissionRecovery: boolean;
    commands: boolean;
    rules: boolean;
    playbooks: boolean;
    tasks: boolean;
    triggers: boolean;
    settings: boolean;
    secretsRead: boolean;
    secretsWrite: boolean;
    resources: boolean;
    documents: boolean;
    events: boolean;
    jobs: boolean;
    jobRunner: boolean;
    assets: boolean;
    clipboardWrite: boolean;
    notifications: boolean;
    messageHooks: boolean;
    messageModify: boolean;
  }

  /**
   * Host capability snapshot for this extension, returned by
   * `msty.platform.getCapabilities()`. Every field reflects the current host
   * version and this extension's granted permissions, so prefer checking it over
   * assuming an API is available. The shape is additive; ignore unknown fields.
   */
  interface PlatformCapabilities extends JsonObject {
    /** Host extension API version. */
    extensionApiVersion: string;
    /** Supported manifest version. */
    manifestVersion: number;
    /** Identity and trust of the installed package. */
    extension: {
      id: string;
      name: string;
      version: string;
      trustLevel: TrustLevel;
      enabled: boolean;
    };
    /** Permission IDs grouped by current state. */
    permissions: {
      granted: PermissionId[];
      pending: PermissionId[];
      denied: PermissionId[];
      revoked: PermissionId[];
      unavailable: PermissionId[];
      required: PermissionId[];
      optional: PermissionId[];
    };
    /** Capability for each host chrome surface, keyed by surface name. */
    surfaces: Record<UiSurface, PlatformSurfaceCapability>;
    /** Host-rendered UI capabilities. */
    ui: {
      /** Whether sandboxed custom UI frames are supported. */
      customUi: boolean;
      /** Whether surface lifecycle events are delivered to custom UI. */
      surfaceLifecycle: boolean;
      /** Content block types the host can render in host-managed surfaces. */
      contentBlocks: Array<UiContentBlock["type"]>;
      /** Host-managed overlay kinds that can be opened. */
      hostManagedOverlays: OverlayKind[];
      /** Host-managed interaction dialogs available. */
      hostManagedInteractions: Array<"confirm" | "prompt" | "pick">;
    };
    /** Storage capability and limits per scope. */
    storage: {
      local: PlatformStorageScopeCapability;
      chat: PlatformStorageScopeCapability;
      workspace: PlatformStorageScopeCapability;
    };
    /** File/folder resource capability and size limits. */
    resources: {
      canPick: boolean;
      canReadText: boolean;
      canSaveText: boolean;
      maxReadBytes: number;
      maxWriteBytes: number;
    };
    /** Document text-extraction capability. */
    documents: {
      canExtractText: boolean;
      supportedKinds: Array<"text" | "pdf">;
      maxExtractChars: number;
    };
    /** Network fetch capability and allowed origins. */
    network: {
      canFetch: boolean;
      allowedOrigins: string[];
    };
    /** Theme capability for theme extensions. */
    themes: {
      canProvide: boolean;
      declaredCount: number;
      canPreview: boolean;
      canApply: boolean;
    };
    /** Model API capabilities exposed by this host. */
    models: {
      canInfer: boolean;
      canProvideModels: boolean;
      canUseLocalModels: boolean;
      declaredAssignmentCount: number;
    };
    /** Feature flags exposed by this host. */
    features: PlatformFeatureCapabilities;
  }
}

/**
 * Global custom-UI API.
 *
 * Custom UI can use the `msty` global directly, but the preferred entry point
 * is `mount({ root, msty, context, extension })` so dependencies stay explicit.
 */
declare var msty: Msty.SurfaceApi;
