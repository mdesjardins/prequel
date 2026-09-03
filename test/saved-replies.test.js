import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const home = await fs.mkdtemp(path.join(os.tmpdir(), 'prequel-home-'));
process.env.PREQUEL_HOME = home;
const { createServer } = await import('../src/server.js');

const listen = (app) =>
  new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s));
  });
let srv;
before(async () => {
  srv = await listen(createServer({}));
});
after(async () => {
  await new Promise((r) => srv.close(r));
  await fs.rm(home, { recursive: true, force: true });
});

const api = (s, p, init) => fetch(`http://127.0.0.1:${s.address().port}${p}`, init);
const json = (body) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('saved replies round trip: post, list, delete', async () => {
  const created = await (
    await api(srv, '/api/saved-replies', json({ name: 'nit', body: 'nit: naming' }))
  ).json();
  assert.ok(created.reply.id);
  assert.equal(created.reply.name, 'nit');
  const { replies } = await (await api(srv, '/api/saved-replies')).json();
  assert.deepEqual(
    replies.map((r) => [r.name, r.body]),
    [['nit', 'nit: naming']]
  );
  const del = (id) => api(srv, `/api/saved-replies/${id}`, { method: 'DELETE' });
  assert.equal((await del(created.reply.id)).status, 200);
  assert.equal((await del(created.reply.id)).status, 404);
  assert.deepEqual((await (await api(srv, '/api/saved-replies')).json()).replies, []);
});

test('rejects blank name or body', async () => {
  assert.equal((await api(srv, '/api/saved-replies', json({ name: ' ', body: 'x' }))).status, 400);
  assert.equal((await api(srv, '/api/saved-replies', json({ name: 'x' }))).status, 400);
});

test('persists across server instances', async () => {
  await api(srv, '/api/saved-replies', json({ name: 'test', body: 'add a test' }));
  const other = await listen(createServer({}));
  const { replies } = await (await api(other, '/api/saved-replies')).json();
  await new Promise((r) => other.close(r));
  assert.ok(replies.some((r) => r.name === 'test'));
});
