---
name: prequel
description: Address code review comments left in prequel, the local GitHub-style PR reviewer, resolving each one in its UI as it is fixed. Use when the user asks to work through their prequel review, address review comments, or says they have left comments for you.
---

# Working a prequel review

prequel is a local web app that renders the current repo's diff as a GitHub-style
pull request. The user leaves inline review comments in it; your job is to address
them one at a time and mark each resolved as you go, so they can watch progress in
the browser.

## 1. Find the server

prequel listens on the first free port from 4711 up, unless it was started with
`--port`. Find the instance serving *this* repository by scanning `/healthz` and
matching the repository's common git directory -- the same from the main checkout
or any worktree of it, so this works when you are in a worktree -- or, from an
older server that does not report it, the repo root. Build the API's address from
what the server reports: it sits under a prefix when the server was started with
`--base-path`.

```bash
COMMON=$(cd "$(git rev-parse --git-common-dir)" && pwd)
ROOT=$(git rev-parse --show-toplevel)
PORT=
for p in ${PREQUEL_PORT:-} $(seq 4711 4720); do
  H=$(curl -sf --max-time 1 "http://localhost:$p/healthz") || continue
  case "$H" in *"\"gitCommonDir\":\"$COMMON\""*|*"\"repoRoot\":\"$ROOT\""*) PORT=$p; break ;; esac
done
[ -n "$PORT" ] && API="http://localhost:$PORT$(printf '%s' "$H" | sed -n 's/.*"basePath":"\([^"]*\)".*/\1/p')/api"
echo "API=$API"
```

When the user runs prequel on a port outside 4711-4720, set `PREQUEL_PORT` to it
first; it is tried before the scan.

If no port matches, prequel is not running for this repo. Tell the user to start it
(`prequel` from inside the repo) and stop — do not guess a port, and do not fall
back to reading `~/.prequel/*.json` directly, since writes there won't reach the
open page.

## 2. Fetch the open comments

```bash
curl -s "$API/comments?status=open&author=user&roots=1"
```

All three filters matter: `author=user` and `roots=1` keep your own replies out of
the list, so you never end up trying to "address" something you wrote yourself.

Each comment has:

| Field | Meaning |
|---|---|
| `id` | The handle you resolve against |
| `filePath` | Repo-relative path |
| `side` | `new`, `old`, or `file` (a whole-file comment, not tied to a line) |
| `startLine`, `endLine` | Line range on that side; both `0` when `side` is `file` |
| `lineSnapshot` | The code as it looked when the comment was written |
| `body` | The user's comment, as markdown |
| `branch` | Branch the comment was written on; may be `null` |
| `bodyHtml` | Rendered markdown — ignore it, read `body` |

Skip any comment whose `branch` is set and differs from the current branch
(`git branch --show-current`). A `null` branch means "unknown" — include it.

**Line numbers may have shifted** since the comment was written, especially once
you've started editing. Treat `lineSnapshot` as the authoritative locator and
`startLine` as a hint; find the snapshot text in the file rather than trusting the
number.

## 3. Work them one at a time

For each comment, in file order: read the surrounding code, make the change, then
immediately mark it resolved:

```bash
curl -s -X PATCH "$API/comments/$ID" \
  -H 'content-type: application/json' -d '{"status":"resolved"}'
```

Resolve after each fix, not in a batch at the end — the point is that the user
watches them clear in the browser as you work. The page updates live, so both the
reply and the resolve appear as you go.

Related comments in the same file can be fixed together, but resolve them
individually so the UI stays accurate.

## 4. Reply when the fix isn't self-explanatory

You can post a reply into a comment's thread. A reply needs only the parent id and
a body — it inherits the file and line from the comment it answers:

```bash
curl -s -X POST "$API/comments" \
  -H 'content-type: application/json' \
  -d '{"parentId":"'"$ID"'","author":"claude","body":"Renamed to `parseHunk`; the old name shadowed the import."}'
```

Always pass `"author":"claude"` so your messages are visually distinct and stay out
of the work queue.

Don't reply "done" to every comment — the resolved state already says that. Reply
when there's something the diff doesn't show: a decision you made, an assumption,
a caveat, or a follow-up you didn't do.

**Reply and leave it open when you don't make the change.** If you disagree, can't
safely make it, or the comment is ambiguous, post a reply explaining why and leave
the comment open. Do not resolve it. An open comment is the signal that it still
needs a human, and the reply is what tells them why — put the reasoning in the
thread, not only in your terminal summary, because the browser is where they're
looking.

## 5. Report

When done, summarize briefly: what you changed, and any comments you left open and
why. Don't restate every comment — the user wrote them and can see the page.
