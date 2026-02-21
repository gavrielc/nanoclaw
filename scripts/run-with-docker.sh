#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="${NANOCLAW_NODE:-$(command -v node)}"
exec sg docker -c "exec $NODE $ROOT/dist/index.js"
