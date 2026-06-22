// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

import {
  filterPrompts,
  loadPromptLibrary,
  recordPromptUsed,
  refreshStarterPrompts,
} from "./prompt-store.js";
import { escapeHtml, promptPreview } from "./ui-helpers.js";
import "./ui.css";

const ICONS = {
  alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  copy: '<rect width="13" height="13" x="9" y="9" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-15.3 6.4L3 16"/><path d="M3 21v-5h5"/><path d="M3 12A9 9 0 0 1 18.3 5.6L21 8"/><path d="M21 3v5h-5"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  send: '<path d="m9 10-5 5 5 5"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/>',
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
    notice: "",
    tone: "default",
    busy: false,
  };

  root.innerHTML = `<div class="pl-picker" id="pl-picker"></div>`;
  const appEl = /** @type {HTMLElement} */ (root.querySelector("#pl-picker"));
  if (!state.prompts.length) await reload({ autoRefresh: true });
  render();

  appEl.addEventListener("click", (event) => {
    const target = targetClosest(appEl, event);
    if (!target || target.hasAttribute("disabled")) return;
    const action = target.getAttribute("data-action") || "";
    const id = target.getAttribute("data-id") || "";
    if (action === "insert") return void insertPrompt(id);
    if (action === "copy") return void copyPrompt(id);
    if (action === "manage") return void openManager();
    if (action === "clear-search") return clearSearch();
    if (action === "refresh-starters") return void refreshStarters();
  });

  appEl.addEventListener("input", (event) => {
    const field = event.target instanceof Element ? event.target.closest('[data-action="search"]') : null;
    if (field instanceof HTMLInputElement) {
      const selection = searchSelection(field);
      state.query = field.value;
      render();
      refocusSearch(selection);
    }
  });

  function render() {
    const filtered = filterPrompts(state.prompts, { query: state.query }).slice(0, 24);
    appEl.innerHTML = `
      <div class="pl-picker__top">
        <div class="pl-search pl-search--picker">
          <span class="pl-search__icon">${icon("search")}</span>
          <input
            class="pl-search__input"
            type="search"
            data-action="search"
            value="${escapeHtml(state.query)}"
            placeholder="Search prompts"
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
        <button type="button" class="pl-icon-btn" data-action="manage" aria-label="Open Prompt Library" title="Open Prompt Library">
          ${icon("plus")}
        </button>
      </div>

      ${
        state.notice
          ? `<div class="pl-picker__notice" data-tone="${escapeHtml(state.tone)}">${escapeHtml(state.notice)}</div>`
          : ""
      }

      <section class="pl-pick-list" aria-label="Choose a prompt">
        ${filtered.length ? filtered.map((prompt) => promptRow(prompt)).join("") : emptyState()}
      </section>
    `;
  }

  function promptRow(prompt) {
    const preview = promptPreview(prompt.prompt) || "No prompt text.";
    const tags = prompt.tags.slice(0, 3).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
    return `
      <article class="pl-pick-row">
        <button type="button" class="pl-pick-row__body" data-action="insert" data-id="${escapeHtml(prompt.id)}">
          <span class="pl-pick-row__name">${escapeHtml(prompt.name)}</span>
          <span class="pl-pick-row__preview">${escapeHtml(preview)}</span>
          <span class="pl-pick-row__tags">${tags}</span>
        </button>
        <button type="button" class="pl-icon-btn" data-action="copy" data-id="${escapeHtml(prompt.id)}" aria-label="Copy ${escapeHtml(prompt.name)}" title="Copy prompt">
          ${icon("copy")}
        </button>
      </article>
    `;
  }

  function emptyState() {
    const isSearch = Boolean(state.query);
    return `
      <div class="pl-picker-empty">
        <span class="pl-picker-empty__icon">${isSearch ? icon("search") : icon("alert")}</span>
        <strong>${isSearch ? "No matching prompts" : "No prompts yet"}</strong>
        <span>${isSearch ? "Try another search." : "Create your own prompt or load the starter prompts."}</span>
        <div class="pl-picker-empty__actions">
          ${
            isSearch
              ? `<button type="button" class="pl-btn pl-btn--ghost" data-action="clear-search">Clear search</button>`
              : `<button type="button" class="pl-btn" data-action="manage">${icon("plus")} New prompt</button>
                 <button type="button" class="pl-btn pl-btn--ghost" data-action="refresh-starters" ${state.busy ? "disabled" : ""}>${icon("refresh")} Load starters</button>`
          }
        </div>
      </div>
    `;
  }

  async function reload(options = {}) {
    const snapshot = await loadPromptLibrary(msty, { autoRefresh: options.autoRefresh === true });
    state.prompts = snapshot.prompts;
  }

  async function refreshStarters() {
    state.busy = true;
    render();
    const snapshot = await refreshStarterPrompts(msty);
    state.prompts = snapshot.prompts;
    state.busy = false;
    const unavailable = snapshot.refresh.status === "unavailable";
    state.notice = unavailable
      ? "Using the prompts saved on this device."
      : "Starter prompts loaded.";
    state.tone = unavailable ? "warning" : "success";
    render();
  }

  async function insertPrompt(promptId) {
    const prompt = state.prompts.find((item) => item.id === promptId);
    if (!prompt) return;
    const composer = await safe(() => msty.composer?.get?.(), { text: "", canEdit: true });
    if (composer?.canEdit === false) {
      state.notice = "Open a chat with an editable message box first.";
      state.tone = "warning";
      render();
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
      state.notice = "Could not add the prompt to your draft.";
      state.tone = "warning";
      render();
      return;
    }
    await recordPromptUsed(msty, prompt);
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

  async function copyPrompt(promptId) {
    const prompt = state.prompts.find((item) => item.id === promptId);
    if (!prompt) return;
    if (typeof msty.clipboard?.writeText !== "function") {
      state.notice = "Copy is not available here.";
      state.tone = "warning";
      render();
      return;
    }
    const copied = await safe(() => msty.clipboard.writeText(prompt.prompt).then(() => true), false);
    state.notice = copied ? `Copied "${prompt.name}".` : "Could not copy that prompt.";
    state.tone = copied ? "success" : "warning";
    render();
  }

  async function openManager() {
    void safe(
      () =>
        typeof msty.ui?.openContribution === "function"
          ? msty.ui.openContribution({
              id: "prompt_library_view",
              kind: "fullView",
              title: "Prompt Library",
              width: "wide",
              context: { prompts: state.prompts },
            })
          : msty.ui?.openFullView?.({
              id: "prompt_library_view",
              title: "Prompt Library",
              entry: "ui.js",
              width: "wide",
              context: { prompts: state.prompts },
            }),
      undefined,
    );
    closeSurface({ action: "manage" });
  }

  function closeSurface(result) {
    if (typeof msty.surface?.close === "function") {
      msty.surface.close(result);
      return;
    }
    void safe(
      () =>
        msty.ui?.closeSurface?.({
          id: "prompt_library_picker",
          kind: "popup",
          result,
        }),
      undefined,
    );
  }

  function clearSearch() {
    state.query = "";
    render();
    refocusSearch({ start: 0, end: 0 });
  }

  function refocusSearch(selection) {
    const field = appEl.querySelector('[data-action="search"]');
    if (field instanceof HTMLInputElement) {
      field.focus();
      const fallback = field.value.length;
      const start = selection?.start ?? fallback;
      const end = selection?.end ?? start;
      field.setSelectionRange(start, end);
    }
  }
}

function searchSelection(field) {
  const fallback = field.value.length;
  return {
    start: field.selectionStart ?? fallback,
    end: field.selectionEnd ?? field.selectionStart ?? fallback,
  };
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
