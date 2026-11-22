#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

usage() {
  cat <<'EOF'
Merchant Reality Engine launcher

Usage:
  ./start.sh             Start the interactive web app at http://localhost:5173
  ./start.sh prototype   Run the Python model checks and open its dashboard
  ./start.sh selftest    Run the TypeScript engine self-test
  ./start.sh samples     Export the sample data files
  ./start.sh --help      Show this help
EOF
}

ensure_node() {
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    echo "Error: Node.js and npm are required. Install Node.js 22.13 or later, then try again." >&2
    exit 1
  fi

  # node:sqlite works without a flag from 22.13.
  if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)'; then
    echo "Error: Node.js 22.13 or later is required (found $(node --version))." >&2
    exit 1
  fi

  if [[ ! -x node_modules/.bin/vite ]]; then
    echo "Dependencies are missing; installing from package-lock.json..."
    npm ci --cache "${TMPDIR:-/tmp}/merchant-reality-engine-npm-cache"
  fi
}

case "${1:-web}" in
  web|--web)
    ensure_node
    # An old server left running on this port would silently answer for the new code.
    if ! node -e 'const s = require("node:net").createServer().once("error", () => process.exit(1)).listen(8787, "127.0.0.1", () => s.close(() => process.exit(0)))'; then
      echo "Error: something is already running on port 8787 (often an older copy of MRE). Find it with: lsof -nP -iTCP:8787 -sTCP:LISTEN" >&2
      exit 1
    fi
    echo "Starting the investigation API at http://127.0.0.1:8787"
    node --import tsx backend/src/server.ts &
    API_PID=$!
    trap 'kill "$API_PID" 2>/dev/null || true' EXIT
    echo "Starting Merchant Reality Engine at http://localhost:5173"
    npm run dev -- --host 127.0.0.1
    ;;
  prototype)
    python3 prototype/run.py
    DASHBOARD="$PROJECT_DIR/prototype/out/dashboard.html"
    echo "Prototype dashboard generated: $DASHBOARD"
    if command -v open >/dev/null 2>&1; then
      open "$DASHBOARD"
    else
      echo "Open that file in a browser to view the offline dashboard."
    fi
    ;;
  selftest|samples)
    ensure_node
    exec npm run "$1"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown option: $1" >&2
    usage >&2
    exit 2
    ;;
esac
