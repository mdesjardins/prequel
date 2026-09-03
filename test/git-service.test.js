import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createFixtureRepo } from './helpers/fixture-repo.js';
import { getDiff, getRepoFiles, getBlobText, blobExists } from '../src/git/gitService.js';
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

test('getRepoFiles lists tracked and untracked files, not ignored ones', async () => {
  const files = await getRepoFiles(fx.dir, { rev: 'WORKTREE' });
  assert.ok(files.includes('src/index.js'));
  assert.ok(files.includes('src/cart.js'));
  assert.ok(!files.includes('ignored.log'));
  assert.ok(!files.includes('src/old.js'));
  assert.deepEqual(files, [...new Set(files)].sort());
});

test('getRepoFiles at HEAD omits untracked files', async () => {
  const files = await getRepoFiles(fx.dir, { rev: 'HEAD' });
  assert.ok(!files.includes('src/index.js'));
  assert.ok(files.includes('src/cart.js'));
});

test('getBlobText reads the working tree or a revision', async () => {
  const wt = await getBlobText(fx.dir, { rev: 'WORKTREE', path: 'src/format.js' });
  const head = await getBlobText(fx.dir, { rev: 'HEAD', path: 'src/format.js' });
  assert.ok(wt.includes('USD'));
  assert.ok(!head.includes('USD'));
  assert.equal(await getBlobText(fx.dir, { rev: 'WORKTREE', path: '../etc/passwd' }), '');
});

test('blobExists distinguishes missing from empty', async () => {
  assert.equal(await blobExists(fx.dir, { rev: 'WORKTREE', path: 'empty.txt' }), true);
  assert.equal(await blobExists(fx.dir, { rev: 'WORKTREE', path: 'nope.js' }), false);
  assert.equal(await blobExists(fx.dir, { rev: 'WORKTREE', path: '../etc/passwd' }), false);
  assert.equal(await blobExists(fx.dir, { rev: 'HEAD', path: 'src/index.js' }), false);
  assert.equal(await blobExists(fx.dir, { rev: 'main', path: 'src/old.js' }), true);
});

test('getDiff returns the base revision for deleted-file reads', async () => {
  const working = await getDiff(fx.dir, { base: 'main', mode: 'working' });
  assert.equal(working.baseRev, 'HEAD');
  const branch = await getDiff(fx.dir, { base: 'main', mode: 'branch' });
  assert.match(branch.baseRev, /^[0-9a-f]{40}$/);
  const all = await getDiff(fx.dir, { base: 'main', mode: 'all' });
  assert.equal(all.baseRev, branch.baseRev);
});
