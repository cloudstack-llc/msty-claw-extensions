// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

import { parseSnippets } from "./ui-helpers.js";

export const PROMPTS_KEY = "prompt_library.prompts.v1";
export const PROMPTS_META_KEY = "prompt_library.meta.v1";

const REGISTRY_URL = "https://next-assets.msty.studio/app/latest/assets/promptsRegistry.json";
const BUNDLED_REGISTRY_PATH = "static/prompts-registry.json";
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_MS = 12 * 60 * 60 * 1000;
const MAX_STARTERS = 260;
const MAX_TAGS = 8;
const STARTER_TAG = "Starters";

const FALLBACK_STARTERS = [
  {
    act: "Release note",
    prompt: "Write a concise release note for these changes. Include what changed, who benefits, and any upgrade or migration notes.",
    tags: ["Writing", "Product"],
  },
  {
    act: "PR review",
    prompt: "Review this change for bugs, regressions, missing tests, and unclear behavior. Prioritize concrete findings with file and line references.",
    tags: ["Review", "Code"],
  },
  {
    act: "Next actions",
    prompt: "Turn these notes into a clear next-action list. Group related work, call out blockers, and keep each item directly actionable.",
    tags: ["Planning", "Work"],
  },
  {
    act: "Decision brief",
    prompt: "Summarize the decision, options considered, tradeoffs, risks, and the recommended next step. Keep it crisp and easy to scan.",
    tags: ["Planning", "Decision"],
  },
];

/**
 * @param {Msty.ExtensionApi} msty
 * @param {{ forceRefresh?: boolean, autoRefresh?: boolean }} [options]
 */
export async function loadPromptLibrary(msty, options = {}) {
  const settings = await safe(() => msty.settings?.get?.(), {});
  const store = normalizeStore(await safe(() => msty.storage?.local?.get?.(PROMPTS_KEY), null));
  const meta = normalizeMeta(await safe(() => msty.storage?.local?.get?.(PROMPTS_META_KEY), null));
  let changed = false;

  if (!meta.legacyImportedAt) {
    const imported = importLegacyPrompts(store, settings);
    meta.legacyImportedAt = nowIso();
    changed = imported > 0 || changed;
  }

  let refresh = { status: "skipped", added: 0, updated: 0, total: 0, changed: false };
  const shouldRefresh =
    options.forceRefresh === true ||
    (options.autoRefresh !== false && starterRefreshDue(meta, store));

  if (shouldRefresh) {
    refresh = await refreshStarterPromptsIntoStore(msty, store, meta);
    changed = refresh.changed || changed;
  }

  if (starterSnapshotNeeded(meta, store)) {
    const bundled = await applyBundledStarterPrompts(msty, store, meta);
    if (bundled.changed) {
      refresh = bundled;
      changed = true;
    }
  }

  if (!hasStarterPrompts(store) && !store.deletedStarterIds.length) {
    const seeded = applyStarterRecords(store, starterRecordsFromRegistry(FALLBACK_STARTERS), {
      overwrite: false,
    });
    if (seeded.added > 0) {
      meta.fallbackSeededAt = meta.fallbackSeededAt || nowIso();
      changed = true;
    }
  }

  if (changed || refresh.changed) await writeAll(msty, store, meta);

  return {
    prompts: sortPrompts(store.prompts),
    meta,
    refresh,
  };
}

/** @param {Msty.ExtensionApi} msty */
export async function refreshStarterPrompts(msty) {
  const settings = await safe(() => msty.settings?.get?.(), {});
  const store = normalizeStore(await safe(() => msty.storage?.local?.get?.(PROMPTS_KEY), null));
  const meta = normalizeMeta(await safe(() => msty.storage?.local?.get?.(PROMPTS_META_KEY), null));

  if (!meta.legacyImportedAt) {
    importLegacyPrompts(store, settings);
    meta.legacyImportedAt = nowIso();
  }

  const refresh = await refreshStarterPromptsIntoStore(msty, store, meta);
  if (!hasStarterPrompts(store) && !store.deletedStarterIds.length) {
    const seeded = applyStarterRecords(store, starterRecordsFromRegistry(FALLBACK_STARTERS), {
      overwrite: false,
    });
    refresh.added += seeded.added;
    refresh.updated += seeded.updated;
    refresh.changed = refresh.changed || seeded.added > 0 || seeded.updated > 0;
    meta.fallbackSeededAt = meta.fallbackSeededAt || nowIso();
  }

  await writeAll(msty, store, meta);
  return {
    prompts: sortPrompts(store.prompts),
    meta,
    refresh,
  };
}

