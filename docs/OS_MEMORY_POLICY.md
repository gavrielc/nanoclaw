# NanoClaw OS — Memory Policy v1.1.0

> Defines how agent memories are classified, stored, recalled, and protected.

---

## Memory Classification Levels

| Level | Name | Visibility | Example |
|-------|------|-----------|---------|
| **L0** | Public | All groups, all products | API docs, public guidelines |
| **L1** | Operational | Owner group + main | Implementation notes, internal patterns |
| **L2** | Product-internal | Same-product groups + main | Product roadmaps, architecture decisions |
| **L3** | Sensitive | Main only, audit-logged | PII, credentials, security findings |

### Auto-classification rules (priority order)

1. PII detected → **L3** (mandatory, cannot downgrade)
2. Scope = PRODUCT → **L2** minimum
3. Default → **L1**
4. Explicit level is respected only if ≥ auto-classified level (never downgrade)

---

## PII Detection & Sanitization

All memory content is scanned before storage. Detected PII is replaced with redaction markers. The original content hash (SHA-256) is stored for verification.

### Detected patterns

| Type | Pattern | Replacement |
|------|---------|-------------|
| JWT | `eyJ...` (3-part base64) | `[JWT_REDACTED]` |
| API Key | `sk-`, `ghp_`, `gho_`, `ghs_`, `ghr_`, `github_pat_` | `[API_KEY_REDACTED]` |
| AWS Key | `AKIA` + 16 chars | `[AWS_KEY_REDACTED]` |
| Bearer Token | `Bearer` + 20+ chars | `Bearer [TOKEN_REDACTED]` |
| Generic Secret | `password=`, `secret=`, `token=`, `api_key=` | `[SECRET_REDACTED]` |
| Email | Standard email format | `[EMAIL_REDACTED]` |
| Credit Card | 16 digits (with optional separators) | `[CC_REDACTED]` |
| Phone | US phone numbers | `[PHONE_REDACTED]` |
| IP Address | IPv4 addresses | `[IP_REDACTED]` |
| SSN | `XXX-XX-XXXX` format | `[SSN_REDACTED]` |

**Key guarantee:** Raw PII is never stored in the `memories` table. Only sanitized content is persisted.

---

## Product Isolation

Memories with `scope=PRODUCT` enforce product isolation:

- Accessor must belong to the same `product_id` to see L1+ memories
- Cross-product access is limited to L0 (public) only
- Main group bypasses product isolation (sees all levels)

---

## Access Control Matrix

| Memory Level | Owner Group | Same-Product Group | Other Group | Main |
|-------------|-------------|-------------------|-------------|------|
| L0 | Read | Read | Read | Read |
| L1 | Read | — | — | Read |
| L2 | Read | Read (same product) | — | Read |
| L3 | — | — | — | Read |

All L3 access attempts (granted or denied) are logged to `memory_access_log`.

---

## Prompt Injection Safeguards

Memory content is scanned for prompt injection patterns:

- Role markers (`<|system|>`, `[INST]`, `<<SYS>>`)
- Instruction overrides ("ignore previous instructions")
- XML tag injection (`<system>`, `<prompt>`)
- Identity manipulation ("you are now")
- Tool/output manipulation

Suspicious content is:
1. Flagged with risk score (0.0–1.0)
2. Wrapped in `<user_memory>` tags with escaped internal XML
3. Still stored (for forensics), but injection metadata is recorded

---

## Model Escalation Policy

Task complexity determines the recommended model tier:

| Condition | Recommended Tier |
|-----------|-----------------|
| P0 priority, SECURITY/INCIDENT type | `deep` |
| L3 memories involved | `deep` |
| High risk level | `standard` minimum |
| RESEARCH or EPIC type | `standard` |
| Default | `fast` |

Auto-escalation on failure: `fast` → `standard` → `deep` (based on retry count).

---

## Embedding Configuration (Hybrid Architecture)

Semantic search via embeddings is optional. Set `EMBEDDING_API_KEY` to enable.

- **L0-L2**: Embedded via OpenAI `text-embedding-3-small` (1536 dims) when `EMBEDDING_API_KEY` is set
- **L3**: **Never embedded** — keyword search only. L3 content never leaves the host, not even in vectorized form
- When `EMBEDDING_API_KEY` is not set: keyword-based search (SQL LIKE) for all levels

This hybrid approach ensures high-quality semantic search for 95% of the corpus while maintaining the L3 security invariant: sensitive content never exits the host boundary.

---

## Data Retention

- Memories persist indefinitely by default
- Backup includes `memories` and `memory_access_log` tables
- L3 audit logs are append-only and must not be purged without explicit approval

---

## MCP Tools

Agents interact with memory via two tools:

- **`store_memory`** — Store knowledge with optional classification, tags, and scope
- **`recall_memory`** — Search memories with keyword query, filtered by access control

Both tools use the IPC request/response pattern (atomic file write + poll).
