#!/usr/bin/env bash
# Upload images to the image host (R2 bucket hydra-jail-img, served at
# https://img.hydra-jail.audiodude.xyz/img/) so s0.initImage('<name>') can load them.
# Usage: scripts/cp-image.sh [-l|--letterbox] FILE...
#   Each goes to img/<basename of FILE>, overwriting.
#   -l, --letterbox  pad each image with black bars to 16:9 (top/bottom if too wide, sides if
#                    too tall; centred, no scaling) before uploading. Needs ImageMagick 7 (`magick`).
# Needs CF_API_TOKEN (from ~/.secrets) or CLOUDFLARE_API_TOKEN.
set -euo pipefail

BUCKET=hydra-jail-img
PREFIX=img
URL_BASE=https://img.hydra-jail.audiodude.xyz/img

usage() { echo "usage: $0 [-l|--letterbox] FILE..." >&2; exit 1; }

letterbox=0
files=()
for arg in "$@"; do
  case "$arg" in
    -l|--letterbox) letterbox=1 ;;
    -*) usage ;;
    *) files+=("$arg") ;;
  esac
done
[[ ${#files[@]} -gt 0 ]] || usage
for f in "${files[@]}"; do
  [[ -f "$f" ]] || { echo "not a file: $f" >&2; exit 1; }
done
if (( letterbox )); then
  command -v magick >/dev/null || { echo "--letterbox needs ImageMagick 7 (magick)" >&2; exit 1; }
fi

export CLOUDFLARE_ACCOUNT_ID=059181f68081f9c0fb55c5c77a969c11
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  [[ -f ~/.secrets ]] && source ~/.secrets
  export CLOUDFLARE_API_TOKEN="${CF_API_TOKEN:?set CF_API_TOKEN or CLOUDFLARE_API_TOKEN}"
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for f in "${files[@]}"; do
  name=$(basename "$f")
  src=$f
  if (( letterbox )); then
    # -auto-orient first so EXIF-rotated photos are measured and padded the way they display.
    read -r w h < <(magick "$f" -auto-orient -format '%w %h\n' info: | head -1)
    if (( w * 9 >= h * 16 )); then
      W=$w; H=$(( (w * 9 + 15) / 16 ))   # too wide (or exact): bars top and bottom
    else
      H=$h; W=$(( (h * 16 + 8) / 9 ))    # too tall: bars left and right
    fi
    src="$tmp/$name"
    magick "$f" -auto-orient -background black -alpha remove -gravity center -extent "${W}x${H}" +repage "$src"
    echo "$name: ${w}x${h} -> ${W}x${H}"
  fi
  # no-cache: browsers revalidate (cheap 304 via ETag) on every load, so a re-upload shows up at once.
  npx --yes wrangler r2 object put "$BUCKET/$PREFIX/$name" --file "$src" --cache-control no-cache --remote
  echo "$URL_BASE/$name  ->  s0.initImage('$name')"
done
