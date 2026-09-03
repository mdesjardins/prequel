import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiff } from '../src/git/diffParser.js';
import { renderDiff } from '../src/render/renderer.js';

function patch(hunks, { path = 'src/a.js', status = 'modified' } = {}) {
  const head =
    status === 'removed'
      ? `diff --git a/${path} b/${path}\ndeleted file mode 100644\n--- a/${path}\n+++ /dev/null\n`
      : `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n`;
  return head + hunks.join('');
}

function hunk(oldStart, newStart, body) {
  const olds = body.filter((l) => !l.startsWith('+')).length;
  const news = body.filter((l) => !l.startsWith('-')).length;
  return `@@ -${oldStart},${olds} +${newStart},${news} @@\n${body.join('\n')}\n`;
}

function render(text, { newLineCount, view = 'unified' } = {}) {
  const diff = parseDiff(text);
  for (const f of diff.files) f.newLineCount = newLineCount;
  return renderDiff(diff, { view, rev: 'WORKTREE' }).filesHtml;
}

const rows = (html) => [...html.matchAll(/<tr class="hunk-header-row[^"]*"[^>]*>/g)].map((m) => m[0]);
const attr = (row, name) => row.match(new RegExp(`data-${name}="([^"]*)"`))?.[1];

test('hunk starting at line 1 gets no top boundary but a trailing one', () => {
  const html = render(patch([hunk(1, 1, ['-a', '+b', ' c'])]), { newLineCount: 40 });
  const r = rows(html);
  assert.equal(r.length, 2);
  assert.equal(attr(r[0], 'gap-start-new'), undefined);
  assert.ok(r[1].includes('boundary-trailing'));
  assert.equal(attr(r[1], 'gap-start-new'), '3');
  assert.equal(attr(r[1], 'gap-end-new'), '40');
  assert.equal(attr(r[1], 'offset'), '0');
});

test('gap between two hunks carries start, end and offset', () => {
  const text = patch([hunk(1, 1, ['-a', '+b', ' c']), hunk(18, 19, [' x', '-y', '+z'])]);
  const html = render(text, { newLineCount: 20 });
  const r = rows(html);
  assert.equal(r.length, 2);
  assert.equal(attr(r[1], 'gap-start-new'), '3');
  assert.equal(attr(r[1], 'gap-end-new'), '18');
  assert.equal(attr(r[1], 'offset'), '-1');
  assert.ok(html.includes('@@ -18,2 +19,2 @@'));
});

test('hunk starting at line 30 gets a top boundary from 1 to 29', () => {
  const html = render(patch([hunk(30, 30, [' a', '-b', '+c'])]), { newLineCount: 31 });
  const r = rows(html);
  assert.equal(attr(r[0], 'gap-start-new'), '1');
  assert.equal(attr(r[0], 'gap-end-new'), '29');
  assert.equal(attr(r[0], 'offset'), '0');
  assert.equal(r.length, 1);
});

test('no trailing boundary when the last hunk reaches the end of file', () => {
  const html = render(patch([hunk(1, 1, ['-a', '+b', ' c'])]), { newLineCount: 2 });
  assert.equal(rows(html).length, 1);
});

test('removed files get no trailing boundary', () => {
  const html = render(patch([hunk(1, 0, ['-a', '-b'])], { status: 'removed' }), { newLineCount: 0 });
  assert.equal(rows(html).length, 1);
  assert.ok(!html.includes('boundary-trailing'));
});

test('boundary rows span the right columns in unified and split views', () => {
  const text = patch([hunk(1, 1, ['-a', '+b', ' c'])]);
  const uni = rows(render(text, { newLineCount: 10 }));
  const split = rows(render(text, { newLineCount: 10, view: 'split' }));
  const gutter = (html) => html.match(/<td class="blob-num blob-num-hunk[^"]*" colspan="(\d)"/)?.[1];
  const uniHtml = render(text, { newLineCount: 10 });
  const splitHtml = render(text, { newLineCount: 10, view: 'split' });
  assert.equal(uni.length, 2);
  assert.equal(split.length, 2);
  assert.equal(gutter(uniHtml), '2');
  assert.equal(gutter(splitHtml), '1');
  assert.ok(splitHtml.includes('blob-code-hunk" colspan="3"'));
});