/**
 * @param {Msty.ExtensionApi} msty
 * @param {{ id?: string, name: string, prompt: string, tags?: string[] | string }} draft
 */
export async function savePrompt(msty, draft) {
  const store = normalizeStore(await safe(() => msty.storage?.local?.get?.(PROMPTS_KEY), null));
  const meta = normalizeMeta(await safe(() => msty.storage?.local?.get?.(PROMPTS_META_KEY), null));
  const existing = draft.id ? store.prompts.find((prompt) => prompt.id === draft.id) : null;
  const now = nowIso();
  const prompt = normalizePromptRecord({
    ...(existing || {}),
    id: existing?.id || newPromptId(),
    name: draft.name,
    prompt: draft.prompt,
    tags: normalizeTags(draft.tags),
    source: "saved",
    sourceId: existing?.sourceId || "",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });

  if (!prompt) throw new Error("Prompt needs a name and prompt text.");
  store.prompts = store.prompts.some((item) => item.id === prompt.id)
    ? store.prompts.map((item) => (item.id === prompt.id ? prompt : item))
    : [prompt, ...store.prompts];

  await writeAll(msty, store, meta);
  return prompt;
}

/**
 * @param {Msty.ExtensionApi} msty
 * @param {string} promptId
 */
export async function deletePrompt(msty, promptId) {
  const store = normalizeStore(await safe(() => msty.storage?.local?.get?.(PROMPTS_KEY), null));
  const meta = normalizeMeta(await safe(() => msty.storage?.local?.get?.(PROMPTS_META_KEY), null));
  const existing = store.prompts.find((prompt) => prompt.id === promptId);
  if (!existing) return false;
  store.prompts = store.prompts.filter((prompt) => prompt.id !== promptId);
  if (isStarterSourceId(existing.sourceId)) {
    store.deletedStarterIds = uniqueStrings([...store.deletedStarterIds, existing.sourceId]);
  }
  await writeAll(msty, store, meta);
  return true;
}

/**
 * @param {Msty.ExtensionApi} msty
 * @param {PromptRecord | { id?: string, name?: string, tags?: string[] }} prompt
 */
export async function recordPromptUsed(msty, prompt) {
  const usage = {
    lastPrompt: text(prompt?.name, "Untitled prompt"),
    lastTag: Array.isArray(prompt?.tags) ? prompt.tags[0] || "" : "",
    lastPromptId: text(prompt?.id, ""),
    updatedAt: nowIso(),
  };
  await safe(() => msty.storage?.local?.set?.("usage", usage), undefined);
  return usage;
}

/**
 * @param {PromptRecord[]} prompts
 * @param {{ query?: string, tag?: string, source?: string }} [filters]
 */
