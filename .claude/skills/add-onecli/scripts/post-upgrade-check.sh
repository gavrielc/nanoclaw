#!/bin/sh
# After the pull, for docs/onecli-upgrades.md: the 1.44+ conversion succeeded in
# this boot. Exit 0: it did; 1: it did not, or not yet; 2: could not check. Run on
# the gateway host. That credentials still reach the vendor is checked afterwards
# by a real agent reply (the guide's Verify step): a probe request cannot show it.
set -u
stop() { echo "STOP: $1" >&2; exit 2; }
notdone() { echo "NOT DONE: $1" >&2; exit 1; }

# Only this boot's line: an earlier boot's result says nothing about the gateway now running.
started=$(docker inspect -f '{{.State.StartedAt}}' onecli 2>/dev/null) && [ -n "$started" ] \
  || stop "no local onecli container: run this on the gateway host"
line=$(docker logs --since "$started" onecli 2>&1 | grep '\[grant-conversion\]' | tail -1)
[ -n "$line" ] || notdone "this boot has no grant-conversion result yet: wait a few seconds, then run this again"
# A verify failure can deny every request while the line still says 0 failed.
case "$line" in *", 0 failed,"*) ;; *) notdone "the conversion did not report 0 failed: $line" ;; esac
case "$line" in *", 0 verify-failed"*) ;; *) notdone "the conversion did not report 0 verify-failed: $line" ;; esac
echo "Conversion: $line"
echo "OK: this boot converted with 0 failed and 0 verify-failed. Next: Verify, which ends with a real agent reply."
