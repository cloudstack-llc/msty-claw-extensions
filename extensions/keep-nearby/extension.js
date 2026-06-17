// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

// Msty Claw loads this module directly from the extension ZIP.

const OPEN_COMMAND = "keep-nearby.open";
const PIN_COMMAND = "keep-nearby.pin-message";
const DRAWER_ID = "keep_nearby_drawer";
const STATE_KEY = "state";
const SCHEMA_VERSION = 1;
let drawerOpenPromise = null;

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  const disposables = [];

  if (typeof msty.ui?.registerToolboxItem === "function") {
    disposables.push(
      msty.ui.registerToolboxItem({
        id: "keep_nearby",
        title: "Keep Nearby",
        label: "Keep",
        tooltip: "Open Keep Nearby",
        icon: "static/icon.svg",
        entry: "extension.js",
        command: OPEN_COMMAND,
        priority: 40,
      }),
    );
  }

  if (typeof msty.ui?.registerTitleBarItem === "function") {
    disposables.push(
      msty.ui.registerTitleBarItem({
        id: "keep_nearby_title_bar",
        title: "Keep Nearby",
        label: "Keep",
        tooltip: "Open or close Keep Nearby",
        icon: "static/icon.svg",
        entry: "extension.js",
        command: OPEN_COMMAND,
        priority: 45,
      }),
    );
  }

  if (typeof msty.ui?.registerMessageInlineItem === "function") {
    disposables.push(
      msty.ui.registerMessageInlineItem({
        id: "keep_nearby_pin",
        title: "Keep Nearby",
        label: "Keep nearby",
        tooltip: "Save this reply",
        icon: "static/icon.svg",
        placement: "message.after",
        when: "message.role == assistant",
        entry: "extension.js",
        command: PIN_COMMAND,
        priority: 10,
      }),
    );
  }

  if (typeof msty.commands?.register === "function") {
    disposables.push(
      msty.commands.register({
        id: "keep_nearby_open",
        name: "keep-nearby",
        label: "Open Keep Nearby",
        description: "Open pins and notes for this chat.",
        command: OPEN_COMMAND,
      }),
    );
  }

  return {
    async run(command, activationContext = {}) {
      if (command === PIN_COMMAND) {
        await pinMessage(msty, activationContext);
        return openDrawer(msty);
      }
      if (command === OPEN_COMMAND) {
        return openDrawer(msty, { toggle: true });
      }
      return undefined;
    },
    dispose() {
      disposeAll(disposables);
    },
  };
}

