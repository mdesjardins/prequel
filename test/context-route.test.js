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
const ctx = async (start, end) => {
  const res = await fetch(
    `http://127.0.0.1:${srv.address().port}/api/context?path=big.js&rev=WORKTREE&start=${start}&end=${end}`
  );
  return res.json();
};
after(async () => {
  await new Promise((r) => srv.close(r));
  await fx.cleanup();
});

test('ranges over the highlight cap come back plain', async () => {
  const data = await ctx(1, 6000);
  assert.equal(data.lines.length, 6000);
  assert.equal(data.html, null);
  assert.equal(data.plain, true);
  assert.equal(data.eof, true);
});

test('small ranges are highlighted', async () => {
  const data = await ctx(1, 100);
  assert.equal(data.lines.length, 100);
  assert.equal(data.plain, false);
  assert.ok(Array.isArray(data.html));
  assert.ok(data.html[0].includes('class="tok"'));
});
