# Token Efficiency Rules (All Agents)

Every API call costs tokens. Tokens cost money. In a multi-agent system with multiple sessions per day, waste compounds fast. These rules are mandatory for all agents.

---

## The Fundamentals

1. **Read selectively, not exhaustively**. Use `offset`/`limit` when reading files. Use `Grep` before `Read` to find the right section. Don't read a 500-line file when you need 20 lines.

2. **Write concisely**. Short sentences. No filler. No "I'd be happy to help" or "Let me think about this". State facts, take actions.

3. **Don't repeat context**. If you already have information in memory, don't re-read the same files. Trust your context window.

4. **One-shot when possible**. Batch related operations. Don't do 5 sequential reads when a single `Grep` finds what you need.

---

## Session Start (Sacred Files)

Sacred files are loaded every session. Their combined size directly impacts every agent's token budget.

### Rules for sacred file authors

| File | Target size | Why |
|------|-------------|-----|
| CLAUDE.md (soul) | <150 lines | Loaded every session, defines identity |
| qa-rules.md | <200 lines | Shared rules, all agents pay this cost |
| team.md | <50 lines | Roster + protocol |
| memory.md | <30 lines | Just an index, no content |
| working.md | <30 lines | Current status only |
| heartbeat.md | <20 lines | Schedule table only |
| tools.md | <40 lines | Tool reference only |

**Total budget per agent at session start**: ~500 lines of sacred files.

### Rules for agents at session start

1. Read `qa-rules.md` — always (mandatory)
2. Read `team.md` — always (small)
3. Read `memory.md` — always (index only)
4. Read `working.md` — always (small)
5. Read `heartbeat.md` — only if running a scheduled routine
6. Read topic files — **only the ones relevant to current task**, not all of them
7. Read daily notes — **only if you need recent context**, not routinely

---

## File Reading Patterns

### DO

```
# Find the right section first, then read it
Grep pattern="validateTransition" path="src/governance/" → finds policy.ts:42
Read file="src/governance/policy.ts" offset=40 limit=30 → reads just the function

# Read only what you need from memory
Grep pattern="JWT" path="groups/developer/memory/topics/" → finds decisions.md:15
Read file="groups/developer/memory/topics/decisions.md" offset=13 limit=10
```

### DON'T

```
# Reading an entire large file when you need one function
Read file="src/index.ts" → 800+ lines loaded, 90% wasted

# Reading all topic files "just in case"
Read file="memory/topics/projects.md"
Read file="memory/topics/decisions.md"
Read file="memory/topics/lessons.md"
Read file="memory/topics/people.md"
Read file="memory/topics/pending.md"
→ 500 lines loaded, maybe 20 relevant
```

---

## Tool Usage

### Grep before Read

Always search first. `Grep` returns file paths and line numbers at low token cost. `Read` loads full content at high token cost.

```
✓ Grep → find file + line → Read with offset/limit
✗ Read entire file → scan through it manually
```

### Batch tool calls

If you need to check 3 independent things, call all 3 tools in parallel (one message, multiple tool calls). Don't wait for each one.

```
✓ [Grep A, Grep B, Grep C] → all in one message
✗ Grep A → wait → Grep B → wait → Grep C → 3 round trips
```

### Avoid redundant searches

If you searched for something this session, don't search again. If you read a file, don't re-read it. Your context window retains this information.

---

## Output Efficiency

### Governance responses

When moving tasks through the pipeline, keep transition reasons concise:

```
✓ gov_transition(task_id, "REVIEW", reason="Auth middleware done. JWT + refresh tokens. Tests passing.")
✗ gov_transition(task_id, "REVIEW", reason="I have completed the implementation of the authentication middleware. I chose to use JSON Web Tokens (JWT) with refresh tokens because they provide stateless authentication which scales better across multiple services. The implementation includes...")
```

### Memory storage

Store the fact, not the narrative:

```
✓ store_memory("Node spawn() with uid/gid doesn't set supplementary groups — use initgroups()", tags=["gotcha", "linux"])
✗ store_memory("Today I discovered that when using Node.js's child_process.spawn() function with uid and gid options, it turns out that the supplementary groups are not automatically set. This caused an issue when...", tags=["gotcha", "linux"])
```

### Daily notes

Bullet points. No prose paragraphs.

```
✓ - GOV-42: auth middleware done, JWT + refresh tokens
  - Gotcha: spawn() doesn't set supplementary groups
  - Decision: chose JWT over sessions (stateless)

✗ Today I worked on GOV-42 which was about implementing the authentication
  middleware. After careful consideration of the various approaches available,
  I decided to go with JWT...
```

---

## Skill Loading

Skills are injected into context when invoked. Keep skill files focused:

- One skill = one capability (don't merge unrelated features)
- Use structured templates, not prose explanations
- Code examples should be minimal — show the pattern, not a full tutorial
- Reference external docs via URLs rather than duplicating content

---

## Rework Is the Biggest Token Waste

A task sent back from REVIEW to DOING costs **2x tokens** (full re-execution). A task sent back twice costs **3x**.

Prevention:
1. Read the Definition of Done before starting
2. Self-review against DoD before submitting
3. Test your work before transitioning to REVIEW
4. If unsure, ask — a clarification message costs ~100 tokens. A rework cycle costs ~10,000+.

---

## Context Window Management

Your context window is finite. Once it fills, the system compacts (summarizes) older content, losing detail. Manage it:

1. **Compaction trigger**: If you're doing a long task, proactively dump to daily notes before compaction happens. Don't lose work.
2. **Don't load unnecessary context**: If you're fixing a bug in one file, don't also read the README, the tests, the deployment docs, and the architecture spec "for context".
3. **Use subagents for research**: When exploring a codebase, use `Task(subagent_type=Explore)` — it runs in a separate context, returns only the findings, and doesn't pollute your main context.

---

## Metrics (tracked in Performance Review)

The Cost-Benefit dimension (10% of performance score) considers:

- **Ext API calls per task**: Are you calling external APIs efficiently or making redundant calls?
- **Session token usage**: Are your sessions lean or bloated with unnecessary reads?
- **Rework rate**: How often does your work get sent back?
- **Output-to-input ratio**: How much useful output per token of input?

Agents with consistently high token waste will see lower Cost-Benefit scores in their weekly Performance Review.

---

## Quick Reference

| Action | Token cost | Alternative |
|--------|-----------|-------------|
| Read 500-line file | ~2,000 tokens | Grep → Read 30 lines = ~150 tokens |
| Load all topic files | ~2,000 tokens | Load 1 relevant file = ~400 tokens |
| Verbose transition reason | ~200 tokens | Concise reason = ~40 tokens |
| Re-read file already in context | ~2,000 tokens | Reference existing context = 0 tokens |
| Rework cycle (full re-execution) | ~10,000+ tokens | Get it right first time = 0 extra tokens |
| Prose daily note | ~500 tokens | Bullet points = ~100 tokens |
