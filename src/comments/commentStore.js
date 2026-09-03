// Central, per-repo comment persistence: ~/.prequel/<repo-hash>.json.
// Keeps the reviewed repo pristine (nothing to gitignore). Each comment is
// tagged with the branch it was written on. Writes are atomic (temp + rename).

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

export const prequelHome = () => process.env.PREQUEL_HOME || path.join(os.homedir(), '.prequel');

export async function writeFileAtomic(dest, data) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  const mode = await fs.stat(dest).then((st) => st.mode, () => undefined);
  await fs.writeFile(tmp, data, { mode });
  await fs.rename(tmp, dest);
}

export const writeJsonAtomic = (dest, data) => writeFileAtomic(dest, JSON.stringify(data, null, 2));

export async function readJsonArray(file, key) {
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    return Array.isArray(data[key]) ? data[key] : [];
  } catch {
    return [];
  }
}

function fileFor(repoRoot) {
  const hash = crypto.createHash('sha1').update(repoRoot).digest('hex').slice(0, 16);
  return path.join(prequelHome(), `${hash}.json`);
}

const readAll = (repoRoot) => readJsonArray(fileFor(repoRoot), 'comments');

const writeAll = (repoRoot, comments) => writeJsonAtomic(fileFor(repoRoot), { repoRoot, comments });

const locks = new Map();

export function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.catch(() => {}));
  return next;
}

const locked = (repoRoot, fn) => withLock(`comments:${repoRoot}`, fn);

export async function listComments(repoRoot, branch) {
  const all = await readAll(repoRoot);
  return branch ? all.filter((c) => c.branch === branch) : all;
}

export function addComment(repoRoot, data) {
  return locked(repoRoot, () => addLocked(repoRoot, data));
}

async function addLocked(repoRoot, data) {
  const all = await readAll(repoRoot);
  const now = new Date().toISOString();
  const comment = {
    id: crypto.randomUUID(),
    repoRoot,
    createdAt: now,
    updatedAt: now,
    status: 'open',
    ...data,
  };
  all.push(comment);
  await writeAll(repoRoot, all);
  return comment;
}

export async function getComment(repoRoot, id) {
  const all = await readAll(repoRoot);
  return all.find((c) => c.id === id) || null;
}

export function updateComment(repoRoot, id, patch) {
  return updateCommentWith(repoRoot, id, () => patch);
}

// `fn(comment)` returns the patch to apply, or null to reject the update.
export function updateCommentWith(repoRoot, id, fn) {
  return locked(repoRoot, async () => {
    const all = await readAll(repoRoot);
    const comment = all.find((c) => c.id === id);
    if (!comment) return null;
    const patch = fn(comment);
    if (!patch) return { comment, rejected: true };
    Object.assign(comment, patch, { updatedAt: new Date().toISOString() });
    await writeAll(repoRoot, all);
    return comment;
  });
}

// Deleting a root comment also deletes its replies — a reply without its
// comment has nothing to attach to and would be invisible in the UI.
export function deleteComment(repoRoot, id) {
  return locked(repoRoot, () => deleteCommentLocked(repoRoot, id));
}

async function deleteCommentLocked(repoRoot, id) {
  const all = await readAll(repoRoot);
  if (!all.some((c) => c.id === id)) return false;
  const kept = all.filter((c) => c.id !== id && c.parentId !== id);
  await writeAll(repoRoot, kept);
  return all.length - kept.length;
}

// In-memory buffer of the last bulk-clear, so the UI can offer a quick Undo.
const lastCleared = new Map();

export function clearComments(repoRoot, branch) {
  return locked(repoRoot, () => clearCommentsLocked(repoRoot, branch));
}

async function clearCommentsLocked(repoRoot, branch) {
  const all = await readAll(repoRoot);
  const cleared = branch ? all.filter((c) => c.branch === branch) : all.slice();
  const kept = branch ? all.filter((c) => c.branch !== branch) : [];
  lastCleared.set(repoRoot, cleared);
  await writeAll(repoRoot, kept);
  return cleared.length;
}

export function restoreCleared(repoRoot) {
  return locked(repoRoot, () => restoreClearedLocked(repoRoot));
}

async function restoreClearedLocked(repoRoot) {
  const cleared = lastCleared.get(repoRoot);
  if (!cleared || !cleared.length) return 0;
  const all = await readAll(repoRoot);
  all.push(...cleared);
  lastCleared.delete(repoRoot);
  await writeAll(repoRoot, all);
  return cleared.length;
}
