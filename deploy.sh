#!/usr/bin/env bash
# Where Is Rob At Work? — one-shot deploy (free tiers only)
#
#   ./deploy.sh                      # deploy Worker, wire its URL into js/config.js, push to GitHub
#   ./deploy.sh 'webcal://p…/published/2/…'   # …and (re)set the CALENDAR_WEBCAL_URL secret first
#
# Needs: Node.js 18+ (for npx wrangler), git. Optional: gh (GitHub CLI) to create the repo + enable Pages.
set -euo pipefail
cd "$(dirname "$0")"

REPO_NAME="where-is-rob-at-work"
CAL_URL="${1:-${CALENDAR_WEBCAL_URL:-}}"
WRANGLER="npx --yes wrangler@latest"

echo "▲ 1/5  Cloudflare login"
(cd worker && $WRANGLER whoami >/dev/null 2>&1) || (cd worker && $WRANGLER login)

if [ -n "$CAL_URL" ]; then
  echo "▲ 2/5  Setting CALENDAR_WEBCAL_URL secret"
  (cd worker && printf '%s' "$CAL_URL" | $WRANGLER secret put CALENDAR_WEBCAL_URL)
else
  echo "▲ 2/5  Keeping existing CALENDAR_WEBCAL_URL secret (pass the webcal:// link to change it)"
fi

echo "▲ 3/5  Deploying rob-flight-tracker-worker"
OUT="$(cd worker && $WRANGLER deploy 2>&1 | tee /dev/stderr)"
URL="$(grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' <<<"$OUT" | head -1 || true)"
if [ -z "$URL" ]; then echo "Could not find the workers.dev URL in the deploy output." >&2; exit 1; fi
echo "    Worker: $URL"

echo "▲ 4/5  Writing WORKER_URL into js/config.js and checking /api/status"
sed -i.bak -E "s#(WORKER_URL: )'[^']*'#\1'${URL}'#" js/config.js && rm -f js/config.js.bak
curl -fsS "$URL/api/status" | head -c 300 || echo "(status check failed — see Worker logs)"
echo

echo "▲ 5/5  Pushing to GitHub"
if [ ! -d .git ]; then git init -b main; fi
git add -A
git commit -m "Deploy: wire Worker URL $URL" >/dev/null 2>&1 || true
if ! git remote get-url origin >/dev/null 2>&1; then
  if command -v gh >/dev/null 2>&1; then
    gh repo create "$REPO_NAME" --public --source . --remote origin --push
    gh api -X POST "repos/{owner}/$REPO_NAME/pages" -f build_type=workflow >/dev/null 2>&1 || true
  else
    echo "Add a GitHub remote (git remote add origin …) and run: git push -u origin main"; exit 0
  fi
else
  git push -u origin main
fi
echo "✅ Done. GitHub Pages builds from the Deploy workflow in a minute or two."
