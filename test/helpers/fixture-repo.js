import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const ID = ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.com'];

export function git(dir, args) {
  return new Promise((resolve, reject) => {
    execFile('git', [...ID, '-C', dir, ...args], (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args.join(' ')} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

const write = (dir, rel, content) => fs.writeFile(path.join(dir, rel), content);

export async function createFixtureRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prequel-fixture-'));
  await fs.mkdir(path.join(dir, 'src'));
  await git(dir, ['init', '-q', '-b', 'main']);

  await write(dir, 'src/cart.js', lines(['export function total(items) {', '  return items.length;', '}'], 40));
  await write(dir, 'src/format.js', 'export const money = (n) => `$${n}`;\n');
  await write(dir, 'src/old.js', 'export const gone = true;\n');
  await write(dir, 'README.md', '# fixture\n');
  await write(dir, 'empty.txt', '');
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-qm', 'init']);

  await git(dir, ['checkout', '-qb', 'feature/x']);
  await write(dir, 'src/cart.js', lines(['const TAX = 0.22;', 'export function total(items) {', '  return items.length * (1 + TAX);', '}'], 40));
  await git(dir, ['rm', '-q', 'src/old.js']);
  await git(dir, ['add', 'src/cart.js']);
  await git(dir, ['commit', '-qm', 'tax and remove old']);

  await write(dir, 'src/format.js', 'export const money = (n, cur = "USD") => `${cur} ${n}`;\n');
  await git(dir, ['add', 'src/format.js']);
  await write(dir, 'README.md', '# fixture\n\nmore\n');
  await write(dir, 'src/index.js', 'import { total } from "./cart.js";\nconsole.log(total([]));\n');

  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

function lines(head, n) {
  const out = [...head];
  for (let i = out.length + 1; i <= n; i++) out.push(`// line ${i}`);
  return out.join('\n') + '\n';
}
