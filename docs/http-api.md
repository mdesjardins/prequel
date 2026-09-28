# HTTP API

What a running prequel serves: the review page, which takes its options from
the URL, and a small JSON API that the page and agent integrations (the bundled
skill) use.

Every path below is relative to the server's base path: `/`, or the prefix
given with `--base-path` ([command line](cli.md)). The page addresses the API
with relative URLs under a `<base href>`, so it works under any prefix; a
client should take the prefix from [`/healthz`](#get-healthz), which also
answers at the root.

## The review page: `GET /`

| Parameter | Values | Default | Meaning |
|---|---|---|---|
| `view` | `split`, `unified` | `split` | Layout. Remembered in the browser (`localStorage`, `prequel:view`) and re-applied when the URL does not say. |
| `mode` | `light`, `dark` | follows the OS | Color scheme. |
| `diff` | `working`, `branch`, `all` | `--diff`, else `working` | Which changes: `working` is uncommitted (staged and unstaged) and untracked files against `HEAD`; `branch` the commits since the merge base with `base`; `all` both. Remembered (`prequel:diff`). |
| `base` | a ref | the branch's [review base](#review-base), else `--base`, else `main` / `master` / `origin`'s default | What `branch` and `all` diff against. |
| `branch` | a ref naming a commit | the checked-out branch | Review another branch straight from git. The mode is then `branch`: that branch's working tree is not the one on disk. The page's branch picker lists the local branches. |
| `a`, `b` | `<rev>:<path>` | | [Compare two files](#comparing-two-files-ab). |
| `la`, `lb` | text, up to 120 characters | the two revisions | Labels for the two sides of a comparison. |
| `live` | `0` | on | `0` turns live updates off: comment changes and [diff refresh](#get-apievents). |

Anything invalid is shown on the page as an error rather than failing the
request.

### Review base

A branch can record the base it should be reviewed against, so its page opens
on exactly the change it was prepared for:

```
git config branch.<name>.reviewbase <ref>      # this clone only
git tag <name>-baseline <commit>               # travels with a push
```

The config wins over the tag; `?base=` wins over both. When the base and the
reviewed commit share no history, the two are diffed directly.

### Comparing two files: `?a=&b=`

```
/?a=<rev>:<path>&b=<rev>:<path>[&la=<label>&lb=<label>]
```

Renders one file: `b` against `a`. The same path at two revisions, or two
different paths -- two copies of a file that no pair of commits relates, since
git diffs a path only against itself. With `b` alone (or `a` alone) the file is
shown whole, as new.

- Each spec must name a file (a blob) in a commit: `HEAD:src/x.js`,
  `main:docs/a.md`, `3f2a9c1:lib/y.py`. A directory, a missing path, or
  anything starting with `-` is refused.
- Two different paths read as a rename: the header shows `a-path -> b-path`.
- textconv drivers apply, by each path's attributes, as they do in a branch
  review.
- Context expansion reads `b`'s side from `b`'s commit.
- The page is read-only: comments belong to a branch, and a comparison has
  none. It says so, or that the two files are identical.

Example -- the same module in two projects of one commit:

```
/?a=HEAD:projects/one/lib/util.py&b=HEAD:projects/two/lib/util.py&la=one&lb=two
```

## JSON API

Requests and responses are JSON (`content-type: application/json`; bodies up
to 1 MB). An error answers with `{ "error": "<message>" }` and a 4xx or 5xx
status.

### `GET /healthz`

Identifies the server and the repository it serves.

```json
{
  "ok": true,
  "app": "prequel",
  "repoRoot": "/home/me/src/project",
  "gitCommonDir": "/home/me/src/project/.git",
  "head": "main",
  "basePath": "/diffs"
}
```

| Field | Meaning |
|---|---|
| `repoRoot` | The repository's top level, as served. |
| `gitCommonDir` | The repository's common git directory, absolute: the same from the main checkout and every worktree of it. Match on this to find the server for a repository from anywhere in it. |
| `head` | The checked-out branch, or a short commit id when detached. |
| `basePath` | `""`, or the prefix every other path is under. |

Finding the server for the repository you are in, as the bundled skill does:

```bash
COMMON=$(cd "$(git rev-parse --git-common-dir)" && pwd)
for p in ${PREQUEL_PORT:-} $(seq 4711 4720); do
  H=$(curl -sf --max-time 1 "http://localhost:$p/healthz") || continue
  case "$H" in *"\"gitCommonDir\":\"$COMMON\""*) PORT=$p; break ;; esac
done
API="http://localhost:$PORT$(printf '%s' "$H" | sed -n 's/.*"basePath":"\([^"]*\)".*/\1/p')/api"
```

### `GET /api/branches`

The local branches, most recently committed first, each with its recorded
review base.

```json
{ "branches": [ { "name": "feature/x", "current": false, "reviewBase": "feature/x-baseline" } ] }
```

### `GET /api/context`

Lines of a file, for expanding the context around a hunk.

| Parameter | Meaning |
|---|---|
| `path` | Repository-relative path. |
| `rev` | `WORKTREE` (the file on disk; the default), `HEAD`, or a ref. A revision is read through textconv, as the diff was. |
| `start`, `end` | 1-based, inclusive line numbers of the new side. |

```json
{ "from": 21, "eof": false, "lines": ["..."], "html": ["<span ...>...</span>"] }
```

`eof` is true when `end` reached the end of the file; `html` is the lines
syntax-highlighted.

### Comments

Comments are kept per repository in your home directory,
`~/.prequel/<first 16 hex digits of sha1(repoRoot)>.json` (as
`{ "repoRoot": ..., "comments": [...] }`), never in the repository. The file
follows the repository's path: a repository moved elsewhere starts with no
comments, and its old file stays behind under the old path's hash.

A comment:

| Field | Meaning |
|---|---|
| `id` | A UUID. |
| `parentId` | `null` for a thread's first comment; a reply carries its root's `id`. Replies are one level deep. |
| `author` | `user` or `claude`. An agent's own messages are marked so they stay out of its work queue. |
| `status` | `open` or `resolved`. |
| `filePath` | Repository-relative path. |
| `side` | `new`, `old`, or `file` (about the whole file, not a line). |
| `startLine`, `endLine` | The line range on that side; both `0` when `side` is `file`. |
| `lineSnapshot` | The lines as they read when the comment was written: the reliable locator once the code has moved. |
| `body` | Markdown. Responses add `bodyHtml`, rendered. |
| `branch` | The branch it was written on, or `null`. |
| `repoRoot`, `createdAt`, `updatedAt` | The repository, and ISO 8601 times. |

A request that changes comments may send `x-prequel-client: <any id>`; the
[event](#get-apievents) it causes carries that id as `origin`, so the client
that made the change can skip its own echo.

#### `GET /api/comments`

`{ "comments": [...] }`, filtered by any of:

| Parameter | Meaning |
|---|---|
| `branch` | Only comments written on this branch. |
| `status` | `open` or `resolved`. A comment from before statuses existed counts as `open`. |
| `author` | `user` or `claude`. |
| `roots` | `1`: thread-starting comments only, no replies. |

An agent working a review wants `?status=open&author=user&roots=1`.

#### `POST /api/comments`

A new thread:

```json
{ "filePath": "src/x.js", "side": "new", "startLine": 12, "endLine": 14,
  "body": "Why not reuse parseHunk?", "branch": "feature/x",
  "lineSnapshot": ["..."], "author": "user" }
```

`side` defaults to `new` and `endLine` to `startLine`; for `side: "file"` the
lines are `0`. A reply names only its thread and inherits the rest:

```json
{ "parentId": "<root id>", "author": "claude", "body": "Renamed; the old name shadowed the import." }
```

Answers `{ "comment": {...} }`; 400 for missing fields or a reply to a reply,
404 for an unknown parent.

#### `PATCH /api/comments/:id`

`{ "body": "...", "status": "open" | "resolved" }`, either or both. Answers
`{ "comment": {...} }`, or 404.

#### `DELETE /api/comments/:id`

Deletes a comment, and a thread's replies with it. Answers
`{ "ok": true, "removed": <number deleted> }`, or `{ "ok": false, "removed": false }`.

#### `POST /api/comments/clear`, `POST /api/comments/restore`

`clear` takes `{ "branch": "..." }` (omit it for every comment) and answers
`{ "cleared": <n> }`. The cleared comments are kept in memory for one
`restore`, which answers `{ "restored": <n> }`; the undo does not survive a
restart.

### `POST /api/export`

`{ "branch": "...", "format": "md" | "json" }`. Collects the thread-starting
comments you wrote (any status), writes them to
`.prequel/review-<timestamp>.<md|json>` in the repository (adding `.prequel/` to
`.git/info/exclude`), and answers `{ "count": <n>, "content": "...", "path": ".prequel/review-..." }`
so the page can also copy it to the clipboard. The markdown groups comments by
file, quotes each one's code snapshot, and marks each with its id as
`<!-- prequel:id ... -->`. With no comments, `count` is 0 and nothing is written.

### `GET /api/events`

A Server-Sent Events stream of what changed, as `data: {"type": ..., "origin": ..., ...}`:

| `type` | Carries | Meaning |
|---|---|---|
| `comment.created` | `comment` | A comment or reply was added. |
| `comment.updated` | `comment` | A body or status changed. |
| `comment.deleted` | `id` | A comment (and its replies) went. |
| `comments.reset` | | A clear or restore: fetch the comments again. |
| `diff.changed` | | The repository changed on disk: render again. |

The stream sends a keep-alive comment every 25 seconds and asks the browser to
reconnect after 2. While at least one client is connected, the server
fingerprints the repository every 1.5 seconds -- `HEAD`, the porcelain status,
and each changed file's size and modification time -- and emits `diff.changed`
when that moves. It watches the checked-out working tree: a page reviewing
another branch refreshes on those changes too, not when that branch gains
commits.

## Security

prequel has no authentication or authorization. Anything that can reach the
port can read every commit in the repository and the files in its working
tree, and can write comments and exports. It binds `127.0.0.1`; to reach it
from elsewhere, put an authenticating reverse proxy in front of it
(`--base-path` exists for that). Refs and specs from a request are validated --
each must name a commit, or a file in one, and none may begin with `-` -- and
git always runs without a shell.
