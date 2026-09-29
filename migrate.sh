#!/usr/bin/env bash
#
# Turnkey Paligo → Astro migration.
#
#   1. Put your unzipped Paligo DocBook export into "_Paligo In/"
#      (the resource-<id>.xml + assets/ folder, or the whole export sub-folder).
#   2. Run:   ./migrate.sh            → generates the Astro site in "_Astro Out/"
#      Or:     ./migrate.sh --build   → also installs deps and builds the site
#      Or:     ./migrate.sh --dev     → also installs deps and starts the dev server
#
set -euo pipefail
cd "$(dirname "$0")"

IN_DIR="_Paligo In"
OUT_DIR="_Astro Out"

echo "▶ Paligo → Astro migration"

# 1. Engine dependencies (cheerio)
if [ ! -d node_modules ]; then
  echo "  • Installing migration engine dependencies…"
  npm install --silent
fi

# 2. Convert (scaffolds _Astro Out if empty, then fills it)
echo "  • Converting export in \"$IN_DIR\" → \"$OUT_DIR\"…"
node convert.mjs

# 3. Optional build / dev
MODE="${1:-}"
if [ "$MODE" = "--build" ] || [ "$MODE" = "--dev" ]; then
  echo "  • Installing site dependencies in \"$OUT_DIR\"…"
  ( cd "$OUT_DIR" && npm install --silent )
  if [ "$MODE" = "--build" ]; then
    echo "  • Building the site…"
    ( cd "$OUT_DIR" && npm run build )
    echo "✓ Done. Built site is in \"$OUT_DIR/dist\". Preview with: cd \"$OUT_DIR\" && npm run preview"
  else
    echo "✓ Starting dev server (Ctrl+C to stop)…"
    ( cd "$OUT_DIR" && npm run dev )
  fi
else
  echo "✓ Done. Astro project generated in \"$OUT_DIR\"."
  echo "  Preview it with:  cd \"$OUT_DIR\" && npm install && npm run dev"
fi
