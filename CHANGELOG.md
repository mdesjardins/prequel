# Changelog

Notable changes, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are
`package.json`'s.

## [Unreleased]

### Added

- `--diff all|branch|working`: the mode a page opened without `?diff=` shows.
- Review any branch: `?branch=<ref>` reads a branch straight from git, with a
  per-branch review base (`branch.<name>.reviewbase`, or a `<name>-baseline`
  tag), a branch picker, and `gitCommonDir` in `/healthz` so a client in a
  worktree can find the server.
- `--base-path <prefix>`: serve every route under a URL prefix, behind a
  reverse proxy.
- `--static <dir>`: serve a site at `/` beside the app, from one process and
  port.
- Compare two files: `?a=<rev>:<path>&b=<rev>:<path>` (labelled with `la`,
  `lb`) shows `b` against `a` -- the same path at two revisions, or two
  paths -- read-only; `b` alone shows a file whole.
- Expand the whole file: an expander after a file's last hunk, and a per-file
  button that works every expander to the ends.
- Documentation: [command line](docs/cli.md), [HTTP API](docs/http-api.md),
  [architecture](docs/architecture.md), and this changelog, all shipped in the
  package.

### Changed

- The bundled skill finds a server by the repository's common git directory
  (so from a worktree too), under the base path `/healthz` reports, and on
  `PREQUEL_PORT` before scanning 4711-4720.

### Fixed

- File-tree links (`#diff-<id>`) stay on the reviewed branch: the page's
  `<base href>` carries the query string.
- Context expansion reads a revision through textconv, as the diff did, so
  expanded lines line up with the hunks.
- Expanding upward twice keeps the file in order (it read lines 7-26, then 1-6).

## [0.4.0] - 2026-09-14

### Added

- The page refreshes when the code changes on disk, and offers a Reload
  button instead while you are writing a comment.
- A comment whose line no longer exists moves to the top of its file, marked
  Outdated, instead of disappearing from the page.

## [0.3.3] and earlier

See the [repository history](https://github.com/mdesjardins/prequel/commits/v0.3.3).

[Unreleased]: https://github.com/mdesjardins/prequel/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/mdesjardins/prequel/compare/v0.3.3...v0.4.0
[0.3.3]: https://github.com/mdesjardins/prequel/releases/tag/v0.3.3
