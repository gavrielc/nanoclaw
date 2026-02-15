# GitHub Integration Skill

This skill provides comprehensive GitHub workflow automation using the `gh` CLI and GraphQL API.

## What This Skill Does

- **GitHub Discussions Management**:
  - List discussions with filtering
  - Create new discussions in any category
  - Add comments to discussions
  - View discussions with full comment threads
- **Future**: PR management, issue triage, project boards, CI/CD workflows

## Usage

All GitHub operations are handled through executable bash scripts:

### GitHub Discussions

```bash
# List discussions (default: 20 most recent)
./gh-discussion-list [owner/repo] [limit]
./gh-discussion-list omniaura/quarterplan-dashboard
./gh-discussion-list ditto-assistant/ditto-app 50

# Create a new discussion
./gh-discussion-create [owner/repo] [category] [title] [body]
./gh-discussion-create omniaura/quarterplan-dashboard "Ideas" "Feature Request" "Description..."

# Add comment to discussion
./gh-discussion-comment [owner/repo] [discussion-number] [comment-body]
./gh-discussion-comment omniaura/quarterplan-dashboard 42 "Progress update..."

# View discussion with all comments
./gh-discussion-view [owner/repo] [discussion-number]
./gh-discussion-view omniaura/quarterplan-dashboard 42
```

### Available Discussion Categories

- `Announcements` 📣 - Updates from maintainers
- `General` 💬 - Chat about anything
- `Ideas` 💡 - Share ideas for new features
- `Polls` 🗳️ - Take a vote from the community
- `Q&A` 🙏 - Ask the community for help
- `Show and tell` 🙌 - Show off something you've made

## Setup

### Prerequisites

1. **GitHub CLI** (`gh`):
   ```bash
   # macOS
   brew install gh

   # Linux
   curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
   sudo apt update
   sudo apt install gh
   ```

2. **jq** (JSON processor):
   ```bash
   # macOS
   brew install jq

   # Linux
   sudo apt install jq
   ```

3. **Authentication**:
   ```bash
   gh auth login
   # Follow prompts to authenticate with GitHub
   ```

### Add to PATH (Optional)

For system-wide access:

```bash
export PATH="$PATH:$(pwd)/.claude/skills/github"
```

## Integration with NanoClaw

This skill can be invoked from NanoClaw agents to:

- **Quarterly Planning**: Create planning threads for each quarter
- **Progress Tracking**: Post weekly updates to ongoing discussions
- **Feature Brainstorming**: Create "Ideas" discussions for feature proposals
- **Retrospectives**: Create "General" discussions for post-mortems
- **Agent Coordination**: Use discussions as shared context between agents

### Example Agent Usage

```typescript
import { $ } from 'bun';

// Create quarterly planning discussion
const result = await $`
  .claude/skills/github/gh-discussion-create
  omniaura/quarterplan-dashboard
  "Announcements"
  "Q1 2026 Planning"
  "Our focus areas for Q1 2026..."
`.text();

console.log(result); // "Created discussion #42: Q1 2026 Planning"

// Post weekly progress update
await $`
  .claude/skills/github/gh-discussion-comment
  omniaura/quarterplan-dashboard
  42
  "Week 3 Update: Completed 15/20 tasks, on track for Q1 goals"
`.text();
```

## Use Cases

### 1. Quarterly Planning Automation

Create quarterly planning discussions at the start of each quarter:

```bash
gh-discussion-create omniaura/quarterplan-dashboard "Announcements" \
  "Q1 2026 Planning" "Our focus areas for Q1: 1) Mac Runner stability, 2) Ditto MCP improvements, 3) NanoClaw agent coordination"
```

### 2. Feature Proposal Workflow

Agents can autonomously create feature discussions:

```bash
gh-discussion-create ditto-assistant/ditto-app "Ideas" \
  "Drag-and-Drop File Upload" "Proposal to add drag-and-drop file upload to chat interface"
```

### 3. Retrospectives & Post-Mortems

Create retrospective threads after major milestones:

```bash
gh-discussion-create omniaura/mac-runner "General" \
  "Phase 6 Retrospective" "What went well: hybrid isolation strategy. What to improve: Mac hardware testing coverage."
```

### 4. Agent Coordination via Discussions

Agents can use discussions as shared context:

