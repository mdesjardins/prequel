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
const fileText = () => fs.readFile(path.join(fx.dir, FILE), 'utf8');
const fileLines = async () => (await fileText()).split('\n');
const post = async (payload) => (await json('POST', '/api/comments', payload)).json();
const fence = (lines) => '```suggestion\n' + lines.join('\n') + (lines.length ? '\n' : '') + '```';
const apply = (id) => json('POST', `/api/comments/${id}/apply`);
const suggest = async (startLine, endLine, added, extra = {}) => {
  const all = await fileLines();
  const { comment } = await post({
    filePath: FILE, side: 'new', startLine, endLine,
    lineSnapshot: all.slice(startLine - 1, endLine), body: fence(added), ...extra,
  });
  return comment;
};

test('apply replaces a single line and resolves the comment', async () => {
  const before = await fileLines();
  const c = await suggest(20, 20, ['// applied 20']);
  const res = await apply(c.id);
  assert.equal(res.status, 200);
  const { comment } = await res.json();
  assert.equal(comment.status, 'resolved');
  assert.deepEqual(comment.applied.lines, ['// applied 20']);
  assert.ok(comment.applied.at);
  const after = await fileLines();
  assert.equal(after[19], '// applied 20');
  assert.equal(after.length, before.length);
  assert.equal(after[18], before[18]);
  assert.equal(after[20], before[20]);
  assert.ok((await fileText()).endsWith('\n'));
});

test('apply collapses a 3-line range into 1 line and shifts the rest up', async () => {
  const before = await fileLines();
  const c = await suggest(30, 32, ['// merged']);
  assert.equal((await apply(c.id)).status, 200);
  const after = await fileLines();
  assert.equal(after[29], '// merged');
  assert.equal(after[30], before[32]);
  assert.equal(after.length, before.length - 2);
});

test('outdated suggestion returns 409 and leaves the file untouched', async () => {
  const c = await suggest(10, 10, ['// nope']);
  const all = await fileLines();
  all[9] = '// edited after comment';
  await fs.writeFile(path.join(fx.dir, FILE), all.join('\n'));
  const res = await apply(c.id);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).outdated, true);
  assert.equal((await fileLines())[9], '// edited after comment');
});

test('comment without a suggestion returns 400', async () => {
  const all = await fileLines();
  const { comment } = await post({ filePath: FILE, side: 'new', startLine: 3, lineSnapshot: [all[2]], body: 'just text' });
  assert.equal((await apply(comment.id)).status, 400);
});

test('escaping filePath returns 400 and writes nothing', async () => {
  const { comment } = await post({ filePath: '../escaped.js', side: 'new', startLine: 1, lineSnapshot: ['x'], body: fence(['y']) });
  assert.equal((await apply(comment.id)).status, 400);
  await assert.rejects(fs.access(path.resolve(fx.dir, '../escaped.js')));
});

test('old-side suggestion returns 400', async () => {
  const { comment } = await post({ filePath: FILE, side: 'old', startLine: 2, lineSnapshot: ['export function total(items) {'], body: fence(['y']) });
  assert.equal((await apply(comment.id)).status, 400);
});

test('applying twice returns 409', async () => {
  const c = await suggest(25, 25, ['// once']);
  assert.equal((await apply(c.id)).status, 200);
  assert.equal((await apply(c.id)).status, 409);
});

test('apply-all applies applicable open suggestions and reports outdated ones', async () => {
  const a = await suggest(5, 5, ['// all a'], { branch: 'b2' });
  const b = await suggest(6, 6, ['// all b'], { branch: 'b2' });
  const c = await suggest(7, 7, ['// all c'], { branch: 'b2' });
  const queued = await suggest(8, 8, ['// queued'], { branch: 'b2' });
  await json('PATCH', `/api/comments/${queued.id}`, { handoff: 'agent' });
  const all = await fileLines();
  all[5] = '// b outdated';
  await fs.writeFile(path.join(fx.dir, FILE), all.join('\n'));
  const res = await json('POST', '/api/suggestions/apply-all?branch=b2');
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.deepEqual(out.applied.sort(), [a.id, c.id].sort());
  assert.deepEqual(out.skipped, [{ id: b.id, reason: 'outdated' }]);
  const lines = await fileLines();
  assert.equal(lines[4], '// all a');
  assert.equal(lines[5], '// b outdated');
  assert.equal(lines[6], '// all c');
  assert.equal(lines[7], all[7]);
});

test('apply-all applies bottom-up so earlier growth does not shift later ranges', async () => {
  const before = await fileLines();
  const grow = await suggest(12, 12, ['// g1', '// g2', '// g3'], { branch: 'b3' });
  const tail = await suggest(15, 15, ['// tail'], { branch: 'b3' });
  const out = await (await json('POST', '/api/suggestions/apply-all?branch=b3')).json();
  assert.deepEqual(out.applied.sort(), [grow.id, tail.id].sort());
  const lines = await fileLines();
  assert.deepEqual(lines.slice(11, 14), ['// g1', '// g2', '// g3']);
  assert.equal(lines[14], before[12]);
  assert.equal(lines[16], '// tail');
  assert.equal(lines.length, before.length + 2);
});

test('PATCH handoff persists and invalid values are ignored', async () => {
  const c = await suggest(35, 35, ['// h'], { branch: 'b4' });
  let res = await json('PATCH', `/api/comments/${c.id}`, { handoff: 'agent' });
  const queued = (await res.json()).comment;
  assert.equal(queued.handoff, 'agent');
  assert.doesNotMatch(queued.bodyHtml, /suggestion-apply/);
  res = await json('PATCH', `/api/comments/${c.id}`, { handoff: 'bogus' });
  assert.equal((await res.json()).comment.handoff, 'agent');
  res = await json('PATCH', `/api/comments/${c.id}`, { handoff: null });
  assert.equal((await res.json()).comment.handoff, null);
  const { comments } = await (await json('GET', '/api/comments?branch=b4')).json();
  assert.equal(comments.find((x) => x.id === c.id).handoff, null);
});

test('file-diff renders one file section and 404s when absent', async () => {
  const ok = await fetch(`${base()}/api/file-diff?path=src/format.js&view=unified&diff=working`);
  assert.equal(ok.status, 200);
  const html = await ok.text();
  assert.match(html, /class="file[^"]*"[^>]*data-path="src\/format.js"/);
  assert.doesNotMatch(html, /data-path="README.md"/);
  const missing = await fetch(`${base()}/api/file-diff?path=src/nope.js&view=unified&diff=working`);
  assert.equal(missing.status, 404);
});
