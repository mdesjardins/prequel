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
const json = (method, p, body) =>
  fetch(`${base()}${p}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const post = async (body) =>
  (await json('POST', '/api/comments', { filePath: 'README.md', side: 'file', startLine: 0, body })).json();
const patch = (id, b) => json('PATCH', `/api/comments/${id}`, b);
const get = async (id) => {
  const { comments } = await (await fetch(`${base()}/api/comments`)).json();
  return comments.find((c) => c.id === id);
};

test('task items render as enabled indexed checkboxes', async () => {
  const { comment } = await post('- [ ] a\n- [x] b');
  const boxes = comment.bodyHtml.match(/<input[^>]*class="task-item"[^>]*>/g);
  assert.equal(boxes.length, 2);
  assert.match(boxes[0], /data-task-index="0"/);
  assert.doesNotMatch(boxes[0], /checked/);
  assert.match(boxes[1], /data-task-index="1"/);
  assert.match(boxes[1], /checked/);
  assert.doesNotMatch(boxes[1], /disabled/);
});

test('PATCH taskIndex rewrites only that marker', async () => {
  const { comment } = await post('intro\n- [ ] a\n- [ ] b\n- [ ] c');
  const res = await patch(comment.id, { taskIndex: 1, checked: true });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).comment.body, 'intro\n- [ ] a\n- [x] b\n- [ ] c');
});

test('back-to-back toggles of different indexes both persist', async () => {
  const { comment } = await post('- [ ] a\n- [ ] b');
  await Promise.all([
    patch(comment.id, { taskIndex: 0, checked: true }),
    patch(comment.id, { taskIndex: 1, checked: true }),
  ]);
  assert.equal((await get(comment.id)).body, '- [x] a\n- [x] b');
});

test('taskIndex out of range or invalid is 400', async () => {
  const { comment } = await post('- [ ] a');
  assert.equal((await patch(comment.id, { taskIndex: 3, checked: true })).status, 400);
  assert.equal((await patch(comment.id, { taskIndex: 'x', checked: true })).status, 400);
});

test('markers inside code fences are not task items', async () => {
  const { comment } = await post('```\n- [ ] not a task\n```\n- [ ] real');
  assert.equal(comment.bodyHtml.match(/class="task-item"/g).length, 1);
  const res = await patch(comment.id, { taskIndex: 0, checked: true });
  assert.equal((await res.json()).comment.body, '```\n- [ ] not a task\n```\n- [x] real');
});

test('@agent renders as a mention outside code', async () => {
  const { comment } = await post('hey @agent why?');
  assert.match(comment.bodyHtml, /<span class="mention mention-agent">@agent<\/span>/);
  const { comment: c2 } = await post('@agentless and `@agent` and\n\n```\n@agent\n```');
  assert.doesNotMatch(c2.bodyHtml, /mention-agent/);
});

test('javascript: and data: links or images are neutralized', async () => {
  const { comment } = await post(
    '[a](javascript:alert(1)) [b](JAVA\tSCRIPT:x) [c](javascript&#58;y) ![d](data:text/html,x) [ok](https://e.com) ![p](/attachments/x.png)',
  );
  assert.doesNotMatch(comment.bodyHtml, /javascript/i);
  assert.doesNotMatch(comment.bodyHtml, /data:/i);
  assert.match(comment.bodyHtml, /<a href="https:\/\/e\.com">ok<\/a>/);
  assert.match(comment.bodyHtml, /<img src="\/attachments\/x\.png"/);
  assert.match(comment.bodyHtml, /\ba\b.*\bb\b.*\bc\b.*\bd\b/);
});

test('cross-origin mutating API requests are rejected', async () => {
  const res = await fetch(`${base()}/api/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
    body: JSON.stringify({ filePath: 'README.md', side: 'file', startLine: 0, body: 'x' }),
  });
  assert.equal(res.status, 403);
  const same = await fetch(`${base()}/api/comments`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base() },
    body: JSON.stringify({ filePath: 'README.md', side: 'file', startLine: 0, body: 'x' }),
  });
  assert.equal(same.status, 200);
  const list = await fetch(`${base()}/api/comments`, { headers: { origin: 'http://evil.example' } });
  assert.equal(list.status, 200);
});

test('blockquoted task items keep index parity with rendered checkboxes', async () => {
  const { comment } = await post('> - [ ] a\n\n- [ ] b\n- [x] c');
  const boxes = comment.bodyHtml.match(/<input[^>]*class="task-item"[^>]*>/g);
  assert.equal(boxes.length, 3);
  await patch(comment.id, { taskIndex: 1, checked: true });
  assert.equal((await get(comment.id)).body, '> - [ ] a\n\n- [x] b\n- [x] c');
  await patch(comment.id, { taskIndex: 0, checked: true });
  assert.equal((await get(comment.id)).body, '> - [x] a\n\n- [x] b\n- [x] c');
});

test('numbered-list task markers toggle by index', async () => {
  const { comment } = await post('1. [ ] a\n2. [ ] b');
  const boxes = comment.bodyHtml.match(/<input[^>]*class="task-item"[^>]*>/g);
  assert.equal(boxes.length, 2);
  await patch(comment.id, { taskIndex: 1, checked: true });
  assert.equal((await get(comment.id)).body, '1. [ ] a\n2. [x] b');
});
