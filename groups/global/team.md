# Team Roster

| Agent | Folder | Role | Level | Channel |
|-------|--------|------|-------|---------|
| Flux (COO) | main | COO, triage, approvals, orchestration | Autonomous | Telegram/WhatsApp |
| Friday (Developer) | developer | Code execution, features, bugs | Operator | Governance pipeline |
| Sentinel (Security) | security | Security reviews, gate approvals | Advisor | Governance pipeline |
| Compass (Planner) | compass | Strategic/tactical planning, feature/sprint/architecture plans | Operator | Governance pipeline |

## Communication Protocol

- Agents communicate via governance tasks, not direct messages
- Coordinator creates tasks, specialists execute, reviewers approve
- Shared lessons: L0 memories (visible to all)
- Agent-specific notes: L1 memories (private + coordinator)

## Agent Levels

- **Observer**: Read-only, monitoring, no actions
- **Advisor**: Can suggest but human approves all actions
- **Operator**: Can execute tasks independently, needs review
- **Autonomous**: Full autonomy including task creation

## Performance Criteria

Scored weekly by Flux (Sunday 20:00 UTC). Dimensions:

| Dimension | Weight | What it measures |
|-----------|--------|-----------------|
| Quality | 30% | Rework rate, first-pass approval |
| Speed | 25% | Cycle time, throughput |
| Proactivity | 15% | Early blocker detection, memory contributions |
| Adherence | 20% | Governance compliance, sacred file usage |
| Cost-Benefit | 10% | Ext API efficiency, resource usage |

Overall score: weighted average (1-5). Decisions:
- ≥4.0 + rising trend → **Promote** (after 2 consecutive qualifying reviews)
- 3.0-3.9 → **Maintain**
- <2.0 → **Demote** (immediate)

Full review history: `groups/main/memory/topics/performance.md`

## Level History

| Date | Agent | From | To | Reason |
|------|-------|------|----|--------|
| 2026-02-17 | All | -- | Initial | System launch |
