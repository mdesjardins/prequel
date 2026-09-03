import path from 'node:path';
import crypto from 'node:crypto';
import { prequelHome, readJsonArray, withLock, writeJsonAtomic } from './commentStore.js';

const file = () => path.join(prequelHome(), 'saved-replies.json');

const readAll = () => readJsonArray(file(), 'replies');

export async function listSavedReplies() {
  return readAll();
}

const locked = (fn) => withLock('saved-replies', fn);

export function addSavedReply({ name, body }) {
  return locked(async () => {
    const all = await readAll();
    const reply = { id: crypto.randomUUID(), name, body, createdAt: new Date().toISOString() };
    all.push(reply);
    await writeJsonAtomic(file(), { replies: all });
    return reply;
  });
}

export function deleteSavedReply(id) {
  return locked(async () => {
    const all = await readAll();
    const kept = all.filter((r) => r.id !== id);
    if (kept.length === all.length) return false;
    await writeJsonAtomic(file(), { replies: kept });
    return true;
  });
}