export function filterPrompts(prompts, filters = {}) {
  const query = String(filters.query || "").trim().toLowerCase();
  const tag = String(filters.tag || "").trim().toLowerCase();
  const source = String(filters.source || "").trim();
  return prompts.filter((prompt) => {
    if (source === "saved" && prompt.source === "starter") return false;
    if (source === "starter" && prompt.source !== "starter") return false;
    if (tag && !prompt.tags.some((item) => item.toLowerCase() === tag)) return false;
    if (!query) return true;
    const haystack = [prompt.name, prompt.prompt, ...prompt.tags].join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

/** @param {PromptRecord[]} prompts */
export function promptTags(prompts) {
  return uniqueStrings(prompts.flatMap((prompt) => prompt.tags)).sort((a, b) =>
    a.localeCompare(b),
  );
}

export function tagsToInput(tags) {
  return Array.isArray(tags) ? tags.join(", ") : "";
}

export function normalizeTags(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,#]/)
        .map((tag) => tag.trim());
  const tags = uniqueStrings(raw.map(titleTag).filter(Boolean)).slice(0, MAX_TAGS);
  return tags.length ? tags : ["General"];
}

/**
 * @param {Msty.ExtensionApi} msty
 * @param {ReturnType<typeof normalizeStore>} store
 * @param {ReturnType<typeof normalizeMeta>} meta
 */
async function refreshStarterPromptsIntoStore(msty, store, meta) {
  const attemptedAt = nowIso();
  meta.lastStarterAttemptAt = attemptedAt;
  const response = await fetchStarterRegistry(msty);
  if (!response.ok) {
    return applyBundledStarterPrompts(msty, store, meta, { attemptedAt });
  }

  const records = starterRecordsFromRegistry(response.items);
  const result = applyStarterRecords(store, records, { overwrite: true, pruneMissing: true });
  meta.lastStarterRefreshAt = attemptedAt;
  meta.lastStarterStatus = "ready";
  meta.lastStarterCount = records.length;
  return {
    status: "ready",
    added: result.added,
    updated: result.updated,
    total: store.prompts.length,
    changed: true,
  };
}

/** @param {Msty.ExtensionApi} msty */
async function fetchStarterRegistry(msty) {
  if (typeof msty.network?.fetch !== "function") {
    return { ok: false, reason: "unavailable", items: [] };
  }
  try {
    const response = await msty.network.fetch({
      url: REGISTRY_URL,
      responseType: "json",
      timeoutMs: 10_000,
      maxBytes: 900_000,
    });
    if (!response?.ok || !Array.isArray(response.json)) {
      return { ok: false, reason: "unavailable", items: [] };
    }
    return { ok: true, reason: "ready", items: response.json };
  } catch {
    return { ok: false, reason: "unavailable", items: [] };
  }
}

/**
 * @param {Msty.ExtensionApi} msty
 * @param {ReturnType<typeof normalizeStore>} store
 * @param {ReturnType<typeof normalizeMeta>} meta
 * @param {{ attemptedAt?: string }} [options]
 */
async function applyBundledStarterPrompts(msty, store, meta, options = {}) {
  const attemptedAt = options.attemptedAt || nowIso();
  const response = await loadBundledStarterRegistry(msty);
  if (!response.ok) {
    meta.lastStarterStatus = "unavailable";
    return {
      status: response.reason,
      added: 0,
      updated: 0,
      total: store.prompts.length,
      changed: true,
    };
  }

  const records = starterRecordsFromRegistry(response.items);
  const result = applyStarterRecords(store, records, { overwrite: true, pruneMissing: true });
  meta.lastStarterRefreshAt = attemptedAt;
  meta.lastStarterStatus = "cached";
  meta.lastStarterCount = records.length;
  return {
    status: "cached",
    added: result.added,
    updated: result.updated,
    total: store.prompts.length,
    changed: true,
  };
}

/** @param {Msty.ExtensionApi} msty */
async function loadBundledStarterRegistry(msty) {
  try {
    if (typeof msty.assets?.json === "function") {
      const json = await msty.assets.json(BUNDLED_REGISTRY_PATH);
      if (Array.isArray(json)) return { ok: true, reason: "cached", items: json };
    }
    if (typeof msty.assets?.text === "function") {
      const text = await msty.assets.text(BUNDLED_REGISTRY_PATH);
      const json = JSON.parse(text);
      if (Array.isArray(json)) return { ok: true, reason: "cached", items: json };
    }
  } catch {
    return { ok: false, reason: "unavailable", items: [] };
  }
  return { ok: false, reason: "unavailable", items: [] };
}

/**
 * @param {ReturnType<typeof normalizeStore>} store
 * @param {PromptRecord[]} records
 * @param {{ overwrite: boolean, pruneMissing?: boolean }} options
 */
function applyStarterRecords(store, records, options) {
  let added = 0;
  let updated = 0;
  const deleted = new Set(store.deletedStarterIds);
  const expectedSourceIds = new Set(records.map((record) => record.sourceId).filter(Boolean));
  const bySource = new Map(store.prompts.map((prompt) => [prompt.sourceId, prompt]));
  const byFingerprint = new Map(store.prompts.map((prompt) => [promptFingerprint(prompt), prompt]));
  const now = nowIso();

  for (const record of records.slice(0, MAX_STARTERS)) {
    if (!record.sourceId || deleted.has(record.sourceId)) continue;
    const existing = bySource.get(record.sourceId) || byFingerprint.get(promptFingerprint(record));
    if (existing) {
      if (options.overwrite && existing.source === "starter") {
        const next = {
          ...existing,
          name: record.name,
          prompt: record.prompt,
          tags: record.tags,
          source: "starter",
          sourceId: record.sourceId,
          updatedAt: now,
        };
        store.prompts = store.prompts.map((prompt) => (prompt.id === existing.id ? next : prompt));
        updated += 1;
      }
      continue;
    }
    store.prompts.push(record);
    added += 1;
  }

  if (options.pruneMissing) {
    store.prompts = store.prompts.filter(
      (prompt) => prompt.source !== "starter" || expectedSourceIds.has(prompt.sourceId),
    );
  }

  return { added, updated };
}

function importLegacyPrompts(store, settings) {
  const legacy = parseSnippets(settings?.snippets);
  let imported = 0;
  const existing = new Set(store.prompts.map(promptFingerprint));
  for (const snippet of legacy) {
    const record = normalizePromptRecord({
      id: stableId("legacy", snippet.tag, snippet.name, snippet.prompt),
      name: snippet.name,
      prompt: snippet.prompt,
      tags: normalizeTags(snippet.tag),
      source: "saved",
      sourceId: "",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    if (!record || existing.has(promptFingerprint(record))) continue;
    store.prompts.unshift(record);
    existing.add(promptFingerprint(record));
    imported += 1;
  }
  return imported;
}

function starterRefreshDue(meta, store) {
  if (!hasStarterPrompts(store)) return !recent(meta.lastStarterAttemptAt, RETRY_AFTER_MS);
  if (!meta.lastStarterRefreshAt) return !recent(meta.lastStarterAttemptAt, RETRY_AFTER_MS);
  return !recent(meta.lastStarterRefreshAt, REFRESH_AFTER_MS);
}

function starterSnapshotNeeded(meta, store) {
  return !meta.lastStarterRefreshAt && store.deletedStarterIds.length === 0 && starterPromptCount(store) < 50;
}

function hasStarterPrompts(store) {
  return store.prompts.some((prompt) => prompt.source === "starter");
}

function starterPromptCount(store) {
  return store.prompts.filter((prompt) => prompt.source === "starter").length;
}

function starterRecordsFromRegistry(items) {
  if (!Array.isArray(items)) return [];
  const now = nowIso();
  return items
    .map((item) => {
      const record = objectValue(item);
      const name = text(record.act, text(record.name, text(record.title, "")));
      const prompt = text(record.prompt, text(record.text, ""));
      const tags = normalizeTags([
        STARTER_TAG,
        ...(Array.isArray(record.tags) ? record.tags : [record.tag]),
      ]);
      const sourceId = stableId("starter", name, prompt);
      return normalizePromptRecord({
        id: sourceId,
        name,
        prompt,
        tags,
        source: "starter",
        sourceId,
        createdAt: now,
        updatedAt: now,
      });
    })
    .filter(Boolean);
}

function normalizeStore(value) {
  const record = objectValue(value);
  return {
    version: 1,
    prompts: Array.isArray(record.prompts)
      ? record.prompts.map(normalizePromptRecord).filter(Boolean)
      : [],
    deletedStarterIds: uniqueStrings(record.deletedStarterIds),
  };
}

function normalizeMeta(value) {
  const record = objectValue(value);
  return {
    version: 1,
    legacyImportedAt: text(record.legacyImportedAt, ""),
    fallbackSeededAt: text(record.fallbackSeededAt, ""),
    lastStarterAttemptAt: text(record.lastStarterAttemptAt, ""),
    lastStarterRefreshAt: text(record.lastStarterRefreshAt, ""),
    lastStarterStatus: text(record.lastStarterStatus, ""),
    lastStarterCount: nonnegative(record.lastStarterCount),
  };
}

function normalizePromptRecord(value) {
  const record = objectValue(value);
  const name = text(record.name, "");
  const prompt = text(record.prompt, "");
  if (!name || !prompt) return null;
  const source = record.source === "starter" ? "starter" : "saved";
  return {
    id: text(record.id, newPromptId()),
    name,
    prompt,
    tags: normalizeTags(record.tags),
    source,
    sourceId: text(record.sourceId, ""),
    createdAt: text(record.createdAt, nowIso()),
    updatedAt: text(record.updatedAt, nowIso()),
  };
}

function sortPrompts(prompts) {
  return [...prompts].sort((left, right) => {
    if (left.source !== right.source) return left.source === "saved" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

function promptFingerprint(prompt) {
  return `${String(prompt.name || "").trim().toLowerCase()}\u0001${String(prompt.prompt || "").trim()}`;
}

function isStarterSourceId(value) {
  return String(value || "").includes("_starter_");
}

async function writeAll(msty, store, meta) {
  await safe(() => msty.storage?.local?.set?.(PROMPTS_KEY, store), undefined);
  await safe(() => msty.storage?.local?.set?.(PROMPTS_META_KEY, meta), undefined);
}

function recent(value, durationMs) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) && Date.now() - time < durationMs;
}

function newPromptId() {
  return `pl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function stableId(kind, ...parts) {
  return `pl_${kind}_${hashString(parts.join("\u0001"))}`;
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function titleTag(value) {
  const tag = String(value || "").trim();
  if (!tag) return "";
  return tag
    .replace(/\s+/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const clean = String(value || "").trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function nonnegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function text(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function nowIso() {
  return new Date().toISOString();
}

async function safe(callback, fallback) {
  try {
    const value = await callback();
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * @typedef {object} PromptRecord
 * @property {string} id
 * @property {string} name
 * @property {string} prompt
 * @property {string[]} tags
 * @property {"saved" | "starter"} source
 * @property {string} sourceId
 * @property {string} createdAt
 * @property {string} updatedAt
 */
