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

prequel listens on the first free port from 4711 up. Find the instance serving
*this* repo by scanning and matching the repo root:

```bash
ROOT=$(git rev-parse --show-toplevel)
for p in $(seq 4711 4720); do
  if curl -sf --max-time 1 "http://localhost:$p/healthz" | grep -qF "\"repoRoot\":\"$ROOT\""; then
    echo "PREQUEL_PORT=$p"; break
  fi
done
```

If no port matches, prequel is not running for this repo. Tell the user to start it
(`prequel` from inside the repo) and stop — do not guess a port, and do not fall
back to reading `~/.prequel/*.json` directly, since writes there won't reach the
open page.

## 2. Fetch the open comments

```bash
curl -s "http://localhost:$PORT/api/comments?status=open&author=user&roots=1"
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
| `kind` | `suggestion` (carries an exact code change), `question` (mentions `@agent`, wants an answer), or `comment` |
| `suggestion` | `{ lines }` for a suggestion: the exact replacement for `lineSnapshot`; `null` otherwise |
| `applicable` | `true` when the snapshot still matches the file on disk, `false` when the lines changed; `null` without a suggestion |
| `handoff` | `"agent"` when the user pressed *Let agent do it*; the change is yours to make |
| `applied` | `true` once a suggestion was written to disk (by the user or by you) |

Skip any comment whose `branch` is set and differs from the current branch
(`git branch --show-current`). A `null` branch means "unknown" — include it.

**Line numbers may have shifted** since the comment was written, especially once
you've started editing. Treat `lineSnapshot` as the authoritative locator and
`startLine` as a hint; find the snapshot text in the file rather than trusting the
number.

## 3. Apply suggestions first

Comments with `kind: "suggestion"` carry the exact lines the user wants in place
of `lineSnapshot`. Handle these before the prose comments:

- `applicable: true` — let the server write and resolve it for you:

  ```bash
  curl -s -X POST "http://localhost:$PORT/api/comments/$ID/apply"
  ```

  A `409` means the file changed underneath; fall through to the next case.
- `applicable: false` — the lines moved or changed. Find `lineSnapshot` in the file,
  apply the intent of `suggestion.lines` by hand, then resolve and reply with one
  line saying how the result differs from the literal suggestion.
- `handoff: "agent"` — the user chose *Let agent do it*; treat it like the case above
  and always make the change yourself.

## 4. Answer questions instead of editing

A comment with `kind: "question"` contains `@agent`. The user wants an answer,
not a change. Reply in the thread (section 6) and mark it resolved. Do not edit
code for a question unless the reply itself says you did.

## 5. Work the rest one at a time

For each comment, in file order: read the surrounding code, make the change, then
immediately mark it resolved:

```bash
curl -s -X PATCH "http://localhost:$PORT/api/comments/$ID" \
  -H 'content-type: application/json' -d '{"status":"resolved"}'
```

Resolve after each fix, not in a batch at the end — the point is that the user
watches them clear in the browser as you work. The page updates live, so both the
reply and the resolve appear as you go.

Related comments in the same file can be fixed together, but resolve them
individually so the UI stays accurate.

## 6. Reply when the fix isn't self-explanatory

You can post a reply into a comment's thread. A reply needs only the parent id and
a body — it inherits the file and line from the comment it answers:

```bash
curl -s -X POST "http://localhost:$PORT/api/comments" \
  -H 'content-type: application/json' \
  -d '{"parentId":"'"$ID"'","author":"claude","body":"Renamed to `parseHunk`; the old name shadowed the import."}'
```

Always pass `"author":"claude"` (the API value for agent-authored messages, whatever
agent you are) so your messages are visually distinct and stay out of the work queue.

Don't reply "done" to every comment — the resolved state already says that. Reply
when there's something the diff doesn't show: a decision you made, an assumption,
a caveat, or a follow-up you didn't do.

**Reply and leave it open when you don't make the change.** If you disagree, can't
safely make it, or the comment is ambiguous, post a reply explaining why and leave
the comment open. Do not resolve it. An open comment is the signal that it still
needs a human, and the reply is what tells them why — put the reasoning in the
thread, not only in your terminal summary, because the browser is where they're
looking.

## 7. Task lists and images

A comment body may contain task items (`- [ ] rename the helper`). Tick each one as
you finish it, by index counted from the first task item in that comment:

```bash
curl -s -X PATCH "http://localhost:$PORT/api/comments/$ID" \
  -H 'content-type: application/json' -d '{"taskIndex":0,"checked":true}'
```

Bodies may reference images as `.prequel/attachments/<file>` inside the repo;
open them when the comment depends on what they show.

## 8. Report

When done, summarize briefly: what you changed, and any comments you left open and
why. Don't restate every comment — the user wrote them and can see the page.
