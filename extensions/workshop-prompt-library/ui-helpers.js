// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

export function parseSnippets(value) {
  return String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [tag = "general", name = "Untitled", ...promptParts] = line
        .split("::")
        .map((part) => part.trim());
      return {
        tag: tag || "general",
        name: name || "Untitled",
        prompt: promptParts.join(" :: ") || line,
      };
    });
}

export function promptPreview(value) {
  const prompt = String(value || "").replace(/\s+/g, " ").trim();
  return prompt.length > 180 ? `${prompt.slice(0, 177)}...` : prompt;
}

// Formats an ISO timestamp for display. Returns an empty string for missing or
// invalid input so callers can omit the line entirely.
export function formatWhen(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
