// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

import "./view.css";

const STORAGE_KEY = "side_chat_history";
const SCHEMA_VERSION = 1;
const MAX_MESSAGES = 80;
const COMPOSER_SEND_SHORTCUT_ID = "composer.send";
const DEFAULT_SEND_SHORTCUT = Object.freeze({
  id: COMPOSER_SEND_SHORTCUT_ID,
  key: "Enter",
  modifiers: [],
  label: "Enter",
});

/** @param {Msty.SurfaceMountContext} params */
export async function mount({ root, msty, context }) {
  const initialChatId = text(context?.chatId, "");
  const liveContext = await safe(() => msty.context.getCurrent(), {});
  let chatId = initialChatId || currentChatId(liveContext);
  let chatTitle = text(context?.chatTitle, text(liveContext?.conversation?.title, ""));
  let messages = [];
  let draft = "";
  let notice = "";
  let busy = false;
  let activeAssistantId = "";
  let activeRunToken = 0;
  let controller = null;
  let copiedMessageId = "";
  let copyResetTimer = 0;
  let lastHeaderActionState = "";
  let sendShortcut = DEFAULT_SEND_SHORTCUT;

  root.innerHTML = shell();
  const listEl = root.querySelector("[data-messages]");
  const emptyEl = root.querySelector("[data-empty]");
  const formEl = root.querySelector("[data-form]");
  const inputEl = root.querySelector("[data-input]");
  const askButton = root.querySelector("[data-ask]");
  const stopButton = root.querySelector("[data-stop]");
  const noticeEl = root.querySelector("[data-notice]");

  if (!chatId) {
    notice = "Open a chat before using Side Chat.";
  } else {
    const state = await loadState(msty, chatId);
    messages = state.messages;
    if (mergeImportedReply(context?.importReply)) {
      await saveState(msty, chatId, messages);
    }
  }
  sendShortcut = await loadSendShortcut(msty);

  render();
  focusInputSoon();

  inputEl?.addEventListener("input", () => {
    draft = String(inputEl.value ?? "");
    renderControls();
  });

  inputEl?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    if (!matchesKeyboardShortcut(event, sendShortcut)) return;
    event.preventDefault();
    void ask();
  });

  formEl?.addEventListener("submit", (event) => {
    event.preventDefault();
    void ask();
  });

  stopButton?.addEventListener("click", () => {
    if (!busy) return;
    void controller?.cancel?.();
  });

  window.addEventListener("keydown", handleToggleShortcut, true);

  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const copyId = target?.closest("[data-copy]")?.getAttribute("data-copy");
    if (copyId) {
      void copyMessage(copyId);
      return;
    }
    const prompt = target?.closest("[data-suggestion]")?.getAttribute("data-suggestion");
    if (!prompt || busy) return;
    draft = prompt;
    inputEl.value = prompt;
    inputEl.focus();
    renderControls();
  });

  const disposeHeaderAction =
    typeof msty.surface?.on === "function"
      ? msty.surface.on("surface.headerAction", (event) => {
          if (event?.data?.id === "clear") {
            void clearSideChat();
          }
        })
      : undefined;
  const disposeSurfaceUpdate =
    typeof msty.surface?.on === "function"
      ? msty.surface.on("surface.updated", (event) => {
          const nextContext =
            event?.data?.context ?? event?.surface?.context ?? msty.surface.context;
          void applySurfaceContext(nextContext);
        })
      : undefined;
  const disposeSurfaceFocus =
    typeof msty.surface?.on === "function"
      ? msty.surface.on("surface.focus", () => {
          void refreshSendShortcut();
          focusInputSoon();
        })
      : undefined;
  const disposeSurfaceHostReady =
    typeof msty.surface?.on === "function"
      ? msty.surface.on("surface.hostReady", () => {
          focusInputSoon();
        })
      : undefined;

  window.addEventListener("pagehide", () => {
    window.removeEventListener("keydown", handleToggleShortcut, true);
    void controller?.cancel?.();
    if (copyResetTimer) window.clearTimeout(copyResetTimer);
    disposeHeaderAction?.();
    disposeSurfaceUpdate?.();
    disposeSurfaceFocus?.();
    disposeSurfaceHostReady?.();
  }, { once: true });

  async function ask() {
    const question = draft.trim();
    if (!question || busy) return;
    if (!chatId) {
      notice = "Open a chat before using Side Chat.";
      render();
      return;
    }
    if (typeof msty.models?.streamSideReply !== "function") {
      notice = "Update Msty Claw to use Side Chat.";
      render();
      return;
    }
    const runChatId = chatId;
    const runToken = ++activeRunToken;

    const history = sideReplyHistory(messages);
    const userMessage = {
      id: newId("user"),
      role: "user",
      content: question,
      createdAt: new Date().toISOString(),
    };
    const assistantMessage = {
      id: newId("assistant"),
      role: "assistant",
      content: "",
      reasoning: "",
      error: null,
      isStreaming: true,
      createdAt: userMessage.createdAt,
    };
    messages = trimMessages([...messages, userMessage, assistantMessage]);
    draft = "";
    inputEl.value = "";
    notice = "";
    busy = true;
    activeAssistantId = assistantMessage.id;
    await saveState(msty, runChatId, messages);
    render();

    try {
      const runController = msty.models.streamSideReply(
        {
          question,
          conversationId: runChatId,
          history,
          metadata: { source: "side_chat" },
        },
        (event) => {
          if (!isActiveRun(runToken, runChatId)) return;
          handleStreamEvent(event, assistantMessage.id);
          renderMessages();
          renderControls();
        },
      );
      controller = runController;
      const result = await runController.done;
      if (!isActiveRun(runToken, runChatId)) return;
      patchAssistant(assistantMessage.id, {
        content: text(result?.text, messageById(assistantMessage.id)?.content ?? ""),
        reasoning: text(result?.metadata?.reasoning, messageById(assistantMessage.id)?.reasoning ?? ""),
        isStreaming: false,
        error: null,
      });
    } catch (error) {
      if (!isActiveRun(runToken, runChatId)) return;
      patchAssistant(assistantMessage.id, {
        isStreaming: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (!isActiveRun(runToken, runChatId)) return;
      busy = false;
      activeAssistantId = "";
      controller = null;
      messages = trimMessages(messages);
      await saveState(msty, runChatId, messages);
      render();
      focusInputSoon();
    }
  }

  function isActiveRun(runToken, runChatId) {
    return activeRunToken === runToken && chatId === runChatId;
  }

  function handleStreamEvent(event, assistantId) {
    if (!event || typeof event !== "object") return;
    if (event.type === "text_delta") {
      patchAssistant(assistantId, {
        content: typeof event.text === "string" ? event.text : appendText(assistantId, event.delta),
      });
      return;
    }
    if (event.type === "reasoning_delta") {
      patchAssistant(assistantId, {
        reasoning: appendReasoning(assistantId, event.delta),
      });
      return;
    }
    if (event.type === "cancelled") {
      patchAssistant(assistantId, {
        isStreaming: false,
        error: event.message || "Side Chat stopped.",
      });
      return;
    }
    if (event.type === "error") {
      patchAssistant(assistantId, {
        error: event.message || "Side Chat failed.",
      });
    }
  }

  function patchAssistant(id, patch) {
    messages = messages.map((message) =>
      message.id === id ? { ...message, ...patch } : message,
    );
  }

  function appendText(id, delta) {
    const message = messageById(id);
    return `${message?.content ?? ""}${typeof delta === "string" ? delta : ""}`;
  }

  function appendReasoning(id, delta) {
    const message = messageById(id);
    return `${message?.reasoning ?? ""}${typeof delta === "string" ? delta : ""}`;
  }

  function messageById(id) {
    return messages.find((message) => message.id === id);
  }

  function mergeImportedReply(value) {
    const imported = normalizeImportedReply(value);
    if (!imported) return false;
    const duplicate = messages.some((message, index) => {
      const next = messages[index + 1];
      return (
        message.role === "user" &&
        message.content.trim() === imported.prompt &&
        next?.role === "assistant" &&
        next.content.trim() === imported.content &&
        (next.error ?? null) === (imported.error ?? null)
      );
    });
    if (duplicate) return false;

    const createdAt = new Date().toISOString();
    const next = [];
    if (imported.prompt) {
      next.push({
        id: newId("user"),
        role: "user",
        content: imported.prompt,
        createdAt,
      });
    }
    if (imported.content || imported.error || imported.reasoning) {
      next.push({
        id: newId("assistant"),
        role: "assistant",
        content: imported.content,
        reasoning: imported.reasoning,
        error: imported.error ?? null,
        isStreaming: false,
        createdAt,
      });
    }
    if (next.length === 0) return false;
    messages = trimMessages([...messages, ...next]);
    return true;
  }

  function render() {
    renderMessages();
    renderControls();
  }

  function renderMessages(options = {}) {
    if (!listEl || !emptyEl) return;
    const stickToBottom = options.stickToBottom !== false;
    const wasNearBottom =
      listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 48;
    emptyEl.hidden = messages.length > 0;
    listEl.hidden = messages.length === 0;
    const existing = new Map(
      Array.from(listEl.querySelectorAll("[data-message-id]")).map((element) => [
        element.getAttribute("data-message-id"),
        element,
      ]),
    );
    const seen = new Set();
    messages.forEach((message, index) => {
      let element = existing.get(message.id);
      if (!element || element.getAttribute("data-role") !== message.role) {
        const template = document.createElement("template");
        template.innerHTML = renderMessageShell(message);
        element = template.content.firstElementChild;
      }
      if (!(element instanceof HTMLElement)) return;
      updateMessageElement(element, message, copiedMessageId);
      seen.add(message.id);
      const current = listEl.children[index] ?? null;
      if (current !== element) {
        listEl.insertBefore(element, current);
      }
    });
    for (const [messageId, element] of existing) {
      if (!messageId || seen.has(messageId)) continue;
      element.remove();
    }
    if (stickToBottom || wasNearBottom) {
      listEl.scrollTop = listEl.scrollHeight;
    }
  }

  function renderControls() {
    if (noticeEl) {
      noticeEl.textContent = notice;
      noticeEl.hidden = !notice;
    }
    if (askButton) askButton.disabled = busy || !draft.trim() || !chatId;
    if (stopButton) stopButton.hidden = !busy;
    if (inputEl) {
      inputEl.disabled = busy || !chatId;
      inputEl.placeholder = chatId
        ? "Ask a side question"
        : "Open a chat to use Side Chat";
    }
    syncHeaderAction();
  }

  async function copyMessage(messageId) {
    const message = messageById(messageId);
    const content = text(message?.content, "");
    if (!content) return;
    try {
      await writeClipboard(msty, content);
      copiedMessageId = messageId;
      notice = "";
      renderMessages({ stickToBottom: false });
      renderControls();
      if (copyResetTimer) window.clearTimeout(copyResetTimer);
      copyResetTimer = window.setTimeout(() => {
        if (copiedMessageId !== messageId) return;
        copiedMessageId = "";
        renderMessages({ stickToBottom: false });
      }, 1600);
    } catch {
      notice = "Couldn’t copy that message.";
      renderControls();
    }
  }

  async function clearSideChat() {
    if (busy || !chatId || messages.length === 0) return;
    messages = [];
    notice = "";
    await saveState(msty, chatId, messages);
    render();
  }

  async function applySurfaceContext(nextContext) {
    const nextChatId = currentChatId(nextContext);
    const nextChatTitle = text(
      nextContext?.chatTitle,
      text(nextContext?.conversation?.title, ""),
    );
    if (nextChatId === chatId) {
      chatTitle = nextChatTitle;
      return;
    }

    const previousChatId = chatId;
    const previousController = controller;
    const previousAssistantId = activeAssistantId;
    activeRunToken += 1;
    if (busy && previousAssistantId) {
      patchAssistant(previousAssistantId, {
        isStreaming: false,
        error: "Side Chat stopped.",
      });
      await saveState(msty, previousChatId, messages);
    }
    void previousController?.cancel?.();

    chatId = nextChatId;
    chatTitle = nextChatTitle;
    messages = [];
    draft = "";
    notice = chatId ? "" : "Open a chat before using Side Chat.";
    busy = false;
    activeAssistantId = "";
    controller = null;
    copiedMessageId = "";
    if (copyResetTimer) {
      window.clearTimeout(copyResetTimer);
      copyResetTimer = 0;
    }
    if (inputEl) inputEl.value = "";

    if (chatId) {
      messages = (await loadState(msty, chatId)).messages;
    }
    render();
    focusInputSoon();
  }

  async function refreshSendShortcut() {
    sendShortcut = await loadSendShortcut(msty);
  }

  function syncHeaderAction() {
    if (typeof msty.ui?.updateSurface !== "function") return;
    const disabled = busy || messages.length === 0 || !chatId;
    const requestId = text(msty.surface?.getSnapshot?.()?.requestId, "side_chat");
    const nextState = `${requestId}:${disabled ? "disabled" : "enabled"}`;
    if (lastHeaderActionState === nextState) return;
    lastHeaderActionState = nextState;
    void safe(
      () =>
        msty.ui.updateSurface({
          kind: "popup",
          id: requestId,
          headerActions: [
            {
              id: "clear",
              label: "Clear Side Chat",
              icon: "trash",
              variant: "danger",
              disabled,
            },
          ],
        }),
      undefined,
    );
  }

  function handleToggleShortcut(event) {
    if (event.defaultPrevented || event.repeat || event.isComposing) return;
    if (!matchesSideChatToggleShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    closeSideChat();
  }

  function closeSideChat() {
    if (typeof msty.surface?.close === "function") {
      msty.surface.close({ dismissed: true });
      return;
    }
    const requestId = text(msty.surface?.getSnapshot?.()?.requestId, "side_chat");
    void msty.ui?.closeSurface?.({
      kind: "popup",
      id: requestId,
      result: { dismissed: true },
    });
  }

  function focusInputSoon() {
    if (!inputEl || busy || !chatId) return;
    const focus = () => {
      if (busy || !chatId || inputEl.disabled) return;
      inputEl.focus({ preventScroll: true });
    };
    focus();
    window.requestAnimationFrame(focus);
    window.setTimeout(focus, 50);
  }
}

function shell() {
  return `
    <main class="sc">
      <section class="sc-empty" data-empty>
        <div class="sc-empty__stage" aria-hidden="true">
          <div class="sc-empty__line sc-empty__line--main"></div>
          <div class="sc-empty__line sc-empty__line--side"></div>
          <div class="sc-empty__line sc-empty__line--reply"></div>
          <div class="sc-empty__mark">${iconSparkles()}</div>
        </div>
        <div class="sc-empty__copy">
          <h2>Ask beside this chat</h2>
        </div>
        <div class="sc-suggestions">
          <button type="button" data-suggestion="What did we decide?">What did we decide?</button>
          <button type="button" data-suggestion="Summarize the last answer.">Summarize the last answer.</button>
          <button type="button" data-suggestion="What should I check next?">What should I check next?</button>
        </div>
      </section>

      <section class="sc-messages" data-messages aria-live="polite"></section>
      <p class="sc-notice" data-notice hidden></p>

      <form class="sc-form" data-form>
        <textarea data-input rows="2"></textarea>
        <div class="sc-actions">
          <button class="sc-secondary" type="button" data-stop hidden>Stop</button>
          <button class="sc-primary" type="submit" data-ask>Ask</button>
        </div>
      </form>
    </main>
  `;
}

function renderMessageShell(message) {
  return `
    <article class="sc-message sc-message--${message.role}" data-message-id="${escapeAttribute(message.id)}" data-role="${message.role}">
      <div class="sc-message__bubble">
        <p class="sc-message__body" data-message-body></p>
      </div>
      <div class="sc-message__actions">
        <button class="sc-copy-button" type="button" data-copy="${escapeAttribute(message.id)}" data-copied="false" aria-label="Copy" data-tooltip="Copy">
          ${iconCopy()}
        </button>
      </div>
    </article>
  `;
}

function updateMessageElement(element, message, copiedMessageId) {
  const copied = copiedMessageId === message.id;
  element.className = `sc-message sc-message--${message.role}${copied ? " sc-message--copied" : ""}`;
  element.setAttribute("data-message-id", message.id);
  element.setAttribute("data-role", message.role);

  const body = element.querySelector("[data-message-body]");
  if (body) {
    const emptyReply = !message.content && !message.isStreaming;
    const thinking = message.isStreaming && !message.content;
    body.textContent = thinking
      ? "Thinking"
      : message.content || (emptyReply ? "No reply available." : "");
    body.classList.toggle("sc-message__thinking", thinking);
  }

  const bubble = element.querySelector(".sc-message__bubble");
  if (bubble) {
    setReasoningElement(bubble, message.reasoning);
    setErrorElement(bubble, message.error);
  }

  const copyButton = element.querySelector("[data-copy]");
  if (copyButton) {
    copyButton.setAttribute("data-copy", message.id);
    copyButton.setAttribute("data-copied", copied ? "true" : "false");
    copyButton.setAttribute("aria-label", copied ? "Copied" : "Copy");
    copyButton.setAttribute("data-tooltip", copied ? "Copied" : "Copy");
    copyButton.innerHTML = copied ? iconCheck() : iconCopy();
  }
}

function setReasoningElement(bubble, reasoning) {
  let element = bubble.querySelector("[data-reasoning]");
  if (!reasoning) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement("details");
    element.className = "sc-reasoning";
    element.setAttribute("data-reasoning", "");
    const summary = document.createElement("summary");
    summary.textContent = "Reasoning";
    const text = document.createElement("p");
    element.append(summary, text);
    bubble.append(element);
  }
  const text = element.querySelector("p");
  if (text) text.textContent = reasoning;
}

function setErrorElement(bubble, error) {
  let element = bubble.querySelector("[data-error]");
  if (!error) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement("p");
    element.className = "sc-error";
    element.setAttribute("data-error", "");
    bubble.append(element);
  }
  element.textContent = error;
}

