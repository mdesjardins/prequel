import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo } from './helpers/fixture-repo.js';
import { createServer } from '../src/server.js';

const fx = await createFixtureRepo();
await fs.writeFile(
  path.join(fx.dir, 'big.js'),
  Array.from({ length: 6000 }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n'
);
const app = createServer({ repoRoot: fx.dir, defaultBase: 'main' });
const srv = await new Promise((r) => {
  const s = app.listen(0, '127.0.0.1', () => r(s));
});
const url = (p, q = '') => `http://127.0.0.1:${srv.address().port}/file/${p}${q}`;
after(async () => {
  await new Promise((r) => srv.close(r));
  await fx.cleanup();
});

const get = async (p, q) => {
  const res = await fetch(url(p, q));
  return { status: res.status, body: await res.text() };
};

test('changed file renders every line with commentable cells', async () => {
  const { status, body } = await get('src/format.js', '?diff=working');
  assert.equal(status, 200);
  assert.ok(body.includes('USD'));
  assert.ok(body.includes('data-path="src/format.js"'));
  assert.ok(body.includes('commentable'));
  assert.ok(body.includes('data-comment-line="1"'));
});

test('changed lines carry the addition gutter class', async () => {
  const { body } = await get('src/cart.js', '?diff=branch');
  const rows = body.match(/<tr>.*?<\/tr>/gs);
  assert.equal(rows.length, 40);
  assert.ok(rows[0].includes('blob-num-addition'));
  assert.ok(!rows[39].includes('blob-num-addition'));
});

test('unchanged file is read-only', async () => {
  const { status, body } = await get('src/cart.js', '?diff=working');
  assert.equal(status, 200);
  assert.ok(body.includes('TAX'));
  assert.ok(!body.includes('commentable'));
});

test('deleted file shows the base version read-only', async () => {
  const { status, body } = await get('src/old.js', '?diff=branch');
  assert.equal(status, 200);
  assert.ok(body.includes('gone'));
  assert.ok(!body.includes('commentable'));
  assert.ok(body.includes('data-deleted="1"'));
});

test('missing or escaping paths are 404, empty file is 200', async () => {
  assert.equal((await get('../etc/passwd')).status, 404);
  assert.equal((await get('..%2F..%2Fetc%2Fpasswd')).status, 404);
  assert.equal((await get('nope.js')).status, 404);
  assert.equal((await get('src/index.js', '?diff=branch')).status, 404);
  assert.equal((await get('empty.txt')).status, 200);
});

test('tree follows the mode revision', async () => {
  const branch = (await get('src/cart.js', '?diff=branch')).body;
  const working = (await get('src/cart.js', '?diff=working')).body;
  assert.ok(!branch.includes('index.js'));
  assert.ok(working.includes('index.js'));
  assert.ok(branch.includes('old.js'));
  assert.ok(working.includes('is-active'));
  assert.ok(working.includes('tree-status-unchanged'));
});

test('binary file renders the binary notice', async () => {
  const { status, body } = await get('img.bin');
  assert.equal(status, 200);
  assert.ok(body.includes('binary-notice'));
  assert.ok(!body.includes('commentable'));
});

test('hostile directory names are escaped', async () => {
  const { body } = await get(encodeURIComponent('<img src=x onerror=1>') + '/x.js');
  assert.ok(!body.includes('<img src=x onerror=1>'));
  assert.ok(body.includes('&lt;img src=x onerror=1&gt;'));
});

test('back link keeps the fragment only for diff files', async () => {
  const changed = (await get('src/format.js', '?diff=working&view=unified')).body;
  assert.match(changed, /data-back-href="\/\?[^"]*diff=working[^"]*#diff-[0-9a-f]{12}"/);
  const other = (await get('README.md', '?diff=branch')).body;
  assert.match(other, /data-back-href="\/\?[^"#]*"/);
});

test('huge file skips highlighting', async () => {
  const { body } = await get('big.js');
  assert.ok(!body.includes('class="tok"'));
  assert.ok(body.includes('data-plain="1"'));
  const small = (await get('src/cart.js')).body;
  assert.ok(small.includes('class="tok"'));
});
