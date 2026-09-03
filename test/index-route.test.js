import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo, startServer } from './helpers/fixture-repo.js';
import { createServer } from '../src/server.js';

const fx = await createFixtureRepo();
const { srv, close } = await startServer(fx);
after(async () => {
  await close();
  await fx.cleanup();
});

const page = async (q) => (await fetch(`http://127.0.0.1:${srv.address().port}/${q}`)).text();

test('review page renders boundary rows and file actions from real line counts', async () => {
  const html = await page('?diff=branch&view=unified');
  assert.match(html, /data-expander[^>]*data-gap-start-new="\d+"/);
  assert.match(html, /class="expand-all-btn"/);
  assert.match(html, /class="view-file-btn" href="\/file\/src\/cart\.js\?/);
});

test('working mode lists staged, unstaged and untracked files', async () => {
  const html = await page('?diff=working');
  for (const p of ['src/format.js', 'README.md', 'src/index.js']) assert.ok(html.includes(`data-path="${p}"`), p);
});

test('no-repo sample page has no expanders or file links', async () => {
  const app = createServer({});
  const s = await new Promise((r) => {
    const x = app.listen(0, '127.0.0.1', () => r(x));
  });
  const html = await (await fetch(`http://127.0.0.1:${s.address().port}/`)).text();
  await new Promise((r) => s.close(r));
  assert.ok(!html.includes('data-expander'));
  assert.ok(!html.includes('view-file-btn'));
});
