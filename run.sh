#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/lecnote ]; then
  echo "Install the Python dependencies first; see README.md."
  exit 1
fi
if [ ! -f web/dist/index.html ]; then
  npm --prefix web run build
fi
exec .venv/bin/lecnote serve --port "${1:-8765}"
