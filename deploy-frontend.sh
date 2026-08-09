#!/usr/bin/env bash
# Syncs the frontend static files from this git checkout to the directory
# nginx actually serves, and cache-busts local script/style tags so
# Cloudflare/browsers don't keep serving a stale JS/CSS file after deploy.
#
# Run this on the server after every `git pull` that touches frontend files:
#   cd /opt/essential && git pull && ./deploy-frontend.sh
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-/var/www/essential-frontend}"
VERSION="$(cd "$SRC" && git rev-parse --short HEAD)"

cp "$SRC/index.html" "$SRC/essential.html" "$SRC/app.js" "$SRC/styles.css" "$SRC/tracking.js" "$DEST/"

# Cache-bust same-origin asset references (tracking.js, app.js, styles.css),
# stripping any previous ?v=... first so re-running this script is idempotent.
perl -pi -e "s/(src|href)=\"(tracking\.js|app\.js|styles\.css)(\?v=[a-zA-Z0-9]+)?\"/\$1=\"\$2?v=${VERSION}\"/g" \
  "$DEST/index.html"

echo "Deployed frontend at commit ${VERSION} -> ${DEST}"
