// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

import {
  STORE_KEY,
  buildChromeUpdates,
  buildRunPrompt,
  categoryLabel,
  clearAllTasks,
  clearStartedTasks,
  deleteTask,
  dismissTask,
  escapeHtml,
  normalizeStoredTasks,
  priorityLabel,
  priorityTone,
  relativeTime,
  restoreTask,
  sourceLabel,
  taskChatTitle,
  taskCounts,
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
import "./view.css";

const MAX_TOASTS = 3;
const ANIM_STEP_MS = 20;
const SUMMARY_OPEN_CLAMP = 240;
const STORAGE_SYNC_MS = 1500;

/** @param {Msty.SurfaceMountContext} params */
export async function mount({ root, msty, context }) {
  const selectedTaskId = text(context?.selectedTaskId, "");

  const state = {
    tasks: normalizeStoredTasks(context.tasks),
    query: "",
    showDismissed: false,
    loading: true,
    busyIds: new Set(),
    cardNotices: new Map(),
    toasts: [],
    undo: null,
    firstRender: true,
  };

  // -- DOM roots ----------------------------------------------------------
  root.innerHTML = `<div id="flag-app"></div><div id="flag-toast" class="flag-toast-stack" aria-live="polite"></div>`;
  const appEl = root.querySelector("#flag-app");
  const toastEl = root.querySelector("#flag-toast");

  await load();
  state.loading = false;
  void logInfo(msty, "Follow-up stack mounted.", {
    selectedTaskId,
    ...countsDiagnostic(state.tasks),
  });
  render();

  const disposeSurface = subscribeToSurfaceUpdates();
  const syncTimer = window.setInterval(() => {
    void load({ renderIfChanged: true });
  }, STORAGE_SYNC_MS);
  window.addEventListener(
    "beforeunload",
    () => {
      if (typeof disposeSurface === "function") disposeSurface();
      window.clearInterval(syncTimer);
    },
    { once: true },
  );

  // -- Delegated listeners ------------------------------------------------
  root.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest("[data-action]");
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return;
    const action = button.getAttribute("data-action") || "";
    const id = button.getAttribute("data-id") || "";
    void handleAction(action, id).catch((error) => {
      void logError(msty, "Follow-up stack action failed.", {
        action,
        taskId: id,
        error: errorDiagnostic(error),
      });
      notify("Could not update follow-ups", { tone: "error" });
      render();
    });
  });

  root.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.dataset.field === "search") {
      state.query = target.value;
      render();
    }
  });

  root.addEventListener("keydown", (event) => {
    const target = event.target;
    const field = target instanceof HTMLElement ? target.dataset.field : "";
    if (event.key === "Escape" && (field === "search" || state.query)) {
      event.preventDefault();
      state.query = "";
      render();
      refocusSearch();
    }
  });

  async function handleAction(action, id) {
    switch (action) {
      case "refresh":
        await load({ renderIfChanged: true });
        notify("Up to date");
        render();
        return;
      case "toggle-dismissed":
        state.showDismissed = !state.showDismissed;
        render();
        return;
      case "clear-search":
        state.query = "";
        render();
        refocusSearch();
        return;
      case "start-newest": {
        const next = nextRunnableTask();
        if (next) await runTask(next.id);
        return;
      }
      case "start-all":
        await runAll();
        return;
      case "run":
        await runTask(id);
        return;
      case "run-foreground":
        await runTask(id, { switchTo: true });
        return;
      case "open-chat": {
        const task = findTask(id);
        if (!task?.runChatId) {
          await logWarn(
            msty,
            "Could not open follow-up chat because no chat id is stored.",
            { taskId: id },
          );
          return;
        }
        try {
          const result = await msty.chats.open(task.runChatId);
          await logInfo(msty, "Opened follow-up chat.", {
            taskId: id,
            chatId: task.runChatId,
            opened: Boolean(result?.opened),
          });
        } catch (error) {
          await logError(msty, "Could not open follow-up chat.", {
            taskId: id,
            chatId: task.runChatId,
            error: errorDiagnostic(error),
          });
        }
        return;
      }
      case "toggle-summary":
        toggleSummary(id);
        return;
      case "dismiss":
        await dismissOne(id);
        return;
      case "delete":
        await deleteOne(id);
        return;
      case "restore":
        state.undo = null;
        await restoreOne(id);
        notify("Restored to waiting");
        render();
        return;
      case "clear-started":
        await mutateStoredTasks((latest) => clearStartedTasks(latest));
        notify("Started follow-ups dismissed");
        render();
        return;
      case "clear-all":
        await clearAll();
        return;
      case "undo":
        await restoreUndo();
        return;
      case "dismiss-toast":
        dismissToast(id);
        return;
    }
  }

  // -- Task actions -------------------------------------------------------
  /** @param {string} taskId @param {{ switchTo?: boolean }} [options] */
  async function runTask(taskId, options = {}) {
    await load();
    const task = findTask(taskId);
    if (!task || state.busyIds.has(taskId)) return;
    if (task.status !== "pending" && task.status !== "failed" && task.status !== "running") return;
    const switchTo = options.switchTo === true;

    state.busyIds.add(taskId);
    showCardNotice(
      taskId,
      switchTo ? "Opening in a new chat..." : "Starting in the background...",
      { ttl: 2600 },
    );
    render();

    try {
      const prompt = buildRunPrompt(task);
      await logInfo(msty, "Starting follow-up run.", {
        ...taskDiagnostic(task),
        promptLength: prompt.length,
        switchTo,
      });
      const runPromise = msty.chats.startRun({
        title: taskChatTitle(task),
        prompt,
        switchTo,
        workspacePath: task.source.workspacePath || undefined,
      });
      await mutateStoredTasks((latest) => deleteTask(latest, taskId));
      state.cardNotices.delete(taskId);
      void trackDispatchedRun(runPromise, task, { switchTo });
    } catch (error) {
      await logError(msty, "Follow-up run failed.", {
        ...taskDiagnostic(task),
        switchTo,
        error: errorDiagnostic(error),
      });
      await mutateStoredTasks((latest) => restoreFailedTask(latest, task));
      showCardNotice(taskId, "Could not start this follow-up. Try again.", {
        tone: "error",
      });
      notify("Could not start this follow-up", { tone: "error" });
    } finally {
      state.busyIds.delete(taskId);
      render();
    }
  }

  /**
   * @param {Promise<{ chat?: { id?: string }, opened?: boolean, started?: boolean } | undefined>} runPromise
   * @param {import("./core.js").FlagTaskItem} task
   * @param {{ switchTo: boolean }} options
   */
  async function trackDispatchedRun(runPromise, task, options) {
    const taskId = task.id;
    try {
      const result = await runPromise;
      if (runStarted(result)) {
        await logInfo(msty, "Follow-up run accepted.", {
          taskId,
          chatId: result?.chat?.id,
          opened: Boolean(result?.opened),
          started: result?.started !== false,
          switchTo: options.switchTo,
        });
        return;
      }
      await logWarn(msty, "Follow-up run was not accepted by the host.", {
        taskId,
        chatId: result?.chat?.id,
        opened: Boolean(result?.opened),
        started: Boolean(result?.started),
        switchTo: options.switchTo,
      });
    } catch (error) {
      if (isTimeoutError(error)) {
        await logWarn(msty, "Follow-up run confirmation timed out after dispatch.", {
          taskId,
          switchTo: options.switchTo,
          error: errorDiagnostic(error),
        });
        return;
      }
      await logError(msty, "Follow-up run failed after dispatch.", {
        ...taskDiagnostic(task),
        switchTo: options.switchTo,
        error: errorDiagnostic(error),
      });
    }

    try {
      await mutateStoredTasks((latest) => restoreFailedTask(latest, task));
      showCardNotice(taskId, "Could not start this follow-up. Try again.", {
        tone: "error",
      });
      notify("Could not start this follow-up", { tone: "error" });
      render();
    } catch (restoreError) {
      await logError(msty, "Could not restore follow-up after dispatch failure.", {
        ...taskDiagnostic(task),
        switchTo: options.switchTo,
        error: errorDiagnostic(restoreError),
      });
    }
  }

  async function runAll() {
    await load({ renderIfChanged: true });
    const runnable = visibleTasks(
      state.tasks,
      state.showDismissed ? { onlyDismissed: true } : undefined,
    ).filter((task) => task.status === "pending" || task.status === "failed");
    if (!runnable.length) return;
    // Sequential: each starts a new chat; parallel would overwhelm the host.
    for (const task of runnable) {
      await runTask(task.id);
    }
  }

  async function dismissOne(taskId) {
    const latest = await readStoredTasks();
    const task = latest.find((entry) => entry.id === taskId) || findTask(taskId);
    if (!task) return;
    const previousStatus = task.status;
    state.undo = { type: "one", taskId, previousStatus };
    await saveTasks(dismissTask(latest, taskId));
    notify("Follow-up dismissed", { undo: true });
    render();
  }

  async function deleteOne(taskId) {
    const latest = await readStoredTasks();
    const task = latest.find((entry) => entry.id === taskId) || findTask(taskId);
    if (!task) return;
    state.undo = null;
    await saveTasks(deleteTask(latest, taskId));
    notify("Follow-up deleted");
    render();
  }

  async function restoreOne(taskId) {
    const latest = await readStoredTasks();
    if (!latest.some((task) => task.id === taskId)) return;
    await saveTasks(restoreTask(latest, taskId));
  }

  async function clearAll() {
    const latest = await readStoredTasks();
    const result = clearAllTasks(latest);
    if (!result.cleared.length) return;
    state.undo = {
      type: "many",
      items: result.cleared.map((task) => ({ id: task.id, status: task.status })),
    };
    await saveTasks(result.tasks);
    notify(`${result.cleared.length} dismissed`, { undo: true });
    render();
  }

  async function restoreUndo() {
    const undo = state.undo;
    state.undo = null;
    if (!undo) return;
    if (undo.type === "one") {
      await mutateStoredTasks((latest) =>
        latest.map((task) =>
          task.id === undo.taskId ? { ...task, status: undo.previousStatus, updatedAt: new Date().toISOString() } : task,
        ),
      );
    } else if (undo.type === "many") {
      const byId = new Map(undo.items.map((entry) => [entry.id, entry.status]));
      const now = new Date().toISOString();
      await mutateStoredTasks((latest) =>
        latest.map((task) =>
          byId.has(task.id) ? { ...task, status: byId.get(task.id), updatedAt: now } : task,
        ),
      );
    }
    notify("Undone");
    render();
  }

  function toggleSummary(taskId) {
    const card = appEl.querySelector(`[data-card="${cssEsc(taskId)}"]`);
    if (!card) return;
    const summary = card.querySelector(".flag-card__summary");
    const more = card.querySelector('[data-action="toggle-summary"]');
    if (!(summary instanceof HTMLElement)) return;
    const open = summary.classList.toggle("flag-card__summary--open");
    summary.classList.toggle("flag-card__summary", true);
    if (more instanceof HTMLElement) more.textContent = open ? "Show less" : "Show more";
  }

  // -- Persistence --------------------------------------------------------
  /** @param {{ renderIfChanged?: boolean }} [options] */
  async function load(options = {}) {
    syncTasks(await readStoredTasks(), options);
  }

  async function readStoredTasks() {
    try {
      return normalizeStoredTasks(await msty.storage.workspace.get(STORE_KEY));
    } catch (error) {
      await logWarn(msty, "Could not read stored follow-ups from the stack.", {
        error: errorDiagnostic(error),
      });
      return state.tasks;
    }
  }

  /** @param {import("./core.js").FlagTaskItem[]} tasks */
  async function saveTasks(tasks) {
    state.tasks = normalizeStoredTasks(tasks);
    if (typeof msty.storage?.workspace?.set !== "function") {
      throw new Error("Follow-ups could not be saved.");
    }
    try {
      await msty.storage.workspace.set(STORE_KEY, state.tasks);
    } catch (error) {
      await logError(msty, "Could not save follow-ups from the stack.", {
        ...countsDiagnostic(state.tasks),
        error: errorDiagnostic(error),
      });
      throw error;
    }
    for (const update of buildChromeUpdates(state.tasks)) {
      try {
        await msty.ui.update(update);
      } catch (error) {
        await logWarn(
          msty,
          "Could not update Follow-ups app chrome from the stack.",
          {
            updateId: update.id,
            surface: update.surface,
            error: errorDiagnostic(error),
          },
        );
      }
    }
  }

  /** @param {(tasks: import("./core.js").FlagTaskItem[]) => import("./core.js").FlagTaskItem[]} mutator */
  async function mutateStoredTasks(mutator) {
    const latest = await readStoredTasks();
    await saveTasks(mutator(latest));
  }

  /** @param {import("./core.js").FlagTaskItem[]} tasks @param {{ renderIfChanged?: boolean }} [options] */
  function syncTasks(tasks, options = {}) {
    const next = normalizeStoredTasks(tasks);
    if (tasksSnapshot(next) === tasksSnapshot(state.tasks)) return false;
    state.tasks = next;
    if (options.renderIfChanged) render();
    return true;
  }

  function subscribeToSurfaceUpdates() {
    if (typeof msty.surface?.on !== "function") return null;
    return msty.surface.on("surface.updated", () => {
      void load({ renderIfChanged: true });
    });
  }

  /** @param {string} id */
  function findTask(id) {
    return state.tasks.find((task) => task.id === id);
  }

  function nextRunnableTask() {
    return visibleTasks(state.tasks).find(
      (task) => task.status === "pending" || task.status === "failed",
    );
  }

  function showCardNotice(taskId, message, opts = {}) {
    if (!message) return;
    const ttl = Number(opts.ttl) > 0 ? Number(opts.ttl) : 4200;
    const tone = opts.tone || "info";
    const id = uid("card_notice");
    state.cardNotices.set(taskId, { id, message, tone });
    window.setTimeout(() => {
      const current = state.cardNotices.get(taskId);
      if (!current || current.id !== id) return;
      state.cardNotices.delete(taskId);
      render();
    }, ttl);
  }

  // -- Toasts -------------------------------------------------------------
  function notify(message, opts = {}) {
    if (!message) return;
    const tone = opts.tone || "success";
    const undo = Boolean(opts.undo);
    const toast = { id: uid("toast"), message, tone, undo };
    state.toasts = [
      ...state.toasts.filter((entry) => !sameToast(entry, toast)),
      toast,
    ].slice(-MAX_TOASTS);
    renderToasts();
    const ttl = opts.undo ? 6500 : 3600;
    window.setTimeout(() => dismissToast(toast.id), ttl);
  }

  function sameToast(left, right) {
    return (
      left.message === right.message &&
      left.tone === right.tone &&
      left.undo === right.undo
    );
  }

  function dismissToast(toastId) {
    state.toasts = state.toasts.filter((entry) => entry.id !== toastId);
    renderToasts();
  }

  function renderToasts() {
    toastEl.innerHTML = state.toasts
      .map((toast) => {
        const undo = toast.undo
          ? `<button type="button" class="flag-toast__undo" data-action="undo">${icon("restore")} Undo</button>`
          : "";
        return `
          <div class="flag-toast flag-tone--${escapeHtml(toast.tone)}" role="status">
            <span class="flag-toast__icon" aria-hidden="true">${icon(toneIcon(toast.tone))}</span>
            <span class="flag-toast__msg">${escapeHtml(toast.message)}</span>
            ${undo}
            <button type="button" class="flag-toast__x" data-action="dismiss-toast" data-id="${escapeHtml(toast.id)}" aria-label="Dismiss">${icon("x")}</button>
          </div>`;
      })
      .join("");
  }

  // -- Render -------------------------------------------------------------
  function render() {
    const view = viewModel();
    ensureAppShell();
    renderToolbar(view);
    renderResults(view);
    appEl.toggleAttribute("data-busy", state.busyIds.size > 0);

    if (state.firstRender) {
      state.firstRender = false;
      if (selectedTaskId) {
        const card = appEl.querySelector(`[data-card="${cssEsc(selectedTaskId)}"]`);
        card?.scrollIntoView({ block: "center", behavior: "auto" });
      }
    }
  }

  function viewModel() {
    const counts = taskCounts(state.tasks);
    const filtered = filterTasks(
      visibleTasks(state.tasks, state.showDismissed ? { onlyDismissed: true } : undefined),
      state.query,
    );
    const runnableCount = filtered.filter(
      (task) => task.status === "pending" || task.status === "failed",
    ).length;
    return {
      counts,
      filtered,
      runnableCount,
      hasItems: counts.total > 0,
      hasQuery: Boolean(state.query.trim()),
    };
  }

  function ensureAppShell() {
    if (appEl.querySelector(".flag")) return;
    appEl.innerHTML = `
      <div class="flag">
        <div class="flag__bar" data-region="toolbar"></div>
        <div class="flag__scroll" data-scroll></div>
      </div>
    `;
  }

  /**
   * @param {ReturnType<typeof viewModel>} view
   */
  function renderToolbar(view) {
    const toolbar = appEl.querySelector('[data-region="toolbar"]');
    if (!(toolbar instanceof HTMLElement)) return;

    if (!view.hasItems) {
      if (toolbar.dataset.mode !== "bare") {
        toolbar.dataset.mode = "bare";
        toolbar.className = "flag__bar flag__bar--bare";
        toolbar.innerHTML = `
          <span class="flag__bar-spacer"></span>
          <button type="button" class="fbtn fbtn--ghost fbtn--icon" data-action="refresh" title="Refresh" aria-label="Refresh">${icon("refresh")}</button>
        `;
      }
      return;
    }

    if (toolbar.dataset.mode !== "items") {
      toolbar.dataset.mode = "items";
      toolbar.className = "flag__bar";
      toolbar.innerHTML = `
        <div class="flag-search">
          <span class="flag-search__icon" aria-hidden="true">${icon("search")}</span>
          <input class="flag-search__input" type="search" data-field="search" value="${escapeHtml(state.query)}" placeholder="Filter follow-ups…" aria-label="Filter follow-ups" />
          <span data-region="search-tools"></span>
        </div>
        <span data-region="start-all"></span>
        <span data-region="overflow"></span>
      `;
    }

    const search = toolbar.querySelector('[data-field="search"]');
    if (search instanceof HTMLInputElement && search.value !== state.query) {
      search.value = state.query;
    }
    const searchTools = toolbar.querySelector('[data-region="search-tools"]');
    if (searchTools instanceof HTMLElement) {
      searchTools.hidden = !view.hasQuery;
      searchTools.innerHTML = view.hasQuery
        ? `<button class="flag-search__clear" type="button" data-action="clear-search" aria-label="Clear filter">${icon("x")}</button>
           <span class="flag-search__count">${view.filtered.length} result${view.filtered.length === 1 ? "" : "s"}</span>`
        : "";
    }
    const startAll = toolbar.querySelector('[data-region="start-all"]');
    if (startAll instanceof HTMLElement) {
      startAll.hidden = view.runnableCount <= 1;
      startAll.innerHTML =
        view.runnableCount > 1
          ? `<button type="button" class="fbtn fbtn--primary fbtn--sm" data-action="start-all" title="Start every runnable follow-up">${icon("sparkles")} Start all (${view.runnableCount})</button>`
          : "";
    }
    const overflow = toolbar.querySelector('[data-region="overflow"]');
    if (overflow instanceof HTMLElement) {
      overflow.innerHTML = overflowHtml({ showDismissedToggle: true, counts: view.counts });
    }
  }

  /**
   * @param {ReturnType<typeof viewModel>} view
   */
  function renderResults(view) {
    const scroll = appEl.querySelector("[data-scroll]");
    if (!(scroll instanceof HTMLElement)) return;
    scroll.innerHTML = resultsHtml(view);
  }

  /**
   * @param {ReturnType<typeof viewModel>} view
   */
  function resultsHtml(view) {
    if (state.loading) return `${skeletonHtml()}${skeletonHtml()}`;
    if (!view.hasItems) return heroHtml();
    if (view.filtered.length) {
      return `<div class="flag-list flag-list--anim">${view.filtered.map((task, index) => taskCard(task, index)).join("")}</div>`;
    }
    return emptyStateHtml();
  }

  /**
   * Compact overflow menu so the control bar stays a single non-wrapping row.
   * @param {{ showDismissedToggle?: boolean, counts?: ReturnType<typeof taskCounts> }} [options]
   */
  function overflowHtml({ showDismissedToggle = false, counts } = {}) {
    return `
      <details class="flag-menu">
        <summary class="fbtn fbtn--ghost fbtn--icon" aria-label="More actions" title="More actions">${icon("more")}</summary>
        <div class="flag-menu__list">
          ${showDismissedToggle ? `<button type="button" class="fbtn fbtn--ghost fbtn--sm" data-action="toggle-dismissed" aria-pressed="${state.showDismissed ? "true" : "false"}">${icon(state.showDismissed ? "eye-off" : "eye")} ${state.showDismissed ? "Hide dismissed" : "Show dismissed"}</button>` : ""}
          ${counts && counts.started > 0 ? `<button type="button" class="fbtn fbtn--ghost fbtn--sm" data-action="clear-started">${icon("check")} Clear started</button>` : ""}
          <button type="button" class="fbtn fbtn--ghost fbtn--sm" data-action="refresh">${icon("refresh")} Refresh</button>
          <button type="button" class="fbtn fbtn--ghost fbtn--sm" data-action="clear-all">${icon("archive")} Dismiss all</button>
        </div>
      </details>
    `;
  }

  /** @param {import("./core.js").FlagTaskItem} task @param {number} index */
  function taskCard(task, index) {
    const busy = state.busyIds.has(task.id);
    const running = task.status === "running" || busy;
    const started = task.status === "started";
    const failed = task.status === "failed";
    const dismissed = task.status === "dismissed";
    const hasStartedChat = Boolean(task.runChatId);
    const tone = priorityTone(task.priority);
    const canRun = task.status === "pending" || task.status === "failed";
    const longSummary = task.summary.length > SUMMARY_OPEN_CLAMP;
    const notice = state.cardNotices.get(task.id);
    const sending = running && notice?.tone !== "success";

    return `
      <article class="flag-card${running ? " is-running" : ""}${sending ? " is-sending" : ""}${failed ? " is-failed" : ""}${started ? " is-started" : ""}${dismissed ? " is-dismissed" : ""}"
               data-card="${escapeHtml(task.id)}"
               data-tone="${escapeHtml(tone)}"
               data-selected="${selectedTaskId === task.id ? "true" : "false"}"
               style="--flag-i:${index}">

        <div class="flag-card__head">
          <div class="flag-card__badges">
            <span class="flag-chip" data-tone="${escapeHtml(tone)}">${escapeHtml(priorityLabel(task.priority))}</span>
            <span class="flag-chip is-muted">${escapeHtml(categoryLabel(task.category))}</span>
            ${task.repeatCount > 1 ? `<span class="flag-chip is-muted">${icon("layers")} ${task.repeatCount}×</span>` : ""}
          </div>
          <div class="flag-card__head-actions">
            <span class="flag-card__time" title="Flagged ${escapeHtml(relativeTime(task.createdAt))}">${escapeHtml(relativeTime(task.createdAt))}</span>
            ${
              dismissed
                ? `<button type="button" class="fbtn fbtn--ghost fbtn--icon" data-action="restore" data-id="${escapeHtml(task.id)}" aria-label="Restore" title="Restore">${icon("restore")}</button>`
                : `<button type="button" class="fbtn fbtn--ghost fbtn--icon" data-action="dismiss" data-id="${escapeHtml(task.id)}" aria-label="Dismiss" title="Dismiss">${icon("archive")}</button>`
            }
            <button type="button" class="fbtn fbtn--ghost fbtn--icon fbtn--danger" data-action="delete" data-id="${escapeHtml(task.id)}" aria-label="Delete" title="Delete">${icon("trash")}</button>
          </div>
        </div>

        <h2>${escapeHtml(task.title)}</h2>
        ${task.summary ? `<p class="flag-card__summary">${escapeHtml(task.summary)}</p>` : ""}
        ${
          longSummary
            ? `<button type="button" class="flag-card__more" data-action="toggle-summary" data-id="${escapeHtml(task.id)}">Show more</button>`
            : ""
        }
        ${
          task.evidence
            ? `<p class="flag-card__evidence"><span class="flag-card__evidence-label">Evidence</span>${escapeHtml(task.evidence)}</p>`
            : ""
        }
        ${task.files.length ? `<div class="flag-card__files">${task.files.map((file) => `<code title="${escapeHtml(file)}">${icon("file")} ${escapeHtml(shortPath(file))}</code>`).join("")}</div>` : ""}
        ${
          notice
            ? `<div class="flag-card__notice flag-card__notice--${escapeHtml(notice.tone)}" role="status">${icon(cardNoticeIcon(notice.tone))} <span>${escapeHtml(notice.message)}</span></div>`
            : ""
        }

        <div class="flag-card__actions">
            ${
              canRun && !dismissed
                ? `<button type="button" class="fbtn fbtn--primary fbtn--sm" data-action="run" data-id="${escapeHtml(task.id)}" title="Run in the background" ${busy ? "disabled" : ""}>
                    ${running ? `<span class="flag-spin" aria-hidden="true"></span> Starting` : `${icon("play")} Run in background`}
                  </button>
                  <button type="button" class="fbtn fbtn--sm" data-action="run-foreground" data-id="${escapeHtml(task.id)}" title="Run and switch to the new chat" ${busy ? "disabled" : ""}>
                    ${icon("message-plus")} Run and open
                  </button>`
                : ""
            }
            ${
              hasStartedChat
                ? `<button type="button" class="fbtn fbtn--sm" data-action="open-chat" data-id="${escapeHtml(task.id)}">${icon("message")} Open chat</button>`
                : ""
            }
        </div>
      </article>
    `;
  }

  function heroHtml() {
    return `
      <div class="flag-hero">
        <span class="flag-hero__icon" aria-hidden="true">${icon("flag")}</span>
        <div class="flag-hero__title">No follow-ups waiting</div>
        <p class="flag-hero__body">When the assistant notices useful work outside your current request, it gets flagged here so you can start each one in a fresh chat.</p>
        <div class="flag-hero__hint">${icon("sparkles")} Flagged follow-ups appear automatically</div>
      </div>
    `;
  }

  function skeletonHtml() {
    return `<div class="flag-skeleton">${'<div class="flag-skeleton__line"></div>'.repeat(3)}</div>`;
  }

  function emptyHtml(iconName, title, body) {
    return `
      <div class="flag-empty">
        <span class="flag-empty__icon" aria-hidden="true">${icon(iconName)}</span>
        <div class="flag-empty__title">${escapeHtml(title)}</div>
        <p class="flag-empty__body">${escapeHtml(body)}</p>
      </div>
    `;
  }

  function emptyStateHtml() {
    if (state.query.trim()) {
      return emptyHtml("search", "No matches", "Nothing here matches your filter. Try different words, or clear it.");
    }
    if (state.showDismissed) {
      return emptyHtml("check-circle", "No dismissed follow-ups", "Restored follow-ups move back to the waiting list.");
    }
    return emptyHtml(
      "flag",
      "No follow-ups waiting",
      "Started and dismissed follow-ups are hidden. Use More to show dismissed items.",
    );
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
}

