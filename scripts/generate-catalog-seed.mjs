#!/usr/bin/env node
/**
 * Generate the extension catalog seed payload from extensions/<name>/manifest.json.
 *
 * Reads packaged zips from extension-zips/ (run ./package.sh first) to compute
 * sha256 + size for each entry, and emits a JSON payload matching the worker's
 * PUT /api/admin/extensions/catalog seed format.
 *
 * Usage:
 *   node scripts/generate-catalog-seed.mjs \
 *     --tag catalog-20260610 \
 *     --repo cloudstack-llc/msty-claw-extensions \
 *     --out catalog-seed.json \
 *     [--download-base https://example.com/extensions]
 *
 * sourceUrl defaults to the GitHub release asset URL for --repo/--tag.
 * Pass --download-base to host zips elsewhere (e.g. an R2 public bucket).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS_DIR = path.join(ROOT, "extensions");
const ZIPS_DIR = path.join(ROOT, "extension-zips");
const CONFIG_PATH = path.join(ROOT, "catalog-config.json");

const ICON_MIME_TYPES = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};
const MAX_ICON_BYTES = 64 * 1024;

const VIEW_CONTRIBUTION_KEYS = [
  "fullViews",
  "dialogs",
  "drawers",
  "popups",
  "workspaceItems",
  "toolboxItems",
  "titleBarItems",
  "statusBarPills",
  "emptyPillItems",
  "pulseItems",
  "messageInlineItems",
  "composerInlineItems",
];
const AUTOMATION_CONTRIBUTION_KEYS = ["tasks", "triggerProviders", "playbooks"];
const BEHAVIOR_CONTRIBUTION_KEYS = [
  "rules",
  "preSendHooks",
  "postMessageHooks",
  "chatContextProviders",
  "modelAssignments",
  "virtualModels",
  "localModels",
  "agentHarnesses",
];

function parseArgs(argv) {
  const args = { repo: "", tag: "", out: "catalog-seed.json", downloadBase: "" };
  for (let i = 2; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--repo":
        args.repo = value ?? "";
        i += 1;
        break;
      case "--tag":
        args.tag = value ?? "";
        i += 1;
        break;
      case "--out":
        args.out = value ?? args.out;
        i += 1;
        break;
      case "--download-base":
        args.downloadBase = (value ?? "").replace(/\/+$/, "");
        i += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${flag}`);
    }
  }
  if (!args.repo) throw new Error("--repo is required (e.g. cloudstack-llc/msty-claw-extensions)");
  if (!args.tag) throw new Error("--tag is required (release tag the zips are published under)");
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function loadCatalogConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { featured: [] };
  const config = readJson(CONFIG_PATH);
  return { featured: Array.isArray(config.featured) ? config.featured : [] };
}

function gitIsoDate(gitArgs) {
  try {
    const output = execFileSync("git", ["-C", ROOT, ...gitArgs], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!output) return null;
    const date = new Date(output);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  } catch {
    return null;
  }
}

function extensionDates(slug) {
  const relDir = `extensions/${slug}`;
  const publishedAt = gitIsoDate([
    "log", "--diff-filter=A", "--follow", "--format=%aI", "--reverse", "--", `${relDir}/manifest.json`,
  ])?.split("\n")[0] ?? null;
  const updatedAt = gitIsoDate(["log", "-1", "--format=%aI", "--", relDir]);
  const fallback = new Date().toISOString();
  return {
    publishedAt: publishedAt ?? updatedAt ?? fallback,
    updatedAt: updatedAt ?? publishedAt ?? fallback,
  };
}

function iconDataUrl(slug, iconRelPath) {
  if (!iconRelPath) return null;
  const iconPath = path.join(EXTENSIONS_DIR, slug, iconRelPath);
  if (!fs.existsSync(iconPath)) {
    console.warn(`warn: ${slug}: icon file not found at ${iconRelPath}, skipping icon`);
    return null;
  }
  const mime = ICON_MIME_TYPES[path.extname(iconRelPath).toLowerCase()];
  if (!mime) {
    console.warn(`warn: ${slug}: unsupported icon type ${iconRelPath}, skipping icon`);
    return null;
  }
  const bytes = fs.readFileSync(iconPath);
  if (bytes.byteLength > MAX_ICON_BYTES) {
    console.warn(`warn: ${slug}: icon larger than ${MAX_ICON_BYTES} bytes, skipping icon`);
    return null;
  }
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

function contributionCount(contributes, keys) {
  return keys.reduce((total, key) => {
    const value = contributes?.[key];
    return total + (Array.isArray(value) ? value.length : 0);
  }, 0);
}

function buildContributionSummary(manifest) {
  const contributes = manifest.contributes ?? {};
  return {
    themes: contributionCount(contributes, ["themes"]),
    commands: contributionCount(contributes, ["commands"]),
    automations: contributionCount(contributes, AUTOMATION_CONTRIBUTION_KEYS),
    views: contributionCount(contributes, VIEW_CONTRIBUTION_KEYS),
    behaviors: contributionCount(contributes, BEHAVIOR_CONTRIBUTION_KEYS),
  };
}

function permissionIds(manifest) {
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  return permissions
    .map((permission) => (typeof permission === "string" ? permission : permission?.id))
    .filter((id) => typeof id === "string" && id.length > 0);
}

function buildEntry({ slug, manifest, args, featured }) {
  const zipPath = path.join(ZIPS_DIR, `${slug}.zip`);
  if (!fs.existsSync(zipPath)) {
    throw new Error(`${slug}: missing ${path.relative(ROOT, zipPath)} — run ./package.sh first`);
  }
  const zipBytes = fs.readFileSync(zipPath);
  const assetName = `${slug}.zip`;
  const sourceUrl = args.downloadBase
    ? `${args.downloadBase}/${assetName}`
    : `https://github.com/${args.repo}/releases/download/${args.tag}/${assetName}`;
  const dates = extensionDates(slug);

  return {
    id: manifest.id,
    extensionId: manifest.id,
    slug,
    name: manifest.name,
    description: manifest.description,
    author: manifest.author?.name
      ? { name: manifest.author.name, url: manifest.author.url ?? null }
      : null,
    version: manifest.version,
    homepage: manifest.homepage ?? null,
    repository: manifest.repository ?? `https://github.com/${args.repo}`,
    supportUrl: manifest.supportUrl ?? null,
    license: manifest.license ?? null,
    iconUrl: iconDataUrl(slug, manifest.icon),
    screenshots: [],
    keywords: Array.isArray(manifest.keywords) ? manifest.keywords : [],
    categories: Array.isArray(manifest.categories) ? manifest.categories : [],
    permissions: permissionIds(manifest),
    contributionSummary: buildContributionSummary(manifest),
    trustLevel: "official",
    package: {
      kind: "github-release",
      repository: args.repo,
      tagName: args.tag,
      assetName,
      sha256: createHash("sha256").update(zipBytes).digest("hex"),
      sizeBytes: zipBytes.byteLength,
      sourceUrl,
    },
    publishedAt: dates.publishedAt,
    updatedAt: dates.updatedAt,
    featured: featured.includes(slug),
    stats: { downloadCount: 0, ratingAverage: null, ratingCount: 0 },
    active: true,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const { featured } = loadCatalogConfig();
  const slugs = fs
    .readdirSync(EXTENSIONS_DIR)
    .filter((name) => fs.existsSync(path.join(EXTENSIONS_DIR, name, "manifest.json")))
    .sort();
  if (slugs.length === 0) {
    console.warn(`warn: no extensions found in ${EXTENSIONS_DIR} — writing an empty seed`);
  }

  const entries = slugs.map((slug) => {
    const manifest = readJson(path.join(EXTENSIONS_DIR, slug, "manifest.json"));
    for (const field of ["id", "name", "version", "description"]) {
      if (typeof manifest[field] !== "string" || manifest[field].trim().length === 0) {
        throw new Error(`${slug}: manifest.${field} is required`);
      }
    }
    return buildEntry({ slug, manifest, args, featured });
  });

  const duplicateIds = entries
    .map((entry) => entry.id)
    .filter((id, index, ids) => ids.indexOf(id) !== index);
  if (duplicateIds.length > 0) {
    throw new Error(`Duplicate extension ids: ${[...new Set(duplicateIds)].join(", ")}`);
  }

  const outPath = path.resolve(ROOT, args.out);
  fs.writeFileSync(outPath, `${JSON.stringify({ entries }, null, 2)}\n`);
  console.log(`wrote ${entries.length} entries -> ${path.relative(ROOT, outPath)}`);
  const withIcons = entries.filter((entry) => entry.iconUrl).length;
  console.log(`icons: ${withIcons}/${entries.length}, featured: ${entries.filter((e) => e.featured).length}`);
}

main();
