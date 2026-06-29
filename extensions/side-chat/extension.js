// @ts-check
/// <reference path="../msty-extension-api.d.ts" />
// Msty Claw loads this module directly from the extension ZIP.

const OPEN_COMMAND = "side-chat.open";
const POPUP_ID = "side_chat";
const TITLE_BAR_ID = "side_chat_open";
const VIEW_ENTRY = "view.js";
let popupOpenPromise = null;

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  const disposables = [];

  if (typeof msty.ui?.registerTitleBarItem === "function") {
    disposables.push(
      msty.ui.registerTitleBarItem({
        id: TITLE_BAR_ID,
        title: "Side Chat",
        label: "Side",
        tooltip: "Open or close Side Chat",
        icon: "static/icon.svg",
        entry: "extension.js",
        command: OPEN_COMMAND,
        when: "chat.hasMessages",
        shortcut: "mod+;",
        shortcutHint: "mod+;",
        priority: 44,
      }),
    );
  }

  return {
    /**
     * @param {string} command
     * @param {Record<string, unknown>} [activationContext]
     */
    async run(command, activationContext = {}) {
      if (command !== OPEN_COMMAND) return undefined;
      return openSideChat(msty, activationContext);
    },
    dispose() {
      disposeAll(disposables);
    },
  };
}

/**
 * @param {Msty.ExtensionApi} msty
 * @param {Record<string, unknown>} activationContext
 */
async function openSideChat(msty, activationContext) {
  const importReply = normalizeImportReply(activationContext?.importReply);
  if (!importReply && popupOpenPromise) {
    if (typeof msty.ui?.closeSurface === "function") {
      const result = await msty.ui.closeSurface({
        kind: "popup",
        id: POPUP_ID,
        result: { dismissed: true },
      });
      if (!result || result.closed !== false) return result;

      // A closed:false result means the host no longer has this popup, so clear stale state and open it again.
      popupOpenPromise = null;
    } else {
      return popupOpenPromise;
    }
  }

  const context = await safe(() => msty.context.getCurrent(), {});
  const chatId = currentChatId(context);
  /** @type {Msty.UiOpenRequest & Msty.UiOpenContributionRequest} */
  const request = {
    kind: "popup",
    id: POPUP_ID,
    title: "Side Chat",
    width: "medium",
    entry: VIEW_ENTRY,
    headerActions: [
      {
        id: "clear",
        label: "Clear Side Chat",
        icon: "trash",
        variant: "danger",
        disabled: true,
      },
    ],
    context: compactObject({
      chatId,
      chatTitle: text(context?.conversation?.title, ""),
      importReply,
      openedAt: new Date().toISOString(),
    }),
    contextSync: { activeChat: true },
  };

  const openPromise =
    typeof msty.ui?.openContribution === "function"
      ? msty.ui.openContribution(request)
      : msty.ui?.openPopup?.(request);
  const trackedPromise = Promise.resolve(openPromise).finally(() => {
    if (popupOpenPromise === trackedPromise) popupOpenPromise = null;
  });
  popupOpenPromise = trackedPromise;
  return trackedPromise;
}

function currentChatId(context) {
  return text(
    context?.activeConversationId,
    text(
      context?.conversation?.id,
      text(context?.activeMessage?.chatId, text(context?.recentMessages?.at?.(-1)?.chatId, "")),
    ),
  );
}

function normalizeImportReply(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = /** @type {Record<string, unknown>} */ (value);
  const prompt = text(source.prompt, "");
  const content = text(source.content, "");
  const reasoning = text(source.reasoning, "");
  const error =
    typeof source.error === "string"
      ? source.error
      : source.error === null
        ? null
        : undefined;
  if (!prompt && !content && !reasoning && !error) return undefined;
  return compactObject({ prompt, content, reasoning, error });
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function disposeAll(disposables) {
  while (disposables.length) {
    try {
      disposables.pop()?.();
    } catch {
      /* ignore */
    }
  }
}

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function text(value, fallback) {
  return typeof value === "string" ? value.trim() : fallback;
}
