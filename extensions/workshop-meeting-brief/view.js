// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

import "./view.css";

/** @param {Msty.SurfaceMountContext} params */
export async function mount({ root, msty, context }) {
  const settings = context.settings || {};
  const appContext = context.currentContext || {};
  const previousBrief = context.previousBrief || null;
  const state = {
    brief: "",
    status: "Preparing brief",
    error: "",
    running: false,
    stopped: false,
    saved: false,
    controller: null,
    modelStatus: null,
    modelCapabilities: context.modelCapabilities || null,
  };

  root.innerHTML = `<div id="mb-app"></div><div id="mb-toast"></div>`;
  const appEl = root.querySelector("#mb-app");
  const toastEl = root.querySelector("#mb-toast");

  root.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-action]");
    if (!button || button.disabled) return;
    const action = button.getAttribute("data-action");
    if (action === "stop") void stopStream();
    else if (action === "retry") void startStream();
    else if (action === "save") void saveBrief("Brief saved");
    else if (action === "copy") void copyBrief();
    else if (action === "insert") void insertBrief();
    else if (action === "model-settings") void openModelSetup();
    else if (action === "close") msty.surface?.close?.();
  });

  render();
  await startStream();

  async function startStream() {
    if (state.controller?.cancel) {
      await safe(() => state.controller.cancel());
    }
    state.brief = "";
    state.error = "";
    state.saved = false;
    state.stopped = false;
    state.modelStatus = null;
    state.modelCapabilities = context.modelCapabilities || null;
    state.running = true;
    state.status = "Checking model";
    render();

    try {
      const modelCapabilities = await checkModelCapabilities();
      const maxOutputTokens = modelOutputLimit(modelCapabilities, 900);
      if (modelCapabilities && modelCapabilities.canInfer === false) {
        state.running = false;
        state.status = "Choose a model";
        state.error =
          modelCapabilities.guidance?.unavailableReason ||
          modelCapabilities.defaultStatus?.unavailableReason ||
          modelCapabilities.defaultStatus?.message ||
          "Choose a model before generating this brief.";
        state.brief = fallbackBrief(settings, appContext);
        render();
        return;
      }
      const modelStatus = await checkModelStatus();
      if (modelStatus && !modelStatus.ready) {
        state.running = false;
        state.status = "Choose a model";
        state.error =
          modelStatus.unavailableReason ||
          modelStatus.message ||
          "Assign a model to Meeting Brief Writer before generating this brief.";
        state.brief = fallbackBrief(settings, appContext);
        render();
        return;
      }
      state.status = modelStatus?.model ? `Writing with ${modelStatus.model}` : "Writing brief";
      render();

      if (modelCanStream(modelCapabilities) && typeof msty.models?.stream === "function") {
        const stream = msty.models.stream(
          {
            prompt: text(context.prompt, fallbackPrompt(settings, appContext)),
            modelAssignment: "meeting_brief_writer",
            temperature: 0.2,
            maxOutputTokens,
            metadata: { example: "workshop-meeting-brief", surface: "full-view" },
          },
          (event) => {
            if (event.type === "start") {
              state.status = event.model ? `Writing with ${event.model}` : "Writing brief";
              render();
            } else if (event.type === "text_delta") {
              state.brief = event.text || `${state.brief}${event.delta || ""}`;
              updateBrief(state.brief);
            } else if (event.type === "complete") {
              state.brief = event.result?.text || state.brief;
              state.status = "Brief ready";
              state.running = false;
              render();
            } else if (event.type === "cancelled") {
              state.brief = event.text || state.brief;
              state.status = "Stopped";
              state.stopped = true;
              state.running = false;
              render();
            } else if (event.type === "error") {
              state.error = event.message || "The brief could not be generated.";
              state.status = "Needs attention";
              render();
            }
          },
        );
        state.controller = stream;
        const result = await stream.done;
        if (state.controller !== stream) return;
        state.brief = result?.text || state.brief || fallbackBrief(settings, appContext);
        state.running = false;
        state.status = result?.finishReason === "cancelled" ? "Stopped" : "Brief ready";
        if (result?.finishReason === "cancelled") state.stopped = true;
        render();
        if (!state.stopped && !state.error) await saveBrief(null);
        return;
      }

      const result = await msty.models?.infer?.({
        prompt: text(context.prompt, fallbackPrompt(settings, appContext)),
        modelAssignment: "meeting_brief_writer",
        temperature: 0.2,
        maxOutputTokens,
        metadata: { example: "workshop-meeting-brief", surface: "full-view-fallback" },
      });
      state.brief = result?.text || fallbackBrief(settings, appContext);
      state.status = "Brief ready";
      state.running = false;
      render();
      await saveBrief(null);
    } catch (error) {
      state.error = errorMessage(error);
      state.brief = state.brief || fallbackBrief(settings, appContext);
      state.status = state.stopped ? "Stopped" : "Needs attention";
      state.running = false;
      render();
    }
  }

  async function checkModelStatus() {
    if (typeof msty.models?.getStatus !== "function") return null;
    const status = await msty.models.getStatus({ modelAssignment: "meeting_brief_writer" });
    state.modelStatus = status || null;
    return state.modelStatus;
  }

  async function checkModelCapabilities() {
    if (typeof msty.models?.getCapabilities !== "function") return state.modelCapabilities;
    const capabilities = await msty.models.getCapabilities();
    state.modelCapabilities = capabilities || state.modelCapabilities;
    return state.modelCapabilities;
  }

  async function stopStream() {
    if (!state.running || !state.controller?.cancel) return;
    state.status = "Stopping";
    state.stopped = true;
    render();
    await safe(() => state.controller.cancel());
  }

  async function saveBrief(successMessage) {
    const body = composeBrief(settings, appContext, state.brief, previousBrief);
    await msty.storage?.workspace?.set?.("last_brief", {
      meetingName: text(settings.meetingName, "Meeting"),
      generatedAt: new Date().toISOString(),
      body,
    });
    state.saved = true;
    render();
    if (successMessage) notify(successMessage, "success");
  }

  async function copyBrief() {
    try {
      if (!(await ensurePermissions(["clipboard.write"], "Copy the generated brief when you choose Copy."))) return;
      await msty.clipboard?.writeText?.(composeBrief(settings, appContext, state.brief, previousBrief));
      notify("Brief copied to clipboard", "success");
    } catch (error) {
      notify(`Couldn't copy: ${errorMessage(error)}`, "error");
    }
  }

  async function insertBrief() {
    try {
      if (!(await ensurePermissions(["composer.write"], "Insert the generated brief into the message draft when you choose Insert."))) return;
      await msty.composer?.insertText?.({
        text: composeBrief(settings, appContext, state.brief, previousBrief),
        mode: "insert",
        select: true,
      });
      await safe(() =>
        msty.notifications?.show?.({ title: "Brief inserted", body: text(settings.meetingName, "Meeting Brief"), tone: "success" }),
      );
      notify("Brief inserted into the composer", "success");
    } catch (error) {
      notify(`Couldn't insert: ${errorMessage(error)}`, "error");
    }
  }

  async function openModelSetup() {
    try {
      if (typeof msty.app?.openModelAssignments !== "function") {
        notify("Open Settings, then choose Model Assignments.", "info");
        return;
      }
      await msty.app.openModelAssignments({ assignmentId: "meeting_brief_writer" });
      notify("Opened model assignments", "info");
    } catch (error) {
      notify(`Model setup unavailable: ${errorMessage(error)}`, "error");
    }
  }

  async function openPermissionReview() {
    if (typeof msty.app?.openExtension !== "function") return;
    await safe(() => msty.app.openExtension({ section: "permissions" }));
  }

  async function ensurePermissions(permissions, reason) {
    if (typeof msty.permissions?.ensure === "function") {
      const result = await msty.permissions.ensure({ permissions, reason, openReview: true });
      if (result?.ok) return true;
      notify(
        result?.reviewOpened ? "Review access in Extensions, then try again." : "Allow the missing access in Extensions, then try again.",
        "warning",
      );
      return false;
    }
    if (typeof msty.permissions?.request !== "function") return true;
    const records = await msty.permissions.request({ permissions, reason });
    const permissionRecords = Array.isArray(records) ? records : [];
    const missing = permissions.filter(
      (permissionId) =>
        !permissionRecords.some((permission) => permission.id === permissionId && permission.state === "granted"),
    );
    if (missing.length === 0) return true;
    notify("Review access in Extensions, then try again.", "warning");
    await openPermissionReview();
    return false;
  }

  // -- Toast ---------------------------------------------------------------

  let toastTimer;
  function notify(message, tone = "info") {
    if (!message) return;
    toastEl.innerHTML = `<div class="mb-toast mb-tone--${tone}" role="status"><span class="mb-toast__icon" aria-hidden="true">${icon(toneIconName(tone))}</span><span>${escapeHtml(message)}</span></div>`;
    const node = toastEl.firstElementChild;
    requestAnimationFrame(() => node && node.setAttribute("data-show", ""));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      const current = toastEl.firstElementChild;
      if (!current) return;
      current.removeAttribute("data-show");
      const clear = () => {
        if (toastEl.firstElementChild === current) toastEl.innerHTML = "";
      };
      current.addEventListener("transitionend", clear, { once: true });
      setTimeout(clear, 320);
    }, 3600);
  }

  // -- Streaming (update only the brief node) ------------------------------

  function updateBrief(value) {
    const body = appEl.querySelector("[data-brief]");
    if (body) {
      body.textContent = value || "";
      if (body.scrollHeight - body.scrollTop - body.clientHeight < 90) body.scrollTop = body.scrollHeight;
    }
    const count = appEl.querySelector("[data-brief-count]");
    if (count) count.textContent = value && value.trim() ? `${value.length} chars` : "Writing…";
  }

  // -- Render --------------------------------------------------------------

  function render() {
    const prevBrief = appEl.querySelector("[data-brief]");
    const prevScroll = prevBrief ? prevBrief.scrollTop : 0;

    const workspace = appContext.workspace?.path || appContext.workspacePath || "No workspace";
    const view = appContext.app?.currentView || appContext.currentView || "Chat";
    const hasBrief = Boolean(state.brief.trim());
    const modelReady = state.modelStatus ? state.modelStatus.ready !== false : true;
    const needsModel = state.status === "Choose a model";

    appEl.innerHTML = `
      <main class="mb">
        <header class="mb-head">
          <div class="mb-head__title">
            ${statusPill(state.status, state.running)}
            <h1>${escapeHtml(text(settings.meetingName, "Meeting Brief"))}</h1>
            <p>${escapeHtml(text(settings.goal, "Decide the next move with clear context."))}</p>
          </div>
          <div class="mb-head__actions">
            ${
              state.running
                ? `<button class="mbtn" type="button" data-action="stop">${icon("stop")} Stop</button>`
                : `<button class="mbtn" type="button" data-action="retry" title="Generate the brief again">${icon("refresh")} Rewrite</button>`
            }
            <button class="mbtn" type="button" data-action="save" title="Save this brief for the workspace" ${hasBrief ? "" : "disabled"}>${icon("save")} Save</button>
            <button class="mbtn" type="button" data-action="copy" title="Copy the brief to the clipboard" ${hasBrief ? "" : "disabled"}>${icon("copy")} Copy</button>
            <button class="mbtn mbtn--primary" type="button" data-action="insert" title="Insert the brief into your message draft" ${hasBrief ? "" : "disabled"}>${icon("insert")} Insert</button>
            <button class="mbtn mbtn--icon" type="button" data-action="close" aria-label="Close" title="Close">${icon("x")}</button>
          </div>
        </header>

        <section class="mb-tiles" aria-label="Meeting context">
          ${tile("users", "Attendees", text(settings.attendees, "Not set"), "muted")}
          ${tile("folder", "Workspace", shortPath(workspace), "muted")}
          ${tile("window", "View", view, "muted")}
          ${tile("cpu", "Model", modelStatusLabel(state.modelStatus), modelReady ? "success" : "warning")}
          ${tile("bolt", "Mode", modelCapabilityLabel(state.modelCapabilities), "info")}
        </section>

        ${
          state.error
            ? `<div class="mb-callout mb-tone--warning" role="alert">
                 <span class="mb-callout__icon" aria-hidden="true">${icon("alert")}</span>
                 <span class="mb-callout__text">${escapeHtml(state.error)}</span>
                 ${needsModel ? `<button class="mbtn mbtn--sm" type="button" data-action="model-settings">${icon("gear")} Choose model</button>` : ""}
               </div>`
            : ""
        }

        <div class="mb-grid">
          <article class="mb-brief${state.running ? " is-writing" : ""}">
            <div class="mb-brief__head">
              <h2>Brief</h2>
              <span class="mb-brief__count" data-brief-count>${escapeHtml(hasBrief ? `${state.brief.length} chars` : "Waiting for text")}</span>
            </div>
            <div class="mb-brief__body" data-brief>${escapeHtml(state.brief)}</div>
            ${!hasBrief && !state.running ? `<div class="mb-brief__placeholder">The brief appears here as the model writes.</div>` : ""}
          </article>

          <aside class="mb-side">
            <section class="mb-card">
              <h2>Rough notes</h2>
              <p>${escapeHtml(text(settings.notes, "No notes configured."))}</p>
            </section>
            <section class="mb-card">
              <h2>Previous brief</h2>
              <p>${escapeHtml(previousSummary(previousBrief))}</p>
            </section>
          </aside>
        </div>
      </main>
    `;

    const briefBody = appEl.querySelector("[data-brief]");
    if (briefBody) briefBody.scrollTop = state.running ? briefBody.scrollHeight : prevScroll;
  }

  function statusPill(status, running) {
    const tone = running ? "live" : status === "Brief ready" ? "ok" : status === "Choose a model" || status === "Needs attention" ? "warn" : "info";
    return `<span class="mb-status mb-status--${tone}"><span class="mb-status__dot" aria-hidden="true"></span>${escapeHtml(status)}</span>`;
  }
}

