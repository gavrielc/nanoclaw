# SwarmHook - Agent Installation Guide

**Zero-cost webhook infrastructure for autonomous AI agents**

SwarmHook provides ephemeral webhook inboxes that agents can poll, eliminating the need for permanent infrastructure.

---

## What is SwarmHook?

SwarmHook solves a critical problem: **AI agents need to receive webhooks but can't run permanent web servers.**

Instead of requiring you to:
- Run a public-facing web server
- Get a static IP address
- Pay for cloud hosting
- Manage SSL certificates

SwarmHook gives you:
- ✅ Temporary webhook URLs (24-48hr lifetime)
- ✅ Polling-based event retrieval (or real-time SSE)
- ✅ Zero cost for basic usage
- ✅ Auto-cleanup (no maintenance)

---

## Installation

### 1. Register Your Agent

```bash
curl -X POST https://swarmhook.com/api/v1/agents/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MyAgent",
    "email": "agent@example.com"
  }'
```

**Response:**
```json
{
  "id": "agent_abc123",
  "api_key": "swh_xyz789abcdef...",
  "tier": "free",
  "message": "Agent registered successfully. Store your API key securely!"
}
```

**⚠️ Important:** Save your API key (`swh_...`) securely. You'll need it to create inboxes.

---

## Usage Guide

### Step 1: Create an Inbox

```bash
curl -X POST https://swarmhook.com/api/v1/inboxes \
  -H "Content-Type: application/json" \
  -H "X-API-Key: swh_your_agent_key" \
  -d '{
    "ttl_hours": 24
  }'
```

**Response:**
```json
{
  "id": "inbox_def456",
  "webhook_url": "https://swarmhook.com/in/inbox_def456",
  "polling_url": "https://swarmhook.com/api/v1/inboxes/inbox_def456/events",
  "api_key": "iwh_inbox_specific_key...",
  "expires_at": "2026-02-08T12:00:00Z",
  "ttl_hours": 24
}
```

**What you get:**
- `webhook_url` - Give this to external services (SwarmMarket, Stripe, etc.)
- `polling_url` - Use this to retrieve events
- `api_key` - Inbox-specific key for polling (different from agent key!)

---

### Step 2: Register Webhook URL

Give your inbox's `webhook_url` to the service you want to receive webhooks from:

**Example: SwarmMarket**
```bash
curl -X POST https://api.swarmmarket.io/api/v1/agents/me/webhooks \
  -H "X-API-Key: your_swarmmarket_key" \
  -d '{
    "url": "https://swarmhook.com/in/inbox_def456",
    "events": ["transaction.*", "offer.*"]
  }'
```

**Example: Stripe**
```bash
stripe webhooks create \
  --url https://swarmhook.com/in/inbox_def456 \
  --events payment_intent.succeeded,charge.failed
```

---

### Step 3: Poll for Events

**Basic Polling:**
```bash
curl https://swarmhook.com/api/v1/inboxes/inbox_def456/events \
  -H "X-API-Key: iwh_inbox_specific_key"
```

**Long Polling (Recommended):**
```bash
curl "https://swarmhook.com/api/v1/inboxes/inbox_def456/events?wait=60&unread=true&mark_read=true" \
  -H "X-API-Key: iwh_inbox_specific_key"
```

Query Parameters:
- `wait=60` - Wait up to 60 seconds for new events (long polling)
- `unread=true` - Only return unread events
- `mark_read=true` - Mark returned events as read
- `since=2026-02-07T10:00:00Z` - Events after this timestamp
- `limit=50` - Max events to return

**Response:**
```json
{
  "events": [
    {
      "id": "evt_abc123",
      "received_at": "2026-02-07T12:34:56Z",
      "source_ip": "54.123.45.67",
      "headers": {
        "content-type": "application/json",
        "x-webhook-signature": "sha256=..."
      },
      "body": {
        "event": "transaction.completed",
        "transaction_id": "tx_123",
        "amount": 10.00
      },
      "read": false
    }
  ],
  "unread_count": 1,
  "total_count": 1
}
```

---

## Code Examples

### Python

```python
import requests
import time

# 1. Register agent (one-time)
response = requests.post('https://swarmhook.com/api/v1/agents/register', json={
    'name': 'MyPythonAgent',
    'email': 'agent@example.com'
})
AGENT_API_KEY = response.json()['api_key']

# 2. Create inbox
inbox = requests.post(
    'https://swarmhook.com/api/v1/inboxes',
    headers={'X-API-Key': AGENT_API_KEY},
    json={'ttl_hours': 24}
).json()

print(f"Webhook URL: {inbox['webhook_url']}")
print(f"Register this URL with your webhook provider!")

# 3. Poll for events (long polling)
while True:
    response = requests.get(
        f"{inbox['polling_url']}?wait=60&unread=true&mark_read=true",
        headers={'X-API-Key': inbox['api_key']}
    )

    data = response.json()
    for event in data['events']:
        print(f"Received webhook: {event['body']}")
        # Process the webhook
        handle_webhook(event)
```

### JavaScript/TypeScript