async function loadState(msty, chatId) {
  const defaults = { schemaVersion: SCHEMA_VERSION, chatId, messages: [] };
  try {
    if (typeof msty.storage?.chat?.migrate === "function") {
      const result = await msty.storage.chat.migrate({
        key: STORAGE_KEY,
        version: SCHEMA_VERSION,
        defaults,
        migrate(value) {
          return normalizeState(value, chatId);
        },
      });
      return normalizeState(result?.value, chatId);
    }
    return normalizeState(await msty.storage.chat.get(STORAGE_KEY), chatId);
  } catch {
    return defaults;
  }
}

async function saveState(msty, chatId, messages) {
  if (!chatId) return;
  await safe(
    () =>
      msty.storage.chat.set(STORAGE_KEY, {
        schemaVersion: SCHEMA_VERSION,
        chatId,
        messages: trimMessages(messages).map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          reasoning: message.reasoning || undefined,
          error: message.error ?? null,
          createdAt: message.createdAt,
        })),
      }),
    undefined,
  );
}

function normalizeState(value, chatId) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    schemaVersion: SCHEMA_VERSION,
    chatId,
    messages: Array.isArray(source.messages)
      ? trimMessages(source.messages.map(normalizeMessage).filter(Boolean))
      : [],
  };
}

function normalizeMessage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const role = value.role === "assistant" ? "assistant" : value.role === "user" ? "user" : "";
  const content = text(value.content, "");
  if (!role || (!content && !value.error)) return null;
  return {
    id: text(value.id, newId(role)),
    role,
    content,
    reasoning: text(value.reasoning, ""),
    error: typeof value.error === "string" ? value.error : null,
    isStreaming: false,
    createdAt: text(value.createdAt, new Date().toISOString()),
  };
}

