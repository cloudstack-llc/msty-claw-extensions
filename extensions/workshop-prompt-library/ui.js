// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

import {
  escapeHtml,
  formatWhen,
  parseSnippets,
  promptPreview,
} from "./ui-helpers.js";
import "./ui.css";

/** @param {Msty.SurfaceMountContext} params */
export async function mount({ root, msty, context }) {
  const state = {
    selectedTag: "",
    notice: "",
  };
  const settings = await safe(() => msty.settings.get(), {});
  // Prefer the prompts the entry passed in; fall back to reading settings directly
  // so the view still works if it is opened without that context.
  const contextSnippets = Array.isArray(context.snippets) ? context.snippets : [];
  const snippets = contextSnippets.length ? contextSnippets : parseSnippets(settings.snippets);
  const activeTag = text(settings.activeTag, text(context.activeTag, ""));
  let usage = asObject(await safe(() => msty.storage.local.get("usage"), {}));
  let composerText = text((await safe(() => msty.composer.get(), { text: "" })).text, "");
  const iconUrl = await safe(() => msty.assets.url("static/icon.svg"), "");
  // The entry counts how often the library is opened; surface it only on repeat visits.
  const opens = Number(context.opens || 0);
  const opensLabel = opens > 1 ? `Opened ${opens} times` : "";
  state.selectedTag = activeTag;

  render();

  function render() {
    const tags = Array.from(
      new Set(snippets.map((snippet) => snippet.tag).filter(Boolean)),
    ).sort((left, right) => left.localeCompare(right));
    const filtered = state.selectedTag
      ? snippets.filter(
          (snippet) => snippet.tag.toLowerCase() === state.selectedTag.toLowerCase(),
        )
      : snippets;
    const emptyMessage = () =>
      snippets.length
        ? "No prompts use this tag. Pick another tag, or add one in Settings > Extensions > Prompt Library."
        : "No prompts yet. Add some in Settings > Extensions > Prompt Library, one per line as: tag :: name :: prompt.";
    root.innerHTML = `
      <main class="prompt-library">
        <header class="hero">
          <div class="identity">
            ${iconUrl ? `<img src="${escapeHtml(iconUrl)}" alt="" />` : ""}
            <div>
              <p>Prompt Library</p>
              <h1>${escapeHtml(state.selectedTag ? `${state.selectedTag} prompts` : "All prompts")}</h1>
            </div>
          </div>
          <div class="metrics" aria-label="Prompt library overview">
            <span>${snippets.length} ${snippets.length === 1 ? "prompt" : "prompts"}</span>
            ${opensLabel ? `<span>${escapeHtml(opensLabel)}</span>` : ""}
            <span>${composerText ? "Draft started" : "Empty draft"}</span>
          </div>
        </header>

        <section class="toolbar" aria-label="Prompt tags">
          <button type="button" data-tag="" class="${state.selectedTag ? "" : "active"}">All</button>
          ${tags.map((tag) => `
            <button type="button" data-tag="${escapeHtml(tag)}" class="${tag === state.selectedTag ? "active" : ""}">
              ${escapeHtml(tag)}
            </button>
          `).join("")}
        </section>

        ${state.notice ? `<p class="notice">${escapeHtml(state.notice)}</p>` : ""}

        <section class="grid" aria-label="Prompts">
          ${
            filtered.length
              ? filtered.map((snippet, index) => snippetCard(snippet, index)).join("")
              : `<div class="empty">${escapeHtml(emptyMessage())}</div>`
          }
        </section>

        <aside class="history" aria-label="Last inserted prompt">
          <span>Last inserted</span>
          <strong>${escapeHtml(text(usage.lastPrompt, "Nothing yet"))}</strong>
          ${formatWhen(usage.updatedAt) ? `<small>${escapeHtml(formatWhen(usage.updatedAt))}</small>` : ""}
        </aside>
      </main>
    `;

    root.querySelectorAll("[data-tag]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedTag = button.getAttribute("data-tag") || "";
        state.notice = "";
        render();
      });
    });

    root.querySelectorAll("[data-prompt-index]").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.getAttribute("data-prompt-index"));
        const snippet = filtered[index];
        if (!snippet) return;
        void usePrompt(snippet);
      });
    });
  }

  async function usePrompt(snippet) {
    const inserted = await safe(
      () =>
        msty.composer
          .insertText({ text: snippet.prompt, mode: "insert", select: true })
          .then(() => true),
      false,
    );
    if (!inserted) {
      state.notice = "Could not add the prompt. Open a chat with an editable message box, then try again.";
      render();
      return;
    }
    usage = {
      lastPrompt: snippet.name,
      lastTag: snippet.tag,
      updatedAt: new Date().toISOString(),
    };
    await safe(() => msty.storage.local.patch("usage", usage));
    await safe(() =>
      msty.diagnostics.info("Prompt inserted", {
        name: snippet.name,
        tag: snippet.tag,
      }),
    );
    await safe(() =>
      msty.notifications.show({
        title: "Prompt added to your draft",
        body: snippet.name,
        tone: "success",
      }),
    );
    composerText = snippet.prompt;
    state.notice = `"${snippet.name}" was added to your draft.`;
    render();
  }
}

function snippetCard(snippet, index) {
  const preview = promptPreview(snippet.prompt) || "No prompt text.";
  return `
    <article>
      <div class="tag">${escapeHtml(snippet.tag || "general")}</div>
      <h2>${escapeHtml(snippet.name || "Untitled")}</h2>
      <p>${escapeHtml(preview)}</p>
      <button type="button" data-prompt-index="${index}">Use prompt</button>
    </article>
  `;
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

// Guards stored values that should be plain objects. Storage can return any
// JSON shape (or undefined), so coerce anything unexpected to an empty object.
function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
