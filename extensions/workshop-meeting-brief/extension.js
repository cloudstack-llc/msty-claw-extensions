// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

// Msty Claw loads this module directly from the extension ZIP.
// Meeting Brief Workshop opens a streamed full-view brief writer that combines
// settings, current context, model inference, composer actions, and workspace
// storage into a reusable pre-meeting workflow.

const COMMAND = "meeting-brief.open";

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  const disposables = [];
  const item = {
    id: "meeting_brief",
    title: "Meeting Brief",
    label: "Meeting Brief",
    tooltip: "Create a meeting-ready brief",
    entry: "extension.js",
    command: COMMAND,
    priority: 40,
  };

  if (typeof msty.ui?.registerWorkspaceItem === "function") {
    disposables.push(msty.ui.registerWorkspaceItem(item));
  }
  if (typeof msty.ui?.registerFullView === "function") {
    disposables.push(msty.ui.registerFullView({ ...item, id: "meeting_brief_view" }));
  }

  return {
    async run(command) {
      if (command !== COMMAND) return undefined;
      const settings = await safeSettings(msty);
      const context = await safeContext(msty);
      const modelCapabilities = await safeModelCapabilities(msty);
      const previous = await safeStorageGet(msty, "last_brief");
      const prompt = buildPrompt(settings, context);
      return msty.ui?.openFullView?.({
        id: "meeting_brief_view",
        title: text(settings.meetingName, "Meeting Brief"),
        width: "wide",
        entry: "view.js",
        context: {
          settings,
          currentContext: context,
          modelCapabilities,
          previousBrief: previous || null,
          prompt,
          generatedAt: new Date().toISOString(),
        },
      });
    },
    dispose() {
      disposeAll(disposables);
    },
  };
}

function buildPrompt(settings, context) {
  return [
    "Create a concise meeting brief with: purpose, context, decisions needed, risks, and next actions.",
    `Meeting: ${text(settings.meetingName, "Untitled meeting")}`,
    `Attendees: ${text(settings.attendees, "Not set")}`,
    `Goal: ${text(settings.goal, "Not set")}`,
    `Workspace: ${context.workspacePath || "Not available"}`,
    `Notes:\n${text(settings.notes, "No notes provided")}`,
  ].join("\n\n");
}

async function safeSettings(msty) {
  try {
    return (await msty.settings?.get?.()) ?? {};
  } catch {
    return {};
  }
}

async function safeContext(msty) {
  try {
    return (await msty.context?.getCurrent?.()) ?? {};
  } catch {
    return {};
  }
}

async function safeModelCapabilities(msty) {
  try {
    return (await msty.models?.getCapabilities?.()) ?? null;
  } catch {
    return null;
  }
}

async function safeStorageGet(msty, key) {
  try {
    return await msty.storage?.workspace?.get?.(key);
  } catch {
    return undefined;
  }
}

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function disposeAll(disposables) {
  while (disposables.length) {
    try {
      disposables.pop()?.();
    } catch {
      /* ignore cleanup errors */
    }
  }
}
