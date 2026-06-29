// @ts-check
/// <reference path="../msty-extension-api.d.ts" />
// Msty Claw loads this module directly from the extension ZIP.

// Msty Claw loads this module directly from the extension ZIP.
import {
  POPUP_ID,
  STORE_KEY,
  buildChromeUpdates,
  normalizeStoredTasks,
  upsertTask,
  visibleTasks,
} from "./core.js";
import {
  countsDiagnostic,
  errorDiagnostic,
  logError,
  logInfo,
  logWarn,
  taskDiagnostic,
} from "./diagnostics.js";

const TOOL_COMMAND = "flag-task.create";
const OPEN_COMMAND = "flag-task.open";
const VIEW_ENTRY = "view.js";
const FLAGGED_TOAST_DURATION_MS = 8_000;

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  const disposables = [];

  if (typeof msty.ui?.registerStatusBarPill === "function") {
    disposables.push(
      msty.ui.registerStatusBarPill({
        id: "flag_task_status",
        title: "Follow-ups",
        label: "Follow-ups",
        tooltip: "Review flagged follow-ups",
        hidden: true,
        entry: "extension.js",
        command: OPEN_COMMAND,
      }),
    );
  }

  await refreshChrome(msty);

  return {
    /**
     * @param {string} command
     * @param {Record<string, unknown>} [input]
     */
    async run(command, input = {}) {
      if (command === TOOL_COMMAND) return flagTask(msty, input);
      if (command === OPEN_COMMAND) return openStackAction(msty);
      return undefined;
    },
    dispose() {
      disposeAll(disposables);
    },
  };
}

/**
 * Stores the flagged item and opens the stack without blocking the model on the
 * popup lifecycle. The tool response stays short so the assistant can continue.
 *
 * @param {Msty.ExtensionApi} msty
 * @param {Record<string, unknown>} input
 */
async function flagTask(msty, input) {
  try {
    const source = await currentSource(msty);
    const stored = await readTasks(msty, { required: true });
    const { tasks, task, created } = upsertTask(stored, input, { source });

    await writeTasks(msty, tasks);
    await refreshChrome(msty, tasks);
    await logInfo(msty, created ? "Follow-up flagged." : "Follow-up updated.", {
      ...taskDiagnostic(task),
      created,
      totalStored: tasks.length,
    });
    await showFlaggedToast(msty, task, created);
    void openStack(msty, task.id).catch((error) => {
      void logError(msty, "Could not open the follow-up stack after flagging.", {
        taskId: task.id,
        error: errorDiagnostic(error),
      });
    });

    return {
      content: created
        ? `Flagged follow-up: ${task.title}.`
        : `Updated existing follow-up: ${task.title}.`,
    };
  } catch (error) {
    await logError(msty, "Could not save a flagged follow-up.", {
      inputKeys:
        input && typeof input === "object"
          ? Object.keys(input).sort().slice(0, 24)
          : [],
      error: errorDiagnostic(error),
    });
    throw error;
  }
}

/**
 * @param {Msty.ExtensionApi} msty
 * @param {import("./core.js").FlagTaskItem} task
 * @param {boolean} created
 */
async function showFlaggedToast(msty, task, created) {
  try {
    await msty.notifications?.show?.({
      title: created ? "Follow-up flagged" : "Follow-up updated",
      body: task.title,
      tone: "success",
      durationMs: FLAGGED_TOAST_DURATION_MS,
    });
  } catch (error) {
    await logWarn(msty, "Could not show the follow-up notification.", {
      taskId: task.id,
      error: errorDiagnostic(error),
    });
  }
}

/**
 * @param {Msty.ExtensionApi} msty
 * @param {string} [selectedTaskId]
 */
async function openStack(msty, selectedTaskId = "") {
  try {
    const tasks = await readTasks(msty);
    await refreshChrome(msty, tasks);
    await logInfo(msty, "Opening follow-up stack.", {
      selectedTaskId,
      ...countsDiagnostic(tasks),
    });
    return await msty.ui?.openContribution?.({
      id: POPUP_ID,
      kind: "popup",
      title: "Follow-ups",
      width: "medium",
      context: stackContext(tasks, selectedTaskId),
    });
  } catch (error) {
    await logError(msty, "Could not open the follow-up stack.", {
      selectedTaskId,
      error: errorDiagnostic(error),
    });
    throw error;
  }
}

