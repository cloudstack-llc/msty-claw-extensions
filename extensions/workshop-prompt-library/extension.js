// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

// Msty Claw loads this module directly from the extension ZIP.
// Prompt Library turns a simple list of saved prompts into a browsable view.
// The full view (ui.js) owns prompt insertion; this entry only opens the view
// with the latest prompts and a running open count.

const COMMAND = "prompt-library.open";

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  /** @type {Msty.Disposable[]} */
  const disposables = [];

  // Only the dynamic fields the runtime updates; manifest.json owns the rest.
  if (typeof msty.ui?.registerWorkspaceItem === "function") {
    disposables.push(
      msty.ui.registerWorkspaceItem({
        id: "prompt_library",
        command: COMMAND,
      }),
    );
  }

  return {
    /** @param {string} command */
    async run(command) {
      if (command !== COMMAND) return undefined;
      const settings = await safeSettings(msty);
      // Track how many times the library has been opened on this device so the
      // view can show a small "opens" stat. Storage is best-effort.
      const opens = Number((await safeLocalGet(msty, "open_count")) || 0) + 1;
      await safeLocalSet(msty, "open_count", opens);
      const snippets = parseSnippets(settings);
      return msty.ui?.openFullView?.({
        id: "prompt_library_view",
        title: "Prompt Library",
        width: "wide",
        entry: "ui.js",
        context: {
          snippets,
          activeTag: text(settings.activeTag, ""),
          opens,
        },
      });
    },
    dispose() {
      disposeAll(disposables);
    },
  };
}

// Each non-empty settings line is "tag :: name :: prompt". The prompt may itself
// contain "::", so anything after the second separator is rejoined. Empty fields
// fall back to sensible defaults so a partial line still renders.
function parseSnippets(settings) {
  return text(settings.snippets, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [tag, name, ...promptParts] = line.split("::").map((part) => part.trim());
      return {
        tag: tag || "general",
        name: name || "Untitled",
        prompt: promptParts.join(" :: ") || line,
      };
    });
}

async function safeSettings(msty) {
  try {
    return (await msty.settings?.get?.()) ?? {};
  } catch {
    return {};
  }
}

async function safeLocalGet(msty, key) {
  try {
    return await msty.storage?.local?.get?.(key);
  } catch {
    return undefined;
  }
}

async function safeLocalSet(msty, key, value) {
  try {
    await msty.storage?.local?.set?.(key, value);
  } catch {
    /* optional storage */
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