```typescript
// 1. Register agent (one-time)
const registration = await fetch('https://swarmhook.com/api/v1/agents/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'MyJSAgent',
    email: 'agent@example.com'
  })
}).then(r => r.json())

const AGENT_API_KEY = registration.api_key

// 2. Create inbox
const inbox = await fetch('https://swarmhook.com/api/v1/inboxes', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': AGENT_API_KEY
  },
  body: JSON.stringify({ ttl_hours: 24 })
}).then(r => r.json())

console.log(`Webhook URL: ${inbox.webhook_url}`)

// 3. Poll for events (long polling)
while (true) {
  const response = await fetch(
    `${inbox.polling_url}?wait=60&unread=true&mark_read=true`,
    { headers: { 'X-API-Key': inbox.api_key } }
  )

  const { events } = await response.json()

  for (const event of events) {
    console.log('Received webhook:', event.body)
    await handleWebhook(event)
  }
}
```

### Bash/cURL Loop

```bash
#!/bin/bash

AGENT_KEY="swh_your_agent_key"
INBOX_KEY="iwh_your_inbox_key"
INBOX_ID="inbox_abc123"

# Poll forever with long polling
while true; do
  curl -s "https://swarmhook.com/api/v1/inboxes/$INBOX_ID/events?wait=60&unread=true&mark_read=true" \
    -H "X-API-Key: $INBOX_KEY" | jq '.events[] | .body'
done
```

---

## Real-Time Streaming (SSE)

For real-time updates without polling, use Server-Sent Events:

```javascript
const eventSource = new EventSource(
  `https://swarmhook.com/api/v1/inboxes/${inbox.id}/stream`,
  {
    headers: { 'X-API-Key': inbox.api_key }
  }
)

eventSource.addEventListener('webhook', (event) => {
  const data = JSON.parse(event.data)
  console.log('New webhook:', data)
  handleWebhook(data)
})

eventSource.addEventListener('keepalive', (event) => {
  console.log('Connection alive')
})
```

---

## Best Practices

### Security
- ✅ Store API keys in environment variables (not in code)
- ✅ Use inbox API key (`iwh_...`) for polling (not agent key)
- ✅ Verify webhook signatures if the source provides them
- ✅ Delete inboxes when no longer needed

### Performance
- ✅ Use long polling (`?wait=60`) instead of rapid polling
- ✅ Mark events as read (`?mark_read=true`) to avoid duplicates
- ✅ Use `?unread=true` to only get new events
- ✅ Consider SSE streaming for truly real-time needs

### Reliability
- ✅ Create new inbox before old one expires (overlap period)
- ✅ Update webhook URL with external service when switching inboxes
- ✅ Monitor inbox expiration time
- ✅ Handle network errors gracefully (retry with backoff)

---

## Limits & Quotas

### Free Tier
- **Max concurrent inboxes:** 5
- **Max events per inbox:** 100
- **Max inbox lifetime:** 48 hours
- **Rate limit:** 60 requests/minute per inbox

### Premium Tier (Coming Soon)
- **Max concurrent inboxes:** Unlimited
- **Max events per inbox:** 10,000
- **Max inbox lifetime:** 7 days
- **Rate limit:** 600 requests/minute

---

## Troubleshooting

### Problem: "Invalid API key"
**Solution:** Make sure you're using the right key:
- `swh_...` for creating inboxes (agent key)
- `iwh_...` for polling events (inbox key)

### Problem: "Inbox not found or expired"
**Solution:** Inboxes expire after their TTL. Create a new one.

### Problem: "Free tier limit: Maximum 5 concurrent inboxes"
**Solution:** Delete old inboxes or wait for them to expire.

### Problem: No events showing up
**Solution:**
1. Verify your webhook URL is correct
2. Check that the external service is sending webhooks
3. Try `GET /in/{inbox_id}` to verify inbox is active

### Problem: Events are marked as read but I didn't process them
**Solution:** Don't use `mark_read=true` until you've successfully processed events.

---

## API Reference

### Register Agent
```http
POST /api/v1/agents/register
Content-Type: application/json

{
  "name": "MyAgent",
  "email": "agent@example.com"
}

→ Returns: { "api_key": "swh_...", ... }
```

### Create Inbox
```http
POST /api/v1/inboxes
X-API-Key: swh_your_agent_key
Content-Type: application/json

{
  "ttl_hours": 24
}

→ Returns: { "webhook_url": "...", "api_key": "iwh_...", ... }
```

### Poll Events
```http
GET /api/v1/inboxes/{id}/events?wait=60&unread=true&mark_read=true
X-API-Key: iwh_your_inbox_key

→ Returns: { "events": [...], "unread_count": 0 }
```

### Stream Events (SSE)
```http
GET /api/v1/inboxes/{id}/stream
X-API-Key: iwh_your_inbox_key

→ Returns: Server-Sent Events stream
```

### Get Profile
```http
GET /api/v1/agents/me
X-API-Key: swh_your_agent_key

→ Returns: { "stats": {...}, "limits": {...} }
```

---

## Support

- **Documentation:** https://github.com/swarmmarket/swarmhook
- **Issues:** https://github.com/swarmmarket/swarmhook/issues
- **Security:** security@swarmmarket.io

---

## License

MIT License - Free to use in any project.

---

Built with ❤️ for the autonomous agent economy 🤖
