import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo, startServer } from './helpers/fixture-repo.js';

const fx = await createFixtureRepo();
const { srv, close } = await startServer(fx);
after(async () => {
  await close();
  await fx.cleanup();
});

const base = () => `http://127.0.0.1:${srv.address().port}`;
const json = (method, p, body) =>
  fetch(`${base()}${p}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const FILE = 'src/cart.js';
const lines = async () => (await fs.readFile(path.join(fx.dir, FILE), 'utf8')).split('\n');
const post = async (payload) => (await json('POST', '/api/comments', payload)).json();
const exportAs = async (format) => (await json('POST', '/api/export', { format })).json();

const all = await lines();
const { comment: sug } = await post({
  filePath: FILE, side: 'new', startLine: 2, endLine: 2, lineSnapshot: [all[1]],
  body: 'Use a reduce here.\n\n```suggestion\nconst sum = items.reduce((a, it) => a + it.price, 0);\n```',
});
const { comment: q } = await post({
  filePath: FILE, side: 'new', startLine: 4, lineSnapshot: [all[3]],
  body: '@agent why is this async? See `@agent` in code too.',
});
const { comment: tasks } = await post({
  filePath: FILE, side: 'file', body: '- [ ] rename\n- [x] add test\n\n![shot](/attachments/abc123def456abcd.png)',
});
const { comment: queued } = await post({
  filePath: FILE, side: 'new', startLine: 6, endLine: 6, lineSnapshot: [all[5]],
  body: '```suggestion\n}\n```',
});
await json('PATCH', `/api/comments/${queued.id}`, { handoff: 'agent' });

test('listing carries kind for suggestions, questions and plain comments', async () => {
  const { comments } = await (await fetch(`${base()}/api/comments`)).json();
  const by = (id) => comments.find((c) => c.id === id);
  assert.equal(by(sug.id).kind, 'suggestion');
  assert.equal(by(q.id).kind, 'question');
  assert.equal(by(tasks.id).kind, 'comment');
});

test('json export of a suggestion carries kind, lines and applicability', async () => {
  const { content } = await exportAs('json');
  const item = JSON.parse(content).find((c) => c.id === sug.id);
  assert.equal(item.kind, 'suggestion');
  assert.deepEqual(item.suggestion.lines, ['const sum = items.reduce((a, it) => a + it.price, 0);']);
  assert.equal(item.applicable, true);
  assert.equal(item.handoff, null);
  assert.equal(item.applied, false);
});

test('markdown export marks questions and renders suggestion blocks with notes', async () => {
  const { content } = await exportAs('md');
  assert.match(content, /Question for the agent: reply and resolve, do not edit code/);
  assert.match(content, /Suggested change \(apply verbatim when the snapshot matches; adapt otherwise\)/);
  assert.match(content, /```suggestion\nconst sum = items\.reduce/);
  assert.match(content, /Queued for agent/);
});

test('task list items stay verbatim in markdown export', async () => {
  const { content } = await exportAs('md');
  assert.match(content, /> - \[ \] rename\n> - \[x\] add test/);
});

test('attachment urls are rewritten to repo-relative paths in both formats', async () => {
  const md = (await exportAs('md')).content;
  assert.match(md, /\]\(\.prequel\/attachments\/abc123def456abcd\.png\)/);
  assert.ok(!md.includes('](/attachments/'));
  const item = JSON.parse((await exportAs('json')).content).find((c) => c.id === tasks.id);
  assert.match(item.comment, /\.prequel\/attachments\/abc123def456abcd\.png/);
});
