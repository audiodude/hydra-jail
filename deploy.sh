#!/usr/bin/env bash
# Build and deploy to Cloudflare Pages (project hydra-jail), then verify that no
# source/secret files are served. Deploys ONLY dist/index.html, never the repo root.
# Needs CF_API_TOKEN (from ~/.secrets) or CLOUDFLARE_API_TOKEN.
set -euo pipefail
cd "$(dirname "$0")"

PROJECT=hydra-jail
DOMAIN=hydra-jail.audiodude.xyz
export CLOUDFLARE_ACCOUNT_ID=059181f68081f9c0fb55c5c77a969c11
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  [[ -f ~/.secrets ]] && source ~/.secrets
  export CLOUDFLARE_API_TOKEN="${CF_API_TOKEN:?set CF_API_TOKEN or CLOUDFLARE_API_TOKEN}"
fi

npm run build

# Stage a copy holding only the single built file, so nothing else can be uploaded.
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
cp dist/index.html "$stage/"

npx --yes wrangler pages deploy "$stage" --project-name "$PROJECT" --branch main --commit-dirty=true

# Content-based leak check: each path must be a 404, not real file bytes.
echo "leak check against https://$DOMAIN"
leaks=0
for p in .env .dev.vars .git/config .secrets package.json deploy.sh vite.config.js src/main.js; do
  code=$(curl -sS -o "$stage/leak" --max-time 10 -w '%{http_code}' "https://$DOMAIN/$p") || true
  head=$(head -c 60 "$stage/leak" 2>/dev/null | tr -d '\n') || true
  rm -f "$stage/leak"
  if [[ -z "$code" || "$code" == "000" ]]; then
    echo "  UNCHECKED /$p (no response)" >&2
    leaks=1
  elif [[ "$code" == "200" ]] && ! grep -qi '<!doctype html' <<<"$head"; then
    echo "  LEAK /$p ($code): $head" >&2
    leaks=1
  else
    echo "  ok /$p ($code)"
  fi
done
exit $leaks