// -- Presentation helpers ---------------------------------------------------

function tile(iconName, label, value, tone) {
  return `
    <article class="mb-tile mb-tone--${tone}">
      <span class="mb-tile__icon" aria-hidden="true">${icon(iconName)}</span>
      <div class="mb-tile__text">
        <span class="mb-tile__label">${escapeHtml(label)}</span>
        <span class="mb-tile__value">${escapeHtml(String(value || "Not available"))}</span>
      </div>
    </article>
  `;
}

const ICONS = {
  spark: '<path d="M12 4.5c.4 2.7 1.8 4.1 4.5 4.5-2.7.4-4.1 1.8-4.5 4.5-.4-2.7-1.8-4.1-4.5-4.5 2.7-.4 4.1-1.8 4.5-4.5z"/><path d="M18 14.5c.2 1.3.9 2 2.2 2.2-1.3.2-2 .9-2.2 2.2-.2-1.3-.9-2-2.2-2.2 1.3-.2 2-.9 2.2-2.2z"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
  refresh: '<path d="M4.5 9a7.5 7.5 0 0 1 13-2.7L20 9"/><path d="M20 4v5h-5"/><path d="M19.5 15a7.5 7.5 0 0 1-13 2.7L4 15"/><path d="M4 20v-5h5"/>',
  save: '<path d="M5 4h11l3 3v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M8 4v5h7"/><path d="M8 14h8v5H8z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
  insert: '<path d="M12 3v11"/><path d="m8 10 4 4 4-4"/><path d="M5 20h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 13a1.6 1.6 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3 2 2 0 1 1-2.8-2.8 1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8 2 2 0 1 1 2.8-2.8 1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3 2 2 0 1 1 2.8 2.8 1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5"/><path d="M17.5 14.2A5.5 5.5 0 0 1 21 20"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 2.5v2.5M15 2.5v2.5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5"/>',
  bolt: '<path d="M13 2 4.5 13.5H11l-1 8.5 8.5-12H12z"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  "check-circle": '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
};

