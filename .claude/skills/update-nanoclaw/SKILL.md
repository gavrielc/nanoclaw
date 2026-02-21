---
name: update-nanoclaw
description: Efficiently bring upstream NanoClaw updates into a customized install, with preview, selective cherry-pick, and low token usage.
---

# About

Your NanoClaw fork drifts from upstream as you customize it. This skill pulls upstream changes into your install without losing your modifications.

Run `/update-nanoclaw` in Claude Code.

## How it works

1. **Preflight** checks clean tree, sets up upstream remote, detects branch
2. **Preview** shows upstream changelog bucketed by category (skills, source, config)
3. **You choose**: full merge, cherry-pick specific commits, rebase, or abort
4. **Backup** created right before any changes (timestamped branch + tag)
5. **Conflict preview** dry-runs the merge so you can see conflicts before committing
6. **Apply** runs the chosen strategy; conflicts are resolved by opening only affected files
7. **Validate** runs `npm run build` and `npm test`
8. **Report** prints summary with rollback command

## Scripts

All logic lives in `scripts/`. Each script prints KEY=VALUE lines (machine-readable), then `---`, then a human summary. Exit codes: 0 success, 1 hard failure, 2 user action needed, 3 conflicts present.

| Script | Purpose |
|--------|---------|
| `preflight.sh` | Clean tree, upstream remote, branch detection, fetch |
| `preview.sh` | Changelog, file buckets, commit counts (capped at 30) |
| `backup.sh` | Timestamped backup branch + tag |
| `dryrun-merge.sh` | Conflict preview, always aborts |
| `apply-merge.sh` | Runs git merge |
| `apply-cherry-pick.sh` | Cherry-picks given hashes (validates they exist) |
| `apply-rebase.sh` | Runs git rebase |
| `validate.sh` | Build + test (checks scripts exist first) |
| `report.sh` | Summary with rollback instructions |

## Rollback

The backup tag is printed at the end of each run:
```
git reset --hard pre-update-<hash>-<timestamp>
```

## Token usage

Scripts print structured output so Claude reads data without scanning files. Only conflicted files are opened for resolution.

## Testing

Run `test-sandbox.sh` to create an isolated git environment for manual testing.
Maintainer regression details are in `MAINTAINER_TESTING_INSTRUCTIONS.md`.
Do not open `MAINTAINER_TESTING_INSTRUCTIONS.md` unless the user explicitly asks for maintainer or CI testing.

---

# Instructions for Claude

Run each script from the skill's directory using `bash .claude/skills/update-nanoclaw/scripts/<script>.sh`.
Read the KEY=VALUE lines from each script's output for data. Show the text after `---` to the user.

## Step 1: Preflight

Run `bash .claude/skills/update-nanoclaw/scripts/preflight.sh`

- If exit 2 and STATUS=dirty: tell user to commit or stash, stop.
- If exit 2 and STATUS=no_upstream: ask user for the upstream URL (default: `https://github.com/qwibitai/nanoclaw.git`) using AskUserQuestion, then rerun with `--url <url>`.
- If exit 2 and STATUS=no_branch: show available branches, ask user which to use, stop (manual setup needed).
- If exit 1: show error, stop.
- If exit 0: read UPSTREAM_BRANCH from output.

## Step 2: Preview

Run `bash .claude/skills/update-nanoclaw/scripts/preview.sh $UPSTREAM_BRANCH`

- If HAS_UPDATES=0: tell user they are up to date, stop.
- Show the output to the user.
- Ask using AskUserQuestion:
  - A) **Full update**: merge all upstream changes
  - B) **Selective**: cherry-pick specific commits
  - C) **Abort**: just wanted the preview
  - D) **Rebase**: advanced, linear history (warn: resolves conflicts per-commit)
- If Abort: stop.

## Step 3: Backup

Run `bash .claude/skills/update-nanoclaw/scripts/backup.sh`

- Read BACKUP_TAG from output.

## Step 4: Conflict preview (full merge and rebase only)

If user chose Full update or Rebase:
Run `bash .claude/skills/update-nanoclaw/scripts/dryrun-merge.sh $UPSTREAM_BRANCH`

- If exit 3: show conflicted files, ask user if they want to proceed or abort.
- If exit 0: tell user it is clean, proceed.

## Step 5: Apply

Run the script matching the user's choice:
- Full update: `bash .claude/skills/update-nanoclaw/scripts/apply-merge.sh $UPSTREAM_BRANCH`
- Cherry-pick: `bash .claude/skills/update-nanoclaw/scripts/apply-cherry-pick.sh $UPSTREAM_BRANCH <hash1> <hash2> ...`
  - First show the commit list from Step 2 output and ask user which hashes they want.
- Rebase: `bash .claude/skills/update-nanoclaw/scripts/apply-rebase.sh $UPSTREAM_BRANCH`

## Step 6: Resolve conflicts (if exit 3)

If the apply script exits with 3:
- Read CONFLICTED_FILES from output.
- For each conflicted file:
  - Open the file.
  - Resolve only conflict markers.
  - Preserve intentional local customizations.
  - Incorporate upstream fixes/improvements.
  - Do not refactor surrounding code.
  - `git add <file>`
- Complete the operation:
  - Merge: `git commit --no-edit`
  - Cherry-pick: `git cherry-pick --continue`
  - Rebase: `git rebase --continue`
- If rebase hits conflicts more than 3 times: `git rebase --abort` and recommend merge instead.

## Step 7: Validate

Run `bash .claude/skills/update-nanoclaw/scripts/validate.sh`

- If exit 1: show the error. Only fix issues clearly caused by the merge (missing imports, type mismatches). Do not refactor. If unclear, ask user.

## Step 8: Report

Run `bash .claude/skills/update-nanoclaw/scripts/report.sh $UPSTREAM_BRANCH $BACKUP_TAG`

- Show the full output to the user.
