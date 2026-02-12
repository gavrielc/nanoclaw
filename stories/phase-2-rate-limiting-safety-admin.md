# Phase 2: Rate Limiting, Safety, Admin & Karyakarta Hierarchy

**Goal**: Production-ready bot with abuse prevention, content safety, admin group integration, karyakarta validation layer, area model, and MLA escalation.

**Deliverable**: Bot enforces daily message limits, detects spam, handles abusive users gracefully. New complaints auto-posted to admin WhatsApp group. Admins can update complaint status from the group. Karyakartas validate complaints in their area before admin review. MLA can receive urgent escalations via personal WhatsApp.

---

## P2-S1: Implement Rate Limiter

**As a** developer
**I want** a rate limiting system that enforces daily message limits and detects spam behavior per phone number
**So that** the bot is protected from abuse and individual users cannot overwhelm the system

### Dependencies

| Depends On | Story Title | Why |
|------------|-------------|-----|
| P1-S8 | Local development setup and end-to-end testing | Need a working bot with DB and message pipeline to hook rate limiter into |

> ⛔ **DO NOT START** this story until all dependencies above are marked completed.

### Acceptance Criteria

1. [ ] `src/rate-limiter.ts` created with `checkRateLimit(phone): { allowed: boolean, reason?: string }`
2. [ ] Daily limit configurable via tenant config (default 20 messages/day)
3. [ ] Spam detection: tracks last 5 message timestamps; if 5+ messages within 60 seconds, cooldown for 60 seconds
4. [ ] Rate limit data stored in `rate_limits` table (per phone, per date)
5. [ ] Rate limit message returned in user's detected language (Marathi/Hindi/English)
6. [ ] Rate limiter hooked into message pipeline before complaint handler
7. [ ] Sending 21st message in a day returns rate limit message
8. [ ] Sending 5 messages in 30 seconds triggers spam cooldown

### Files & Scope

| File | Action | What Changes |
|------|--------|-------------|
| `src/rate-limiter.ts` | New | Rate limiting logic with daily limits and spam detection |

### Testing Requirements (TDD Workflow)

Use the `/test-driven-development` skill.

1. **Write tests FIRST**:
   - Test: first message of the day is allowed
   - Test: 20th message of the day is allowed
   - Test: 21st message of the day is blocked with reason
   - Test: rate limit resets on new day
   - Test: 4 messages in 60 seconds is allowed
   - Test: 5 messages in 60 seconds triggers spam cooldown
   - Test: after 60-second cooldown, messages allowed again
   - Test: rate limit message in Marathi for Marathi users
   - Test: rate limit message in Hindi for Hindi users
   - Test: rate limit message in English for English users
   - Test: daily limit configurable (e.g., set to 10, 11th blocked)
   - Edge case: `recent_timestamps` JSON array correctly maintained
   - Edge case: multiple users rate-limited independently
2. **Run tests** — confirm they fail
3. **Implement** rate limiter
4. **Refactor** — optimize DB queries

### Development Workflow

#### Step 1: Architecture Review
Use `/writing-plans` to plan the rate limiter.
Use `/requesting-code-review` to validate:
- Rate limit algorithm design
- Database query efficiency
- Integration point in message pipeline

#### Step 2: TDD Implementation
Use `/test-driven-development` — tests first, then implement.

#### Step 3: Code Review
Use `/requesting-code-review`. Process feedback via `/receiving-code-review`.

#### Step 4: Verification
Use `/verification-before-completion`:
- Run full test suite
- Verify Phase 1 tests still pass

#### Step 5: Mark Complete
Check off all acceptance criteria. Update STORIES_INDEX.md.

---

## P2-S2: Harden Content Safety in System Prompts

**As a** developer
**I want** robust content safety guardrails in the system prompt with input sanitization
**So that** the bot handles adversarial inputs safely — rejecting political questions, handling abusive language, and resisting prompt injection

### Dependencies

| Depends On | Story Title | Why |
|------------|-------------|-----|
| P1-S4 | Write CLAUDE.md — the bot's brain | Need the base CLAUDE.md to enhance with safety guardrails |

