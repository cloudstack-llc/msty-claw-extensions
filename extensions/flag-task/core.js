// @ts-check

export const STORE_KEY = "flag_task_items_v1";
export const STATUS_ID = "flag_task_status";
export const POPUP_ID = "flag_task_stack";
export const MAX_STORED_TASKS = 80;
export const MAX_VISIBLE_TASKS = 24;

const PRIORITIES = ["low", "medium", "high", "urgent"];
const CATEGORIES = [
  "bug",
  "test",
  "cleanup",
  "docs",
  "security",
  "follow_up",
  "other",
];

/**
 * @typedef {"low" | "medium" | "high" | "urgent"} FlagTaskPriority
 * @typedef {"bug" | "test" | "cleanup" | "docs" | "security" | "follow_up" | "other"} FlagTaskCategory
 * @typedef {"pending" | "running" | "started" | "failed" | "dismissed"} FlagTaskStatus
 * @typedef {{ chatId?: string, chatTitle?: string, workspacePath?: string }} FlagTaskSource
 * @typedef {{
 *   id: string,
 *   key: string,
 *   title: string,
 *   summary: string,
 *   reason: string,
 *   priority: FlagTaskPriority,
 *   category: FlagTaskCategory,
 *   evidence: string,
 *   suggestedPrompt: string,
 *   files: string[],
 *   source: FlagTaskSource,
 *   status: FlagTaskStatus,
 *   repeatCount: number,
 *   createdAt: string,
 *   updatedAt: string,
 *   startedAt?: string,
 *   runChatId?: string,
 *   runChatTitle?: string
 * }} FlagTaskItem
 */

/**
 * Turns a tool call into a stored task. The caller supplies source context so
 * tests and the runtime both use the same normalization path.
 *
 * @param {Record<string, unknown>} input
 * @param {{ id?: string, now?: string, source?: FlagTaskSource }} [options]
 * @returns {FlagTaskItem}
 */