```bash
# Agent 1 creates discussion with findings
gh-discussion-create omniaura/nanoclaw "Q&A" \
  "Cloud-Local Communication Strategy" "Researched Sprites ↔ Apple Container communication patterns..."

# Agent 2 adds insights to same discussion
gh-discussion-comment omniaura/nanoclaw 15 \
  "Found IPC file-based messaging system in src/ipc/. This could be extended for cloud-local comms."
```

## Architecture

- ✅ **No NanoClaw core modifications** - Standalone bash scripts
- ✅ **CLI-first design** - Easy to test and invoke
- ✅ **GraphQL API** - Direct GitHub API access via `gh api graphql`
- ✅ **Human-readable output** - Formatted with `jq` and `column`
- ✅ **Error handling** - Validation and helpful error messages
- ✅ **Flexible defaults** - Works with any repo, defaults to `omniaura/quarterplan-dashboard`

## Files

- `SKILL.md` - This documentation
- `gh-discussion-list` - List discussions with filtering
- `gh-discussion-create` - Create new discussions
- `gh-discussion-comment` - Add comments to discussions
- `gh-discussion-view` - View full discussion threads

## Development Patterns & Best Practices

### Why GitHub Discussions Over Custom Tools?

GitHub Discussions provides:
- **Native integration** with GitHub Issues, PRs, and code
- **Rich formatting** with Markdown support
- **Notification system** built into GitHub
- **Discoverability** - all conversations in one place
- **Searchable history** - never lose context
- **Upvoting/reactions** - community feedback built-in

For agent coordination, Discussions are superior to Slack/Discord because:
- **Persistent context** - doesn't scroll away like chat
- **Threaded conversations** - organized by topic
- **Linked to code** - reference commits, PRs, issues directly
- **GitHub-native** - no additional tools to maintain

### Agent Coordination Strategies

1. **Use "Announcements" for milestones**: Quarterly goals, major releases
2. **Use "Ideas" for feature proposals**: Agents can propose features autonomously
3. **Use "General" for retrospectives**: Post-mortems and learning notes
4. **Use "Q&A" for technical questions**: Agents can ask other agents for help
5. **Cross-reference with Issues/PRs**: Link discussions to specific work items

### Gotchas & Best Practices

- **Authentication**: Ensure `gh auth login` is completed before using scripts
- **Rate Limits**: GitHub GraphQL API has rate limits (5000 requests/hour for authenticated users)
- **Category IDs**: Categories are repo-specific. Scripts handle common categories, but custom categories need GraphQL queries
- **Markdown Formatting**: Use proper escaping for multiline bodies (use `\n` or heredocs)
- **Default Repo**: Scripts default to `omniaura/quarterplan-dashboard` - override with `owner/repo` argument

### Common Workflows

**Weekly Progress Updates**:
```bash
# Create quarterly planning discussion once
DISCUSSION_ID=$(gh-discussion-create omniaura/quarterplan-dashboard "Announcements" "Q1 2026" "Goals..." | grep -oP '#\K\d+')

# Add weekly updates as comments
gh-discussion-comment omniaura/quarterplan-dashboard $DISCUSSION_ID "Week 1: Completed Mac Runner Phase 6"
gh-discussion-comment omniaura/quarterplan-dashboard $DISCUSSION_ID "Week 2: NanoClaw stability audit"
```

**Feature Brainstorming**:
```bash
# Agent 1: Propose feature
DISCUSSION_ID=$(gh-discussion-create ditto-assistant/ditto-app "Ideas" "Dark Mode" "..." | grep -oP '#\K\d+')

# Agent 2: Add design notes
gh-discussion-comment ditto-assistant/ditto-app $DISCUSSION_ID "Design consideration: sync with system theme"

# Agent 3: Add implementation notes
gh-discussion-comment ditto-assistant/ditto-app $DISCUSSION_ID "Can use CSS variables + prefers-color-scheme"
```

## Future Enhancements

- [ ] Add `gh-discussion-update` for editing discussion title/body
- [ ] Add `gh-discussion-close` for closing discussions
- [ ] Add `gh-discussion-lock` for locking discussions
- [ ] Add filtering by category, author, date range
- [ ] Add search functionality across discussions
- [ ] Add upvote/downvote commands
- [ ] PR management scripts (`gh-pr-create`, `gh-pr-review`, `gh-pr-merge`)
- [ ] Issue triage scripts (`gh-issue-label`, `gh-issue-assign`)
- [ ] GitHub Projects/Kanban integration
- [ ] CI/CD workflow management (trigger workflows, check status)
- [ ] Automated quarterly planning thread creation (scheduled task)
