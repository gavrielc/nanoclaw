# Sprint 2 Acceptance — Context + Product Scoping

**Sprint:** 2 — Context + Product Scoping
**Branch:** `feat/multiproduct-os-s1`
**Commit:** `5a2fc89`
**Date:** 2026-02-15
**Status:** ACCEPTED

---

## Outcomes Delivered

### A. Context Pack (cross-agent cognitive continuity)
- `buildContextPack(task)` generates structured context with 5 sections:
  Product Context, Task Metadata, Execution Summary, Evidence, Activity Log
- Injected into approval prompts via `buildApprovalPrompt()`
- Reviewer Contract pattern: approve / block / rework

### B. Strict Review Summary
- `GOV_STRICT=1` requires non-empty `reason` for DOING→REVIEW transitions
- Deny reason: `MISSING_REVIEW_SUMMARY`
- `execution_summary` activity logged for cross-agent context retrieval
- Backward compatible: non-strict mode accepts empty reason

### C. Broker Product Scoping
- PRODUCT-scoped tasks require `product_id` on capability match
- Deny reasons: `PRODUCT_SCOPE_REQUIRES_PRODUCT_ID`, `CAPABILITY_PRODUCT_MISMATCH`
- Main group override: company-wide capabilities allowed for PRODUCT tasks
- `product_id` and `scope` stored on `ext_calls` audit records

### D. DB Migrations
- `ext_capabilities`: additive `scope`, `product_id` columns
- `ext_calls`: additive `product_id`, `scope` columns
- `gov-db`: `getGovActivitiesForContext()`, `getGovTaskExecutionSummary()`

---

## Test Coverage

```
 Test Files  13 passed (13)
      Tests  379 passed (379)
   Start at  20:33:48
   Duration  4.08s
```

Sprint 2 added **39 new tests** (340 → 379):
- 10 tests: gov-db context helpers
- 6 tests: ext-broker-db product_id/scope migrations
- 7 tests: gov-ipc strict review summary
- 8 tests: gov-loop Context Pack
- 8 tests: ext-broker product scoping

---

## Mini-Run Evidence

Script: `scripts/sprint2-evidence.ts`

### Evidence A: Execution Summary (DOING→REVIEW)
```
Stored summary: "Implemented retry with exponential backoff (base 2s,
  max 5 retries). Unit tests cover all edge cases including partial
  refunds. No secrets in code path."
Summary matches: YES
```

### Evidence B: Context Pack (approval prompt)
```
## Product Context
- Name: ACME SaaS
- Status: active
- Risk Level: high

## Task Metadata
- ID: task-sprint2-evidence
- Title: Implement payment retry logic
- Type: Feature | Priority: P1
- Scope: PRODUCT

## Execution Summary
Implemented retry with exponential backoff (base 2s, max 5 retries).
Unit tests cover all edge cases including partial refunds.

## Activity Log (recent)
- developer: DOING → REVIEW — Implemented retry with exponential backoff...

Contains product context: YES
Contains task metadata: YES
Contains execution summary: YES
Contains activity log: YES
```

### Evidence C: ext_call Product Scoping
```
request_id: ext-evidence-001
product_id: prod-acme
scope: PRODUCT
product_id stored: YES
scope stored: YES
```

**ALL CHECKS: PASS**

---

## Residual Risks (accepted, not blocking)

| ID | Risk | Mitigation (future sprint) |
|----|------|---------------------------|
| R1 | Main override has no explicit limits | Add audit event + rate limit in Sprint 2.1 |
| R2 | Execution summary could contain secrets | Regex sanitization in Sprint 2.1 |
| R3 | Evidence parsing needs safe truncation | Prompt size guard in Sprint 2.1 |

---

## Files Changed

```
 src/ext-broker-db.test.ts   |  60 +++
 src/ext-broker-db.ts        |  35 ++-
 src/ext-broker.test.ts      | 181 +++++++++-
 src/ext-broker.ts           |  44 ++-
 src/gov-db.ts               | 179 ++++++++-
 src/gov-ipc.test.ts         | 451 ++++++++++++++++++++++-
 src/gov-ipc.ts              |  78 ++++-
 src/gov-loop.test.ts        | 220 ++++++++++++
 src/gov-loop.ts             | 162 +++++++--
 src/governance/constants.ts |  21 ++
 10 files changed, 1400 insertions(+), 31 deletions(-)
```

---

**Accepted by:** PMO + Architect + Security review
**Sprint 2 is formally closed.**
