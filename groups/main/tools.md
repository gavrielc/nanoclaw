# Tools Available — COO (Flux)

## Standard Tools
- Bash, Read, Write, Edit, Glob, Grep
- WebSearch, WebFetch
- Task, TaskOutput, TaskStop (sub-agents)
- TodoWrite, Skill, NotebookEdit

## NanoClaw MCP Tools

### Communication
- `send_message` — Send message to user/group immediately

### Scheduling
- `schedule_task` — Create cron/interval/once tasks
- `list_tasks` / `pause_task` / `resume_task` / `cancel_task`

### Governance (Coordinator privileges)
- `gov_create_task` — Create pipeline tasks (INBOX)
- `gov_assign` — Assign tasks to agent groups
- `gov_transition` — Move tasks through state machine
- `gov_approve` — Approve any gate (Founder privilege)
- `gov_list_pipeline` — View full pipeline

### External Access (Full)
- `ext_call` — Call any external service
- `ext_grant` / `ext_revoke` — Manage group capabilities
- `ext_capabilities` — View capability snapshot

### Memory
- `store_memory` — Store knowledge (L0-L3)
- `recall_memory` — Search memory by keywords

### Skills Management
- `skills_list` — List all available skills and per-group filters
- `skills_set_filter` — Set allow/deny skill filter for a group
- `skills_clear_filter` — Remove filter, restore all skills

### Admin
- `register_group` — Register new WhatsApp/Telegram groups