async function pinMessage(msty, activationContext) {
  const messageId = text(activationContext.messageId, "");
  if (!messageId) {
    await notify(msty, "Choose an assistant reply first.", "warning");
    return null;
  }

  const message = await safe(() => msty.messages.get(messageId), null);
  if (!message || message.role !== "assistant") {
    await notify(msty, "Only assistant replies can be kept nearby.", "warning");
    return null;
  }

  const context = await safe(() => msty.context.getCurrent(), {});
  const selection = await safe(() => msty.context.getCurrentSelection(), null);
  const chatId = text(message.chatId, text(context.activeConversationId, text(context.conversation?.id, "")));
  const selectedForMessage =
    selection &&
    selection.source === "message" &&
    selection.messageId === messageId &&
    text(selection.text, "");
  const savedText = selectedForMessage ? selection.text.trim() : message.content;
  const now = new Date().toISOString();
  const state = await loadState(msty, chatId);
  const sourceRange =
    selectedForMessage &&
    Number.isFinite(selection.selectionStart) &&
    Number.isFinite(selection.selectionEnd)
      ? {
          startOffset: Math.min(selection.selectionStart, selection.selectionEnd),
          endOffset: Math.max(selection.selectionStart, selection.selectionEnd),
        }
      : undefined;
  const duplicate = state.pins.find(
    (pin) =>
      pin.sourceMessageId === messageId &&
      pin.snippet === snippet(savedText, 420) &&
      sameRange(pin.sourceRange, sourceRange),
  );

  if (duplicate) {
    duplicate.status = "active";
    duplicate.updatedAt = now;
  } else {
    state.pins.unshift(compactObject({
      id: `pin_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      chatId,
      sourceMessageId: messageId,
      sourceRange,
      title: titleFromText(savedText),
      snippet: snippet(savedText, 420),
      fullText: savedText.length > 420 ? savedText : undefined,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }));
  }

  state.updatedAt = now;
  await saveState(msty, state);
  await notify(msty, selectedForMessage ? "Selection kept nearby." : "Reply kept nearby.", "success");
  return state;
}

async function openDrawer(msty, options = {}) {
  if (options.toggle === true && drawerOpenPromise) {
    if (typeof msty.ui?.closeSurface === "function") {
      const result = await msty.ui.closeSurface({
        kind: "drawer",
        id: DRAWER_ID,
        result: { dismissed: true },
      });
      if (!result || result.closed !== false) return result;

      // A closed:false result means the host no longer has this drawer, so clear stale state and open it again.
      drawerOpenPromise = null;
    } else {
      return drawerOpenPromise;
    }
  }

  const context = await safe(() => msty.context.getCurrent(), {});
  const chatId = text(context.activeConversationId, text(context.conversation?.id, ""));
  const state = await loadState(msty, chatId);
  const request = {
    id: DRAWER_ID,
    kind: "drawer",
    context: {
      chatId,
      state,
      openedAt: new Date().toISOString(),
    },
  };

  const openPromise =
    typeof msty.ui?.openContribution === "function"
      ? msty.ui.openContribution(request)
      : msty.ui?.openDrawer?.({
          id: request.id,
          title: "Keep Nearby",
          entry: "view.js",
          width: "wide",
          context: request.context,
        });

  const trackedPromise = Promise.resolve(openPromise).finally(() => {
    if (drawerOpenPromise === trackedPromise) drawerOpenPromise = null;
  });
  drawerOpenPromise = trackedPromise;
  return trackedPromise;
}

async function loadState(msty, chatId) {
  const defaults = defaultState(chatId);
  try {
    if (typeof msty.storage?.chat?.migrate === "function") {
      const result = await msty.storage.chat.migrate({
        key: STATE_KEY,
        version: SCHEMA_VERSION,
        defaults,
        migrate(value) {
          return normalizeState(value, chatId);
        },
      });
      return normalizeState(result?.value, chatId);
    }
    return normalizeState(await msty.storage.chat.get(STATE_KEY), chatId);
  } catch {
    return defaults;
  }
}

async function saveState(msty, state) {
  await msty.storage.chat.set(STATE_KEY, normalizeState(state, state.chatId));
}

function defaultState(chatId) {
  return {
    schemaVersion: SCHEMA_VERSION,
    chatId,
    pins: [],
    notes: [],
    drawerPromptDraft: "",
    updatedAt: new Date().toISOString(),
  };
}

function normalizeState(value, chatId) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    chatId: text(source.chatId, chatId),
    pins: Array.isArray(source.pins) ? source.pins.map(normalizePin).filter(Boolean) : [],
    notes: Array.isArray(source.notes) ? source.notes.map(normalizeNote).filter(Boolean) : [],
    drawerPromptDraft: text(source.drawerPromptDraft, ""),
    updatedAt: text(source.updatedAt, new Date().toISOString()),
  };
}

function normalizePin(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = text(value.id, "");
  const sourceMessageId = text(value.sourceMessageId, "");
  const snippetText = text(value.snippet, text(value.fullText, ""));
  if (!id || !sourceMessageId || !snippetText) return null;
  return compactObject({
    id,
    chatId: text(value.chatId, ""),
    sourceMessageId,
    sourceRange: normalizeRange(value.sourceRange),
    title: text(value.title, titleFromText(snippetText)),
    snippet: snippet(snippetText, 420),
    fullText: text(value.fullText, undefined),
    status: value.status === "reviewed" ? "reviewed" : "active",
    createdAt: text(value.createdAt, new Date().toISOString()),
    updatedAt: text(value.updatedAt, text(value.createdAt, new Date().toISOString())),
  });
}

function normalizeNote(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = text(value.id, "");
  const body = text(value.body, "");
  if (!id || !body) return null;
  return {
    id,
    chatId: text(value.chatId, ""),
    body,
    status: value.status === "reviewed" ? "reviewed" : "active",
    createdAt: text(value.createdAt, new Date().toISOString()),
    updatedAt: text(value.updatedAt, text(value.createdAt, new Date().toISOString())),
  };
}

function normalizeRange(value) {
  if (!value || typeof value !== "object") return undefined;
  const start = Number(value.startOffset);
  const end = Number(value.endOffset);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return {
    startOffset: Math.max(0, Math.trunc(Math.min(start, end))),
    endOffset: Math.max(0, Math.trunc(Math.max(start, end))),
  };
}

function sameRange(left, right) {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return left.startOffset === right.startOffset && left.endOffset === right.endOffset;
}

async function notify(msty, title, tone = "default") {
  try {
    await msty.ui?.showToast?.({ title, tone });
  } catch {
    try {
      await msty.notifications?.show?.({ title, tone });
    } catch {
      /* optional confirmation */
    }
  }
}

function titleFromText(value) {
  return snippet(value, 72).replace(/[.!?]+$/, "") || "Saved reply";
}

function snippet(value, limit) {
  const compact = String(value ?? "").replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

async function safe(callback, fallback) {
  try {
    return await callback();
  } catch {
    return fallback;
  }
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
