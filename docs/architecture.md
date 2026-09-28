# Architecture

prequel is one small Express server that shells out to `git` for every diff
and renders the page on the server, plus two browser scripts for interaction.
There is no build step and no client framework.

## Layout

```
bin/prequel.js                CLI: options, port selection, browser launch, `install`
src/server.js                 Express app: the page (/) and the JSON API (/api/*, /healthz)
src/git/gitService.js         git CLI wrapper: refs, review bases, diffs, two-file diffs, blob lines, fingerprint
src/git/diffParser.js         raw patch text -> diff model (files, hunks, lines)
src/render/wordDiff.js        intra-line (word-level) changed ranges
src/render/highlighter.js     Shiki dual-theme syntax highlighting
src/render/renderer.js        diff model -> GitHub-faithful HTML (split and unified), file tree
src/comments/commentStore.js  per-repository comment persistence (~/.prequel/<hash>.json)
src/export/claudeExport.js    comments -> markdown or JSON for an agent
src/installer.js              `prequel install <agent>`: where each agent's skill goes
src/sampleDiff.js             built-in sample diff, shown outside a repository
views/review.ejs              page shell (Primer tokens, the header, the diff container)
public/css/diff.css           the GitHub "Files changed" look
public/js/review.js           toggles, collapse, copy path, Viewed, file tree, context expansion
public/js/comments.js         compose, threads, resolve, export, live updates
skills/prequel/SKILL.md       the agent skill `prequel install claude` copies
```

## A page request

`GET /` (`src/server.js`) builds the whole page on the server:

1. **The patch.** `getDiff` (`src/git/gitService.js`) runs `git diff` for the
   mode: `working` against `HEAD` (plus untracked files, each as a
   `--no-index` patch), `branch` from the merge base of the base and the
   reviewed commit, `all` both. `?branch=` reviews another commit straight
   from git. `?a=&b=` takes the other path, `getBlobPairDiff`: `git diff` of
   two blobs, its header rewritten into a rename or a new file, which the
   parser already understands.
2. **The model.** `parseDiff` (`src/git/diffParser.js`) turns the patch into
   files, hunks and numbered lines.
3. **Decoration.** `annotateWordDiffs` marks the changed ranges within paired
   lines; `highlightDiff` attaches highlighted HTML to every line.
4. **HTML.** `renderDiff` and `renderFileTree` (`src/render/renderer.js`)
   produce the files and the tree; `views/review.ejs` wraps them with the
   header, the mode toggles and the notices.

Everything that differs between a working-tree review, a branch review and a
two-file comparison happens in step 1 and in the template's header; steps 2
to 4 are shared.

## In the browser

`public/js/review.js` handles layout toggles (remembered in `localStorage`
under `prequel:`), collapsing, the Viewed checkboxes, the resizable file tree,
and context expansion: each gap between hunks, and the ends of a file, is an
expander that fetches lines from [`/api/context`](http-api.md#get-apicontext)
(`rev` names where the new side comes from), and "Expand the whole file"
works them to the ends.

`public/js/comments.js` does everything about comments -- composing on a line,
a range or the whole file, threads, replies, resolve and reopen, clear and
undo, export -- through the [comments API](http-api.md#comments). It anchors
each thread by its line, and a thread whose line has gone moves to the top of
its file, marked Outdated. It is off entirely when the page has no comments
(outside a repository, or a two-file comparison).

## Live updates

The server keeps the connected [`/api/events`](http-api.md#get-apievents)
streams and broadcasts every comment change, with the id of the client that
made it, so every open page (and an agent working the review) stays in step
without reloading. While any client is connected it also polls a cheap
fingerprint of the repository (`repoFingerprint`: `HEAD`, the porcelain
status, and each changed file's size and time) every 1.5 seconds, and emits
`diff.changed` when it moves; the page reloads, or offers a Reload button if
you are in the middle of a comment.

## Where things are kept

- **Comments:** `~/.prequel/<hash>.json`, per repository path; never in the
  repository ([details](http-api.md#comments)).
- **Exports:** `.prequel/` in the repository, which prequel adds to
  `.git/info/exclude`.
- **Review bases:** `branch.<name>.reviewbase` in the repository's git config,
  or a `<name>-baseline` tag ([details](http-api.md#review-base)).
- **Page preferences:** the browser's `localStorage` (`prequel:view`,
  `prequel:diff`, `prequel:tree`, `prequel:tree-w`, `prequel:viewed`).