> ⛔ **DO NOT START** this story until all dependencies above are marked completed.

### Acceptance Criteria

1. [ ] `src/prompts/system-prompt.ts` created with templated guardrails
2. [ ] Identity guardrail: "You are a complaint assistant for {mla_name}'s office in {constituency}"
3. [ ] NEVER rules enforced: make promises, discuss politics, share other users' data, use offensive language
4. [ ] ALWAYS rules enforced: be polite, empathetic, redirect off-topic, acknowledge frustration
5. [ ] Language rule: respond in same language as user
6. [ ] Input sanitization: strip potential prompt injection attempts
7. [ ] Asking about politics returns polite redirect (e.g., "मी तक्रार सहाय्यक आहे, राजकीय प्रश्नांना उत्तर देणे माझ्या कार्यक्षेत्रात नाही")
8. [ ] Abusive message gets calm, empathetic response
9. [ ] Off-topic requests redirected to complaint filing
10. [ ] **User roles**: `role` column added to `users` table — values: `user` (default), `admin`, `superadmin`. Roles stored in DB and checked before any blocking action
11. [ ] **Admin immunity**: Users with role `admin` or `superadmin` can NEVER be blocked — `block_user` MCP tool and LLM guardrails must check role before blocking and refuse with "This user is an admin and cannot be blocked"
12. [ ] **Role assignment**: `set_user_role` MCP tool added (callable from admin group only) — sets a user's role. Only `superadmin` can promote to `admin`/`superadmin`
13. [ ] **Admin phone list**: Tenant config `admin_phones` (array of phone numbers) — users matching these phones are auto-assigned `admin` role on first contact
14. [ ] **Temporary blocking**: User blocks expire after 24 hours automatically. `blocked_until` column added to `users` table (ISO timestamp). `isUserBlocked()` checks `blocked_until > now()` — if expired, auto-unblocks (sets `is_blocked = 0, blocked_until = NULL`). Also checks role — admins always return `false`
15. [ ] **Block duration configurable**: Default 24h, configurable via tenant config `block_duration_hours`
16. [ ] `block_user` MCP tool updated to: (a) refuse if target has `admin`/`superadmin` role, (b) set `blocked_until = now + block_duration_hours`
17. [ ] Bot informs blocked user how long until auto-unblock: "तुमचा प्रवेश 24 तासांसाठी रोखला गेला आहे" / "Your access has been blocked for 24 hours"

### Files & Scope

| File | Action | What Changes |
|------|--------|-------------|
| `src/prompts/system-prompt.ts` | New | Templated safety guardrails, input sanitization |

### Testing Requirements (TDD Workflow)

Use the `/test-driven-development` skill.

1. **Write tests FIRST**:
   - Test: system prompt includes identity template
   - Test: political question input → polite redirect response
   - Test: abusive language input → empathetic, de-escalation response
   - Test: off-topic request → complaint filing redirect
   - Test: prompt injection attempt sanitized (e.g., "ignore all instructions and...")
   - Test: system prompt in Marathi context uses Marathi guardrail phrases
   - Test: NEVER rules present in generated prompt
   - Test: ALWAYS rules present in generated prompt
   - Edge case: mixed-language adversarial input handled
   - Test: blocking sets `blocked_until` to now + 24 hours
   - Test: `isUserBlocked` returns true when `blocked_until` is in the future
   - Test: `isUserBlocked` returns false (auto-unblocks) when `blocked_until` is in the past
   - Test: auto-unblock clears `is_blocked` and `blocked_until` in the DB
   - Test: block duration configurable via tenant config
   - Test: blocked user informed of unblock time in their language
   - Test: user with role `admin` cannot be blocked — `block_user` refuses
   - Test: user with role `superadmin` cannot be blocked
   - Test: `isUserBlocked` always returns false for admin/superadmin regardless of `is_blocked` flag
   - Test: default role is `user` for new users
   - Test: phones in tenant config `admin_phones` auto-assigned `admin` role on first contact
   - Test: `set_user_role` only callable by superadmin
