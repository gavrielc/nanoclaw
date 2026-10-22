#!/usr/bin/env bash
# Setup helper: install-node — bundles Node 22 install into one idempotent
# script so /new-setup can run it without needing `curl | sudo -E bash -` in
# the allowlist (that pattern is inherently unmatchable — bash reads from
# stdin, so pre-approval can't inspect what's being executed).
#
# The script itself is the allowlisted unit; the pipes and sudo live inside
# it. Pure bash by design — runs before Node exists on the host.
set -euo pipefail

# shellcheck source=setup/lib/node-version.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/node-version.sh"

echo "=== NANOCLAW SETUP: INSTALL_NODE ==="

# nodesource replaces the system nodejs, so an unpatched supported line is
# upgraded on its own line; anything older gets Node 22.
NODE_LINE=22
if command -v node >/dev/null 2>&1; then
  CURRENT="$(node --version)"
  case "$(node_version_status "$CURRENT")" in
    ok)
      echo "STATUS: already-installed"
      echo "NODE_VERSION: $CURRENT"
      echo "=== END ==="
      exit 0
      ;;
    unsupported)
      echo "STATUS: failed"
      echo "ERROR: $(node_fix_hint "$CURRENT" "$(command -v node)")"
      echo "=== END ==="
      exit 1
      ;;
    outdated)
      NODE_LINE="${CURRENT#v}"
      NODE_LINE="${NODE_LINE%%.*}"
      ;;
  esac
  echo "STEP: upgrade-node"
fi

if command -v uvx >/dev/null 2>&1; then
  echo "STEP: uvx-nodeenv"
  uvx nodeenv --force -n lts ~/node
  mkdir -p ~/.local/bin
  ln -sf ~/node/bin/node ~/.local/bin/node
  ln -sf ~/node/bin/npm ~/.local/bin/npm
  ln -sf ~/node/bin/npx ~/.local/bin/npx
  ln -sf ~/node/bin/pnpm ~/.local/bin/pnpm
  export PATH="$HOME/.local/bin:$PATH"
else
  case "$(uname -s)" in
    Darwin)
      echo "STEP: brew-install-node"
      if ! command -v brew >/dev/null 2>&1; then
        echo "STATUS: failed"
        echo "ERROR: Homebrew not installed. Install brew first (https://brew.sh) then re-run."
        echo "=== END ==="
        exit 1
      fi
      # Keg-only, so it never replaces another Node; node_use_patched finds it.
      brew install node@22
      export PATH="$(brew --prefix node@22)/bin:$PATH"
      ;;
    Linux)
      echo "STEP: nodesource-setup"
      curl -fsSL "https://deb.nodesource.com/setup_${NODE_LINE}.x" | sudo -E /bin/bash -
      echo "STEP: apt-install-nodejs"
      sudo apt-get install -y nodejs
      ;;
    *)
      echo "STATUS: failed"
      echo "ERROR: Unsupported platform: $(uname -s)"
      echo "=== END ==="
      exit 1
      ;;
  esac
fi

if ! command -v node >/dev/null 2>&1; then
  echo "STATUS: failed"
  echo "ERROR: node not found on PATH after install"
  echo "=== END ==="
  exit 1
fi

# The PATH node decides: the install can land behind another Node (nvm), or
# the package mirror can lag the security release.
INSTALLED="$(node --version)"
if [ "$(node_version_status "$INSTALLED")" != ok ]; then
  echo "STATUS: failed"
  echo "ERROR: $(node_fix_hint "$INSTALLED" "$(command -v node)")"
  echo "=== END ==="
  exit 1
fi

echo "STATUS: installed"
echo "NODE_VERSION: $INSTALLED"
echo "=== END ==="
