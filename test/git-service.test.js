import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from './helpers/fixture-repo.js';
import { getDiff } from '../src/git/gitService.js';
import { parseDiff } from '../src/git/diffParser.js';

const fx = await createFixtureRepo();
after(() => fx.cleanup());

const paths = (patch) => parseDiff(patch).files.map((f) => f.newPath).sort();

test('working mode lists staged, unstaged and untracked files', async () => {
  const { patch, head } = await getDiff(fx.dir, { base: 'main', mode: 'working' });
  assert.equal(head, 'feature/x');
  assert.deepEqual(paths(patch), ['README.md', 'src/format.js', 'src/index.js']);
});

test('branch mode lists only committed branch changes', async () => {
  const { patch } = await getDiff(fx.dir, { base: 'main', mode: 'branch' });
  assert.deepEqual(paths(patch), ['src/cart.js', 'src/old.js']);
  const removed = parseDiff(patch).files.find((f) => f.newPath === 'src/old.js');
  assert.equal(removed.status, 'removed');
});

test('all mode lists the union', async () => {
  const { patch } = await getDiff(fx.dir, { base: 'main', mode: 'all' });
  assert.deepEqual(paths(patch), ['README.md', 'src/cart.js', 'src/format.js', 'src/index.js', 'src/old.js']);
});
