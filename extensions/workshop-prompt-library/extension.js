// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

import { loadPromptLibrary, refreshStarterPrompts } from "./prompt-store.js";

const OPEN_COMMAND = "prompt-library.open";
const PICK_COMMAND = "prompt-library.pick";
const REFRESH_STARTERS_COMMAND = "prompt-library.refreshStarters";
const FULL_VIEW_ID = "prompt_library_view";
const PICKER_ID = "prompt_library_picker";

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  /** @type {Array<Msty.Disposable | (() => void)>} */
  const disposables = [];

  if (typeof msty.ui?.registerWorkspaceItem === "function") {
    disposables.push(
      msty.ui.registerWorkspaceItem({
        id: "prompt_library",
        command: OPEN_COMMAND,
      }),
    );
  }

  if (typeof msty.ui?.registerToolboxItem === "function") {
    disposables.push(
      msty.ui.registerToolboxItem({
        id: "prompt_library_toolbox",
        title: "Prompts",
        label: "Prompts",
        tooltip: "Insert a saved prompt",
        icon: "static/icon.svg",
        command: PICK_COMMAND,
        priority: 38,
        when: "composer.canEdit",
      }),
    );
  }

  return {
    /** @param {string} command */
    async run(command) {
      if (command === OPEN_COMMAND) return openLibrary(msty);
      if (command === PICK_COMMAND) return openPicker(msty);
      if (command === REFRESH_STARTERS_COMMAND) return refreshStarters(msty);
      return undefined;
    },
    dispose() {
      disposeAll(disposables);
    },
  };
}

/** @param {Msty.ExtensionApi} msty */
async function openLibrary(msty) {
  const snapshot = await loadPromptLibrary(msty, { autoRefresh: true });
  return openContribution(msty, {
    id: FULL_VIEW_ID,
    kind: "fullView",
    title: "Prompt Library",
    width: "wide",
    context: {
      prompts: snapshot.prompts,
      meta: snapshot.meta,
      refresh: snapshot.refresh,
    },
  });
}

/** @param {Msty.ExtensionApi} msty */
async function openPicker(msty) {
  const snapshot = await loadPromptLibrary(msty, { autoRefresh: true });
  return openContribution(msty, {
    id: PICKER_ID,
    kind: "popup",
    title: "Prompts",
    width: "medium",
    context: {
      prompts: snapshot.prompts,
      meta: snapshot.meta,
    },
  });
}

/** @param {Msty.ExtensionApi} msty */
async function refreshStarters(msty) {
  const snapshot = await refreshStarterPrompts(msty);
  const added = Number(snapshot.refresh.added || 0);
  const updated = Number(snapshot.refresh.updated || 0);
  const unavailable = snapshot.refresh.status === "unavailable";
  const title = unavailable ? "Using saved prompts" : "Starter prompts updated";
  const body = unavailable
    ? "Using the saved prompts on this device. Try refreshing again later."
    : added || updated
      ? `${added + updated} prompt${added + updated === 1 ? "" : "s"} updated.`
      : "Everything is already up to date.";

  return {
    message: body,
    actions: [
      {
        type: "showNotification",
        title,
        body,
        tone: unavailable ? "warning" : "success",
      },
    ],
  };
}

/**
 * @param {Msty.ExtensionApi} msty
 * @param {Msty.UiOpenContributionRequest} request
 */
function openContribution(msty, request) {
  if (typeof msty.ui?.openContribution === "function") {
    return msty.ui.openContribution(request);
  }
  const fallback = {
    id: request.id,
    title: request.title || "Prompt Library",
    entry: request.kind === "popup" ? "picker.js" : "ui.js",
    width: request.width,
    context: request.context,
  };
  if (request.kind === "popup") return msty.ui?.openPopup?.(fallback);
  if (request.kind === "fullView") return msty.ui?.openFullView?.(fallback);
  return undefined;
}

/** @param {Array<Msty.Disposable | (() => void)>} disposables */
function disposeAll(disposables) {
  while (disposables.length) {
    try {
      const disposable = disposables.pop();
      if (typeof disposable === "function") disposable();
      else disposable?.dispose?.();
    } catch {
      /* Best-effort cleanup. */
    }
  }
}
