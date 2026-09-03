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
  fetch(`${base()}${method === 'GET' ? p : p}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const fileLines = async (p) => (await fs.readFile(path.join(fx.dir, p), 'utf8')).split('\n');
const post = async (payload) => (await json('POST', '/api/comments', payload)).json();
const listOne = async (id) => {
  const { comments } = await (await json('GET', '/api/comments')).json();
  return comments.find((c) => c.id === id);
};
const fence = (lines) => '```suggestion\n' + lines.join('\n') + (lines.length ? '\n' : '') + '```';

test('range suggestion renders removed snapshot and added fence lines', async () => {
  const all = await fileLines('src/cart.js');
  const snapshot = all.slice(8, 14);
  const added = ['// a', '// b'];
  const { comment } = await post({
    filePath: 'src/cart.js', side: 'new', startLine: 9, endLine: 14, lineSnapshot: snapshot,
    body: 'Tighten this.\n\n' + fence(added),
  });
  assert.deepEqual(comment.suggestion, { lines: added });
  assert.equal(comment.applicable, true);
  const removed = (comment.bodyHtml.match(/blob-code-deletion/g) || []).length;
  const addedN = (comment.bodyHtml.match(/blob-code-addition/g) || []).length;
  assert.equal(removed, 6);
  assert.equal(addedN, 2);
  assert.match(comment.bodyHtml, /Suggested change/);
  assert.match(comment.bodyHtml, /<button class="suggestion-apply"(?![^>]*disabled)/);
  assert.match(comment.bodyHtml, /suggestion-handoff/);
});

test('single line suggestion', async () => {
  const all = await fileLines('src/cart.js');
  const { comment } = await post({
    filePath: 'src/cart.js', side: 'new', startLine: 20, endLine: 20, lineSnapshot: [all[19]],
    body: fence(['x', 'y', 'z']),
  });
  assert.equal((comment.bodyHtml.match(/blob-code-deletion/g) || []).length, 1);
  assert.equal((comment.bodyHtml.match(/blob-code-addition/g) || []).length, 3);
});

test('suggestion fence in a reply renders as plain code', async () => {
  const all = await fileLines('src/cart.js');
  const { comment: root } = await post({
    filePath: 'src/cart.js', side: 'new', startLine: 21, endLine: 21, lineSnapshot: [all[20]], body: 'root',
  });
  const { comment: reply } = await post({ parentId: root.id, body: fence(['nope']) });
  assert.equal(reply.suggestion, null);
  assert.ok(!reply.bodyHtml.includes('class="suggestion"'));
  assert.match(reply.bodyHtml, /<pre><code/);
});

test('outdated when the file changed since the comment', async () => {
  const all = await fileLines('src/cart.js');
  const { comment } = await post({
    filePath: 'src/cart.js', side: 'new', startLine: 25, endLine: 25, lineSnapshot: [all[24]], body: fence(['new']),
  });
  assert.equal(comment.applicable, true);
  all[24] = '// edited after commenting';
  await fs.writeFile(path.join(fx.dir, 'src/cart.js'), all.join('\n'));
  const c = await listOne(comment.id);
  assert.equal(c.applicable, false);
  assert.match(c.bodyHtml, /Outdated/);
  assert.match(c.bodyHtml, /<button class="suggestion-apply"[^>]*disabled/);
});

test('empty fence is a pure deletion', async () => {
  const all = await fileLines('src/cart.js');
  const { comment } = await post({
    filePath: 'src/cart.js', side: 'new', startLine: 30, endLine: 31, lineSnapshot: all.slice(29, 31), body: fence([]),
  });
  assert.deepEqual(comment.suggestion, { lines: [] });
  assert.equal((comment.bodyHtml.match(/blob-code-deletion/g) || []).length, 2);
  assert.equal((comment.bodyHtml.match(/blob-code-addition/g) || []).length, 0);
});

test('deleted file: not applicable, no crash', async () => {
  const { comment } = await post({
    filePath: 'src/old.js', side: 'new', startLine: 1, endLine: 1, lineSnapshot: ['gone'], body: fence(['x']),
  });
  assert.equal(comment.applicable, false);
  assert.match(comment.bodyHtml, /Outdated/);
});

test('comment without a suggestion has null suggestion fields', async () => {
  const { comment } = await post({
    filePath: 'src/cart.js', side: 'new', startLine: 2, endLine: 2, lineSnapshot: ['x'], body: 'plain',
  });
  assert.equal(comment.suggestion, null);
  assert.equal(comment.applicable, null);
});

test('preview renders a mini diff with an anchor and plain code without', async () => {
  const all = await fileLines('src/cart.js');
  const withAnchor = await (await json('POST', '/api/preview', {
    body: fence(['changed']), filePath: 'src/cart.js', side: 'new', startLine: 3, endLine: 4,
  })).json();
  assert.match(withAnchor.html, /class="suggestion"/);
  assert.equal((withAnchor.html.match(/blob-code-deletion/g) || []).length, 2);
  assert.ok(withAnchor.html.includes(all[2].replace(/</g, '&lt;')));
  const plain = await (await json('POST', '/api/preview', { body: fence(['changed']) })).json();
  assert.ok(!plain.html.includes('class="suggestion"'));
  assert.match(plain.html, /<pre><code/);
});
