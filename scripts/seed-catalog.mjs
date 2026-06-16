#!/usr/bin/env node
/**
 * Push a generated catalog seed file to the sync worker admin endpoint.
 *
 * Usage:
 *   CATALOG_ADMIN_TOKEN=... node scripts/seed-catalog.mjs \
 *     --base-url https://claw-auth-dev.msty.ai \
 *     --seed catalog-seed.json
 *
 * The worker accepts up to 100 entries per request; larger seeds are chunked.
 * Re-seeding is safe: entry metadata is upserted, download/rating stats are
 * preserved for existing entries.
 *
 * After seeding, any live catalog entry that is missing from the seed file is
 * deactivated, so removing an extension from the repo unpublishes it on the
 * next run (stats are kept in case it is ever promoted again).
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const CHUNK_SIZE = 100;

function parseArgs(argv) {
  const args = { baseUrl: "", seed: "catalog-seed.json" };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--base-url":
        args.baseUrl = (value ?? "").replace(/\/+$/, "");
        i += 1;
        break;
      case "--seed":
        args.seed = value ?? args.seed;
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!args.baseUrl) throw new Error("--base-url is required (e.g. https://claw-auth-dev.msty.ai)");
  return args;
}

async function putEntries(args, token, entries) {
  const response = await fetch(`${args.baseUrl}/api/admin/extensions/catalog`, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ entries }),
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Seed request failed (${response.status}): ${body.slice(0, 500)}`);
  }
  return JSON.parse(body);
}

async function listLiveEntries(args) {
  const live = [];
  let offset = 0;
  for (;;) {
    const response = await fetch(
      `${args.baseUrl}/api/extensions/catalog?limit=${CHUNK_SIZE}&offset=${offset}`,
    );
    if (!response.ok) {
      throw new Error(`Failed to list live catalog (${response.status})`);
    }
    const result = await response.json();
    live.push(...result.entries);
    offset += result.entries.length;
    if (result.entries.length === 0 || offset >= result.total) return live;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const token = process.env.CATALOG_ADMIN_TOKEN?.trim();
  if (!token) throw new Error("CATALOG_ADMIN_TOKEN environment variable is required");

  const seedPath = path.resolve(args.seed);
  const { entries } = JSON.parse(fs.readFileSync(seedPath, "utf8"));
  if (!Array.isArray(entries)) {
    throw new Error(`No entries array found in ${seedPath}`);
  }
  if (entries.length === 0) {
    // An empty repo publishes nothing, and as a safety measure never mass-
    // deactivates a live catalog. Withdraw extensions by deleting their
    // directories while at least one other extension remains published.
    console.log("no extensions to publish; live catalog left untouched");
    return;
  }

  let saved = 0;
  for (let offset = 0; offset < entries.length; offset += CHUNK_SIZE) {
    const chunk = entries.slice(offset, offset + CHUNK_SIZE);
    const result = await putEntries(args, token, chunk);
    saved += result.total ?? chunk.length;
    console.log(`seeded ${Math.min(offset + CHUNK_SIZE, entries.length)}/${entries.length}`);
  }

  // Withdraw live entries that no longer exist in the repo. The live list only
  // returns active entries, and they validate as seed entries as-is.
  const seededIds = new Set(entries.map((entry) => entry.id));
  const removed = (await listLiveEntries(args)).filter((entry) => !seededIds.has(entry.id));
  for (let offset = 0; offset < removed.length; offset += CHUNK_SIZE) {
    const chunk = removed.slice(offset, offset + CHUNK_SIZE).map((entry) => ({
      ...entry,
      active: false,
    }));
    await putEntries(args, token, chunk);
  }
  if (removed.length > 0) {
    console.log(`deactivated removed extensions: ${removed.map((entry) => entry.slug).join(", ")}`);
  }

  console.log(`done: ${saved} entries live at ${args.baseUrl}/api/extensions/catalog`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