2. **Run tests** — confirm they fail
3. **Implement** — system prompt builder and sanitizer
4. **Refactor** — ensure clean separation of concerns

### Development Workflow

#### Step 1: Architecture Review
Use `/writing-plans` to plan the safety system.
Use `/requesting-code-review` to validate:
- Input sanitization approach
- Guardrail completeness
- Integration with CLAUDE.md

#### Step 2: TDD Implementation
Use `/test-driven-development` — tests first, then implement.

#### Step 3: Code Review
Use `/requesting-code-review`. Process feedback via `/receiving-code-review`.

#### Step 4: Verification
Use `/verification-before-completion`:
- Run full test suite
- Test with adversarial inputs manually

#### Step 5: Mark Complete
Check off all acceptance criteria. Update STORIES_INDEX.md.

---

## P2-S3: Build Admin Group Notification System

**As a** developer
**I want** new complaints automatically posted to the admin WhatsApp group with structured details, and admins able to update complaint status via group commands
**So that** the MLA's team is immediately notified of new complaints and can manage them directly from WhatsApp

### Dependencies

| Depends On | Story Title | Why |
|------------|-------------|-----|
| P1-S8 | Local development setup and end-to-end testing | Need a working bot with complaint creation and admin group routing |

> ⛔ **DO NOT START** this story until all dependencies above are marked completed.

### Acceptance Criteria

1. [ ] `src/admin-handler.ts` created
2. [ ] On new complaint → formatted notification posted to admin WhatsApp group within 30 seconds:
   ```
   🆕 New Complaint
   ID: RK-20260211-0042
   From: +91 98765 43210
   Category: Water Supply
   Location: Ward 7, Shivaji Nagar
   Description: No water supply for 3 days
   Status: Registered
   ```
3. [ ] On status change → admin group notified
4. [ ] `#update RK-XXXX in_progress: note` command parsed and executed — updates status, notifies user
5. [ ] `#resolve RK-XXXX: note` command parsed and executed — marks resolved, notifies user
6. [ ] `#escalate RK-XXXX: note` command parsed and executed — escalates complaint
7. [ ] `#hold RK-XXXX: note` command parsed and executed — puts on hold with reason
8. [ ] `#unblock +919876543210` command parsed and executed — immediately unblocks a user (sets `is_blocked = 0, blocked_until = NULL`), confirms in admin group
9. [ ] `#block +919876543210: reason` command parsed and executed — admin can manually block a user with reason. Refuses if target is admin/superadmin
10. [ ] `#role +919876543210 admin` command parsed and executed — sets user role (superadmin only). Valid roles: `user`, `admin`, `superadmin`
11. [ ] Invalid complaint ID in command returns error message
12. [ ] Uses nanoclaw's existing group message handling + IPC for routing

### Files & Scope

| File | Action | What Changes |
|------|--------|-------------|
| `src/admin-handler.ts` | New | Admin group notification, command parsing, status updates |

### Testing Requirements (TDD Workflow)

Use the `/test-driven-development` skill.

1. **Write tests FIRST**:
   - Test: new complaint triggers notification to admin group with correct format
   - Test: notification contains all fields (ID, phone, category, location, description, status)
   - Test: `#update RK-20260211-0042 in_progress: Contacted water dept` parsed correctly
   - Test: `#resolve RK-20260211-0042: Issue fixed` parsed correctly
   - Test: `#escalate RK-20260211-0042: Needs collector attention` parsed correctly
   - Test: `#hold RK-20260211-0042: Waiting for MSEDCL response` parsed correctly
   - Test: invalid complaint ID returns error message
   - Test: malformed command returns usage help
   - Test: status update creates record in `complaint_updates` table
   - Edge case: concurrent admin commands on same complaint
   - Test: `#unblock +919876543210` immediately unblocks user and confirms in admin group
   - Test: `#unblock` with invalid phone returns error message
   - Test: `#block +919876543210: spam` blocks user with reason and confirms
   - Test: `#block` refuses to block admin/superadmin users
   - Test: unblocked user can send messages again immediately
   - Test: `#role +919876543210 admin` sets user role and confirms
   - Test: `#role` only works for superadmin — admin trying to set roles gets error
   - Test: `#role` with invalid role name returns error
