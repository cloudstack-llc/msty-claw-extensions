// @ts-check
/// <reference path="../msty-extension-api.d.ts" />

// Msty Claw loads this module directly from the extension ZIP.

// Two additive tools backed by the public Hacker News (Algolia) API. Nothing is
// overridden; both tools appear under their own names and are discoverable.

const SEARCH_URL = "https://hn.algolia.com/api/v1/search";

/** @param {Msty.ExtensionApi} msty */
export async function activate(msty) {
  return {
    async run(command, input = {}) {
      if (command === "hn.search") return search(msty, input);
      if (command === "hn.top") return topStories(msty, input);
      return undefined;
    },
    dispose() {},
  };
}

async function search(msty, input) {
  const query = String(input.query || "").trim();
  if (!query) return { content: "Provide a search query.", isError: true };
  const limit = clampLimit(input.limit, 10);
  const response = await msty.network.fetch({
    url: `${SEARCH_URL}?query=${encodeURIComponent(query)}&hitsPerPage=${limit}`,
    responseType: "json",
  });
  if (!response.ok) return { content: `Hacker News search failed (${response.status}).`, isError: true };
  const hits = Array.isArray(response.json?.hits) ? response.json.hits : [];
  if (hits.length === 0) return { content: `No Hacker News results for "${query}".` };
  return { content: hits.slice(0, limit).map(formatHit).join("\n") };
}

async function topStories(msty, input) {
  const limit = clampLimit(input.limit, 10);
  const response = await msty.network.fetch({
    url: `${SEARCH_URL}?tags=front_page&hitsPerPage=${limit}`,
    responseType: "json",
  });
  if (!response.ok) return { content: `Could not load front page (${response.status}).`, isError: true };
  const hits = Array.isArray(response.json?.hits) ? response.json.hits : [];
  return { content: hits.slice(0, limit).map(formatHit).join("\n") };
}

function formatHit(hit) {
  const title = hit.title || hit.story_title || "(untitled)";
  const points = Number.isFinite(hit.points) ? `${hit.points} points` : "discussion";
  const link = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
  const author = hit.author ? ` by ${hit.author}` : "";
  return `- ${title} (${points}${author})\n  ${link}`;
}

function clampLimit(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(20, Math.max(1, Math.round(n)));
}