/**
 * @param {Msty.ExtensionApi} msty
 * @param {string} [selectedTaskId]
 */
async function openStackAction(msty, selectedTaskId = "") {
  const tasks = await readTasks(msty);
  await refreshChrome(msty, tasks);
  await logInfo(msty, "Prepared follow-up stack open action.", {
    selectedTaskId,
    ...countsDiagnostic(tasks),
  });
  return {
    actions: [
      {
        type: "openUi",
        kind: "popup",
        request: {
          id: POPUP_ID,
          title: "Follow-ups",
          entry: VIEW_ENTRY,
          width: "medium",
          context: stackContext(tasks, selectedTaskId),
        },
      },
    ],
  };
}

/**
 * @param {import("./core.js").FlagTaskItem[]} tasks
 * @param {string} selectedTaskId
 */
function stackContext(tasks, selectedTaskId) {
  return {
    tasks: visibleTasks(tasks, { showDismissed: true }),
    selectedTaskId,
    openedAt: new Date().toISOString(),
  };
}

/**
 * @param {Msty.ExtensionApi} msty
 * @param {import("./core.js").FlagTaskItem[]} [tasks]
 */
async function refreshChrome(msty, tasks) {
  const current = tasks || (await readTasks(msty));
  for (const update of buildChromeUpdates(current)) {
    await safeUiUpdate(msty, update);
  }
}

/** @param {Msty.ExtensionApi} msty */
async function currentSource(msty) {
  let context = {};
  try {
    context = (await msty.context?.getCurrent?.()) || {};
  } catch (error) {
    await logWarn(msty, "Could not read current chat context for a follow-up.", {
      error: errorDiagnostic(error),
    });
  }
  const conversation =
    context && typeof context === "object"
      ? /** @type {{ conversation?: { id?: string, title?: string }, activeConversationId?: string, workspacePath?: string }} */ (context)
      : {};
  return {
    chatId: conversation.conversation?.id || conversation.activeConversationId || "",
    chatTitle: conversation.conversation?.title || "",
    workspacePath: conversation.workspacePath || "",
  };
}

/**
 * @param {Msty.ExtensionApi} msty
 * @param {{ required?: boolean, fallback?: import("./core.js").FlagTaskItem[] }} [options]
 */
async function readTasks(msty, options = {}) {
  const fallback = normalizeStoredTasks(options.fallback || []);
  if (typeof msty.storage?.workspace?.get !== "function") {
    const error = new Error("Follow-ups could not be loaded.");
    await logWarn(msty, "Could not read stored follow-ups.", {
      required: options.required === true,
      error: errorDiagnostic(error),
    });
    if (options.required === true) throw error;
    return fallback;
  }
  try {
    return normalizeStoredTasks(await msty.storage.workspace.get(STORE_KEY));
  } catch (error) {
    await logWarn(msty, "Could not read stored follow-ups.", {
      required: options.required === true,
      error: errorDiagnostic(error),
    });
    if (options.required === true) throw error;
    return fallback;
  }
}

/**
 * @param {Msty.ExtensionApi} msty
 * @param {import("./core.js").FlagTaskItem[]} tasks
 */
async function writeTasks(msty, tasks) {
  if (typeof msty.storage?.workspace?.set !== "function") {
    throw new Error("Follow-ups could not be saved.");
  }
  try {
    await msty.storage.workspace.set(STORE_KEY, normalizeStoredTasks(tasks));
  } catch (error) {
    await logError(msty, "Could not write stored follow-ups.", {
      totalStored: tasks.length,
      error: errorDiagnostic(error),
    });
    throw error;
  }
}

/**
 * @param {Msty.ExtensionApi} msty
 * @param {Msty.UiUpdateRequest} update
 */
async function safeUiUpdate(msty, update) {
  try {
    await msty.ui?.update?.(update);
  } catch (error) {
    await logWarn(msty, "Could not update Follow-ups app chrome.", {
      updateId: update.id,
      surface: update.surface,
      error: errorDiagnostic(error),
    });
  }
}

/** @param {Array<Msty.Disposable | (() => void)>} disposables */
function disposeAll(disposables) {
  for (const disposable of disposables) {
    try {
      if (typeof disposable === "function") {
        disposable();
      } else {
        disposable.dispose();
      }
    } catch {
      /* Best-effort cleanup. */
    }
  }
}