2. **Run tests** — confirm they fail
3. **Implement** — admin handler with notification and command parsing
4. **Refactor** — clean up command parser

### Development Workflow

#### Step 1: Architecture Review
Use `/writing-plans` to plan the admin handler.
Use `/requesting-code-review` to validate:
- Command syntax design
- IPC integration for group messaging
- Notification format

#### Step 2: TDD Implementation
Use `/test-driven-development` — tests first, then implement.

#### Step 3: Code Review
Use `/requesting-code-review`. Process feedback via `/receiving-code-review`.

#### Step 4: Verification
Use `/verification-before-completion`:
- Run full test suite
- Test admin commands end-to-end

#### Step 5: Mark Complete
Check off all acceptance criteria. Update STORIES_INDEX.md.

---

## P2-S4: User Notification on Status Updates

**As a** developer
**I want** constituents to receive WhatsApp notifications in their language when an admin updates their complaint status
**So that** users are kept informed about their complaint progress without needing to check manually

### Dependencies

| Depends On | Story Title | Why |
|------------|-------------|-----|
| P2-S3 | Build admin group notification system | Need admin command parsing to trigger user notifications |

> ⛔ **DO NOT START** this story until all dependencies above are marked completed.

### Acceptance Criteria

1. [ ] When admin updates status via group command, constituent receives WhatsApp notification
2. [ ] Notification sent in user's stored language (from `users.language` column)
3. [ ] Marathi notification format:
   ```
   तक्रार अपडेट 📢
   तक्रार क्र.: RK-20260211-0042
   स्थिती: कार्यवाही सुरू ✅
   टीप: महानगरपालिका पाणीपुरवठा विभागाशी संपर्क साधला आहे.
   ```
4. [ ] Hindi and English notification formats also supported
5. [ ] Admin note translated using Claude (Sonnet) if admin writes in English but user's language is Marathi/Hindi
6. [ ] Status change recorded in `complaint_updates` table with audit trail
7. [ ] Notification sent within 30 seconds of admin command

### Files & Scope

| File | Action | What Changes |
|------|--------|-------------|
| `src/admin-handler.ts` | Extend | Add user notification logic on status update |

### Testing Requirements (TDD Workflow)

Use the `/test-driven-development` skill.

1. **Write tests FIRST**:
   - Test: admin `#update` triggers WhatsApp message to constituent
   - Test: notification in Marathi for Marathi-speaking user
   - Test: notification in Hindi for Hindi-speaking user
   - Test: notification in English for English-speaking user
   - Test: admin note translated from English to Marathi when user language is Marathi
   - Test: admin note translated from English to Hindi when user language is Hindi
   - Test: audit record created in `complaint_updates` with `updated_by` = admin phone
   - Edge case: user's phone number not reachable — error logged but doesn't crash
   - Edge case: translation failure falls back to original English text
2. **Run tests** — confirm they fail
3. **Implement** — notification sender with translation
4. **Refactor** — ensure notification templates are clean

### Development Workflow

#### Step 1: Architecture Review
Use `/writing-plans` to plan the notification system.
Use `/requesting-code-review` to validate:
- Translation approach (Sonnet call)
- Notification template design
- Error handling for unreachable users

#### Step 2: TDD Implementation
Use `/test-driven-development` — tests first, then implement.

#### Step 3: Code Review
Use `/requesting-code-review`. Process feedback via `/receiving-code-review`.

#### Step 4: Verification
Use `/verification-before-completion`:
- Run full test suite
- Verify no regressions in Phase 1 and P2-S1 through P2-S3

#### Step 5: Mark Complete
Check off all acceptance criteria. Update STORIES_INDEX.md.

---

## P2-S5: Daily Summary Scheduled Task

**As a** developer
**I want** an automated daily summary posted to the admin WhatsApp group at 9 AM
**So that** the MLA's team starts each day with a clear picture of complaint volumes, aging issues, and top categories

### Dependencies