function icon(name) {
  const paths = ICONS[name] || ICONS.spark;
  return `<svg class="mb-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function toneIconName(tone) {
  if (tone === "success") return "check-circle";
  if (tone === "warning" || tone === "error") return "alert";
  return "info";
}

function composeBrief(settings, context, brief, previous) {
  const lines = [
    text(settings.meetingName, "Meeting Brief"),
    "",
    `Goal: ${text(settings.goal, "Not set")}`,
    `Attendees: ${text(settings.attendees, "Not set")}`,
    `Workspace: ${context.workspace?.path || context.workspacePath || "Not available"}`,
    `Current view: ${context.app?.currentView || context.currentView || "Not available"}`,
    "",
    "Brief",
    text(brief, fallbackBrief(settings, context)),
  ];
  if (previous?.generatedAt) {
    lines.push("", `Previous brief: ${formatWhen(previous.generatedAt)}`);
  }
  return lines.join("\n");
}

function fallbackPrompt(settings, context) {
  return [
    "Create a concise meeting brief with: purpose, context, decisions needed, risks, and next actions.",
    `Meeting: ${text(settings.meetingName, "Untitled meeting")}`,
    `Attendees: ${text(settings.attendees, "Not set")}`,
    `Goal: ${text(settings.goal, "Not set")}`,
    `Workspace: ${context.workspace?.path || context.workspacePath || "Not available"}`,
    `Notes:\n${text(settings.notes, "No notes provided")}`,
  ].join("\n\n");
}

function fallbackBrief(settings, context) {
  return [
    "Purpose",
    text(settings.goal, "Clarify the meeting goal before starting."),
    "",
    "Context",
    `Workspace: ${context.workspace?.path || context.workspacePath || "Not available"}`,
    "",
    "Decisions needed",
    "- Confirm owners for open items.",
    "- Decide what moves forward after the meeting.",
    "",
    "Risks",
    text(settings.notes, "No rough notes were provided."),
    "",
    "Next actions",
    "- Assign owners and dates before closing the meeting.",
  ].join("\n");
}

function modelStatusLabel(status) {
  if (!status) return "Checking";
  if (!status.ready) return status.unavailableReason || status.message || "Needs assignment";
  const provider = status.providerName || status.providerId || "Assigned";
  return status.model ? `${provider} · ${status.model}` : provider;
}

function modelCanStream(capabilities) {
  return !capabilities || capabilities.canStream !== false;
}

function modelOutputLimit(capabilities, fallback) {
  const limit = Number(capabilities?.limits?.maxOutputTokens);
  if (!Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.max(1, Math.min(fallback, Math.trunc(limit)));
}

function modelCapabilityLabel(capabilities) {
  if (!capabilities) return "Host default";
  if (capabilities.canInfer === false) return "Unavailable";
  const mode = capabilities.canStream === false ? "Single response" : "Streaming";
  const assignmentCount = Number(capabilities.guidance?.assignmentCount || 0);
  if (assignmentCount > 0) return `${mode}, ${assignmentCount} slot${assignmentCount === 1 ? "" : "s"}`;
  return mode;
}

function previousSummary(previous) {
  if (!previous?.generatedAt) return "No saved brief for this workspace yet.";
  return `Last saved ${formatWhen(previous.generatedAt)}.`;
}

function formatWhen(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return date.toLocaleString();
}

function shortPath(value) {
  const parts = String(value || "").replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length <= 2) return value || "No workspace";
  return `…/${parts.slice(-2).join("/")}`;
}

async function safe(callback, fallback) {
  try {
    const value = await callback();
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function errorMessage(error) {
  return error && typeof error.message === "string" ? error.message : String(error);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