function sideReplyHistory(messages) {
  return messages
    .filter((message) => !message.isStreaming && !message.error && message.content.trim())
    .map((message) => ({ role: message.role, content: message.content, createdAt: message.createdAt }));
}

function normalizeImportedReply(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prompt = text(value.prompt, "");
  const content = text(value.content, "");
  const reasoning = text(value.reasoning, "");
  const error = typeof value.error === "string" ? value.error : value.error === null ? null : undefined;
  if (!prompt && !content && !reasoning && !error) return null;
  return { prompt, content, reasoning, error };
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

function trimMessages(messages) {
  return messages.slice(-MAX_MESSAGES);
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

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

async function writeClipboard(msty, value) {
  if (typeof msty.clipboard?.writeText === "function") {
    await msty.clipboard.writeText(value);
    return;
  }
  if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
    await navigator.clipboard.writeText(value);
    return;
  }
  throw new Error("Clipboard unavailable.");
}

async function loadSendShortcut(msty) {
  const shortcut = await safe(
    () => msty.platform?.getKeyboardShortcut?.(COMPOSER_SEND_SHORTCUT_ID),
    null,
  );
  return normalizeKeyboardShortcut(shortcut) ?? DEFAULT_SEND_SHORTCUT;
}

function matchesSideChatToggleShortcut(event) {
  const semicolon = event.key === ";" || event.code === "Semicolon";
  return semicolon && (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}

function normalizeKeyboardShortcut(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.id !== COMPOSER_SEND_SHORTCUT_ID || value.key !== "Enter") {
    return null;
  }
  const modifiers = Array.isArray(value.modifiers)
    ? value.modifiers.filter((modifier) =>
        modifier === "mod" ||
        modifier === "ctrl" ||
        modifier === "alt" ||
        modifier === "shift",
      )
    : [];
  return {
    id: COMPOSER_SEND_SHORTCUT_ID,
    key: "Enter",
    modifiers,
    label: text(value.label, DEFAULT_SEND_SHORTCUT.label),
  };
}

function matchesKeyboardShortcut(event, shortcut) {
  if (event.key !== shortcut.key) return false;
  const modifiers = new Set(shortcut.modifiers);
  if (modifiers.has("mod")) {
    return platformModKey(event) && !event.altKey;
  }
  if (modifiers.has("ctrl")) {
    return event.ctrlKey && !event.metaKey && !event.altKey;
  }
  if (modifiers.has("alt")) {
    return event.altKey && !event.metaKey && !event.ctrlKey;
  }
  if (modifiers.has("shift")) {
    return event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
  }
  return !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

function platformModKey(event) {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  const mac = platform.toUpperCase().includes("MAC");
  return mac ? event.metaKey : event.ctrlKey;
}

function iconSparkles() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.6 5.1L19 9l-5.4 1.9L12 16l-1.6-5.1L5 9l5.4-1.9L12 2z"/><path d="M19 14l.8 2.7L22 18l-2.2 1.3L19 22l-.8-2.7L16 18l2.2-1.3L19 14z"/><path d="M5 13l.7 2.1L8 16l-2.3.9L5 19l-.7-2.1L2 16l2.3-.9L5 13z"/></svg>';
}

function iconCopy() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3h-1v-2h1a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v1H8V7z"/><path d="M3 11a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7zm3-1a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1H6z"/></svg>';
}

function iconCheck() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.2 16.6 4.8 12.2l1.4-1.4 3 3 8.6-8.6 1.4 1.4-10 10z"/></svg>';
}
