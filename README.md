# prequel

*Review it before it's a pull request.*

A local web app that renders a Git repo's diff using a UI that looks like
GitHub's Pull Request **Files changed** tab. Supports system light/dark mode.

<img width="1285" height="718" alt="Screen Shot 2026-08-11 at 11 40 30" src="https://github.com/user-attachments/assets/67adea24-2a1b-4fb2-921c-73618fe2a273" />

## Why

If you're like me, you've probably spent hundreds of hours over more than a decade reviewing code, and you've done almost all of it through Github's pull request review interface. It's comfortable, and for me, it shifts my brain into a "mode" where it can efficiently evaluate and comment on code.

In the day of agentic coding, I was finding that my brain likes this style of review so much that I'd actually push code to Github to review it before telling Claude what changes I wanted made. That seemed silly, so I created this thing. It's basically a simulator of Github's PR interface, but works only on your locally staged and unstaged files. You can comment on them and easily dump this into your Claude Code session to make changes.

In the future I'd like to tighten the feedback loop with Claude and not copy/paste my comments for it to work on, not manually refresh the page, etc., but this was mostly a proof of concept.

## Note

This is almost entirely vibe-coded. I've barely even looked at the code. Having said that, I am a giant hypocrite and am not accepting any AI created contributions to this codebase right now. In fact, I'm not really accepting *any* changes yet. There's a lot I want to do personally before opening this up to that. 

## Install

```bash
npm install -g @mdesjardins/prequel
```

Then run it from inside any git repo:

```bash
prequel [repoPath] [--base <ref>] [--port <n>] [--no-open]
```

## Closing the loop with Claude

Instead of copy/pasting the export, install the bundled skill so Claude Code can
read your comments straight from the running server and resolve each one as it
addresses it:

```bash
prequel install claude
```

It goes in `~/.claude/skills` rather than a project's `.claude/skills` because you
run prequel *against* other repos — pass `--project` to install into the current
repo instead, if you'd rather commit it and share it with a team. The command is
idempotent, and refuses to overwrite a skill you've edited unless you pass
`--force`. If an installed skill falls behind after an upgrade, prequel says so at
startup.

`claude` is the only agent supported today; the command takes an agent name so
support for others can be added without renaming it.

Then, from a Claude Code session in the repo you're reviewing: `/prequel`. Claude finds the server by scanning ports 4711-4720
and matching the repo root reported by `/healthz`, works the comments one at a
time, and `PATCH`es each to `status: resolved` as it goes.

The page updates live over an event stream, so comments resolve and Claude's
replies appear as it works — no reload. Append `?live=0` to the URL to opt out.

Claude can reply in a thread as well as resolve it, which is where it explains a
decision or says why it *didn't* make a change. Its messages are labelled and
accented so they're distinguishable from yours, and they never re-enter its own
work queue. You can also resolve or reopen any comment yourself from the thread.

## Run from source

```bash
npm install
npm start                 # serves the sample diff, opens the browser
npm link                  # makes `prequel` global, with live edits
```

URL params (all optional): `?view=split|unified` picks the layout,
`?diff=working|branch|all` picks which changes to show (default `working`;
persists), `?base=<ref>` overrides the base branch, `?mode=light|dark` forces a
color mode (default follows the OS).

Hunk boundaries carry GitHub-style expanders (up, down, or all for small gaps,
20 lines a click), including one after the last hunk. Each file header has
**Expand all** / **Collapse** and **View file**, which opens the whole file at
`/file/<path>` with a tree of the repository on the left. Files in the diff
accept comments there too, on any line.

## Layout

```
bin/prequel.js             CLI entry (port selection, browser launch, repo resolution)
src/server.js             Express app + routes (/, /file/*, /api/context, /api/comments)
src/git/gitService.js     git CLI wrapper: refs, diff generation, blob lines
src/git/diffParser.js     raw patch text -> diff model
src/render/renderer.js    diff model -> GitHub-faithful HTML (unified + split)
src/render/highlighter.js Shiki dual-theme syntax highlighting + word-diff overlay
src/render/wordDiff.js    intra-line (word-level) diff ranges
src/comments/commentStore.js  per-repo comment persistence (~/.prequel)
src/export/claudeExport.js    build markdown/JSON export payload
src/sampleDiff.js         built-in sample diff (fallback outside a repo)
views/review.ejs          review page shell
views/file.ejs            whole-file page with repository tree
views/partials/head.ejs   shared <head> (Primer tokens + diff.css)
public/css/diff.css       GitHub "Files changed" clone
public/js/review.js       toggles, collapse/expand, copy path, Viewed, context expansion
public/js/tree-pane.js    file-tree pane: show/hide, resize, folder collapse
public/js/comments.js     hover-+, compose, inject threads, delete
```