export function normalizeTaskInput(input, options = {}) {
  const now = options.now || new Date().toISOString();
  const summary = clip(text(input.summary, ""), 1200);
  const title = clip(
    text(input.title, "") || firstSentence(summary) || "Follow-up task",
    90,
  );
  const reason = clip(text(input.reason, ""), 800);
  const evidence = clip(text(input.evidence, ""), 1200);
  const suggestedPrompt = clip(
    text(input.suggested_prompt, "") || text(input.suggestedPrompt, ""),
    2400,
  );
  const priority = normalizePriority(input.priority);
  const category = normalizeCategory(input.category);
  const source = normalizeSource(options.source);
  const files = normalizeFiles(input.files);
  const key = stableTaskKey({ title, summary, source });

  return {
    id: options.id || createTaskId(),
    key,
    title,
    summary,
    reason,
    priority,
    category,
    evidence,
    suggestedPrompt,
    files,
    source,
    status: "pending",
    repeatCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Adds a task or updates the matching open task when the assistant flags the
 * same follow-up again.
 *
 * @param {FlagTaskItem[]} tasks
 * @param {Record<string, unknown>} input
 * @param {{ id?: string, now?: string, source?: FlagTaskSource }} [options]
 * @returns {{ tasks: FlagTaskItem[], task: FlagTaskItem, created: boolean }}
 */
export function upsertTask(tasks, input, options = {}) {
  const nextTask = normalizeTaskInput(input, options);
  const existing = tasks.find(
    (task) => task.key === nextTask.key && task.status !== "dismissed",
  );
  if (!existing) {
    const next = [nextTask, ...tasks].slice(0, MAX_STORED_TASKS);
    return { tasks: next, task: nextTask, created: true };
  }

  const updated = {
    ...existing,
    summary: nextTask.summary || existing.summary,
    reason: nextTask.reason || existing.reason,
    priority: higherPriority(existing.priority, nextTask.priority),
    category: nextTask.category || existing.category,
    evidence: mergeText(existing.evidence, nextTask.evidence),
    suggestedPrompt: nextTask.suggestedPrompt || existing.suggestedPrompt,
    files: mergeFiles(existing.files, nextTask.files),
    source: { ...existing.source, ...nextTask.source },
    status: existing.status === "started" ? "pending" : existing.status,
    repeatCount: existing.repeatCount + 1,
    updatedAt: nextTask.updatedAt,
  };
  return {
    tasks: tasks.map((task) => (task.id === existing.id ? updated : task)),
    task: updated,
    created: false,
  };
}

/**
 * @param {FlagTaskItem[]} tasks
 * @param {{ showDismissed?: boolean, onlyDismissed?: boolean }} [options]
 */
export function visibleTasks(tasks, options = {}) {
  return sortTasks(
    tasks.filter((task) => {
      if (options.onlyDismissed) return task.status === "dismissed";
      return options.showDismissed ? true : task.status !== "dismissed";
    }),
  ).slice(0, MAX_VISIBLE_TASKS);
}

/** @param {FlagTaskItem[]} tasks */
export function taskCounts(tasks) {
  const counts = {
    pending: 0,
    running: 0,
    started: 0,
    failed: 0,
    dismissed: 0,
    active: 0,
    total: tasks.length,
  };
  for (const task of tasks) {
    if (task.status === "pending") counts.pending += 1;
    if (task.status === "running") counts.running += 1;
    if (task.status === "started") counts.started += 1;
    if (task.status === "failed") counts.failed += 1;
    if (task.status === "dismissed") counts.dismissed += 1;
  }
  counts.active = counts.pending + counts.running + counts.failed;
  return counts;
}

/**
 * @param {FlagTaskItem[]} tasks
 * @param {string} id
 * @param {string} now
 */
export function markTaskRunning(tasks, id, now = new Date().toISOString()) {
  return tasks.map((task) =>
    task.id === id ? { ...task, status: "running", updatedAt: now } : task,
  );
}

/**
 * @param {FlagTaskItem[]} tasks
 * @param {string} id
 * @param {{ chat?: { id?: string, title?: string }, started?: boolean }} result
 * @param {string} now
 */
export function markTaskStarted(
  tasks,
  id,
  result,
  now = new Date().toISOString(),
) {
  if (taskStarted(result)) {
    return tasks.filter((task) => task.id !== id);
  }

  return tasks.map((task) =>
    task.id === id
      ? {
          ...task,
          status: "failed",
          updatedAt: now,
        }
      : task,
  );
}

/**
 * @param {{ chat?: { id?: string, title?: string }, started?: boolean }} result
 */
function taskStarted(result) {
  return result.started !== false || Boolean(text(result.chat?.id, ""));
}

/**
 * @param {FlagTaskItem[]} tasks
 * @param {string} id
 * @param {string} now
 */
export function markTaskFailed(tasks, id, now = new Date().toISOString()) {
  return tasks.map((task) =>
    task.id === id ? { ...task, status: "failed", updatedAt: now } : task,
  );
}

/**
 * @param {FlagTaskItem[]} tasks
 * @param {string} id
 * @param {string} now
 */
export function dismissTask(tasks, id, now = new Date().toISOString()) {
  return tasks.map((task) =>
    task.id === id ? { ...task, status: "dismissed", updatedAt: now } : task,
  );
}

/**
 * @param {FlagTaskItem[]} tasks
 * @param {string} id
 * @param {string} now
 */
export function restoreTask(tasks, id, now = new Date().toISOString()) {
  return tasks.map((task) =>
    task.id === id ? { ...task, status: "pending", updatedAt: now } : task,
  );
}

/**
 * @param {FlagTaskItem[]} tasks
 * @param {string} id
 */
export function deleteTask(tasks, id) {
  return tasks.filter((task) => task.id !== id);
}

/**
 * Moves every started follow-up into the dismissed pile. Used by the
 * "Clear started" toolbar action.
 *
 * @param {FlagTaskItem[]} tasks
 * @param {string} now
 */
export function clearStartedTasks(tasks, now = new Date().toISOString()) {
  return tasks.map((task) =>
    task.status === "started" ? { ...task, status: "dismissed", updatedAt: now } : task,
  );
}

/**
 * Dismisses every non-dismissed follow-up in one sweep. Returns the cleared
 * items so the view can offer an Undo that restores the exact set.
 *
 * @param {FlagTaskItem[]} tasks
 * @param {string} now
 * @returns {{ tasks: FlagTaskItem[], cleared: FlagTaskItem[] }}
 */
export function clearAllTasks(tasks, now = new Date().toISOString()) {
  const cleared = /** @type {FlagTaskItem[]} */ (
    tasks.filter((task) => task.status !== "dismissed")
  );
  if (!cleared.length) return { tasks, cleared };
  return {
    tasks: tasks.map((task) =>
      task.status === "dismissed" ? task : { ...task, status: "dismissed", updatedAt: now },
    ),
    cleared,
  };
}

/** @param {FlagTaskItem} task */
export function buildRunPrompt(task) {
  if (task.suggestedPrompt.trim()) return task.suggestedPrompt.trim();

  const lines = [task.title];
  if (task.summary) lines.push("", task.summary);
  if (task.evidence) lines.push("", task.evidence);
  if (task.files.length) lines.push("", ...task.files.map((file) => `- ${file}`));
  return lines.join("\n");
}

/** @param {FlagTaskItem[]} tasks */
export function buildChromeUpdates(tasks) {
  const counts = taskCounts(tasks);
  const allVisible = visibleTasks(tasks, { showDismissed: true });
  const waiting = visibleTasks(tasks).filter(
    (task) =>
      task.status === "pending" ||
      task.status === "running" ||
      task.status === "failed",
  );
  const top = waiting[0] || allVisible[0] || null;
  const hasStoredItems = counts.total > 0;
  const hasWaiting = counts.active > 0;
  const tone = hasWaiting
    ? top?.priority === "urgent" || top?.priority === "high"
      ? "warning"
      : "info"
    : "default";
  const tooltip = hasWaiting
    ? `${counts.active} follow-up${counts.active === 1 ? "" : "s"} waiting`
    : counts.dismissed
      ? `${counts.dismissed} dismissed follow-up${counts.dismissed === 1 ? "" : "s"}`
      : "Review follow-ups";

  return [
    {
      id: STATUS_ID,
      surface: "statusBar",
      title: "Follow-ups",
      label: "Follow-ups",
      hidden: !hasStoredItems,
      badge: hasWaiting
        ? String(counts.active)
        : counts.dismissed
          ? String(counts.dismissed)
          : null,
      tone,
      tooltip,
    },
  ];
}

/** @param {FlagTaskItem} task */
export function taskChatTitle(task) {
  return `Follow-up: ${clip(task.title, 48)}`;
}

/** @param {FlagTaskPriority} priority */
export function priorityLabel(priority) {
  return titleCase(priority);
}

/** @param {FlagTaskCategory} category */
export function categoryLabel(category) {
  if (category === "follow_up") return "Follow-up";
  return titleCase(category);
}

/**
 * Semantic tone for a priority, so the view maps to host color tokens instead
 * of per-class color rules. Urgent collapses onto "danger".
 *
 * @param {FlagTaskPriority} priority
 * @returns {"neutral" | "warning" | "danger"}
 */
export function priorityTone(priority) {
  if (priority === "urgent") return "danger";
  if (priority === "high") return "warning";
  return "neutral";
}

/**
 * Short label for the chat a follow-up was flagged from. Empty string when
 * there is nothing useful to show, so the view can omit the chip entirely.
 *
 * @param {FlagTaskSource} source
 */
export function sourceLabel(source) {
  return text(source?.chatTitle, source?.chatId ? "Current chat" : "");
}

/**
 * Compact relative time label for an ISO timestamp.
 *
 * @param {string} iso
 */
export function relativeTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "recently";
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 8) return `${days} day${days === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString();
}

/** @param {unknown} value */
export function escapeHtml(value) {
  return text(value, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @param {unknown} value @param {string} fallback */
export function text(value, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

/**
 * @param {unknown} value
 * @returns {FlagTaskItem[]}
 */
export function normalizeStoredTasks(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((task) => task && typeof task === "object")
    .map((task) => sanitizeStoredTask(/** @type {Record<string, unknown>} */ (task)))
    .filter(Boolean);
}

/** @param {FlagTaskItem[]} tasks */
function sortTasks(tasks) {
  return [...tasks].sort((left, right) => {
    const byStatus = statusRank(left.status) - statusRank(right.status);
    if (byStatus !== 0) return byStatus;
    const byPriority = priorityRank(right.priority) - priorityRank(left.priority);
    if (byPriority !== 0) return byPriority;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

/**
 * @param {Record<string, unknown>} task
 * @returns {FlagTaskItem | null}
 */
function sanitizeStoredTask(task) {
  const id = text(task.id, "");
  const title = text(task.title, "");
  if (!id || !title) return null;
  const source = normalizeSource(
    task.source && typeof task.source === "object"
      ? /** @type {FlagTaskSource} */ (task.source)
      : {},
  );
  /** @type {FlagTaskItem} */
  const sanitized = {
    id,
    key: text(
      task.key,
      stableTaskKey({ title, summary: text(task.summary, ""), source }),
    ),
    title,
    summary: text(task.summary, ""),
    reason: text(task.reason, ""),
    priority: normalizePriority(task.priority),
    category: normalizeCategory(task.category),
    evidence: text(task.evidence, ""),
    suggestedPrompt: text(task.suggestedPrompt, ""),
    files: normalizeFiles(task.files),
    source,
    status: normalizeStatus(task.status),
    repeatCount: Math.max(1, Math.round(Number(task.repeatCount) || 1)),
    createdAt: text(task.createdAt, new Date().toISOString()),
    updatedAt: text(task.updatedAt, text(task.createdAt, new Date().toISOString())),
  };
  const startedAt = text(task.startedAt, "");
  const runChatId = text(task.runChatId, "");
  const runChatTitle = text(task.runChatTitle, "");
  if (startedAt) sanitized.startedAt = startedAt;
  if (runChatId) sanitized.runChatId = runChatId;
  if (runChatTitle) sanitized.runChatTitle = runChatTitle;
  return sanitized;
}

/** @param {unknown} value */
function normalizePriority(value) {
  const normalized = text(value, "medium").toLowerCase();
  return /** @type {FlagTaskPriority} */ (
    PRIORITIES.includes(normalized) ? normalized : "medium"
  );
}

/** @param {unknown} value */
function normalizeCategory(value) {
  const normalized = text(value, "other").toLowerCase();
  return /** @type {FlagTaskCategory} */ (
    CATEGORIES.includes(normalized) ? normalized : "other"
  );
}

/** @param {unknown} value */
function normalizeStatus(value) {
  const normalized = text(value, "pending").toLowerCase();
  if (["pending", "running", "started", "failed", "dismissed"].includes(normalized)) {
    return /** @type {FlagTaskStatus} */ (normalized);
  }
  return "pending";
}

/** @param {unknown} value */
function normalizeFiles(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => clip(text(item, ""), 240))
        .filter(Boolean),
    ),
  ).slice(0, 12);
}

/** @param {FlagTaskSource | undefined} source */
function normalizeSource(source) {
  return {
    chatId: text(source?.chatId, ""),
    chatTitle: text(source?.chatTitle, ""),
    workspacePath: text(source?.workspacePath, ""),
  };
}

/** @param {{ title: string, summary: string, source: FlagTaskSource }} task */
function stableTaskKey(task) {
  return [
    task.source.workspacePath || "",
    task.source.chatId || "",
    task.title,
    task.summary.slice(0, 160),
  ]
    .join("|")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function createTaskId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `flag_${Date.now().toString(36)}_${random}`;
}

/** @param {string} value @param {number} max */
function clip(value, max) {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trim()}...`;
}

/** @param {string} value */
function firstSentence(value) {
  return value.split(/[.!?\n]/)[0]?.trim() || "";
}

/** @param {FlagTaskPriority} left @param {FlagTaskPriority} right */
function higherPriority(left, right) {
  return priorityRank(right) > priorityRank(left) ? right : left;
}

/** @param {FlagTaskPriority} priority */
function priorityRank(priority) {
  return { low: 1, medium: 2, high: 3, urgent: 4 }[priority] || 2;
}

/** @param {FlagTaskStatus} status */
function statusRank(status) {
  return { failed: 0, running: 1, pending: 2, started: 3, dismissed: 4 }[status] || 2;
}

/** @param {string} left @param {string} right */
function mergeText(left, right) {
  if (!right) return left;
  if (!left) return right;
  return left.includes(right) ? left : clip(`${left}\n${right}`, 1200);
}

/** @param {string[]} left @param {string[]} right */
function mergeFiles(left, right) {
  return Array.from(new Set([...left, ...right])).slice(0, 12);
}

/** @param {string} value */
function titleCase(value) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
