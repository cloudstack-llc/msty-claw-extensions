// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

import {
  deletePrompt,
  filterPrompts,
  loadPromptLibrary,
  promptTags,
  recordPromptUsed,
  refreshStarterPrompts,
  savePrompt,
  tagsToInput,
} from "./prompt-store.js";
import { escapeHtml, formatWhen, promptPreview } from "./ui-helpers.js";
import "./ui.css";

const TOAST_MAX = 3;
const TOAST_TTL = { success: 3600, warning: 6000, danger: 6000 };
const ICONS = {
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.3 6.4L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.3 5.6L21 8"/><path d="M21 3v5h-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  send: '<path d="m9 10-5 5 5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v5M14 11v5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
};

/** @param {keyof typeof ICONS} name */
function icon(name) {
  return `<svg class="pl-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.search}</svg>`;
}

/** @param {Msty.SurfaceMountContext} params */
export async function mount({ root, msty, context }) {
  const state = {
    prompts: Array.isArray(context?.prompts) ? context.prompts : [],
    query: "",
    source: "all",
    tag: "",
    busy: false,
    toasts: [],
  };

  let usage = asObject(await safe(() => msty.storage?.local?.get?.("usage"), {}));
  const iconUrl = await safe(() => msty.assets?.url?.("static/icon.svg"), "");

  root.innerHTML = `
    <div class="pl-shell" id="pl-app"></div>
    <div class="pl-toast-stack" id="pl-toast" aria-live="polite" aria-atomic="false"></div>
  `;
  const appEl = /** @type {HTMLElement} */ (root.querySelector("#pl-app"));
  const toastEl = /** @type {HTMLElement} */ (root.querySelector("#pl-toast"));

  if (!state.prompts.length) await reload({ autoRefresh: true, silent: true });
  render();

  appEl.addEventListener("click", (event) => {
    const target = targetClosest(appEl, event);
    if (!target || target.hasAttribute("disabled")) return;
    const action = target.getAttribute("data-action") || "";
    const id = target.getAttribute("data-id") || "";
    if (action === "source") return setSource(target.getAttribute("data-source") || "all");
    if (action === "clear-search") return clearSearch();
    if (action === "clear-filters") return clearFilters();
    if (action === "add") return void openEditor();
    if (action === "edit") return void openEditor(id);
    if (action === "delete") return void removePrompt(id);
    if (action === "copy") return void copyPrompt(id);
    if (action === "insert") return void insertPrompt(id);
    if (action === "refresh-starters") return void refreshStarters();
  });

  appEl.addEventListener("input", (event) => {
    const field = event.target instanceof Element ? event.target.closest('[data-action="search"]') : null;
    if (field instanceof HTMLInputElement) {
      state.query = field.value;
      render();
      refocusSearch();
    }
  });

  appEl.addEventListener("change", (event) => {
    const field =
      event.target instanceof Element ? event.target.closest('[data-action="tag-select"]') : null;
    if (field instanceof HTMLSelectElement) {
      state.tag = field.value;
      render();
    }
  });

  appEl.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.query) {
      event.preventDefault();
      clearSearch();
    }
  });

  function render() {
    const total = state.prompts.length;
    const savedCount = state.prompts.filter((prompt) => prompt.source !== "starter").length;
    const starterCount = total - savedCount;
    const filtered = filterPrompts(state.prompts, {
      query: state.query,
      tag: state.tag,
      source: state.source,
    });
    const tags = promptTags(state.prompts);

    appEl.innerHTML = `
      <header class="pl-header pl-header--manager">
        <div class="pl-brand">
          <span class="pl-brand__mark">${
            iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="" />` : icon("sparkle")
          }</span>
          <div>
            <h1 class="pl-brand__title">Prompt Library</h1>
            <p class="pl-brand__meta">
              <span>${total} ${total === 1 ? "prompt" : "prompts"}</span>
              <span class="pl-meta-dot">.</span>
              <span>${savedCount} saved</span>
              <span class="pl-meta-dot">.</span>
              <span>${starterCount} starter</span>
            </p>
          </div>
        </div>
        <div class="pl-header__actions">
          <button type="button" class="pl-btn pl-btn--ghost" data-action="refresh-starters" ${state.busy ? "disabled" : ""}>
            ${icon("refresh")} Refresh starters
          </button>
          <button type="button" class="pl-btn" data-action="add">
            ${icon("plus")} New prompt
          </button>
        </div>
      </header>

      <section class="pl-manager-bar" aria-label="Prompt filters">
        <div class="pl-search pl-search--wide">
          <span class="pl-search__icon">${icon("search")}</span>
          <input
            class="pl-search__input"
            type="search"
            data-action="search"
            value="${escapeHtml(state.query)}"
            placeholder="Search by name, tag, or prompt text"
            aria-label="Search prompts"
            autocomplete="off"
            spellcheck="false"
          />
          ${
            state.query
              ? `<button type="button" class="pl-search__clear" data-action="clear-search" aria-label="Clear search">${icon("x")}</button>`
              : ""
          }
        </div>
        <div class="pl-filter-row">
          ${tagSelect(tags)}
          <div class="pl-segmented" role="group" aria-label="Prompt type">
            ${sourceButton("all", "All", total)}
            ${sourceButton("saved", "Saved", savedCount)}
            ${sourceButton("starter", "Starters", starterCount)}
          </div>
        </div>
      </section>

      <section class="pl-list" aria-label="Prompt management">
        ${
          filtered.length
            ? listHeader() + filtered.map((prompt) => promptRow(prompt)).join("")
            : emptyState(total)
        }
      </section>

      <aside class="pl-footer" aria-label="Last inserted prompt">
        <span class="pl-footer__icon">${icon("send")}</span>
        <span class="pl-footer__label">Last inserted</span>
        <span class="pl-footer__name">${escapeHtml(text(usage.lastPrompt, "Nothing yet"))}</span>
        ${
          formatWhen(usage.updatedAt)
            ? `<span class="pl-footer__when">${escapeHtml(formatWhen(usage.updatedAt))}</span>`
            : ""
        }
      </aside>
    `;
  }

  function sourceButton(source, label, count) {
    const active = state.source === source;
    return `
      <button type="button" class="pl-segment ${active ? "is-active" : ""}" data-action="source" data-source="${escapeHtml(source)}">
        ${escapeHtml(label)}
        <span>${count}</span>
      </button>
    `;
  }

  function tagSelect(tags) {
    return `
      <label class="pl-select-control">
        <span>Tag</span>
        <select class="pl-select" data-action="tag-select" aria-label="Filter by tag">
          <option value="">All tags</option>
          ${tags
            .map(
              (tag) =>
                `<option value="${escapeHtml(tag)}" ${tag === state.tag ? "selected" : ""}>${escapeHtml(tag)}</option>`,
            )
            .join("")}
        </select>
      </label>
    `;
  }

  function listHeader() {
    return `
      <div class="pl-list__head" aria-hidden="true">
        <span>Prompt</span>
        <span>Type</span>
        <span>Actions</span>
      </div>
    `;
  }

  function promptRow(prompt) {
    const preview = promptPreview(prompt.prompt) || "No prompt text.";
    return `
      <article class="pl-row" data-id="${escapeHtml(prompt.id)}">
        <div class="pl-row__main">
          <div class="pl-row__titleline">
            <h2 class="pl-row__title">${escapeHtml(prompt.name)}</h2>
            <div class="pl-row__tags">${prompt.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
          </div>
          <p class="pl-row__preview">${escapeHtml(preview)}</p>
        </div>
        <div class="pl-row__source">
          <span class="pl-source-pill ${prompt.source === "starter" ? "is-starter" : "is-saved"}">
            ${prompt.source === "starter" ? "Starter" : "Saved"}
          </span>
        </div>
        <div class="pl-row__actions">
          <button type="button" class="pl-btn pl-btn--ghost" data-action="insert" data-id="${escapeHtml(prompt.id)}" title="Insert prompt">
            ${icon("send")} Insert
          </button>
          <button type="button" class="pl-icon-btn" data-action="copy" data-id="${escapeHtml(prompt.id)}" aria-label="Copy ${escapeHtml(prompt.name)}" title="Copy prompt">
            ${icon("copy")}
          </button>
          <button type="button" class="pl-icon-btn" data-action="edit" data-id="${escapeHtml(prompt.id)}" aria-label="Edit ${escapeHtml(prompt.name)}" title="Edit prompt">
            ${icon("edit")}
          </button>
          <button type="button" class="pl-icon-btn pl-icon-btn--danger" data-action="delete" data-id="${escapeHtml(prompt.id)}" aria-label="Delete ${escapeHtml(prompt.name)}" title="Delete prompt">
            ${icon("trash")}
          </button>
        </div>
      </article>
    `;
  }

  function emptyState(total) {
    const filtered = Boolean(state.query || state.tag || state.source !== "all");
    if (total && filtered) {
      return `
        <div class="pl-empty pl-empty--manager">
          <span class="pl-empty__mark">${icon("search")}</span>
          <strong class="pl-empty__title">No matching prompts</strong>
          <span>Try another search, or switch the filters.</span>
          <button type="button" class="pl-btn pl-btn--ghost" data-action="clear-filters">Clear filters</button>
        </div>
      `;
    }
    return `
      <div class="pl-empty pl-empty--manager">
        <span class="pl-empty__mark">${icon("sparkle")}</span>
        <strong class="pl-empty__title">Create your first reusable prompt</strong>
        <span>Save prompts you use often, then insert them from the toolbox without leaving your chat.</span>
        <div class="pl-empty__actions">
          <button type="button" class="pl-btn" data-action="add">${icon("plus")} New prompt</button>
          <button type="button" class="pl-btn pl-btn--ghost" data-action="refresh-starters">${icon("refresh")} Load starters</button>
        </div>
      </div>
    `;
  }

  async function reload(options = {}) {
    const snapshot = await loadPromptLibrary(msty, {
      autoRefresh: options.autoRefresh === true,
      forceRefresh: options.forceRefresh === true,
    });
    state.prompts = snapshot.prompts;
    if (!options.silent) render();
  }

  function setSource(source) {
    state.source = ["all", "saved", "starter"].includes(source) ? source : "all";
    render();
  }

  function setTag(tag) {
    state.tag = state.tag === tag ? "" : tag;
    render();
  }

  function clearSearch() {
    state.query = "";
    render();
    refocusSearch();
  }

  function clearFilters() {
    state.query = "";
    state.tag = "";
    state.source = "all";
    render();
    refocusSearch();
  }

  async function refreshStarters() {
    state.busy = true;
    render();
    const snapshot = await refreshStarterPrompts(msty);
    state.prompts = snapshot.prompts;
    state.busy = false;
    const unavailable = snapshot.refresh.status === "unavailable";
    pushToast({
      tone: unavailable ? "warning" : "success",
      message: unavailable
        ? "Using the prompts saved on this device. Try refreshing again later."
        : snapshot.refresh.added || snapshot.refresh.updated
          ? "Starter prompts updated."
          : "Starter prompts are already up to date.",
    });
    render();
  }

  async function openEditor(promptId = "") {
    const existing = state.prompts.find((prompt) => prompt.id === promptId);
    if (typeof msty.ui?.openDrawer !== "function") {
      pushToast({ tone: "warning", message: "Prompt editing is not available here." });
      return;
    }
    const result = await safe(
      () =>
        msty.ui.openDrawer({
          id: "prompt_library_editor",
          title: existing ? "Edit prompt" : "New prompt",
          width: "medium",
          content: editorContent(existing),
          closeLabel: "Cancel",
          actions: [
            {
              id: "save",
              label: existing ? "Save changes" : "Create prompt",
              variant: "primary",
            },
          ],
        }),
      null,
    );
    const { actionId, values } = readSurfaceResult(result);
    if (actionId !== "save") return;
    const name = text(values.name, "");
    const prompt = text(values.prompt, "");
    if (!name || !prompt) {
      pushToast({ tone: "warning", message: "Add a name and prompt text before saving." });
      return;
    }
    await savePrompt(msty, {
      id: existing?.id,
      name,
      prompt,
      tags: text(values.tags, ""),
    });
    await reload({ silent: true });
    pushToast({ tone: "success", message: existing ? "Prompt updated." : "Prompt created." });
    render();
  }

  function editorContent(existing) {
    const fields = [
      {
        type: "text",
        id: "name",
        label: "Name",
        placeholder: "Release note",
        defaultValue: existing?.name || "",
        required: true,
      },
      {
        type: "text",
        id: "tags",
        label: "Tags",
        description: "Separate tags with commas.",
        placeholder: "Writing, Release notes",
        defaultValue: tagsToInput(existing?.tags || []),
      },
      {
        type: "textarea",
        id: "prompt",
        label: "Prompt",
        placeholder: "Write the prompt you want to reuse.",
        defaultValue: existing?.prompt || "",
        required: true,
      },
    ];
    return [
      {
        type: "form",
        title: "Prompt details",
        fields,
      },
    ];
  }

  async function removePrompt(promptId) {
    const prompt = state.prompts.find((item) => item.id === promptId);
    if (!prompt) return;
    const result = await safe(
      () =>
        msty.ui?.confirm?.({
          title: `Delete "${prompt.name}"?`,
          body: "This removes it from your Prompt Library.",
          confirmLabel: "Delete prompt",
          cancelLabel: "Keep prompt",
          tone: "danger",
        }),
      { confirmed: false },
    );
    if (result?.confirmed !== true) return;
    const deleted = await deletePrompt(msty, prompt.id);
    if (deleted) {
      await reload({ silent: true });
      pushToast({ tone: "success", message: "Prompt deleted." });
      render();
    }
  }

  async function copyPrompt(promptId) {
    const prompt = state.prompts.find((item) => item.id === promptId);
    if (!prompt) return;
    if (typeof msty.clipboard?.writeText !== "function") {
      pushToast({ tone: "warning", message: "Copy is not available here." });
      return;
    }
    const copied = await safe(() => msty.clipboard.writeText(prompt.prompt).then(() => true), false);
    pushToast({
      tone: copied ? "success" : "danger",
      message: copied ? `Copied "${prompt.name}".` : "Could not copy that prompt.",
    });
  }

  async function insertPrompt(promptId) {
    const prompt = state.prompts.find((item) => item.id === promptId);
    if (!prompt) return;
    const composer = await safe(() => msty.composer?.get?.(), { text: "", canEdit: true });
    if (composer?.canEdit === false) {
      pushToast({ tone: "warning", message: "Open a chat with an editable message box first." });
      return;
    }
    const inserted = await safe(
      () =>
        msty.composer
          .insertText({ text: prompt.prompt, mode: "insert", select: true })
          .then(() => true),
      false,
    );
    if (!inserted) {
      pushToast({ tone: "danger", message: "Could not add the prompt to your draft." });
      return;
    }
    usage = await recordPromptUsed(msty, prompt);
    await safe(
      () =>
        msty.notifications?.show?.({
          title: "Prompt added to your draft",
          body: prompt.name,
          tone: "success",
        }),
      undefined,
    );
    closeSurface({ action: "inserted", promptId: prompt.id });
  }

  function closeSurface(result) {
    if (typeof msty.surface?.close === "function") {
      msty.surface.close(result);
      return;
    }
    void safe(
      () =>
        msty.ui?.closeSurface?.({
          id: "prompt_library_view",
          kind: "fullView",
          result,
        }),
      undefined,
    );
  }

  function refocusSearch() {
    const field = appEl.querySelector('[data-action="search"]');
    if (field instanceof HTMLInputElement) {
      field.focus();
      const len = field.value.length;
      field.setSelectionRange(len, len);
    }
  }

  function pushToast({ tone, message }) {
    const id = `toast-${Date.now()}-${state.toasts.length}`;
    state.toasts = [...state.toasts, { id, tone, message }].slice(-TOAST_MAX);
    renderToasts();
    const ttl = TOAST_TTL[tone] || TOAST_TTL.warning;
    window.setTimeout(() => dismissToast(id), ttl);
  }

  function dismissToast(id) {
    state.toasts = state.toasts.filter((toast) => toast.id !== id);
    renderToasts();
  }

  function renderToasts() {
    toastEl.innerHTML = state.toasts
      .map(
        (toast) => `
          <div class="pl-toast" data-tone="${escapeHtml(toast.tone)}" role="status">
            <span class="pl-toast__icon">${toast.tone === "success" ? icon("check") : icon("alert")}</span>
            <span class="pl-toast__msg">${escapeHtml(toast.message)}</span>
            <button type="button" class="pl-toast__x" data-dismiss="${escapeHtml(toast.id)}" aria-label="Dismiss">${icon("x")}</button>
          </div>
        `,
      )
      .join("");
    toastEl.querySelectorAll("[data-dismiss]").forEach((button) => {
      button.addEventListener("click", () =>
        dismissToast(/** @type {string} */ (button.getAttribute("data-dismiss"))),
      );
    });
  }
}

function readSurfaceResult(result) {
  const record = asObject(result);
  return { actionId: text(record.actionId, ""), values: asObject(record.values) };
}

function targetClosest(scope, event) {
  let node = event.target;
  while (node && node instanceof Element && node !== scope) {
    if (node.getAttribute("data-action")) return node;
    node = node.parentElement;
  }
  return null;
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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
