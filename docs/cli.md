# Command line

```
prequel [repoPath] [options]              serve a review of a repository
prequel install <agent> [--project] [--force]
prequel --version | --help
```

## Serving a review

| Option | Default | Meaning |
|---|---|---|
| `repoPath` | the current directory | Any path inside the repository to serve. Outside a git repository prequel serves a built-in sample diff, so the UI still demonstrates. |
| `--base <ref>` | `main`, else `master`, else `origin`'s default branch | What `branch` and `all` modes diff against: the merge base of it and the reviewed commit. A page's `?base=`, or the reviewed branch's recorded review base, takes precedence ([HTTP API](http-api.md#review-base)). |
| `--diff all\|branch\|working` | `working` | Which changes a page opened without `?diff=` shows ([HTTP API](http-api.md#the-review-page-get-)). |
| `--port <n>` | the first free port from 4711 | The port to listen on. prequel binds `127.0.0.1` only. |
| `--no-open` | open a browser | Do not open the page in a browser. |
| `--base-path <prefix>` | `/` | Serve every page and API route under a URL prefix, for a reverse proxy that mounts prequel at `https://host/<prefix>/`. `/healthz` also answers at the root, so a client can find the prefix. |
| `--static <dir>` | none | Serve `<dir>` as static files at `/`, beside the app, so one process and one port carry both a site and the reviews it links to. Needs `--base-path`: the site takes `/`, the app its prefix. |
| `--version`, `-v` | | Print the installed version and exit. |
| `--help`, `-h` | | Print a usage summary and exit. |

prequel reads the repository on every request: a page for another branch, or
a comparison of two files, comes straight from git; `working` and `all` modes
read the working tree. Nothing is written to the repository except an export
(`.prequel/`, which it adds to `.git/info/exclude`). Comments live in your home
directory ([HTTP API](http-api.md#comments)).

The server has no authentication. It binds `127.0.0.1`, so only this machine
reaches it; put an authenticating proxy in front of it before exposing it any
further ([HTTP API](http-api.md#security)).

## Installing an agent's skill

```
prequel install claude [--project] [--force]
```

Copies the bundled skill (`skills/prequel/SKILL.md`) to
`~/.claude/skills/prequel/SKILL.md`, or with `--project` to
`.claude/skills/prequel/SKILL.md` in the current directory, so that Claude Code
can work a review's comments through the [HTTP API](http-api.md). It reports
`Installed`, `Updated` or `Already current`, and refuses to overwrite a copy you
have edited unless you pass `--force`. At startup, prequel says when an
installed copy has fallen behind the one it ships.

The destination is always `.claude` under your home directory (or the current
directory): a Claude Code configured elsewhere, with `CLAUDE_CONFIG_DIR`, does
not look there, so copy the file into that directory's `skills/` instead.

`claude` is the only agent today; the command takes an agent name so that
others can be added.

## Examples

Review uncommitted work in the repository you are in:

```
prequel
```

Review branches against `main`, without opening a browser; then open
`http://127.0.0.1:4711/?branch=<any branch>`:

```
prequel --diff branch --base main --no-open
```

Serve a site and the reviews it links to from one port, behind a reverse
proxy that maps `https://host/` to `http://127.0.0.1:8832/` (the site at
`https://host/`, reviews at `https://host/diffs/?branch=...`, comparisons at
`https://host/diffs/?a=...&b=...`):

```
prequel /srv/repo --port 8832 --no-open --diff branch --base main \
        --base-path /diffs --static /srv/site
```

## Exit status

| Status | When |
|---|---|
| 0 | Normal exit (the server runs until interrupted) |
| 1 | The server failed to start, or `install` named an unknown agent or met an edited copy |
| 2 | `--static` without `--base-path` |
