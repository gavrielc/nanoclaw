#!/bin/sh
# After the pull, for docs/onecli-upgrades.md: the 1.44+ conversion succeeded in
# this boot and the gateway still injects credentials. Exit 0: done; 1: not
# done; 2: could not check. Run on the gateway host, with $GW as in Detect.
set -u
: "${GW:?set GW to the gateway address, as in the Detect step}"
export ONECLI_API_HOST="$GW"
stop() { echo "STOP: $1" >&2; exit 2; }
notdone() { echo "NOT DONE: $1" >&2; exit 1; }
LIST='if type == "array" then . elif (type == "object") and ((.data | type) == "array") then .data else error("not a list") end'

# Only this boot's line: an earlier boot's result says nothing about the gateway now running.
started=$(docker inspect -f '{{.State.StartedAt}}' onecli 2>/dev/null) && [ -n "$started" ] \
  || stop "no local onecli container: run this on the gateway host"
line=$(docker logs --since "$started" onecli 2>&1 | grep '\[grant-conversion\]' | tail -1)
[ -n "$line" ] || notdone "this boot has no grant-conversion result yet: wait a few seconds, then run this again"
# A verify failure can deny every request while the line still says 0 failed.
case "$line" in *", 0 failed,"*) ;; *) notdone "the conversion did not report 0 failed: $line" ;; esac
case "$line" in *", 0 verify-failed"*) ;; *) notdone "the conversion did not report 0 verify-failed: $line" ;; esac
echo "Conversion: $line"

# One request through the gateway as an agent that holds a credential.
L=$(onecli secrets list --max 0) && S=$(printf '%s' "$L" | jq -c "[($LIST)[] | {id, host: .hostPattern, path: (.pathPattern // \"\")}]") \
  || stop "could not read the OneCLI secrets"
A=$(onecli agents list --max 0) && agents=$(printf '%s' "$A" | jq -r "($LIST)[] | \"\(.id)=\(.identifier)\"") \
  || stop "could not read the OneCLI agents"
probe=""
for row in $agents; do
  g=$(onecli agents grants list --id "${row%%=*}") || continue
  # An exact host, and its path when that is exact too: a wildcard host or path cannot be probed.
  pick=$(printf '%s' "$g" | jq -r --argjson s "$S" '[((.data // .).secrets // [])[] | .secretId as $i | $s[] | select(.id == $i and (.host | test("^[A-Za-z0-9.-]+$")))] | first // empty | "\(.host) \(if (.path | test("^/[A-Za-z0-9._~/-]*$")) then .path else "/" end)"' 2>/dev/null)
  [ -n "$pick" ] && { probe="${row#*=} $pick"; break; }
done
[ -n "$probe" ] || stop "no agent holds a credential to probe: send one message to an agent, then run this again"
set -- $probe
out=$(onecli run --agent "$1" -- curl -s --max-time 20 -w '\n%{http_code}' "https://$2$3") \
  || notdone "a request through the gateway as $1 to $2 failed"
code=$(printf '%s\n' "$out" | tail -1)
# The gateway answers for itself with a string error code; vendors use an error object.
err=$(printf '%s\n' "$out" | sed '$d' | jq -r 'if (type == "object") and ((.error | type) == "string") then .error else empty end' 2>/dev/null)
[ -z "$err" ] || notdone "the gateway answered $code $err for $2 as $1 instead of injecting its credential"
echo "OK: $2 answered $code through the gateway as $1, with its credential injected"
