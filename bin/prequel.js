#!/usr/bin/env node
import { createServer as createNetServer } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import open from 'open';
import { createServer } from '../src/server.js';
import { resolveRepoRoot } from '../src/git/gitService.js';
import { install, staleTargets, TARGET_NAMES } from '../src/installer.js';

const VERSION = JSON.parse(
  readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
).version;

// --- tiny arg parser (avoid a dependency for Phase 0) --------------------
function parseArgs(argv) {
  const opts = { repoPath: process.cwd(), base: null, port: null, open: true, diff: null, basePath: '', staticDir: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') opts.base = argv[++i];
    else if (a === '--diff') opts.diff = argv[++i];
    else if (a === '--base-path') opts.basePath = argv[++i];
    else if (a === '--static') opts.staticDir = argv[++i];
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--no-open') opts.open = false;
    else if (a === '--project') opts.project = true;
    else if (a === '--force' || a === '-f') opts.force = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--version' || a === '-v' || a === '-V') opts.version = true;
    else if (!a.startsWith('-')) positional.push(a);
  }
  if (positional[0]) opts.repoPath = positional[0];
  return opts;
}

const HELP = `prequel — local GitHub-style PR diff reviewer

Usage:
  prequel [repoPath] [--base <ref>] [--diff all|branch|working] [--base-path /p] [--static <dir>] [--port <n>] [--no-open]
  prequel install <agent> [--project] [--force]

  repoPath   Path to the git repo (default: current directory)
  --base     Base ref to diff against (default: main/master)
  --diff     Which changes to show when the page is opened without ?diff=
             (all | branch | working; default: working)
  --base-path  URL prefix the app is served under, e.g. /diffs when a
             reverse proxy mounts it at https://host/diffs/ (default: /)
  --static   Serve <dir> as static files at /, beside the app, which then
             needs --base-path: one process and one port carry both a site
             and the reviews it links to
  --port     Port to listen on (default: first free from 4711)
  --no-open  Don't auto-open the browser
  --version  Print the installed version and exit

install sets up a coding agent to work a review directly — reading your
comments, fixing them one at a time, and resolving each in the UI as it goes.

  <agent>    claude — installs a skill; then run /prequel in Claude Code
  --project  Install into the current repo instead of your home directory, so
             it can be committed and shared with a team
  --force    Overwrite an installed file you have edited
`;

function findFreePort(start) {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once('error', () => {
      // port in use — try the next one
      findFreePort(start + 1).then(resolve, reject);
    });
    srv.once('listening', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.listen(start, '127.0.0.1');
  });
}

async function runInstall(target, opts) {
  if (!target || !TARGET_NAMES.includes(target)) {
    process.stderr.write(
      `\n  ${target ? `Unknown agent: ${target}` : 'Specify an agent'} — supported: ${TARGET_NAMES.join(', ')}\n` +
        `  e.g. prequel install ${TARGET_NAMES[0]}\n\n`
    );
    process.exitCode = 1;
    return;
  }
  const { status, dest } = await install(target, { project: opts.project, force: opts.force });
  if (status === 'conflict') {
    process.stderr.write(
      `\n  A different version is already installed at\n    ${dest}\n` +
        '  Re-run with --force to overwrite it.\n\n'
    );
    process.exitCode = 1;
    return;
  }
  const verb = { installed: 'Installed', updated: 'Updated', current: 'Already current' }[status];
  process.stdout.write(`\n  ${verb}: ${dest}\n  Run /prequel in a Claude Code session to use it.\n\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);
  if (opts.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }
  if (argv[0] === 'install') return runInstall(argv[1], opts);

  const repoRoot = await resolveRepoRoot(opts.repoPath);
  // A non-repo is tolerated: the server falls back to the built-in sample diff.
  const effectiveRepo = repoRoot || opts.repoPath;

  const basePath = ('/' + (opts.basePath || '')).replace(/\/+/g, '/').replace(/\/$/, '');
  if (opts.staticDir && !basePath) {
    console.error('--static needs --base-path: the site takes /, the app a prefix');
    process.exit(2);
  }
  const app = createServer({ repoRoot, defaultBase: opts.base, defaultDiff: opts.diff, basePath, staticDir: opts.staticDir });
  const port = opts.port || (await findFreePort(4711));

  app.listen(port, '127.0.0.1', async () => {
    const url = `http://127.0.0.1:${port}${basePath}/`;
    process.stdout.write(`\n  prequel running at ${url}\n`);
    process.stdout.write(`  repo: ${effectiveRepo}${repoRoot ? '' : '  (not a git repo — showing sample diff)'}\n`);
    process.stdout.write('  Ctrl-C to stop\n');
    for (const target of await staleTargets()) {
      process.stdout.write(
        `  (your installed ${target} integration is out of date — run: prequel install ${target} --force)\n`
      );
    }
    process.stdout.write('\n');
    if (opts.open) {
      try {
        await open(url);
      } catch {
        /* headless / no browser — ignore */
      }
    }
  });
}

main().catch((err) => {
  process.stderr.write(`prequel failed to start: ${err.message}\n`);
  process.exit(1);
});
