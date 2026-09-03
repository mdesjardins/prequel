import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo, startServer } from './helpers/fixture-repo.js';

const fx = await createFixtureRepo();
const { srv, close } = await startServer(fx);
after(async () => {
  await close();
  await fx.cleanup();
});

const base = () => `http://127.0.0.1:${srv.address().port}`;
const preview = (payload) =>
  fetch(`${base()}/api/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

test('preview renders markdown', async () => {
  const res = await preview({ body: '**bold**\n\n- one\n- two\n\n```js\nconst x = 1;\n```' });
  assert.equal(res.status, 200);
  const { html } = await res.json();
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<li>one<\/li>/);
  assert.match(html, /<pre><code class="language-js">/);
});

test('preview escapes raw html', async () => {
  const res = await preview({ body: '<script>alert(1)</script>\n\nhi <img src=x onerror=alert(1)>' });
  const { html } = await res.json();
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<img'));
  assert.match(html, /&lt;script&gt;/);
});

test('comment listing escapes raw html in bodies', async () => {
  const post = await fetch(`${base()}/api/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filePath: 'src/cart.js', side: 'new', startLine: 1, body: '<img src=x onerror=alert(1)> **ok**' }),
  });
  assert.equal(post.status, 200);
  const { comments } = await (await fetch(`${base()}/api/comments`)).json();
  const c = comments.find((x) => x.body.includes('onerror'));
  assert.ok(!c.bodyHtml.includes('<img'));
  assert.match(c.bodyHtml, /<strong>ok<\/strong>/);
});

test('preview rejects a missing body', async () => {
  assert.equal((await preview({})).status, 400);
  assert.equal((await preview({ body: 5 })).status, 400);
});
