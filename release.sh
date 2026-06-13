#!/usr/bin/env bash
# One-click release wrapper (mac/Linux). Reuses build-desktop.sh for env/dep checks.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
if ! command -v node >/dev/null 2>&1; then
  echo "[FAIL] node not found on PATH. Install Node.js 18+ first." >&2
  exit 127
fi
exec node "$DIR/release.mjs" "$@"
