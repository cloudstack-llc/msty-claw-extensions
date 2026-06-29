// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

import { taskCounts } from "./core.js";

/**
 * @param {Msty.ExtensionApi | Msty.SurfaceApi} msty
 * @param {string} message
 * @param {Record<string, unknown>} [data]
 */
export async function logInfo(msty, message, data = {}) {
  await safeDiagnostic(() =>
    msty.diagnostics?.info?.(message, compactDiagnostic(data)),
  );
}

/**
 * @param {Msty.ExtensionApi | Msty.SurfaceApi} msty
 * @param {string} message
 * @param {Record<string, unknown>} [data]
 */
export async function logWarn(msty, message, data = {}) {
  await safeDiagnostic(() =>
    msty.diagnostics?.warn?.(message, compactDiagnostic(data)),
  );
}

/**
 * @param {Msty.ExtensionApi | Msty.SurfaceApi} msty
 * @param {string} message
 * @param {Record<string, unknown>} [data]
 */
export async function logError(msty, message, data = {}) {
  await safeDiagnostic(() =>
    msty.diagnostics?.error?.(message, compactDiagnostic(data)),
  );
}

/** @param {import("./core.js").FlagTaskItem} task */
export function taskDiagnostic(task) {
  return {
    taskId: task.id,
    title: clipDiagnostic(task.title, 120),
    status: task.status,
    priority: task.priority,
    category: task.category,
    repeatCount: task.repeatCount,
    fileCount: task.files.length,
    hasSuggestedPrompt: Boolean(task.suggestedPrompt),
    suggestedPromptLength: task.suggestedPrompt.length,
    sourceChatAttached: Boolean(task.source.chatId),
    workspaceAttached: Boolean(task.source.workspacePath),
  };
}

/** @param {import("./core.js").FlagTaskItem[]} tasks */
export function countsDiagnostic(tasks) {
  const counts = taskCounts(tasks);
  return {
    totalStored: counts.total,
    pending: counts.pending,
    running: counts.running,
    failed: counts.failed,
    dismissed: counts.dismissed,
  };
}

/** @param {unknown} error */
export function errorDiagnostic(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: clipDiagnostic(error.message, 320),
      code:
        typeof /** @type {{ code?: unknown }} */ (error).code === "string"
          ? /** @type {{ code: string }} */ (error).code
          : undefined,
    };
  }
  return { message: clipDiagnostic(String(error), 320) };
}

/** @param {() => Promise<unknown> | unknown} fn */
async function safeDiagnostic(fn) {
  try {
    await fn();
  } catch {
    /* Diagnostics must never change extension behavior. */
  }
}

/** @param {Record<string, unknown>} data */
function compactDiagnostic(data) {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  );
}

/** @param {string} value @param {number} max */
function clipDiagnostic(value, max) {
  return value.length > max
    ? `${value.slice(0, Math.max(0, max - 1)).trim()}...`
    : value;
}