// ---- Pure helpers ---------------------------------------------------------

/** @param {import("./core.js").FlagTaskItem[]} tasks */
function tasksSnapshot(tasks) {
  return JSON.stringify(tasks);
}

/** @param {import("./core.js").FlagTaskItem[]} tasks @param {string} query */
function filterTasks(tasks, query) {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  const words = q.split(/\s+/).filter(Boolean);
  return tasks.filter((task) => {
    const haystack = [
      task.title,
      task.summary,
      categoryLabel(task.category),
      task.evidence,
      task.files.join(" "),
      sourceLabel(task.source),
      priorityLabel(task.priority),
    ]
      .join(" ")
      .toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/** @param {string} tone */
function toneIcon(tone) {
  if (tone === "success") return "check-circle";
  if (tone === "warning" || tone === "error") return "alert";
  return "info";
}

/** @param {import("./core.js").FlagTaskItem[]} tasks @param {import("./core.js").FlagTaskItem} task */
function restoreFailedTask(tasks, task) {
  const now = new Date().toISOString();
  return [
    { ...task, status: "failed", updatedAt: now },
    ...tasks.filter((candidate) => candidate.id !== task.id),
  ];
}

/** @param {{ chat?: { id?: string }, started?: boolean }} result */
function runStarted(result) {
  if (!result || typeof result !== "object") return true;
  return result.started !== false || Boolean(text(result.chat?.id, ""));
}

/** @param {unknown} error */
function isTimeoutError(error) {
  return Boolean(
    error &&
      typeof error === "object" &&
      /** @type {{ code?: unknown }} */ (error).code === "TIMEOUT",
  );
}

/** @param {string} tone */
function cardNoticeIcon(tone) {
  if (tone === "error") return "alert";
  return "send";
}

/** @param {string} path */
function shortPath(path) {
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return path;
  return `…/${parts.slice(-2).join("/")}`;
}

/** @param {string} value */
function cssEsc(value) {
  return window.CSS?.escape ? window.CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

/** @param {string} prefix */
function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}

/** @param {unknown} value @param {string} fallback */
function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() || fallback : fallback;
}

// ---- Icons ----------------------------------------------------------------

const ICONS = {
  flag: '<path d="M6 4.5h11l-3 4 3 4H6"/><path d="M6 3.5v17"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  jump: '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M19 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4.5"/>',
  play: '<path d="m9 6 9 6-9 6V6z"/>',
  "message-plus": '<path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.1A8 8 0 1 1 21 11.5z"/><path d="M12 8v7"/><path d="M8.5 11.5h7"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  "check-circle": '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h16.9a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  refresh: '<path d="M4.5 9a7.5 7.5 0 0 1 13-2.7L20 9"/><path d="M20 4v5h-5"/><path d="M19.5 15a7.5 7.5 0 0 1-13 2.7L4 15"/><path d="M4 20v-5h5"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 12.5a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9L18 7"/><path d="M9 7V4.5h6V7"/>',
  archive: '<path d="M21 8v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8"/><path d="M3 4h18v4H3z"/><path d="M10 12h4"/>',
  restore: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 5 5v0a5 5 0 0 1-5 5H8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sparkles: '<path d="M12 4.5c.4 2.7 1.8 4.1 4.5 4.5-2.7.4-4.1 1.8-4.5 4.5-.4-2.7-1.8-4.1-4.5-4.5 2.7-.4 4.1-1.8 4.5-4.5z"/><path d="M18 14.5c.2 1.3.9 2 2.2 2.2-1.3.2-2 .9-2.2 2.2-.2-1.3-.9-2-2.2-2.2 1.3-.2 2-.9 2.2-2.2z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  message: '<path d="M21 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-5.1A8 8 0 1 1 21 11.5z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  "eye-off": '<path d="M3 3l18 18"/><path d="M10.6 6.1A10.6 10.6 0 0 1 12 6c6.5 0 10 6 10 6a16 16 0 0 1-3 3.6"/><path d="M6.6 6.6A16 16 0 0 0 2 12s3.5 6 10 6a10.4 10.4 0 0 0 4.2-.9"/>',
  more: '<circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
};

/** @param {keyof typeof ICONS | string} name */
function icon(name) {
  const paths = ICONS[/** @type {keyof typeof ICONS} */ (name)] || ICONS.flag;
  return `<svg class="flag-ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}