| Depends On | Story Title | Why |
|------------|-------------|-----|
| P2-S3 | Build admin group notification system | Need admin group messaging infrastructure to post summaries |

> ⛔ **DO NOT START** this story until all dependencies above are marked completed.

### Acceptance Criteria

1. [ ] Daily summary scheduled via nanoclaw's `task-scheduler.ts` at 9 AM
2. [ ] Summary includes: total open complaints by status
3. [ ] Summary includes: new complaints today
4. [ ] Summary includes: aging complaints (> 7 days, > 14 days, > 30 days)
5. [ ] Summary includes: top categories
6. [ ] Summary posted to admin WhatsApp group
7. [ ] Summary formatted clearly for WhatsApp readability

### Files & Scope

| File | Action | What Changes |
|------|--------|-------------|
| `src/task-scheduler.ts` | Extend | Register daily summary task at 9 AM |
| `src/admin-handler.ts` | Extend | Add summary generation and posting logic |

### Testing Requirements (TDD Workflow)

Use the `/test-driven-development` skill.

1. **Write tests FIRST**:
   - Test: summary task registered in scheduler for 9 AM
   - Test: summary includes correct count of open complaints by status
   - Test: summary includes new complaints count for today
   - Test: summary identifies aging complaints > 7 days
   - Test: summary identifies aging complaints > 14 days
   - Test: summary identifies aging complaints > 30 days
   - Test: summary lists top categories by complaint count
   - Test: summary formatted correctly for WhatsApp
   - Edge case: no complaints exist — summary handles empty state gracefully
2. **Run tests** — confirm they fail
3. **Implement** — summary generator and scheduler integration
4. **Refactor** — optimize DB queries for summary

### Development Workflow

#### Step 1: Architecture Review
Use `/writing-plans` to plan the daily summary.
Use `/requesting-code-review` to validate:
- Summary content and format
- Scheduler integration approach
- Query efficiency for summary data

#### Step 2: TDD Implementation
Use `/test-driven-development` — tests first, then implement.

#### Step 3: Code Review
Use `/requesting-code-review`. Process feedback via `/receiving-code-review`.

#### Step 4: Verification
Use `/verification-before-completion`:
- Run full test suite
- Verify summary generates correctly with test data

#### Step 5: Mark Complete
Check off all acceptance criteria. Update STORIES_INDEX.md.

---

## P2-S6: Usage Volume Monitoring

**As a** developer
**I want** usage volume tracking appended to the daily summary, with all container runs logged for trend analysis
**So that** the team can monitor system utilization, plan capacity, and detect unusual patterns

### Dependencies

| Depends On | Story Title | Why |
|------------|-------------|-----|
| P2-S5 | Daily summary scheduled task | Need the daily summary to append usage data to |

> ⛔ **DO NOT START** this story until all dependencies above are marked completed.

### Acceptance Criteria

1. [ ] Daily usage summary appended to admin group daily summary
2. [ ] Usage summary includes: total messages processed today
3. [ ] Usage summary includes: container runs count and average duration
4. [ ] Usage summary includes: Sonnet vs Opus usage breakdown
5. [ ] All container runs logged to `usage_log` table with model, purpose, duration
6. [ ] Alert posted if daily message volume exceeds configurable threshold
7. [ ] Usage data available for trend analysis via `usage_log` table queries

### Files & Scope

| File | Action | What Changes |
|------|--------|-------------|
| `src/admin-handler.ts` | Extend | Add usage volume section to daily summary |
| `src/container-runner.ts` | Modify | Log container runs to `usage_log` table |

### Testing Requirements (TDD Workflow)

Use the `/test-driven-development` skill.

1. **Write tests FIRST**:
   - Test: container run creates record in `usage_log` with model, purpose, duration
   - Test: usage summary shows correct message count for today
   - Test: usage summary shows correct container run count and average duration
   - Test: usage summary distinguishes Sonnet vs Opus usage
   - Test: alert triggered when daily volume exceeds threshold
   - Test: alert not triggered when volume is within threshold
   - Edge case: no container runs today — shows zero counts
