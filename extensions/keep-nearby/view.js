// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

import "./view.css";

const STATE_KEY = "state";
const SCHEMA_VERSION = 1;
const DRAWER_ID = "keep_nearby_drawer";
const DRAWER_KIND = "drawer";
const MODEL_ASSIGNMENT = "keep_nearby_assistant";
const EVENT_TYPES = ["context.changed", "messages.changed"];
const GENERIC_WORDS = new Set([
  "about",
  "active",
  "items",
  "nearby",
  "notes",
  "review",
  "reviewed",
  "these",
  "this",
  "with",
]);
const MAX_TOASTS = 3;
const ANIM_STEP_MS = 22;

/** @param {Msty.SurfaceMountContext} params */
export async function mount({ root, msty, context }) {
  // -- State ---------------------------------------------------------------
  const initialContext = await safe(() => msty.context.getCurrent(), {});
  const initialChat = await safe(() => msty.chats.getCurrent(), null);
  const chatId = text(context?.chatId, text(initialContext.activeConversationId, text(initialChat?.id, "")));

  const state = {
    chatId,
    chat: initialChat,
    keep: normalizeState(context?.state, chatId),
    noteDraft: "",
    addingNote: false,
    editingNoteId: null,
    editingBody: "",
    reviewedOpen: false,
    query: "",
    expandedIds: [],
    prompt: "",
    result: null,
    toasts: [],
    busy: false,
    loading: true,
    stream: null,
    modelStatus: null,
    focusField: null,
    scrollBottom: false,
    animKey: null,
  };

  state.keep = await loadState(msty, state.chatId, state.keep);
  state.prompt = state.keep.drawerPromptDraft || "";
  state.loading = false;

  // -- DOM roots -----------------------------------------------------------
  root.innerHTML = `<div id="keep-app"></div><div id="keep-toast" class="keep-toast-stack" aria-live="polite"></div>`;
  const appEl = root.querySelector("#keep-app");
  const toastEl = root.querySelector("#keep-toast");

  // -- Delegated listeners -------------------------------------------------
  root.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-action]");
    if (!button || button.disabled) return;
    void handleAction(button.getAttribute("data-action"), button.getAttribute("data-id"));
  });

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement)) return;
    const field = target.dataset.field;
    if (field === "note") {
      state.noteDraft = target.value;
      autoGrow(target);
    } else if (field === "edit-note") {
      state.editingBody = target.value;
      autoGrow(target);
    } else if (field === "prompt") {
      state.prompt = target.value;
      state.keep.drawerPromptDraft = target.value;
      scheduleSaveDraft();
    } else if (field === "search") {
      state.query = target.value;
      render();
      refocusSearch();
    }
  });

  root.addEventListener("keydown", handleKeydown);

  root.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.dataset.form === "note") await addNote();
    if (form.dataset.form === "prompt") await runPrompt();
  });

  function handleKeydown(event) {
    const target = event.target;
    const field = target?.dataset?.field;

    // Esc: priority chain — search → note composer → note edit → result.
    if (event.key === "Escape") {
      if (field === "search" || state.query) {
        event.preventDefault();
        state.query = "";
        render();
        refocusSearch();
        return;
      }
      if (state.addingNote) {
        event.preventDefault();
        state.addingNote = false;
        state.noteDraft = "";
        render();
        return;
      }
      if (state.editingNoteId) {
        event.preventDefault();
        state.editingNoteId = null;
        state.editingBody = "";
        render();
        return;
      }
      if (state.result) {
        event.preventDefault();
        state.result = null;
        render();
        return;
      }
    }

    // ⌘/Ctrl+Enter submits the Ask prompt from anywhere.
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      const promptEl = appEl.querySelector('[data-field="prompt"]');
      if (promptEl) {
        event.preventDefault();
        void runPrompt();
      }
    }
  }

  // -- Draft persistence ---------------------------------------------------
  let draftTimer = null;
  function scheduleSaveDraft() {
    if (draftTimer) window.clearTimeout(draftTimer);
    draftTimer = window.setTimeout(() => {
      void msty.storage.chat
        .set(STATE_KEY, normalizeState({ ...state.keep, drawerPromptDraft: state.prompt }, state.chatId))
        .catch(() => {});
    }, 500);
  }

  // -- Action dispatch -----------------------------------------------------
  const ACTIONS = {
    refresh,
    source: (id) => openSource(id),
    review: (id) => setItemReviewed(id, true),
    restore: (id) => setItemReviewed(id, false),
    remove: (id) => removeItem(id),
    "copy-item": (id) => copyItem(id),
    undo: () => restoreUndo(),
    "start-note": () => {
      state.addingNote = true;
      state.focusField = "note";
      render();
    },
    "cancel-note": () => {
      state.addingNote = false;
      state.noteDraft = "";
      render();
    },
    "edit-note": (id) => startEditNote(id),
    "cancel-edit": () => {
      state.editingNoteId = null;
      state.editingBody = "";
      render();
    },
    "save-note": (id) => saveEditedNote(id),
    "toggle-reviewed": () => {
      state.reviewedOpen = !state.reviewedOpen;
      render();
    },
    "toggle-expand": (id) => toggleExpand(id),
    "clear-search": () => {
      state.query = "";
      render();
      refocusSearch();
    },
    "cancel-run": () => cancelRun(),
    "copy-result": () => copyResult(),
    "note-result": () => addResultToNotes(),
    "send-result": () => sendResultToChat(),
    "new-chat-result": () => createChatFromResult(),
    "regenerate-result": () => regenerate(),
    "discard-result": () => {
      state.result = null;
      render();
    },
    "apply-intent": (id) => applyIntent(id),
    "dismiss-toast": (id) => dismissToast(id),
    "open-model-settings": () => openModelSettings(),
  };

  async function handleAction(action, id) {
    const handler = ACTIONS[action];
    if (handler) await handler(id);
  }

  // -- Actions: items ------------------------------------------------------
  async function refresh() {
    const [nextContext, nextChat] = await Promise.all([
      safe(() => msty.context.getCurrent(), {}),
      safe(() => msty.chats.getCurrent(), null),
    ]);
    const nextChatId = text(nextContext.activeConversationId, text(nextChat?.id, state.chatId));
    if (nextChatId !== state.chatId) {
      state.chatId = nextChatId;
      state.chat = nextChat;
      state.keep = await loadState(msty, nextChatId);
      state.prompt = state.keep.drawerPromptDraft || "";
      state.noteDraft = "";
      state.addingNote = false;
      state.result = null;
      state.query = "";
      state.expandedIds = [];
      state.undo = null;
    } else {
      state.chat = nextChat || state.chat;
      state.keep = await loadState(msty, nextChatId, state.keep);
    }
    await checkModelStatus();
    render();
    notify("Up to date");
  }

  async function addNote(body = state.noteDraft) {
    const value = text(body, "");
    if (!value) {
      notify("Write a note first.", { tone: "warning" });
      return;
    }
    const now = new Date().toISOString();
    state.keep.notes.unshift({
      id: id("note"),
      chatId: state.chatId,
      body: value,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    state.noteDraft = "";
    state.addingNote = false;
    state.animKey = null; // force enter animation on new item
    await persist("Note added");
  }

  function startEditNote(noteId) {
    const note = findItem(noteId, "note");
    if (!note) return;
    state.editingNoteId = noteId;
    state.editingBody = note.body;
    state.focusField = "edit-note";
    render();
    autoGrowFocused();
  }

  async function saveEditedNote(noteId) {
    const note = findItem(noteId, "note");
    const body = text(state.editingBody, "");
    if (!note || !body) return;
    note.body = body;
    note.updatedAt = new Date().toISOString();
    state.editingNoteId = null;
    state.editingBody = "";
    await persist("Note saved");
  }

  async function setItemReviewed(itemId, reviewed) {
    const item = findItem(itemId);
    if (!item) return;
    item.status = reviewed ? "reviewed" : "active";
    item.updatedAt = new Date().toISOString();
    state.undo = {
      label: reviewed ? "Reviewed" : "Restored",
      item: clone(item),
      previousStatus: reviewed ? "active" : "reviewed",
    };
    await persist(reviewed ? "Marked reviewed" : "Moved back", { undo: true });
  }

  async function removeItem(itemId) {
    const removed = spliceItem(itemId);
    if (!removed) return;
    state.undo = { label: "Removed", removed };
    await persist("Removed", { undo: true });
  }

  function spliceItem(itemId) {
    const pinIndex = state.keep.pins.findIndex((item) => item.id === itemId);
    if (pinIndex >= 0) return { type: "pin", index: pinIndex, item: state.keep.pins.splice(pinIndex, 1)[0] };
    const noteIndex = state.keep.notes.findIndex((item) => item.id === itemId);
    if (noteIndex >= 0) return { type: "note", index: noteIndex, item: state.keep.notes.splice(noteIndex, 1)[0] };
    return null;
  }

  async function restoreUndo() {
    const undo = state.undo;
    if (!undo) return;
    if (undo.removed) {
      const target = undo.removed.type === "pin" ? state.keep.pins : state.keep.notes;
      target.splice(undo.removed.index, 0, undo.removed.item);
    } else if (undo.item) {
      const item = findItem(undo.item.id);
      if (item) item.status = undo.previousStatus;
    }
    state.undo = null;
    await persist("Change undone");
  }

  async function copyItem(itemId) {
    const item = findItem(itemId);
    if (!item) return;
    try {
      await msty.clipboard.writeText(itemText(item));
      notify("Copied to clipboard", { tone: "success" });
    } catch {
      notify("Copy isn't available here.", { tone: "warning" });
    }
  }

  function toggleExpand(itemId) {
    const set = new Set(state.expandedIds);
    if (set.has(itemId)) set.delete(itemId);
    else set.add(itemId);
    state.expandedIds = [...set];
    render();
  }

  async function openSource(itemId) {
    const pin = findItem(itemId, "pin");
    if (!pin) return;
    try {
      const result = await msty.messages.open({
        messageId: pin.sourceMessageId,
        chatId: pin.chatId || state.chatId,
        highlight: true,
      });
      notify(result?.opened === false ? "Couldn't find that message." : "Opened in chat", {
        tone: result?.opened === false ? "warning" : "info",
      });
    } catch (error) {
      notify(`Couldn't open it: ${errorMessage(error)}`, { tone: "error" });
    }
  }

  // -- Actions: Ask / result ----------------------------------------------
  async function checkModelStatus() {
    if (typeof msty.models?.getStatus !== "function") return;
    const next = await safe(() => msty.models.getStatus({ modelAssignment: MODEL_ASSIGNMENT }), null);
    const prevReady = state.modelStatus ? state.modelStatus.ready !== false : null;
    state.modelStatus = next;
    // Re-render when readiness flipped so the Ask placeholder + chip stay accurate.
    if (!next || prevReady !== (next.ready !== false)) render();
    else updateModelChip();
  }

  function openModelSettings() {
    void safe(
      () => msty.app?.openModelAssignments?.({ assignmentId: MODEL_ASSIGNMENT }),
      null,
    );
  }

  async function runPrompt(promptOverride) {
    const prompt = text(promptOverride ?? state.prompt, "");
    if (!prompt) {
      notify("Type a question first.", { tone: "warning" });
      return;
    }
    if (state.busy) return;
    state.busy = true;
    state.result = {
      state: "running",
      text: "",
      prompt,
      intents: [],
      tokens: null,
      startedAt: new Date().toISOString(),
    };
    state.scrollBottom = true;
    render();

    const contextPackage = await buildContextPackage(prompt);
    const maxTokens = await maxOutputTokens();
    const request = {
      prompt: promptForContext(contextPackage),
      modelAssignment: MODEL_ASSIGNMENT,
      temperature: 0.2,
      maxOutputTokens: maxTokens,
      metadata: { extension: "keep-nearby", chatId: state.chatId },
    };

    try {
      if (typeof msty.models?.stream === "function") {
        let streamedText = "";
        const stream = msty.models.stream(request, (event) => {
          if (event?.type === "text_delta") {
            streamedText = text(event.text, `${streamedText}${event.delta || ""}`);
            if (state.result) state.result.text = streamedText;
            updateResultText(streamedText);
          } else if (event?.type === "complete" && state.result && event.result?.usage) {
            state.result.tokens = event.result.usage;
          }
        });
        state.stream = stream;
        const result = await stream.done;
        if (state.result) {
          state.result.text = text(result?.text, streamedText || "No answer came back.");
          if (result?.usage) state.result.tokens = result.usage;
        }
      } else {
        const result = await msty.models.infer(request);
        if (state.result) {
          state.result.text = text(result?.text, "No answer came back.");
          if (result?.usage) state.result.tokens = result.usage;
        }
      }
      state.result.state = "complete";
      state.result.completedAt = new Date().toISOString();
      state.result.intents = deriveActionIntents(prompt, state.result.text);
    } catch (error) {
      state.result.state = isCancelled(error) ? "cancelled" : "failed";
      state.result.error = errorMessage(error);
      await checkModelStatus();
    } finally {
      state.busy = false;
      state.stream = null;
      state.scrollBottom = true;
      render();
    }
  }

  function regenerate() {
    const prompt = state.result?.prompt;
    if (!prompt) return;
    state.result = null;
    void runPrompt(prompt);
  }

  async function maxOutputTokens() {
    const usage = await safe(() => msty.context.getUsage(), null);
    const guided = Number(usage?.guidance?.maxOutputTokens);
    return Number.isFinite(guided) && guided > 0 ? guided : 900;
  }

  async function cancelRun() {
    if (!state.stream) return;
    try {
      await state.stream.cancel();
    } catch {
      /* best effort */
    }
    state.busy = false;
    if (state.result) state.result.state = "cancelled";
    render();
  }

  async function copyResult() {
    if (!state.result?.text) return;
    try {
      await msty.clipboard.writeText(state.result.text);
      notify("Copied to clipboard", { tone: "success" });
    } catch {
      notify("Copy isn't available here.", { tone: "warning" });
    }
  }

  async function addResultToNotes() {
    if (!state.result?.text) return;
    await addNote(state.result.text);
  }

  async function sendResultToChat() {
    if (!state.result?.text) return;
    try {
      const send = msty.messages.send(state.result.text);
      closeSurface({ action: "send-result" });
      await send;
      notify("Sent to chat", { tone: "success" });
    } catch (error) {
      notify(`Couldn't send: ${errorMessage(error)}`, { tone: "error" });
    }
  }

  async function createChatFromResult() {
    if (!state.result?.text) return;
    try {
      await msty.chats.create({
        draft: state.result.text,
        switchTo: true,
      });
      closeSurface({ action: "new-chat-result" });
      notify("Started a new chat", { tone: "success" });
    } catch (error) {
      notify(`Couldn't start a chat: ${errorMessage(error)}`, { tone: "error" });
    }
  }

  function closeSurface(value) {
    const request = { kind: DRAWER_KIND, id: DRAWER_ID, result: value };
    try {
      if (typeof msty.ui?.closeSurface === "function") {
        void msty.ui.closeSurface(request).catch(() => {
          closeCurrentSurface(value);
        });
        closeCurrentSurface(value);
        return;
      }
      closeCurrentSurface(value);
    } catch {
      /* The host may already be closing the surface. */
    }
  }

  function closeCurrentSurface(value) {
    if (typeof msty.surface?.close === "function") {
      msty.surface.close(value);
    } else if (typeof msty.ui?.close === "function") {
      msty.ui.close(value);
    }
  }

  async function applyIntent(intentId) {
    const intent = state.result?.intents?.find((entry) => entry.id === intentId);
    if (!intent) return;
    if (intent.type === "reviewItems") {
      for (const itemId of intent.itemIds) {
        const item = findItem(itemId);
        if (item) {
          item.status = "reviewed";
          item.updatedAt = new Date().toISOString();
        }
      }
      state.undo = null;
      await persist(`${intent.itemIds.length} marked reviewed`);
    } else if (intent.type === "addNote") {
      await addNote(intent.body || state.result.text);
    }
  }

  async function persist(notice, opts) {
    state.keep.updatedAt = new Date().toISOString();
    state.keep.drawerPromptDraft = state.prompt;
    await msty.storage.chat.set(STATE_KEY, normalizeState(state.keep, state.chatId));
    render();
    if (notice) notify(notice, { tone: "success", ...opts });
  }

  async function buildContextPackage(userPrompt) {
    const chatContext = await safe(
      () => msty.context.getCurrentChat({ includeMessages: "recent", maxMessages: 8 }),
      { chat: state.chat, messages: [] },
    );
    return {
      chat: {
        id: state.chatId,
        title: text(chatContext?.chat?.title, text(state.chat?.title, "Current chat")),
      },
      recentMessages: normalizeMessages(chatContext?.messages).slice(-8),
      activePins: state.keep.pins.filter((item) => item.status !== "reviewed").map(pinContext),
      reviewedPins: state.keep.pins.filter((item) => item.status === "reviewed").map(pinContext),
      activeNotes: state.keep.notes.filter((item) => item.status !== "reviewed").map(noteContext),
      reviewedNotes: state.keep.notes.filter((item) => item.status === "reviewed").map(noteContext),
      userPrompt,
    };
  }

  function deriveActionIntents(prompt, resultText) {
    const lower = prompt.toLowerCase();
    const intents = [];
    if (/\b(add|save|keep)\b/.test(lower) && /\bnote\b/.test(lower)) {
      intents.push({ id: "add-note", type: "addNote", label: "Add answer to notes", body: resultText });
    }
    if (/\b(mark|move|set)\b/.test(lower) && /\breviewed\b|\breview\b/.test(lower)) {
      const keywords = lower.split(/[^a-z0-9]+/).filter((word) => word.length > 3 && !GENERIC_WORDS.has(word));
      const candidates = [...state.keep.pins, ...state.keep.notes].filter((item) => item.status !== "reviewed");
      const matches = candidates.filter((item) => {
        if (keywords.length === 0) return true;
        const content = itemText(item).toLowerCase();
        return keywords.some((word) => content.includes(word));
      });
      if (matches.length > 0) {
        const label = keywords.length
          ? `Mark ${matches.length} matching reviewed`
          : `Mark all ${matches.length} active reviewed`;
        intents.push({
          id: "review-matches",
          type: "reviewItems",
          label,
          itemIds: matches.map((item) => item.id),
        });
      }
    }
    return intents;
  }

  function findItem(itemId, type) {
    if (!itemId) return null;
    if (type !== "note") {
      const pin = state.keep.pins.find((item) => item.id === itemId);
      if (pin) return pin;
    }
    if (type !== "pin") {
      const note = state.keep.notes.find((item) => item.id === itemId);
      if (note) return note;
    }
    return null;
  }

  // -- Toast queue ---------------------------------------------------------
  function notify(message, opts = {}) {
    if (!message) return;
    const tone = opts.tone || "info";
    const toast = {
      id: id("toast"),
      message,
      tone,
      undo: Boolean(opts.undo),
    };
    state.toasts = [...state.toasts, toast].slice(-MAX_TOASTS);
    renderToasts();
    const ttl = opts.undo ? 6500 : 3600;
    setTimeout(() => dismissToast(toast.id), ttl);
  }

  function dismissToast(toastId) {
    state.toasts = state.toasts.filter((entry) => entry.id !== toastId);
    renderToasts();
  }

  function renderToasts() {
    toastEl.innerHTML = state.toasts
      .map((toast) => {
        const undo = toast.undo
          ? `<button type="button" class="keep-toast__undo" data-action="undo">${icon("restore")} Undo</button>`
          : "";
        return `
          <div class="keep-toast keep-tone--${toast.tone}" role="status" data-show>
            <span class="keep-toast__icon" aria-hidden="true">${icon(toneIconName(toast.tone))}</span>
            <span class="keep-toast__msg">${escapeHtml(toast.message)}</span>
            ${undo}
            <button type="button" class="keep-toast__x" data-action="dismiss-toast" data-id="${escapeHtml(toast.id)}" aria-label="Dismiss">${icon("x")}</button>
          </div>`;
      })
      .join("");
  }

  // -- Targeted DOM updates (no full re-render) ----------------------------
  function updateResultText(value) {
    const el = appEl.querySelector("[data-result-text]");
    if (el) el.textContent = value;
    const scroller = appEl.querySelector("[data-scroll]");
    if (scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 64) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }

  function updateModelChip() {
    const el = appEl.querySelector("[data-model-chip]");
    if (el) el.outerHTML = modelChipHtml();
  }

  function autoGrow(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }

  function autoGrowFocused() {
    if (state.focusField) {
      requestAnimationFrame(() => {
        const field = appEl.querySelector(`[data-field="${state.focusField}"]`);
        if (field instanceof HTMLTextAreaElement) autoGrow(field);
      });
    }
  }

  function refocusSearch() {
    const search = appEl.querySelector('[data-field="search"]');
    if (search instanceof HTMLInputElement) {
      search.focus();
      const end = search.value.length;
      try {
        search.setSelectionRange(end, end);
      } catch {
        /* not all inputs support selection */
      }
    }
  }

  // -- Render --------------------------------------------------------------
  function render() {
    const previous = appEl.querySelector("[data-scroll]");
    const prevTop = previous ? previous.scrollTop : 0;
    appEl.innerHTML = workspaceHtml();
    appEl.toggleAttribute("data-busy", state.busy);
    const scroller = appEl.querySelector("[data-scroll]");
    if (scroller) {
      if (state.scrollBottom) {
        if (typeof scroller.scrollTo === "function") {
          scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
        } else {
          scroller.scrollTop = scroller.scrollHeight;
        }
      } else {
        scroller.scrollTop = prevTop;
      }
    }
    state.scrollBottom = false;
    if (state.focusField) {
      const field = appEl.querySelector(`[data-field="${state.focusField}"]`);
      if (field) {
        field.focus();
        const end = "value" in field ? field.value.length : 0;
        try {
          field.setSelectionRange(end, end);
        } catch {
          /* not all inputs support selection */
        }
        if (field instanceof HTMLTextAreaElement) autoGrow(field);
      }
      state.focusField = null;
    }
  }

  function workspaceHtml() {
    const activePins = state.keep.pins.filter((item) => item.status !== "reviewed");
    const activeNotes = state.keep.notes.filter((item) => item.status !== "reviewed");
    const reviewed = [...state.keep.pins, ...state.keep.notes].filter((item) => item.status === "reviewed");
    const query = state.query.trim().toLowerCase();
    const searching = Boolean(query);

    const shownPins = searching ? activePins.filter((item) => matchesQuery(item, query)) : activePins;
    const shownNotes = searching ? activeNotes.filter((item) => matchesQuery(item, query)) : activeNotes;
    const totalActive = activePins.length + activeNotes.length;
    const heroEmpty = !searching && totalActive === 0 && !state.result;

    return `
      <div class="keep">
        ${headerHtml()}

        ${totalActive > 0 || searching ? searchBarHtml(shownPins.length + shownNotes.length, searching) : ""}

        <div class="keep__scroll" data-scroll>
          ${
            state.loading
              ? skeletonHtml()
              : heroEmpty
                ? heroEmptyHtml()
                : bodyHtml({ shownPins, shownNotes, reviewed, searching })
          }
          ${resultHtml()}
        </div>

        ${askBarHtml()}
      </div>
    `;
  }

  function headerHtml() {
    return `
      <header class="keep__head">
        <div class="keep__brand">
          <span class="keep__logo" aria-hidden="true">${icon("bookmark")}</span>
          <div class="keep__brand-text">
            <h1>Keep Nearby</h1>
            <div class="keep__chat" title="Pins and notes are saved just for this chat">
              ${icon("message")}<span>${escapeHtml(chatLabel())}</span>
            </div>
          </div>
          <button class="kbtn kbtn--ghost kbtn--icon keep__refresh" type="button" data-action="refresh" aria-label="Refresh" title="Refresh">${icon("refresh")}</button>
        </div>
      </header>
    `;
  }

  function searchBarHtml(count, searching) {
    return `
      <div class="keep-search">
        <span class="keep-search__icon" aria-hidden="true">${icon("search")}</span>
        <input class="keep-search__input" type="search" data-field="search" value="${escapeHtml(state.query)}" placeholder="Search pins and notes…" aria-label="Search pins and notes" />
        ${
          searching
            ? `<button class="keep-search__clear" type="button" data-action="clear-search" aria-label="Clear search">${icon("x")}</button>`
            : ""
        }
        ${searching ? `<span class="keep-search__count">${count} result${count === 1 ? "" : "s"}</span>` : ""}
      </div>
    `;
  }

  function bodyHtml({ shownPins, shownNotes, reviewed, searching }) {
    if (searching) {
      const any = shownPins.length || shownNotes.length;
      if (!any) return emptyHtml("search", "No matches", "Nothing here matches your search. Try different words, or clear it.");
      return `
        ${shownPins.length ? sectionHtml("Pinned", shownPins.length, shownPins.map(pinCardHtml).join(""), false) : ""}
        ${shownNotes.length ? sectionHtml("Notes", shownNotes.length, shownNotes.map(noteCardHtml).join(""), false) : ""}
      `;
    }

    const reviewedPins = reviewed.filter((item) => item.sourceMessageId);
    const reviewedNotes = reviewed.filter((item) => !item.sourceMessageId);

    return `
      ${sectionHtml(
        "Pinned",
        shownPins.length,
        shownPins.length
          ? `<div class="keep-list">${shownPins.map(pinCardHtml).join("")}</div>`
          : emptyHtml("bookmark", "Nothing pinned yet", "Under any assistant reply, choose “Keep nearby” to save it here."),
        true,
      )}
      ${sectionHtml(
        "Notes",
        shownNotes.length,
        shownNotes.length
          ? `<div class="keep-list">${shownNotes.map(noteCardHtml).join("")}</div>`
          : state.addingNote
            ? ""
            : emptyHtml("note", "No notes yet", "Jot anything you want to keep beside this chat."),
        true,
        noteComposerHtml(),
      )}
      ${reviewedSectionHtml(reviewedPins, reviewedNotes)}
    `;
  }

  function sectionHtml(title, count, body, withAnim, footer = "") {
    return `
      <section class="keep-sec">
        <div class="keep-sec__head"><h2>${escapeHtml(title)}</h2>${countBadge(count)}</div>
        <div class="keep-sec__body${withAnim ? " keep-sec__body--anim" : ""}">${body}</div>
        ${footer}
      </section>
    `;
  }

  function reviewedSectionHtml(reviewedPins, reviewedNotes) {
    const total = reviewedPins.length + reviewedNotes.length;
    return `
      <section class="keep-sec keep-sec--reviewed">
        <button class="keep-disclosure" type="button" data-action="toggle-reviewed" aria-expanded="${state.reviewedOpen ? "true" : "false"}">
          <span class="keep-disclosure__chev" aria-hidden="true">${icon("chevron-down")}</span>
          <span>Reviewed</span>
          ${countBadge(total)}
        </button>
        ${
          state.reviewedOpen
            ? total
              ? `<div class="keep-list keep-list--reviewed">
                  ${reviewedPins.length ? `<div class="keep-subhead">${icon("bookmark")} Pins ${countBadge(reviewedPins.length)}</div>${reviewedPins.map(reviewedCardHtml).join("")}` : ""}
                  ${reviewedNotes.length ? `<div class="keep-subhead">${icon("note")} Notes ${countBadge(reviewedNotes.length)}</div>${reviewedNotes.map(reviewedCardHtml).join("")}` : ""}
                </div>`
              : emptyInline("Nothing reviewed yet.")
            : ""
        }
      </section>
    `;
  }

  function countBadge(count) {
    return count > 0 ? `<span class="keep-count">${count}</span>` : "";
  }

  function noteComposerHtml() {
    if (state.addingNote) {
      return `
        <form class="keep-note-form" data-form="note">
          <textarea data-field="note" rows="2" placeholder="Write a note for this chat…" aria-label="Note"></textarea>
          <div class="keep-note-form__bar">
            <span class="keep-note-form__hint">Enter to add · Esc to cancel</span>
            <span class="keep-note-form__btns">
              <button class="kbtn kbtn--ghost kbtn--sm" type="button" data-action="cancel-note">Cancel</button>
              <button class="kbtn kbtn--primary kbtn--sm" type="submit">${icon("plus")} Add note</button>
            </span>
          </div>
        </form>
      `;
    }
    return `<button class="keep-add" type="button" data-action="start-note">${icon("plus")} Add a note</button>`;
  }

  function pinCardHtml(pin, index = 0) {
    const expanded = state.expandedIds.includes(pin.id);
    const hasFull = Boolean(pin.fullText) && pin.fullText.length > pin.snippet.length;
    const text = expanded && pin.fullText ? pin.fullText : pin.snippet;
    return `
      <article class="keep-item" style="--keep-i:${index}">
        <div class="keep-item__head">
          <span class="keep-item__icon" aria-hidden="true">${icon("bookmark")}</span>
          <div class="keep-item__title">${escapeHtml(pin.title || "Saved reply")}</div>
        </div>
        <p class="keep-item__text${expanded ? " keep-item__text--expanded" : ""}">${escapeHtml(text)}</p>
        ${
          hasFull
            ? `<button class="keep-item__more" type="button" data-action="toggle-expand" data-id="${escapeHtml(pin.id)}">${expanded ? "Show less" : "Show more"}</button>`
            : ""
        }
        ${itemFooterHtml(pin.id, `Kept ${escapeHtml(relativeTime(pin.createdAt))}`, { source: true })}
      </article>
    `;
  }

  function noteCardHtml(note, index = 0) {
    if (state.editingNoteId === note.id) {
      return `
        <article class="keep-item keep-item--editing" style="--keep-i:${index}">
          <textarea data-field="edit-note" rows="2" aria-label="Edit note">${escapeHtml(state.editingBody)}</textarea>
          <div class="keep-item__edit-bar">
            <button class="kbtn kbtn--ghost kbtn--sm" type="button" data-action="cancel-edit">Cancel</button>
            <button class="kbtn kbtn--primary kbtn--sm" type="button" data-action="save-note" data-id="${escapeHtml(note.id)}">${icon("check")} Save</button>
          </div>
        </article>
      `;
    }
    return `
      <article class="keep-item" style="--keep-i:${index}">
        <div class="keep-item__head">
          <span class="keep-item__icon keep-item__icon--note" aria-hidden="true">${icon("note")}</span>
          <div class="keep-item__title keep-item__title--note">Note</div>
        </div>
        <p class="keep-item__text keep-item__text--note">${escapeHtml(note.body)}</p>
        ${itemFooterHtml(note.id, `Noted ${escapeHtml(relativeTime(note.createdAt))}`, { edit: true })}
      </article>
    `;
  }

  function reviewedCardHtml(item, index = 0) {
    const isPin = Boolean(item.sourceMessageId);
    return `
      <article class="keep-item keep-item--reviewed" style="--keep-i:${index}">
        <div class="keep-item__head">
          <span class="keep-item__icon" aria-hidden="true">${icon(isPin ? "bookmark" : "note")}</span>
          <div class="keep-item__title">${escapeHtml(isPin ? item.title || "Saved reply" : "Note")}</div>
        </div>
        <p class="keep-item__text">${escapeHtml(itemText(item))}</p>
        ${itemFooterHtml(item.id, "Reviewed", { source: isPin, restore: true, reviewed: true })}
      </article>
    `;
  }

  function itemFooterHtml(itemId, metaLabel, { source, edit, restore, reviewed } = {}) {
    return `
      <div class="keep-item__foot">
        <span class="keep-item__meta">${metaLabel ? `${icon("clock")} ${metaLabel}` : ""}</span>
        <div class="keep-item__actions">
          ${source ? `<button class="kbtn kbtn--ghost kbtn--icon" type="button" data-action="source" data-id="${escapeHtml(itemId)}" aria-label="Open the original message" title="Open the original message">${icon("jump")}</button>` : ""}
          ${edit ? `<button class="kbtn kbtn--ghost kbtn--icon" type="button" data-action="edit-note" data-id="${escapeHtml(itemId)}" aria-label="Edit note" title="Edit">${icon("pencil")}</button>` : ""}
          <button class="kbtn kbtn--ghost kbtn--icon" type="button" data-action="copy-item" data-id="${escapeHtml(itemId)}" aria-label="Copy" title="Copy">${icon("copy")}</button>
          ${
            reviewed
              ? `<button class="kbtn kbtn--ghost kbtn--icon" type="button" data-action="restore" data-id="${escapeHtml(itemId)}" aria-label="Move back" title="Move back">${icon("restore")}</button>`
              : `<button class="kbtn kbtn--ghost kbtn--icon" type="button" data-action="review" data-id="${escapeHtml(itemId)}" aria-label="Mark reviewed" title="Mark reviewed">${icon("check")}</button>`
          }
          <button class="kbtn kbtn--ghost kbtn--icon" type="button" data-action="remove" data-id="${escapeHtml(itemId)}" aria-label="Remove" title="Remove">${icon("trash")}</button>
        </div>
      </div>
    `;
  }

  function askBarHtml() {
    const ready = !(state.modelStatus && state.modelStatus.ready === false);
    const placeholder = ready
      ? "Ask about this chat — answers use only its pins and notes"
      : "Set up the model first…";
    return `
      <form class="keep__ask" data-form="prompt">
        <textarea data-field="prompt" rows="2" ${state.busy ? "readonly" : ""} placeholder="${escapeHtml(placeholder)}" aria-label="Ask about this chat">${escapeHtml(state.prompt)}</textarea>
        <div class="keep__ask-bar">
          <span class="keep__ask-side" data-model-chip>${modelChipHtml()}</span>
          <span class="keep__ask-spacer"></span>
          <div class="keep__ask-actions">
            ${
              state.busy
                ? `<button class="kbtn kbtn--sm" type="button" data-action="cancel-run">${icon("x")} Stop</button>`
                : `<button class="kbtn kbtn--primary kbtn--sm" type="submit">${icon("spark")} Ask</button>`
            }
          </div>
        </div>
        <div class="keep__kbd-row">
          <span class="keep-kbd"><kbd>${isMac() ? "⌘" : "Ctrl"}</kbd><kbd>↵</kbd> Ask</span>
          <span class="keep-kbd"><kbd>Esc</kbd> Cancel</span>
        </div>
      </form>
    `;
  }

  function modelChipHtml() {
    const status = state.modelStatus;
    if (!status) return "";
    const ready = status.ready !== false;
    const tone = ready ? "ready" : status.source === "unavailable" ? "error" : "warn";
    const label = ready
      ? status.model
        ? shortModel(status.model)
        : "Ready"
      : status.source === "unavailable"
        ? "Set up model"
        : "Configuring…";
    const button = ready
      ? ""
      : `<button class="keep-status__setup" type="button" data-action="open-model-settings" title="Open model settings">Configure</button>`;
    return `<span class="keep-status keep-status--${tone}" data-model-chip title="${escapeHtml(status.unavailableReason || status.message || "")}"><span class="keep-status__dot" aria-hidden="true"></span>${escapeHtml(label)}${button}</span>`;
  }

  function resultHtml() {
    if (!state.result) return "";
    const result = state.result;
    const running = result.state === "running";
    const statusLabel = running
      ? "Working"
      : result.state === "failed"
        ? "Couldn't finish"
        : result.state === "cancelled"
          ? "Stopped"
          : "Answer";
    const intents =
      result.state === "complete" && Array.isArray(result.intents) && result.intents.length
        ? `<div class="keep-result__intents">${result.intents
            .map(
              (intent) =>
                `<button class="keep-chip" type="button" data-action="apply-intent" data-id="${escapeHtml(intent.id)}">${icon("spark")}${escapeHtml(intent.label)}</button>`,
            )
            .join("")}</div>`
        : "";
    const tokens =
      result.state === "complete" && result.tokens?.outputTokens
        ? `<span class="keep-result__tokens">· ~${result.tokens.outputTokens} tokens</span>`
        : "";
    const primary = `<button class="kbtn kbtn--sm" type="button" data-action="copy-result">${icon("copy")} Copy</button>`;
    const more = `
      <details class="keep-result__menu">
        <summary class="kbtn kbtn--sm" aria-label="More actions">${icon("more")} More</summary>
        <div class="keep-result__menu-list">
          <button class="kbtn kbtn--ghost kbtn--sm" type="button" data-action="note-result">${icon("note")} Save as note</button>
          <button class="kbtn kbtn--ghost kbtn--sm" type="button" data-action="send-result">${icon("send")} Send to chat</button>
          <button class="kbtn kbtn--ghost kbtn--sm" type="button" data-action="new-chat-result">${icon("chat-plus")} New chat</button>
        </div>
      </details>`;
    const retry =
      result.state === "failed"
        ? `<button class="kbtn kbtn--primary kbtn--sm" type="button" data-action="regenerate-result">${icon("refresh")} Retry</button>`
        : result.state === "complete"
          ? `<button class="kbtn kbtn--ghost kbtn--icon kbtn--sm" type="button" data-action="regenerate-result" aria-label="Regenerate" title="Regenerate">${icon("refresh")}</button>`
          : "";
    const actions = result.text && !running ? `<div class="keep-result__actions">${primary}${retry}${more}</div>` : "";
    return `
      <section class="keep-result keep-result--${result.state}${running ? " is-streaming" : ""}" aria-live="polite">
        <div class="keep-result__head">
          <span class="keep-result__status">${running ? `<span class="keep-spin" aria-hidden="true"></span>` : ""}${escapeHtml(statusLabel)}${tokens}</span>
          <button class="kbtn kbtn--ghost kbtn--icon kbtn--xs" type="button" data-action="discard-result" aria-label="Dismiss answer" title="Dismiss">${icon("x")}</button>
        </div>
        ${result.prompt ? `<p class="keep-result__prompt">${escapeHtml(result.prompt)}</p>` : ""}
        <div class="keep-result__body${result.state === "failed" ? " keep-result__body--error" : ""}" data-result-text>${escapeHtml(result.error || result.text || "")}</div>
        ${intents}
        ${actions}
      </section>
    `;
  }

  function heroEmptyHtml() {
    return `
      <div class="keep-hero">
        <span class="keep-hero__icon" aria-hidden="true">${icon("bookmark")}</span>
        <div class="keep-hero__title">Nothing kept nearby yet</div>
        <p class="keep-hero__body">Pin a reply from any assistant message, or jot a quick note. Everything stays tied to this chat.</p>
        <div class="keep-hero__actions">
          <button class="kbtn kbtn--primary kbtn--sm" type="button" data-action="start-note">${icon("plus")} Add a note</button>
        </div>
        <div class="keep-hero__hint">${icon("spark")} Or ask a question about this chat below</div>
      </div>
    `;
  }

  function skeletonHtml() {
    return `<div class="keep-skeleton">${'<div class="keep-skeleton__line"></div>'.repeat(4)}</div>`;
  }

  function chatLabel() {
    return text(state.chat?.title, state.chatId ? "Current chat" : "No chat open");
  }

  function emptyHtml(iconName, title, body) {
    return `
      <div class="keep-empty">
        <span class="keep-empty__icon" aria-hidden="true">${icon(iconName)}</span>
        <div class="keep-empty__title">${escapeHtml(title)}</div>
        <p class="keep-empty__body">${escapeHtml(body)}</p>
      </div>
    `;
  }

  function emptyInline(message) {
    return `<p class="keep-empty-inline">${escapeHtml(message)}</p>`;
  }

  // -- Boot ----------------------------------------------------------------
  render();
  void checkModelStatus();

  try {
    await msty.events?.subscribe?.(() => {
      void refresh();
    }, { types: EVENT_TYPES });
  } catch {
    /* the drawer still works without live events */
  }
}

// -- Icons ------------------------------------------------------------------

const ICONS = {
  bookmark: '<path d="M6 4.5h12a1 1 0 0 1 1 1v14l-7-4-7 4v-14a1 1 0 0 1 1-1z"/>',
  note: '<path d="M5 4h10l5 5v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z"/><path d="M14 4v5h5"/>',
  message: '<path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.1A8 8 0 1 1 21 11.5z"/>',
  "chat-plus": '<path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.1A8 8 0 1 1 21 11.5z"/><path d="M12 8.5v6M9 11.5h6"/>',
  jump: '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M19 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12.5a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7"/><path d="M9 7V4.5h6V7"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  restore: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H8"/>',
  refresh: '<path d="M4.5 9a7.5 7.5 0 0 1 13-2.7L20 9"/><path d="M20 4v5h-5"/><path d="M19.5 15a7.5 7.5 0 0 1-13 2.7L4 15"/><path d="M4 20v-5h5"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  spark: '<path d="M12 4.5c.4 2.7 1.8 4.1 4.5 4.5-2.7.4-4.1 1.8-4.5 4.5-.4-2.7-1.8-4.1-4.5-4.5 2.7-.4 4.1-1.8 4.5-4.5z"/><path d="M18 14.5c.2 1.3.9 2 2.2 2.2-1.3.2-2 .9-2.2 2.2-.2-1.3-.9-2-2.2-2.2 1.3-.2 2-.9 2.2-2.2z"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  "check-circle": '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
};

function icon(name) {
  const paths = ICONS[name] || ICONS.note;
  return `<svg class="keep-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function toneIconName(tone) {
  if (tone === "success") return "check-circle";
  if (tone === "warning" || tone === "error") return "alert";
  return "info";
}

// -- State / data helpers ---------------------------------------------------

async function loadState(msty, chatId, fallback) {
  const defaults = fallback || defaultState(chatId);
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
  const pinId = text(value.id, "");
  const sourceMessageId = text(value.sourceMessageId, "");
  const snippetText = text(value.snippet, text(value.fullText, ""));
  if (!pinId || !sourceMessageId || !snippetText) return null;
  return compactObject({
    id: pinId,
    chatId: text(value.chatId, ""),
    sourceMessageId,
    sourceRange: value.sourceRange,
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
  const noteId = text(value.id, "");
  const body = text(value.body, "");
  if (!noteId || !body) return null;
  return {
    id: noteId,
    chatId: text(value.chatId, ""),
    body,
    status: value.status === "reviewed" ? "reviewed" : "active",
    createdAt: text(value.createdAt, new Date().toISOString()),
    updatedAt: text(value.updatedAt, text(value.createdAt, new Date().toISOString())),
  };
}

function matchesQuery(item, query) {
  if (!query) return true;
  const haystack = `${item.title || ""} ${item.snippet || ""} ${item.fullText || ""} ${item.body || ""}`.toLowerCase();
  return query.split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

function promptForContext(contextPackage) {
  return [
    "You are helping with Keep Nearby, a small holding area for the current chat.",
    "Use only this context. Do not invent missing chat history. Keep the answer concise.",
    "Do not say that you changed notes, pins, chats, or reviewed state unless the provided tools apply that action.",
    "",
    JSON.stringify(contextPackage, null, 2),
  ].join("\n");
}

function normalizeMessages(messages) {
  return Array.isArray(messages)
    ? messages.map((message) => ({
        role: text(message.role, "message"),
        content: snippet(message.content, 1000),
      }))
    : [];
}

function pinContext(pin) {
  return { id: pin.id, sourceMessageId: pin.sourceMessageId, title: pin.title, text: pin.fullText || pin.snippet };
}

function noteContext(note) {
  return { id: note.id, text: note.body };
}

function itemText(item) {
  return item.body || item.fullText || item.snippet || item.title || "";
}

function titleFromText(value) {
  return snippet(value, 64).replace(/[.!?]+$/, "") || "Keep Nearby";
}

function shortModel(model) {
  if (!model) return "Ready";
  const base = String(model).split("/").pop() || model;
  return base.length > 22 ? `${base.slice(0, 21)}…` : base;
}

function relativeTime(value) {
  if (!value) return "just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} day${days === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString();
}

function snippet(value, limit) {
  const compact = String(value ?? "").replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  return `${compact.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function id(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function errorMessage(error) {
  return error && typeof error.message === "string" ? error.message : String(error);
}

function isCancelled(error) {
  return error?.code === "CANCELLED" || /cancel/i.test(errorMessage(error));
}

function isMac() {
  try {
    return /Mac|iPhone|iPad/.test(navigator.platform) || /Mac|iPhone|iPad/.test(navigator.userAgent);
  } catch {
    return false;
  }
}

async function safe(callback, fallback) {
  try {
    return await callback();
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
