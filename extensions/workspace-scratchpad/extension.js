// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

// Msty Claw loads this module directly from the extension ZIP.
//
// Workspace Scratchpad adds four assistant-callable tools (save, list, read,
// delete) backed by a single "notes" array in this extension's workspace
// storage. Because the store is workspace-scoped, each workspace keeps its own
// notes and they persist across turns and app restarts. Notes are not synced
// across devices.
//
// The store holds plain JSON, so every value that crosses the model -> tool
// boundary is coerced to the expected type before use, and timestamps are kept
// as ISO strings so they round-trip cleanly through JSON.

/** Storage key holding the array of saved notes for the active workspace. */
const KEY = "notes";

/**
 * Reject note bodies past this size. Workspace storage is meant for short
 * scratch notes, not large documents, so we fail clearly instead of silently
 * bloating storage or hitting the host's per-value quota.
 */
const MAX_BODY_LENGTH = 100_000;

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  const store = msty.storage.workspace;

  return {
    /**
     * @param {string} command
     * @param {Record<string, unknown>} [input] Arguments from the model call.
     */
    async run(command, input = {}) {
      const notes = await readNotes(store);
      switch (command) {
        case "scratchpad.save": {
          // Coerce across the JSON boundary: the model can send any type, so we
          // normalize to trimmed strings and reject anything empty.
          const title = String(input.title ?? "").trim();
          const body = String(input.body ?? "").trim();
          if (!title || !body) return { content: "A note needs a title and a body.", isError: true };
          if (body.length > MAX_BODY_LENGTH) {
            return { content: `Note is too long. Keep the body under ${MAX_BODY_LENGTH.toLocaleString()} characters.`, isError: true };
          }
          const note = { id: newId(), title, body, createdAt: new Date().toISOString() };
          await store.set(KEY, [...notes, note]);
          return { content: `Saved note "${title}" (id: ${note.id}).` };
        }
        case "scratchpad.list": {
          // The model passes no arguments for this command.
          if (notes.length === 0) return { content: "No notes saved for this workspace yet." };
          return { content: notes.map((n) => `- ${n.id}: ${n.title} (saved ${formatDate(n.createdAt)})`).join("\n") };
        }
        case "scratchpad.get": {
          const id = String(input.id ?? "");
          const note = notes.find((n) => n.id === id);
          if (!note) return { content: `No note found with id ${id || "(missing)"}.`, isError: true };
          return { content: `# ${note.title}\n\n_Saved ${formatDate(note.createdAt)}_\n\n${note.body}` };
        }
        case "scratchpad.delete": {
          const id = String(input.id ?? "");
          const next = notes.filter((n) => n.id !== id);
          if (next.length === notes.length) return { content: `No note found with id ${id || "(missing)"}.`, isError: true };
          await store.set(KEY, next);
          return { content: `Deleted note ${id}.` };
        }
        default:
          // Not one of this extension's commands; let the host route it elsewhere.
          return undefined;
      }
    },
    dispose() {
      // No subscriptions or host registrations to clean up: the tools are
      // declared statically in the manifest and storage needs no teardown.
    },
  };
}

/**
 * Reads the saved notes, tolerating a missing or malformed stored value.
 * @param {Msty.StorageArea} store
 * @returns {Promise<Array<{ id: string, title: string, body: string, createdAt?: string }>>}
 */
async function readNotes(store) {
  try {
    const value = await store.get(KEY);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** Formats an ISO timestamp as a short local date, falling back when absent. */
function formatDate(iso) {
  if (typeof iso !== "string" || !iso) return "unknown date";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "unknown date" : date.toLocaleDateString();
}

/** Generates a short, unique-enough id for a note. */
function newId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}
