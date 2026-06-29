#!/usr/bin/env bash
#
# Package extensions into installable zips under extension-zips/.
# Each zip contains the extension's files at the top level (matching how
# Msty Claw loads a package), so run this whenever you change an extension's
# source before reinstalling it in the app.
#
# Usage:
#   ./package.sh                      # package every extension
#   ./package.sh living-wiki ...      # package only the named extensions
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/extensions"
OUT="$ROOT/extension-zips"

if ! command -v zip >/dev/null 2>&1; then
  echo "error: 'zip' is required but not found on PATH" >&2
  exit 1
fi

# The extension contract docs (API declaration, manifest schema, authoring
# guide, platform spec) are copied here from the msty-claw app repo. Refuse to
# package while the copies drift so stale contract docs never ship.
APP_REPO="${MSTY_CLAW_REPO:-$ROOT/../msty-claw}"
if [ -f "$APP_REPO/scripts/sync-extension-contract.mjs" ]; then
  if ! node "$APP_REPO/scripts/sync-extension-contract.mjs" --check; then
    echo "error: contract docs drifted from msty-claw; run 'node scripts/sync-extension-contract.mjs' there, commit the copies, then retry" >&2
    exit 1
  fi
else
  echo "warning: msty-claw checkout not found at $APP_REPO; skipping contract docs parity check" >&2
fi

mkdir -p "$OUT"

read_manifest_id() {
  node -e '
const fs = require("fs");
const manifestPath = process.argv[1];
try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  console.log(typeof manifest.id === "string" ? manifest.id : "");
} catch (error) {
  console.error(`error: could not read ${manifestPath}: ${error.message}`);
  process.exit(1);
}
' "$1/manifest.json"
}

names=()
if [ "$#" -gt 0 ]; then
  names=("$@")
else
  for dir in "$SRC"/*/; do
    [ -f "${dir}manifest.json" ] && names+=("$(basename "$dir")")
  done
fi

if [ "${#names[@]}" -eq 0 ]; then
  echo "no extensions found in $SRC" >&2
  exit 0
fi

count=0
for name in "${names[@]}"; do
  dir="$SRC/$name"
  if [ ! -f "$dir/manifest.json" ]; then
    echo "skip $name (no extensions/$name/manifest.json)" >&2
    continue
  fi
  zip_path="$OUT/$name.zip"
  rm -f "$zip_path"
  manifest_id="$(read_manifest_id "$dir")"
  if [[ "$manifest_id" == "ai.msty.official" || "$manifest_id" == ai.msty.official.* ]]; then
    if [ ! -f "$dir/META-INF/msty-author-certificate.json" ] || [ ! -f "$dir/META-INF/msty-signature.json" ]; then
      echo "error: official extension $name must include META-INF signature files before public packaging" >&2
      exit 1
    fi
  fi
  ( cd "$dir" && zip -rX "$zip_path" . \
      -x '.DS_Store' '*/.DS_Store' '__MACOSX*' '*.zip' 'node_modules/*' '.git/*' >/dev/null )
  echo "packaged $name -> extension-zips/$name.zip"
  count=$((count + 1))
done

echo "done: $count package(s)"
