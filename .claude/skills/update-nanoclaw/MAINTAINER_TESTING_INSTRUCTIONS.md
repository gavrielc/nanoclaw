# Maintainer Testing Instructions

Use this guide when changing `.claude/skills/update-nanoclaw/`.

## Quick Start

Run the full regression suite:

```bash
bash .claude/skills/update-nanoclaw/scripts/run-tests.sh
```

This executes all supported scenarios and validates expected exit codes and `STATUS=` output keys.

## What It Covers

`run-tests.sh` currently validates these sandbox cases:

- `merge-conflict`: preflight/preview/backup, dry-run conflict detection, apply conflict handling, validate, report.
- `clean-merge`: dry-run and apply both succeed without conflicts.
- `no-upstream`: `preflight.sh` returns `STATUS=no_upstream`, then succeeds with `--url`.
- `bad-upstream`: fetch failure path returns `STATUS=error`.
- `no-main-master`: upstream branch detection returns `STATUS=no_branch`.
- `cherry-conflict`: multi-commit cherry-pick where one commit applies and a later commit conflicts.
- `validate-fail`: merge succeeds, validation fails with `STATUS=build_failed`.

## Manual Case Generation

Create a specific local sandbox:

```bash
bash .claude/skills/update-nanoclaw/test-sandbox.sh --case merge-conflict
```

Available `--case` values:

- `merge-conflict`
- `clean-merge`
- `no-upstream`
- `bad-upstream`
- `no-main-master`
- `cherry-conflict`
- `validate-fail`

Machine-readable mode:

```bash
bash .claude/skills/update-nanoclaw/test-sandbox.sh --case clean-merge --quiet
```

It prints keys like `USER_CLONE=...`, `UPSTREAM=...`, and `UPSTREAM_BRANCH=...` for automation.

## CI

CI runs these tests through:

- `.github/workflows/update-nanoclaw-skill-tests.yml`

That workflow triggers on pull requests that touch:

- `.claude/skills/update-nanoclaw/**`
- `.github/workflows/update-nanoclaw-skill-tests.yml`