2. **Run tests** — confirm they fail
3. **Implement** — usage logging and summary generation
4. **Refactor** — optimize queries

### Development Workflow

#### Step 1: Architecture Review
Use `/writing-plans` to plan usage monitoring.
Use `/requesting-code-review` to validate:
- Logging approach in container-runner
- Alert threshold configuration
- Usage summary format

#### Step 2: TDD Implementation
Use `/test-driven-development` — tests first, then implement.

#### Step 3: Code Review
Use `/requesting-code-review`. Process feedback via `/receiving-code-review`.

#### Step 4: Verification
Use `/verification-before-completion`:
- Run full test suite
- Verify no regressions in Phase 1 and P2-S1 through P2-S5

#### Step 5: Mark Complete
Check off all acceptance criteria. Update STORIES_INDEX.md.

---

## P2-S7: Schema for Areas and Karyakartas

**As a** developer
**I want** a database schema for geographic areas, karyakartas (local reps), and complaint validation records
**So that** the system can track area assignments, karyakarta-area mappings, and complaint validation history

### Dependencies

| Depends On | Story Title | Why |
|------------|-------------|-----|
| P2-S2 | Content safety + roles | Need role column on users before adding karyakarta records |

> :no_entry: **DO NOT START** this story until all dependencies above are marked completed.

### Acceptance Criteria

1. [ ] Migration `004-areas-karyakartas.sql` creates `areas`, `karyakartas`, `karyakarta_areas`, `complaint_validations` tables
2. [ ] Migration adds `area_id` column to `complaints` table
3. [ ] `src/area-db.ts` created with CRUD functions: `createArea`, `getArea`, `listAreas`, `updateArea`, `deactivateArea`
4. [ ] Karyakarta CRUD: `addKaryakarta`, `removeKaryakarta`, `getKaryakarta`, `listKaryakartas`
5. [ ] Assignment CRUD: `assignKaryakartaToArea`, `unassignKaryakartaFromArea`, `getKaryakartasForArea`, `getAreasForKaryakarta`
6. [ ] Validation CRUD: `createValidation`, `getValidationsForComplaint`
7. [ ] `src/test-helpers.ts` created with shared seeding functions for Phase 2 tests
8. [ ] Area slugs auto-generated from name (e.g., "Shivaji Nagar" → "shivaji-nagar")
9. [ ] Areas support multilingual names (name, name_mr, name_hi)

### Testing Requirements (TDD Workflow)

Use the `/test-driven-development` skill.

