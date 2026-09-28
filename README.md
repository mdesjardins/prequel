<p align="center">
  <img src="public/icon.svg" width="96" height="96" alt="">
</p>

<h1 align="center">prequel</h1>

<p align="center">Review your code <i>before</i> it's a pull request.</p>

Prequel is a local web app that renders a local Git repo's diff using a UI that looks like
GitHub's Pull Request **Files changed** tab. Supports system light/dark mode.

<img width="1285" height="718" alt="Screen Shot 2026-08-11 at 11 40 30" src="https://github.com/user-attachments/assets/67adea24-2a1b-4fb2-921c-73618fe2a273" />

## Why

If you're like me, you've probably spent hundreds of hours over more than a decade reviewing code, and you've done almost all of it through Github's pull request review interface. It's comfortable, and for me, it shifts my brain into a "mode" where it can efficiently evaluate and comment on code.

In the day of agentic coding, I was finding that my brain likes this style of review so much that I'd actually push code to Github to review it before telling Claude Code the changes that I wanted it to make. That seemed silly, so I created this thing. It's basically a simulator of Github's PR interface, but works only on your locally staged and unstaged files. You can comment on them and easily dump this into your Claude Code session to make changes.

The repo comes with installable skills for most code agents, so that once you're done commenting, you can run, e.g. `/prequel`, and your agent will make the requested changes and/or reply to your comments.

In the future I'd like to tighten the feedback loop with Claude and not manually refresh the page, etc., but this was mostly a proof of concept.

## Note

This was initially vibe-coded. I've since taken to paying more attention to the code as I've added features and (surprise) people started using it. Having said that, I am a giant hypocrite and am not accepting any AI created contributions to this codebase right now. In fact, I'm going to be really reluctant to accept *any* changes for a while ... I've done open source projects before and it became kind of a chore - I want this to stay fun. 

## Install

```bash
npm install -g @mdesjardins/prequel
```

Then run it from inside any git repo:

```bash
prequel [repoPath] [--base <ref>] [--port <n>] [--no-open]
```

Every option, with examples: [docs/cli.md](docs/cli.md).

## Closing the loop with your agent

Instead of copy/pasting the export, install the bundled skill so Claude Code can read your comments straight from the running server and resolve each one as it
addresses it:

```bash
prequel install claude
```

It goes in `~/.claude/skills` rather than a project's `.claude/skills` because you run prequel *against* other repos — pass `--project` to install into the current
repo instead, if you'd rather commit it and share it with a team. The command refuses to overwrite a skill you've edited unless you pass `--force`. If an installed skill falls behind after an upgrade, prequel says so at startup.

`claude` is the only agent supported today; the command takes an agent name so support for others can be added without renaming it. I don't use or regularly test other agents, I'll accept PRs to add support for others!

Once the skill is installed, from a Claude Code session in the repo you're reviewing you can run `/prequel`. Claude finds the server by scanning ports 4711-4720
and matching the repo root reported by `/healthz`, works the comments one at a time.

The page updates live over an event stream, so comments resolve and Claude's replies appear as it works — no reload. The diff itself is rendered server-side, so when the code changes on disk the page reloads to pick it up; if you're partway through writing a comment it offers a Reload button instead of discarding your draft. Append `?live=0` to the URL to opt out of both.

A comment whose line no longer exists after a change isn't lost — it moves to the top of its file marked **Outdated**, noting the line it used to point at.

Claude can reply in a thread as well as resolve it, which is where it explains a decision or says why it *didn't* make a change.

## Documentation

- [Command line](docs/cli.md): every option, with examples, including serving
  behind a reverse proxy.
- [HTTP API](docs/http-api.md): the page's URL parameters -- review any branch,
  compare two files -- and the JSON API and event stream an agent uses.
- [Architecture](docs/architecture.md): how the source is laid out and how a
  page is built.
- [Changelog](CHANGELOG.md).
