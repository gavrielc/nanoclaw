#!/bin/sh
# Run by tool skills before they ask for or save a key: they attach the key with
# OneCLI agent grants. On a gateway without grants (before 1.44) a saved key
# reaches every agent; an agent still in `all` mode means the 1.44+ conversion
# has not finished and would receive it too. Prints the gateway version and
# exits 0 when the pinned gateway, every agent converted and a CLI with grants
# are in place; exits 1 otherwise. Reads only. Usage: check-grants-gateway.sh /<skill>
set -u
skill="${1:-this skill}"
# $2 = cli when the CLI, not the gateway, is what needs upgrading.
no() {
  if [ "${2:-}" = cli ]; then need="the pinned onecli CLI, 2.11.0: see \"The CLI binary\" in docs/onecli-upgrades.md"
  else need="the pinned OneCLI gateway, 1.45: see docs/onecli-upgrades.md"; fi
  echo "$1. Nothing was written to OneCLI. $skill needs $need." >&2; exit 1
}
U=$(onecli config get api-host 2>/dev/null | jq -r '.value // empty') && [ -n "$U" ] \
  || no "could not read the onecli CLI's api-host, so the OneCLI gateway cannot be checked"
H=$(curl -fsS --max-time 10 "$U/api/health" 2>/dev/null) || no "could not reach the OneCLI gateway at $U"
V=$(printf '%s' "$H" | jq -er '.version' 2>/dev/null) || V=
case "$V" in
  1.45.[0-9] | 1.45.[0-9][0-9]*) ;;
  1.44.*) no "the OneCLI gateway at $U is $V: it has agent grants but is not the pinned 1.45" ;;
  0.* | 1.[0-9].* | 1.[1-3][0-9].* | 1.4[0-3].*) no "the OneCLI gateway at $U is $V, older than 1.44 and has no agent grants" ;;
  *) no "the OneCLI gateway at $U reports version '${V:-unreadable}', newer than the pinned 1.45 or unknown" ;;
esac
AG=$(onecli agents list --max 0) || no "could not list OneCLI agents at $U"
N=$(printf '%s' "$AG" | jq -er '[(if type == "array" then . else .data end)[] | select(.secretMode == "all")] | length') \
  || no "could not read the OneCLI agent list at $U"
[ "$N" = 0 ] || no "$N OneCLI agent(s) at $U are still in all mode: the gateway's grant conversion has not finished (run docs/onecli-upgrades.md's post-upgrade check)"
onecli agents grants --help >/dev/null 2>&1 \
  || no "the onecli CLI has no 'agents grants' command (it needs CLI 2.9 or later)" cli
echo "$V"
