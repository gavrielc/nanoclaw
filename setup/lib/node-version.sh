# node-version.sh — which Node setup accepts. Sourced by setup.sh,
# setup/install-node.sh and nanoclaw.sh; pure bash (3.2-safe) because it runs
# before Node is installed.

# The first release on each supported line with the October 21, 2026 security
# fixes (Brotli decoder RCE, TLS hostname checks). Odd lines between them are
# end-of-life and get no fix.
node_patched_minimum() {
  case "$1" in
    22) echo 22.23.4 ;;
    24) echo 24.22.1 ;;
    26) echo 26.12.1 ;;
    *) return 1 ;;
  esac
}

# node_version_status VERSION -> ok | outdated | old | unsupported
#   old          below 22 (or unreadable): install-node.sh installs Node 22 over it
#   unsupported  23, 25 or a pre-release build (nightlies get no backports):
#                refused, since installing 22 over it is a downgrade apt refuses
node_version_status() {
  local v="${1#v}" major minor patch rest min min_minor min_patch
  case "$v" in
    *[-+]*) echo unsupported; return ;;
  esac
  IFS=. read -r major minor patch rest <<<"$v"
  case "$major.$minor.$patch" in
    *[!0-9.]* | .* | *..* | *.) echo old; return ;;
  esac
  if [ "$major" -lt 22 ]; then echo old; return; fi
  if [ "$major" -gt 26 ]; then echo ok; return; fi
  if ! min="$(node_patched_minimum "$major")"; then echo unsupported; return; fi
  IFS=. read -r rest min_minor min_patch <<<"$min"
  if [ "$minor" -gt "$min_minor" ] || { [ "$minor" -eq "$min_minor" ] && [ "$patch" -ge "$min_patch" ]; }; then
    echo ok
  else
    echo outdated
  fi
}

# node_fix_hint VERSION WHERE -> one plain-English sentence on what to do.
node_fix_hint() {
  local v="${1#v}"
  if [ -z "$v" ]; then
    echo "Node isn't on PATH." \
      "Install Node 24 ($(node_patched_minimum 24) or newer) or Node 22 ($(node_patched_minimum 22) or newer), then run setup again."
  elif [ "$(node_version_status "$1")" = outdated ]; then
    echo "Node $1 ($2) is missing the October 2026 security fixes." \
      "Update it to $(node_patched_minimum "${v%%.*}") or newer, then run setup again."
  else
    echo "Node $1 ($2) does not get security fixes." \
      "Install Node 24 ($(node_patched_minimum 24) or newer) or Node 22 ($(node_patched_minimum 22) or newer), then run setup again."
  fi
}

# node_use_patched -> if the PATH node is missing or unpatched, put a patched
# one from where install-node.sh installs (uvx-nodeenv's ~/.local/bin,
# keg-only Homebrew node@22) in front. A PATH change stays in the calling shell,
# so each script that runs Node calls this. Returns 0 if the PATH node is patched.
node_use_patched() {
  local dir keg dirs=("$HOME/.local/bin")
  if command -v node >/dev/null 2>&1 && [ "$(node_version_status "$(node --version 2>/dev/null)")" = ok ]; then
    return 0
  fi
  if [ "$(uname -s)" = Darwin ] && command -v brew >/dev/null 2>&1; then
    keg="$(brew --prefix node@22 2>/dev/null || true)"
    if [ -n "$keg" ]; then dirs+=("$keg/bin"); fi
  fi
  for dir in "${dirs[@]}"; do
    if [ -x "$dir/node" ] && [ "$(node_version_status "$("$dir/node" --version 2>/dev/null)")" = ok ]; then
      export PATH="$dir:$PATH"
      hash -r 2>/dev/null || true
      return 0
    fi
  done
  return 1
}
