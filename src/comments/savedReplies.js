import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { prequelHome, writeJsonAtomic } from './commentStore.js';

const file = () => path.join(prequelHome(), 'saved-replies.json');

async function readAll() {
  try {
    const data = JSON.parse(await fs.readFile(file(), 'utf8'));
    return Array.isArray(data.replies) ? data.replies : [];
  } catch {
    return [];
  }
}

export async function listSavedReplies() {
  return readAll();
}

export async function addSavedReply({ name, body }) {
  const all = await readAll();
  const reply = { id: crypto.randomUUID(), name, body, createdAt: new Date().toISOString() };
  all.push(reply);
  await writeJsonAtomic(file(), { replies: all });
  return reply;
}

export async function deleteSavedReply(id) {
  const all = await readAll();
  const kept = all.filter((r) => r.id !== id);
  if (kept.length === all.length) return false;
  await writeJsonAtomic(file(), { replies: kept });
  return true;
}
