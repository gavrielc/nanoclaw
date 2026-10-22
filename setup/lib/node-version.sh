# node-version.sh — the lowest Node setup accepts on each supported line.
# Sourced by setup.sh and setup/install-node.sh; pure bash, since it runs
# before Node is installed.
NODE_MINIMUMS="22.23.4 24.22.1 26.12.1"

# node_meets_minimum VERSION: a listed line at or above its minimum, or a
# newer release line. Pre-releases never qualify: nightlies get no backports.
node_meets_minimum() {
  local v="${1#v}" re='^[0-9]+\.[0-9]+\.[0-9]+$' major minor patch min min_minor min_patch newest="${NODE_MINIMUMS##* }"
  [[ $v =~ $re ]] || return 1
  IFS=. read -r major minor patch <<<"$v"
  [ "$major" -gt "${newest%%.*}" ] && return 0
  for min in $NODE_MINIMUMS; do
    [ "${min%%.*}" = "$major" ] || continue
    IFS=. read -r _ min_minor min_patch <<<"$min"
    [ "$minor" -gt "$min_minor" ] || { [ "$minor" -eq "$min_minor" ] && [ "$patch" -ge "$min_patch" ]; }
    return
  done
  return 1
}

# node_install_line VERSION: the NodeSource line install-node.sh installs. A
# listed line stays on its line and anything older gets 22; 23, 25 and
# pre-releases fail, since installing 22 over them is a downgrade apt refuses.
node_install_line() {
  local v="${1#v}" re='^[0-9]+\.[0-9]+\.[0-9]+$' min
  [[ $v =~ $re ]] || return 1
  for min in $NODE_MINIMUMS; do
    [ "${min%%.*}" = "${v%%.*}" ] && { echo "${v%%.*}"; return; }
  done
  [ "${v%%.*}" -lt 22 ] && { echo 22; return; }
  return 1
}

node_minimum_message() {
  echo "Node $1 at $2 does not meet the minimum (${NODE_MINIMUMS// / / })."
}
