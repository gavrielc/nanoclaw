---
name: github
description: Full GitHub operations via `gh` CLI — pull requests, issues, code review, CI/CD, search, and GraphQL API. Use for any GitHub interaction beyond basic git.
allowed-tools: Bash(gh:*)
---

# GitHub CLI (`gh`)

All commands use the authenticated `gh` CLI. Use `--json` output with `--jq` for scripting.

---

## Pull Requests

```bash
gh pr create --title "Title" --body "Description" --base main
gh pr create --draft --title "WIP: feature"
gh pr edit 42 --title "New title" --body "New description"
gh pr ready 42                          # Mark draft as ready
gh pr view 42                           # View PR details
gh pr view 42 --json title,state,files,reviews,reviewThreads
gh pr diff 42                           # View diff
gh pr list --assignee @me --state open
gh pr checks 42                         # View CI status
gh pr checks 42 --watch                 # Poll until checks complete
gh pr merge 42 --squash                 # Squash merge
gh pr merge 42 --squash --auto          # Auto-merge when checks pass
gh pr close 42
gh pr reopen 42
gh pr checkout 42                       # Check out locally
```

## Code Review

```bash
gh pr review 42 --approve
gh pr review 42 --approve --body "LGTM"
gh pr review 42 --request-changes --body "See inline comments"
gh pr review 42 --comment --body "Question about the approach"
```

## Resolve Review Threads (GraphQL)

The `gh` CLI has no built-in command for resolving PR conversations. Use GraphQL.

### List all threads on a PR

```bash
gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes {
            id
            isResolved
            path
            line
            comments(first: 1) {
              nodes { body author { login } }
            }
          }
        }
      }
    }
  }
' -f owner=OWNER -f repo=REPO -F number=PR_NUMBER
```

### Resolve a single thread

```bash
gh api graphql -f query='
  mutation($threadId: ID!) {
    resolveReviewThread(input: {threadId: $threadId}) {
      thread { isResolved }
    }
  }
' -f threadId=THREAD_ID
```

### Resolve all unresolved threads on a PR

```bash
OWNER="owner" REPO="repo" PR=123

THREADS=$(gh api graphql -f query='
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes { id isResolved }
        }
      }
    }
  }
' -f owner="$OWNER" -f repo="$REPO" -F number="$PR" \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false) | .id')

for THREAD_ID in $THREADS; do
  gh api graphql -f query='
    mutation($threadId: ID!) {
      resolveReviewThread(input: {threadId: $threadId}) {
        thread { isResolved }
      }
    }
  ' -f threadId="$THREAD_ID"
  echo "Resolved: $THREAD_ID"
done
```

### Reply to a review thread

```bash
gh api graphql -f query='
  mutation($threadId: ID!, $body: String!) {
    addPullRequestReviewThreadReply(input: {pullRequestReviewThreadId: $threadId, body: $body}) {
      comment { body }
    }
  }
' -f threadId=THREAD_ID -f body="Fixed in latest commit."
```

### Unresolve a thread

```bash
gh api graphql -f query='
  mutation($threadId: ID!) {
    unresolveReviewThread(input: {threadId: $threadId}) {
      thread { isResolved }
    }
  }
' -f threadId=THREAD_ID
```

---

## Issues

```bash
gh issue create --title "Bug: description" --body "Steps to reproduce..."
gh issue create --title "Feature" --label "enhancement" --assignee @me
gh issue edit 123 --title "Updated" --add-label "priority:high"
gh issue comment 123 --body "Still reproducing on v2.1"
gh issue close 123 --comment "Fixed in PR #456"
gh issue reopen 123
gh issue list --assignee @me --state open
gh issue list --search "label:bug is:open no:assignee"
gh issue view 123
gh issue pin 123
gh issue lock 123
gh issue transfer 123 --repo other-owner/other-repo
gh issue develop 123                    # Create branch from issue
```

---

## GitHub Actions / CI

```bash
gh run list                             # Recent runs
gh run list --status failure --limit 10
gh run view 12345                       # Run details
gh run view 12345 --log                 # Full logs
gh run view 12345 --job 678 --log       # Specific job log
gh run watch 12345                      # Live follow
gh run rerun 12345                      # Re-run all jobs
gh run rerun 12345 --failed             # Re-run only failed
gh run cancel 12345
gh run download 12345                   # Download artifacts
gh run download 12345 -n "test-results" # Specific artifact
gh workflow list                        # List workflows
gh workflow run "CI" --ref main         # Trigger manually
gh workflow run deploy.yml -f environment=staging
```

---

## Code Search

```bash
gh search code "handleClick" --repo owner/repo
gh search code "TODO" --language typescript
gh search code "import" --filename "index.ts" --extension ts
gh search code "APIKey" --owner my-org
gh search issues "is:open label:bug" --repo owner/repo
gh search prs "is:open review-requested:@me"
```

---

## Repository

```bash
gh repo view owner/repo
gh repo clone owner/repo
gh repo sync fork/repo --source upstream/repo
gh repo edit --description "New description"
gh release list
gh release download v1.0.0
```

---

## JSON Output & Scripting

Use `--json` with `--jq` for structured data:

```bash
# Get PR files changed
gh pr view 42 --json files --jq '.files[].path'

# Get all approvers
gh pr view 42 --json reviews --jq '[.reviews[] | select(.state == "APPROVED") | .author.login]'

# Count open issues by label
gh issue list --json labels --jq '[.[].labels[].name] | group_by(.) | map({(.[0]): length}) | add'

# Get failed workflow run branches
gh run list --status failure --json headBranch --jq '[.[].headBranch] | unique'
```

---

## GraphQL API (Advanced)

For anything not covered by built-in commands:

```bash
# Generic pattern
gh api graphql -f query='QUERY_OR_MUTATION' -f varName=value -F numericVar=42

# Check if PR is mergeable
gh api graphql -f query='
  query($owner: String!, $repo: String!, $pr: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $pr) {
        mergeable
        mergeStateStatus
        reviewDecision
      }
    }
  }
' -f owner=OWNER -f repo=REPO -F pr=42

# REST API shorthand
gh api repos/owner/repo/pulls/42/comments    # List PR comments
gh api repos/owner/repo/issues/123/comments   # List issue comments
```
