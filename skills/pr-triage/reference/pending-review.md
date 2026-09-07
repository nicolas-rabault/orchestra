# Drafting a pending review on GitHub

A **pending** review is a draft. Only you can see it, in the GitHub PR UI, until you
press "Submit review" yourself. This file is the exact mechanism. Follow it literally.

`OWNER/REPO` below is always `$(gh repo view --json nameWithOwner -q .nameWithOwner)`, read at the
start of the run. Never type a repository name into one of these calls.

## The one rule

`POST /repos/{owner}/{repo}/pulls/{n}/reviews` **with no `event` field** creates a
review in state `PENDING`.

Adding `event` (`APPROVE`, `REQUEST_CHANGES`, `COMMENT`) publishes it immediately.
Never send `event`.

## Commands that publish (never run these)

| Command | What it does |
|---|---|
| `gh pr review --approve` | publishes an approval |
| `gh pr review --request-changes` | publishes a change request |
| `gh pr review --comment` | publishes a review comment |
| `gh pr comment` | publishes an issue comment on the PR thread |
| `gh api .../reviews -f event=...` | publishes |

`gh pr comment` is the trap. It posts a visible top-level comment, not a review, and
the inline notes are silently dropped. If you catch yourself reaching for it, stop.

## Procedure

### 1. Clear your own stale pending review

GitHub allows exactly one pending review per user per PR. A leftover one makes the
POST fail or silently merge into the old draft.

```bash
ME=$(gh api user -q .login)
STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)   # the watermark step 4's leak check compares against
gh api "repos/$REPO/pulls/N/reviews" \
  -q ".[] | select(.user.login==\"$ME\" and .state==\"PENDING\") | .id"
```

Delete any id returned:

```bash
gh api -X DELETE "repos/$REPO/pulls/N/reviews/REVIEW_ID"
```

### 2. Build the payload as a JSON file

`gh api -f body=@file` and `-F body=@file` do **not** read the file contents here.
Write real JSON and use `--input`.

```python
import json

body = """Summary paragraph. No em dash. No signature."""

comments = [
    {"path": "src/train.py", "line": 189, "side": "RIGHT",
     "body": "Inline note."},
    {"path": "src/rollout.py", "start_line": 180, "start_side": "RIGHT",
     "line": 184, "side": "RIGHT",
     "body": "Multi-line note spanning 180-184."},
]

json.dump({"body": body, "comments": comments},
          open("review_payload.json", "w"))
```

Write it into the session scratchpad, not the repo. Any language that can write JSON does; the
project you are triaging need not be a Python one.

Comment field rules:

- `path` is repo-relative, as it appears in the diff.
- `line` must be a line **present in the diff hunk**. A line outside any hunk returns
  `422 Unprocessable Entity`.
- `side`: `RIGHT` for added or context lines, `LEFT` for removed lines.
- Multi-line span: `start_line` + `start_side` plus `line` + `side`.
- File-level comment with no line: `{"path": ..., "subject_type": "file", "body": ...}`.
- `commit_id` is optional and defaults to the PR head. Omit it.

### 3. POST it

```bash
gh api "repos/$REPO/pulls/N/reviews" -X POST \
  --input review_payload.json -q '{id, state}'
```

Expect `"state": "PENDING"`.

### 4. Verify before reporting back

Two checks. Both must pass. Do not tell the user the draft is ready until they do.

```bash
gh api "repos/$REPO/pulls/N/reviews/REVIEW_ID" -q .state
gh api "repos/$REPO/pulls/N/reviews/REVIEW_ID/comments" \
  -q '.[] | "\(.path):\(.line)"'
```

First must print `PENDING`. Second must list every inline comment you sent. If the
count is short, some `line` values fell outside the diff: fix those and redo from
step 1.

Then confirm nothing leaked into the public thread:

```bash
gh api "repos/$REPO/issues/N/comments" \
  -q ".[] | select(.user.login==\"$ME\" and .created_at > \"$STARTED\") | .id"
```

Must be empty. If not, THIS RUN published something: tell the user immediately and
offer to delete it.

`$STARTED` is load-bearing, not decoration. `$ME` is the maintainer's own account, and
maintainers comment on their own pull requests routinely — the sweep's own watermark
filters `me` out for exactly that reason. Without the timestamp this fires on every PR
they ever replied to and offers to delete a legitimate comment, and a safety check that
cries wolf is one that gets ignored.

## 422 troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `line must be part of the diff` | line outside every hunk | re-read `gh pr diff`, pick a line inside a `@@` hunk |
| `pull_request_review_thread.line` invalid | `side` wrong for that line | added or context line is `RIGHT`, removed is `LEFT` |
| `user can only have one pending review` | stale draft | step 1 |
| `path` not found | file renamed in the PR | use the new path, the one on the right of the rename |
