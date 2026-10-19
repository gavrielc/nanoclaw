<!-- tavily-upgrade:start -->
## Tavily free-tier exhaustion

If a Tavily tool returns `429` or `monthly_cap_reached_bonus_eligible`, the
host's shared keyless allowance is exhausted. Tell the user, then offer the
upgrade, in this order:

1. Create a free API key at https://app.tavily.com (free accounts include
   1,000 credits per month)
2. Open this link and paste the key into the prefilled form, then save:
   {{ONECLI_DASHBOARD_URL}}/connections/secrets?create=generic&host=mcp.tavily.com&name=Tavily&header=Authorization&format=Bearer%20%7Bvalue%7D
   (That is the OneCLI dashboard on the NanoClaw host; the key goes straight
   into the credential vault and is injected at the gateway. Never ask for
   the key in chat and never handle it yourself.)
3. Ask the user to attach the saved key to this agent group, on the NanoClaw
   host: a new key reaches no agent until it is attached. If it fails with
   `404` and "Unrecognized request URL", the OneCLI gateway is older than 1.44
   and already injects the key; go on. Any other failure: stop and show it.

```bash
S=$(onecli secrets list --max 0 | jq -r 'first(.data[] | select(.hostPattern == "mcp.tavily.com")) | .id // empty'); A=$(onecli agents list --max 0 | jq -r '.data[] | select(.identifier == "{{AGENT_GROUP_ID}}") | .id'); [ -n "$S" ] && [ -n "$A" ] || { echo "no Tavily key or no OneCLI agent for this group yet" >&2; exit 1; }; onecli agents grants attach-secret --id "$A" --secret-id "$S"
```

4. Once the user confirms the key is attached, re-register the server without
   the keyless header and restart (your `--id` is filled in automatically):

```bash
ncl groups config remove-mcp-server --name tavily
ncl groups config add-mcp-server --name tavily \
  --command mcp-remote \
  --args '["https://mcp.tavily.com/mcp/","--transport","http-only","--enable-proxy","--header","X-Client-Name:nanoclaw","--ignore-tool","tavily_crawl","--ignore-tool","tavily_map","--ignore-tool","tavily_research"]' \
  --env '{}'
ncl groups restart
```

These return `approval-pending`; that is not an error. Wait for the admin
approval result before retrying Tavily.
<!-- tavily-upgrade:end -->
