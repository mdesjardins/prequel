import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createFixtureRepo, startServer } from './helpers/fixture-repo.js';
import { createServer } from '../src/server.js';

const fx = await createFixtureRepo();
const { srv, close } = await startServer(fx);
after(async () => {
  await close();
  await fx.cleanup();
});

const base = () => `http://127.0.0.1:${srv.address().port}`;
const upload = (body) =>
  fetch(`${base()}/api/attachments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const png = (size = 0) => {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.concat([
    Buffer.from([0, 0, 0, 13]),
    Buffer.from('IHDR'),
    Buffer.alloc(13),
    Buffer.alloc(4),
  ]);
  const head = Buffer.concat([sig, ihdr]);
  return size > head.length ? Buffer.concat([head, Buffer.alloc(size - head.length)]) : head;
};
const jpegBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);

test('uploads a png and serves it back', async () => {
  const res = await upload({ name: 'shot.png', type: 'image/png', data: png().toString('base64') });
  assert.equal(res.status, 200);
  const { url, path: rel } = await res.json();
  assert.match(url, /^\/attachments\/[a-f0-9]{16,}\.png$/);
  assert.match(rel, /^\.prequel\/attachments\//);
  await fs.stat(path.join(fx.dir, rel));
  const served = await fetch(base() + url);
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-type'), /image\/png/);
  assert.equal(Buffer.from(await served.arrayBuffer()).length, png().length);
});

test('a 3 MB png uploads', async () => {
  const data = png(3 * 1024 * 1024).toString('base64');
  const res = await upload({ name: 'big.png', type: 'image/png', data });
  assert.equal(res.status, 200);
});

test('rejects unsupported types and mismatched bytes', async () => {
  const svg = { name: 'x.svg', type: 'image/svg+xml', data: png().toString('base64') };
  assert.equal((await upload(svg)).status, 400);
  const mismatch = { name: 'x.png', type: 'image/png', data: jpegBytes.toString('base64') };
  assert.equal((await upload(mismatch)).status, 400);
});

test('oversized payload is a JSON 400, not a raw 413', async () => {
  const data = png(16 * 1024 * 1024).toString('base64');
  const res = await upload({ name: 'huge.png', type: 'image/png', data });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'too large');
});

test('attachment route rejects traversal and non-image names', async () => {
  assert.equal((await fetch(`${base()}/attachments/..%2Fx`)).status, 404);
  assert.equal((await fetch(`${base()}/attachments/evil.js`)).status, 404);
  assert.equal((await fetch(`${base()}/attachments/0123456789abcdef.png`)).status, 404);
});

test('upload without a repo is 400', async () => {
  const app = createServer({});
  const s = await new Promise((r) => {
    const x = app.listen(0, '127.0.0.1', () => r(x));
  });
  const res = await fetch(`http://127.0.0.1:${s.address().port}/api/attachments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'a.png', type: 'image/png', data: png().toString('base64') }),
  });
  await new Promise((r) => s.close(r));
  assert.equal(res.status, 400);
});