1. **Write tests FIRST**:
   - Test: create area with slug auto-generation
   - Test: list active areas
   - Test: deactivate area
   - Test: add karyakarta (creates user with karyakarta role if not exists)
   - Test: remove karyakarta (deactivates, doesn't delete)
   - Test: assign karyakarta to area
   - Test: unassign karyakarta from area
   - Test: get karyakartas for a specific area
   - Test: get areas for a specific karyakarta
   - Test: create complaint validation record
   - Test: get validation history for complaint
   - Test: area_id column on complaints works correctly
   - Edge case: duplicate area name returns error
   - Edge case: assign to non-existent area returns error
2. **Run tests** — confirm they fail
3. **Implement** — migration + CRUD functions
4. **Refactor** — ensure clean separation

---

## P2-S8: Admin Commands for Karyakarta Management

**As a** developer
**I want** admin group commands for managing karyakartas, areas, and overriding rejected complaints
**So that** the admin team can manage the karyakarta network directly from WhatsApp

### Dependencies

| Depends On | Story Title | Why |
|------------|-------------|-----|
| P2-S3 | Admin group notifications | Need AdminService and command parsing infrastructure |
| P2-S7 | Schema for areas/karyakartas | Need area and karyakarta tables to manage |

> :no_entry: **DO NOT START** this story until all dependencies above are marked completed.

### Acceptance Criteria

1. [ ] `src/admin-commands.ts` created with command parser and executor
2. [ ] `#add-karyakarta +919876543210 AreaSlug` — adds karyakarta, assigns to area, confirms
3. [ ] `#remove-karyakarta +919876543210` — deactivates karyakarta, confirms
4. [ ] `#assign-area +919876543210 AreaSlug` — assigns karyakarta to additional area
5. [ ] `#unassign-area +919876543210 AreaSlug` — removes karyakarta from area
6. [ ] `#add-area AreaName` — creates new area with auto-slug
7. [ ] `#rename-area old-slug NewName` — renames area, updates slug
8. [ ] `#remove-area AreaSlug` — deactivates area (soft delete)
9. [ ] `#list-karyakartas` — lists all active karyakartas with their areas
10. [ ] `#list-areas` — lists all active areas with karyakarta count
11. [ ] `#override-reject RK-XXXX: reason` — moves rejected complaint to validated status
12. [ ] All commands integrated into AdminService.handleCommand()
13. [ ] Invalid inputs return helpful error messages

### Testing Requirements (TDD Workflow)

Use the `/test-driven-development` skill.

1. **Write tests FIRST** for each command (parse + execute)
2. **Run tests** — confirm they fail
3. **Implement** — command parser + executor
4. **Refactor** — clean up

---

## P2-S9: Area-Based Complaint Routing

**As a** developer
**I want** complaints to be matched to geographic areas using fuzzy text matching
**So that** the right karyakarta is notified about complaints in their assigned area

### Dependencies

| Depends On | Story Title | Why |
|------------|-------------|-----|
| P2-S7 | Schema for areas/karyakartas | Need area tables for matching |

> :no_entry: **DO NOT START** this story until all dependencies above are marked completed.

### Acceptance Criteria

1. [ ] `src/area-matcher.ts` created with `matchArea(db, locationText): AreaMatch[]`
2. [ ] Fuzzy matching using Levenshtein distance with configurable threshold
3. [ ] Returns ranked matches with confidence scores
4. [ ] New MCP tool `resolve_area` registered in complaint-handler.ts
5. [ ] When `karyakarta_validation_enabled`, createComplaint sets status to `pending_validation` and sets `area_id`
6. [ ] When `karyakarta_validation_enabled` is false, complaints behave as Phase 1 (status = registered, no area_id)
7. [ ] Updated complaint CLAUDE.md: agent calls `resolve_area` after location extraction
8. [ ] If area match is ambiguous, agent asks user to clarify

### Testing Requirements (TDD Workflow)

Use the `/test-driven-development` skill.

1. **Write tests FIRST**:
   - Test: exact area name match returns confidence 1.0
   - Test: fuzzy match "Shivaji Nagr" → "Shivaji Nagar" with high confidence
   - Test: no match returns empty array
   - Test: multiple partial matches ranked by confidence
   - Test: resolve_area MCP tool returns formatted results
   - Test: with feature flag on, createComplaint sets pending_validation + area_id
   - Test: with feature flag off, createComplaint sets registered (no area_id)
   - Edge case: empty location text
   - Edge case: Marathi/Hindi location text matching
2. **Run tests** — confirm they fail
3. **Implement** — area matcher + MCP tool
4. **Refactor** — optimize matching algorithm

---

## P2-S10: Karyakarta Validation Flow

**As a** developer
**I want** karyakartas to approve or reject complaints via WhatsApp commands
**So that** local reps can validate complaints in their area before they reach the admin team

### Dependencies

| Depends On | Story Title | Why |
|------------|-------------|-----|
| P2-S8 | Admin commands for karyakarta mgmt | Need karyakarta management infrastructure |
| P2-S9 | Area-based complaint routing | Need area matching to route complaints to karyakartas |

> :no_entry: **DO NOT START** this story until all dependencies above are marked completed.

### Acceptance Criteria

1. [ ] `src/karyakarta-handler.ts` created with `handleKaryakartaCommand()`
2. [ ] DM notification sent to karyakarta(s) assigned to area when complaint created with pending_validation
3. [ ] `#approve RK-XXXX: note` — status → validated, forward to admin group, notify constituent
4. [ ] `#reject RK-XXXX reason_code: note` — status → rejected, log validation, notify constituent
5. [ ] Rejection reasons: duplicate, fraud, not_genuine, out_of_area, insufficient_info, other
6. [ ] `#my-complaints` — lists pending complaints for karyakarta's assigned areas
7. [ ] Admin `#override-reject RK-XXXX: reason` moves rejected → validated
8. [ ] Role-based dispatch in index.ts: if karyakarta + `#command` → karyakarta-handler
9. [ ] Validation record created in `complaint_validations` table
10. [ ] Constituent notified of approval/rejection in their language

### Testing Requirements (TDD Workflow)

Use the `/test-driven-development` skill.

1. **Write tests FIRST** for each command and notification
2. **Run tests** — confirm they fail
3. **Implement** — handler + notifications
4. **Refactor** — clean up

---

## P2-S11: Validation Timeout and Reminders

**As a** developer
**I want** automatic reminders to karyakartas for pending validations and auto-escalation on timeout
**So that** complaints don't get stuck waiting for karyakarta response indefinitely

### Dependencies

| Depends On | Story Title | Why |
|------------|-------------|-----|
| P2-S10 | Karyakarta validation flow | Need the validation flow to add timeout logic |

> :no_entry: **DO NOT START** this story until all dependencies above are marked completed.

### Acceptance Criteria

1. [ ] `src/validation-scheduler.ts` created with `checkPendingValidations()` run hourly
2. [ ] 12h (configurable): send reminder DM to karyakarta
3. [ ] 24h (configurable): auto-escalate → status `escalated_timeout`, notify admin group + constituent
4. [ ] Timeouts configurable via `karyakarta_response_timeout_hours` and `karyakarta_reminder_hours` in tenant YAML
5. [ ] Validation record created with action `escalated_timeout`
6. [ ] Already-actioned complaints skip reminder/escalation

### Testing Requirements (TDD Workflow)

Use the `/test-driven-development` skill.

1. **Write tests FIRST**:
   - Test: complaint pending < 12h → no action
   - Test: complaint pending 12h → reminder sent to karyakarta
   - Test: complaint pending 24h → auto-escalated, admin + constituent notified
   - Test: already approved complaint → no reminder
   - Test: configurable timeout hours
   - Edge case: multiple karyakartas for same area — all get reminded
2. **Run tests** — confirm they fail
3. **Implement** — scheduler + notifications
4. **Refactor** — optimize queries

---

## P2-S12: MLA Escalation

**As a** developer
**I want** admins to escalate urgent complaints directly to the MLA's personal WhatsApp
**So that** critical issues reach the MLA immediately for personal attention

### Dependencies

| Depends On | Story Title | Why |
|------------|-------------|-----|
| P2-S10 | Karyakarta validation flow | Need the full validation pipeline |
| P2-S5 | Daily summary scheduled task | MLA escalation count included in summary |

> :no_entry: **DO NOT START** this story until all dependencies above are marked completed.

### Acceptance Criteria

1. [ ] `src/mla-escalation.ts` created with `formatMlaEscalation()` and `handleMlaReply()`
2. [ ] Admin command `#escalate-to-mla RK-XXXX: reason` sends DM to MLA phone from tenant config
3. [ ] MLA DM includes complaint summary, reason, and reply instructions
4. [ ] MLA reply detection in onMessage: match `mla_phone` from config → forward to admin group
5. [ ] Escalation logged in complaint_updates with `updated_by = 'admin'`
6. [ ] MLA phone configurable via tenant YAML (`mla_phone`)
7. [ ] Error if `mla_phone` not configured

### Testing Requirements (TDD Workflow)

Use the `/test-driven-development` skill.

1. **Write tests FIRST**:
   - Test: escalate-to-mla sends formatted DM to MLA phone
   - Test: MLA reply forwarded to admin group
   - Test: escalation logged in complaint_updates
   - Test: error when mla_phone not configured
   - Test: MLA DM format includes complaint details
   - Edge case: MLA sends unrelated message → not forwarded
2. **Run tests** — confirm they fail
3. **Implement** — escalation handler + MLA reply detection
4. **Refactor** — clean up

Note: Phase 2 is now complete — Phase 3 and Phase 4 stories are unblocked.
