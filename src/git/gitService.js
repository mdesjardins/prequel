// Thin wrapper over the `git` CLI. All diffing is delegated to git so the
// output matches real PR semantics (rename detection, binary detection, etc.).
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

// Run git in a repo. `okCodes` lists non-zero exit codes to treat as success
// (git diff --no-index returns 1 when files differ, which is not an error).
function git(repoRoot, args, { okCodes = [0] } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      // core.quotePath=false keeps non-ASCII paths literal instead of octal-escaped.
      ['-c', 'core.quotePath=false', '-C', repoRoot, ...args],
      { maxBuffer: 256 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !okCodes.includes(err.code)) {
          reject(new Error(`git ${args.join(' ')} failed: ${stderr || err.message}`));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

export async function resolveRepoRoot(cwd) {
  try {
    const out = await git(cwd, ['rev-parse', '--show-toplevel']);
    return out.trim() || null;
  } catch {
    return null;
  }
}

// Pick a sensible base ref: prefer main, then master, then origin's default.
export async function getDefaultBase(repoRoot) {
  const candidates = ['main', 'master'];
  for (const ref of candidates) {
    try {
      await git(repoRoot, ['rev-parse', '--verify', '--quiet', ref]);
      return ref;
    } catch {
      /* not present */
    }
  }
  try {
    const out = await git(repoRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
    const ref = out.trim();
    if (ref) return ref; // e.g. "origin/main"
  } catch {
    /* no origin HEAD */
  }
  return 'HEAD'; // last resort: diff against working tree only
}

// Current branch name, or a short SHA when detached.
export async function getHead(repoRoot) {
  const name = (await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (name && name !== 'HEAD') return name;
  const sha = (await git(repoRoot, ['rev-parse', '--short', 'HEAD'])).trim();
  return sha || 'HEAD';
}

const badRef = (ref) => typeof ref !== 'string' || !ref || ref.startsWith('-');

async function mergeBase(repoRoot, base) {
  if (badRef(base)) throw new Error(`invalid base ref: ${base}`);
  try {
    return (await git(repoRoot, ['merge-base', base, 'HEAD'])).trim();
  } catch {
    return base; // base may not share history (e.g. HEAD sentinel) — diff directly
  }
}

const DIFF_FLAGS = ['--no-color', '--find-renames', '--find-copies'];

async function untrackedPatches(repoRoot) {
  const listing = await git(repoRoot, ['ls-files', '--others', '--exclude-standard']);
  const files = listing.split('\n').map((s) => s.trim()).filter(Boolean);
  const patches = [];
  for (const file of files) {
    // --no-index synthesizes an "added file" patch; exit code 1 == differs.
    const patch = await git(
      repoRoot,
      ['diff', ...DIFF_FLAGS, '--no-index', '--', '/dev/null', file],
      { okCodes: [0, 1] }
    );
    if (patch) patches.push(patch);
  }
  return patches.join('');
}

/**
 * Produce the raw combined patch text for the requested mode.
 *  - branch:  committed changes on this branch vs base (closest to a real PR)
 *  - working: uncommitted changes (staged + unstaged) + untracked
 *  - all:     branch commits + working tree + untracked (default; superset)
 */
export async function getDiff(repoRoot, { base, mode = 'all' } = {}) {
  const head = await getHead(repoRoot);
  const baseRef = base || (await getDefaultBase(repoRoot));

  let patch = '';
  let baseRev = 'HEAD';
  if (mode === 'working') {
    patch = await git(repoRoot, ['diff', ...DIFF_FLAGS, 'HEAD']);
    patch += await untrackedPatches(repoRoot);
  } else if (mode === 'branch') {
    baseRev = await mergeBase(repoRoot, baseRef);
    patch = await git(repoRoot, ['diff', ...DIFF_FLAGS, baseRev, 'HEAD']);
  } else {
    // all
    baseRev = await mergeBase(repoRoot, baseRef);
    patch = await git(repoRoot, ['diff', ...DIFF_FLAGS, baseRev]);
    patch += await untrackedPatches(repoRoot);
  }

  return { patch, head, base: baseRef, baseRev, mode };
}

// Absolute on-disk path for a repo-relative file, or null when it escapes the repo.
function insideRepo(repoRoot, filePath) {
  const root = path.resolve(repoRoot);
  const abs = path.resolve(root, filePath);
  return abs.startsWith(root + path.sep) ? abs : null;
}

// Whole-file text. rev === 'WORKTREE' reads the on-disk file (matches what's
// shown for all/working modes, including uncommitted edits); otherwise
// `git show rev:path`. Unreadable or escaping paths yield ''.
export async function getBlobText(repoRoot, { rev, path: filePath }) {
  if (rev === 'WORKTREE') {
    const abs = insideRepo(repoRoot, filePath);
    if (!abs) return '';
    return fs.readFile(abs, 'utf8').catch(() => '');
  }
  return git(repoRoot, ['cat-file', 'blob', `${rev}:${filePath}`]).catch(() => '');
}

export async function blobExists(repoRoot, { rev, path: filePath }) {
  if (rev === 'WORKTREE') {
    const abs = insideRepo(repoRoot, filePath);
    if (!abs) return false;
    return fs
      .stat(abs)
      .then((st) => st.isFile())
      .catch(() => false);
  }
  return git(repoRoot, ['cat-file', '-t', `${rev}:${filePath}`])
    .then((t) => t.trim() === 'blob')
    .catch(() => false);
}

export async function getRepoFiles(repoRoot, { rev }) {
  const out =
    rev === 'WORKTREE'
      ? await git(repoRoot, ['ls-files', '--cached', '--others', '--exclude-standard'])
      : await git(repoRoot, ['ls-tree', '-r', '--name-only', rev]);
  return [...new Set(out.split('\n').map((s) => s.trim()).filter(Boolean))].sort();
}

export function splitLines(content) {
  const all = content.split('\n');
  if (all.length && all[all.length - 1] === '') all.pop(); // drop trailing newline artifact
  return all;
}

export async function getLineCount(repoRoot, { rev, path: filePath }) {
  return splitLines(await getBlobText(repoRoot, { rev, path: filePath })).length;
}

// Fetch a contiguous range of lines from a file for hunk-context expansion.
// start/end are 1-based inclusive. `eof` is true when `end` reached past the
// last line, so the caller can stop offering further downward expansion.
export async function getBlobLines(repoRoot, { rev, path: filePath, start, end }) {
  const all = splitLines(await getBlobText(repoRoot, { rev, path: filePath }));
  const from = Math.max(1, start);
  const lines = all.slice(from - 1, end);
  return { lines, from, eof: end >= all.length };
}
