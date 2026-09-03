import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createFixtureRepo, startServer } from './helpers/fixture-repo.js';

const fx = await createFixtureRepo();
await fs.writeFile(
  path.join(fx.dir, 'big.js'),
  Array.from({ length: 6000 }, (_, i) => `const v${i} = ${i};`).join('\n') + '\n'
);
const { srv, close } = await startServer(fx);
const url = (p, q = '') => `http://127.0.0.1:${srv.address().port}/file/${p}${q}`;
after(async () => {
  await close();
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

test('page shell: back link, escaped crumbs, tree, comments flag', async () => {
  const changed = (await get('src/format.js', '?diff=working')).body;
  assert.ok(changed.includes('class="back-link"'));
  assert.ok(/href="\/\?[^"]*#diff-[0-9a-f]{12}"/.test(changed));
  assert.ok(changed.includes('data-comments-enabled="1"'));
  assert.ok(changed.includes('class="tree-header">Repository'));
  assert.ok(changed.includes('/static/js/tree-pane.js'));

  const unchanged = (await get('src/cart.js', '?diff=working')).body;
  assert.ok(unchanged.includes('data-comments-enabled="0"'));
  assert.ok(!/class="back-link" href="[^"]*#diff-/.test(unchanged));

  const deleted = (await get('src/old.js', '?diff=branch')).body;
  assert.ok(deleted.includes('data-comments-enabled="0"'));
  assert.ok(deleted.includes('Deleted in this diff'));

  const evil = (await get('%3Cimg%20src%3Dx%20onerror%3D1%3E/x.js', '?diff=working')).body;
  assert.ok(!evil.includes('<img src=x onerror=1>'));
  assert.ok(evil.includes('&lt;img src=x onerror=1&gt;'));
});

test('raw request with a literal .. segment is rejected by the route', async () => {
  const res = await new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port: srv.address().port, path: '/file/../etc/passwd' }, (r) => {
        let body = '';
        r.on('data', (d) => (body += d));
        r.on('end', () => resolve({ status: r.statusCode, body }));
      })
      .on('error', reject);
  });
  assert.equal(res.status, 404);
  assert.equal(res.body, 'not found');
});

test('flag-like base ref is ignored and never reaches git', async () => {
  const out = path.join(fx.dir, 'pwned.txt');
  const res = await get('README.md', `?diff=branch&base=${encodeURIComponent('--output=' + out)}`);
  assert.equal(res.status, 200);
  await assert.rejects(fs.stat(out));
  assert.ok(!res.body.includes('base=--output'));
});

test('directory path at a revision is not a file', async () => {
  assert.equal((await get('src', '?diff=branch')).status, 404);
});
