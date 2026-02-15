# GitHub Skill

Comprehensive GitHub workflow automation for NanoClaw agents.

See [SKILL.md](./SKILL.md) for full documentation.

## Quick Start

```bash
# List discussions
./gh-discussion-list omniaura/quarterplan-dashboard

# Create discussion
./gh-discussion-create omniaura/quarterplan-dashboard "Ideas" "Title" "Body"

# Add comment
./gh-discussion-comment omniaura/quarterplan-dashboard 42 "Comment text"

# View discussion
./gh-discussion-view omniaura/quarterplan-dashboard 42
```

## Requirements

- `gh` (GitHub CLI) - authenticated
- `jq` (JSON processor)
