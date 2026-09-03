import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  binaryNotice,
  escapeHtml,
  renderDiff,
  renderFileHtml,
  renderFileTree,
  renderFileView,
  renderRepoTree,
} from './render/renderer.js';
import { highlightDiff, highlightLines } from './render/highlighter.js';
import { annotateWordDiffs } from './render/wordDiff.js';
import {
  getDiff,
  getBlobLines,
  getLineCount,
  getBlobText,
  blobExists,
  getRepoFiles,
  splitLines,
  insideRepo,
} from './git/gitService.js';
import { parseDiff, inferLanguage } from './git/diffParser.js';
import { sampleDiff } from './sampleDiff.js';
import {
  listComments,
  addComment,
  getComment,
  updateComment,
  updateCommentWith,
  deleteComment,
  clearComments,
  restoreCleared,
  withLock,
  writeFileAtomic,
} from './comments/commentStore.js';
import { listSavedReplies, addSavedReply, deleteSavedReply } from './comments/savedReplies.js';
import { buildMarkdown, buildJson } from './export/claudeExport.js';
import crypto from 'node:crypto';
import { marked } from 'marked';
import { parseSuggestions, renderSuggestionBlock } from './render/suggestion.js';

marked.setOptions({ breaks: true });

const MENTION = /(^|[^\w@])@agent(?![\w-])/g;

// A fresh renderer per parse: raw HTML is escaped, task items become enabled
// indexed checkboxes, and @agent becomes a mention.
const ENTITY = /&#(x[0-9a-f]+|\d+);?|&colon;/gi;
const SCHEME = /^([a-z][a-z0-9+.-]*):/;
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto']);

function safeHref(href) {
  const h = String(href || '')
    .replace(ENTITY, (m, n) =>
      n === undefined ? ':' : String.fromCodePoint(/^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n)))
    .replace(/[\s\u0000-\u001f]/g, '')
    .toLowerCase();
  const m = SCHEME.exec(h);
  return !m || SAFE_SCHEMES.has(m[1]);
}

function commentRenderer() {
  const r = new marked.Renderer();
  const link = r.link.bind(r);
  const image = r.image.bind(r);
  let task = 0;
  r.html = (html) => escapeHtml(html);
  r.link = (href, title, text) => (safeHref(href) ? link(href, title, text) : text);
  r.image = (href, title, text) => (safeHref(href) ? image(href, title, text) : escapeHtml(text));
  r.checkbox = (checked) =>
    `<input type="checkbox" class="task-item" data-task-index="${task++}"${checked ? ' checked' : ''}>`;
  r.text = (text) => text.replace(MENTION, '$1<span class="mention mention-agent">@agent</span>');
  return r;
}

export function renderMarkdown(body) {
  return marked.parse(body || '', { renderer: commentRenderer() });
}

const TASK = /^((?:\s*>)*\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/;

// Rewrite the nth task marker (source order, fences skipped); null when absent.
export function toggleTask(body, idx, checked) {
  const lines = String(body || '').split('\n');
  let fence = false;
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence;
    if (fence) continue;
    const m = TASK.exec(lines[i]);
    if (!m) continue;
    if (n++ === idx) {
      lines[i] = lines[i].replace(TASK, `$1${checked ? 'x' : ' '}$3`);
      return lines.join('\n');
    }
  }
  return null;
}

const isLineRoot = (c) => c && c.side !== 'file' && !c.parentId;

const stripCode = (body) => String(body || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
const hasMention = (body) => new RegExp(MENTION.source).test(stripCode(body));
export const kindOf = (c, sugs) => {
  if (isLineRoot(c) && c.side === 'new' && (sugs || parseSuggestions(c.body)).length) return 'suggestion';
  if (hasMention(c.body)) return 'question';
  return 'comment';
};

// Render a comment body; `suggestion` fences on a root line comment become a
// mini diff against the snapshot, everywhere else they stay plain code.
export function renderCommentHtml(
  c,
  { snapshot = [], applicable = null, handoff = null, applied = false } = {}
) {
  if (!isLineRoot(c) || c.side !== 'new') return renderMarkdown(c.body);
  const renderer = commentRenderer();
  const base = renderer.code.bind(renderer);
  let seen = false;
  renderer.code = (code, lang, escaped) => {
    if ((lang || '').trim() !== 'suggestion' || seen) return base(code, lang, escaped);
    seen = true;
    const added = code === '' ? [] : code.split(/\r?\n/);
    return renderSuggestionBlock({ removed: snapshot, added, applicable, handoff, applied, id: c.id });
  };
  return marked.parse(c.body || '', { renderer });
}

const sameLines = (a, b) => a.length === b.length && a.every((l, i) => l === b[i]);

// Per-request decorator: adds bodyHtml, suggestion lines and applicability
// (snapshot vs working tree), caching file reads by path.
function decorator(repoRoot) {
  const files = new Map();
  const linesOf = async (c) => {
    if (!files.has(c.filePath)) {
      files.set(
        c.filePath,
        getBlobText(repoRoot, { rev: 'WORKTREE', path: c.filePath })
          .then((t) => splitLines(t).map((l) => l.replace(/\r$/, '')))
          .catch(() => [])
      );
    }
    const all = await files.get(c.filePath);
    return all.slice(c.startLine - 1, c.endLine);
  };
  return async (c) => {
    const sugs = isLineRoot(c) && c.side === 'new' ? parseSuggestions(c.body) : [];
    const sug = sugs[0] || null;
    const kind = kindOf(c, sugs);
    if (!sug) return { ...c, kind, bodyHtml: renderCommentHtml(c), suggestion: null, applicable: null };
    const snapshot = Array.isArray(c.lineSnapshot) ? c.lineSnapshot : [];
    const cur = repoRoot && safeRelPath(c.filePath) ? await linesOf(c) : [];
    const applicable = snapshot.length > 0 && sameLines(cur, snapshot);
    return {
      ...c,
      bodyHtml: renderCommentHtml(c, {
        snapshot,
        applicable,
        handoff: c.handoff || null,
        applied: Boolean(c.applied),
      }),
      kind,
      suggestion: { lines: sug.lines },
      applicable,
      handoff: c.handoff || null,
    };
  };
}

// Best-effort: add ".prequel/" to the repo's local git exclude so exported
// review files don't appear as untracked in the diff or get committed. Uses
// .git/info/exclude so the user's tracked .gitignore is left untouched.
async function ensureExcluded(repoRoot) {
  try {
    const p = path.join(repoRoot, '.git', 'info', 'exclude');
    let cur = '';
    try {
      cur = await fs.readFile(p, 'utf8');
    } catch {
      /* file may not exist yet */
    }
    if (cur.split('\n').some((l) => l.trim() === '.prequel/')) return;
    const prefix = cur && !cur.endsWith('\n') ? cur + '\n' : cur;
    await fs.writeFile(p, prefix + '.prequel/\n');
  } catch {
    /* .git may be a file (worktree/submodule) or unwritable — ignore */
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

const DIFF_MODES = ['all', 'branch', 'working'];
const MAX_HIGHLIGHT_LINES = 5000;

// ?view=split|unified (layout); ?mode=light|dark (color); default auto.
// ?diff=all|branch|working (which changes to show); ?base=<ref>.
function pageParams(query, defaultBase) {
  const view = query.view === 'unified' ? 'unified' : 'split';
  const colorMode = ['light', 'dark'].includes(query.mode) ? query.mode : 'auto';
  const diffMode = DIFF_MODES.includes(query.diff) ? query.diff : 'working';
  const rawBase = typeof query.base === 'string' && query.base && !query.base.startsWith('-') ? query.base : null;
  const requestedBase = rawBase || defaultBase;
  const qs = new URLSearchParams({ view, diff: diffMode });
  if (colorMode !== 'auto') qs.set('mode', colorMode);
  if (rawBase) qs.set('base', rawBase);
  return { view, colorMode, diffMode, requestedBase, query: qs.toString() };
}

// Repo-relative path from the URL, or null when it is absolute or escapes upward.
function safeRelPath(raw) {
  const p = path.posix.normalize(String(raw || ''));
  if (!p || p === '.' || p.startsWith('/') || p === '..' || p.startsWith('../')) return null;
  return p;
}

const isBinaryText = (text) => text.slice(0, 8192).includes('\0');

const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const ATTACHMENT_NAME = /^[a-f0-9]{16,}\.(png|jpe?g|gif|webp)$/;

function matchesMagic(buf, type) {
  const startsWith = (bytes, at = 0) => bytes.every((b, i) => buf[at + i] === b);
  switch (type) {
    case 'image/png':
      return startsWith([0x89, 0x50, 0x4e, 0x47]);
    case 'image/jpeg':
      return startsWith([0xff, 0xd8, 0xff]);
    case 'image/gif':
      return buf.subarray(0, 4).toString('latin1') === 'GIF8';
    case 'image/webp':
      return buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP';
    default:
      return false;
  }
}

export function createServer({ repoRoot = null, defaultBase = null } = {}) {
  const app = express();

  async function loadDiff(diffMode, requestedBase) {
    const result = await getDiff(repoRoot, { base: requestedBase, mode: diffMode });
    return { ...result, diff: parseDiff(result.patch) };
  }

  // Which revision the "new" side comes from, for context expansion:
  // branch mode diffs against HEAD; all/working show the working tree.
  const revFor = (diffMode) => (!repoRoot ? null : diffMode === 'branch' ? 'HEAD' : 'WORKTREE');

  async function prepareDiff(diff, rev) {
    annotateWordDiffs(diff); // intra-line changed ranges (before highlighting)
    await highlightDiff(diff); // attaches per-line highlighted HTML in place
    if (!repoRoot) return;
    await Promise.all(
      diff.files
        .filter((f) => !f.isBinary && f.status !== 'removed')
        .map(async (f) => {
          f.newLineCount = await getLineCount(repoRoot, { rev, path: f.newPath });
        })
    );
  }

  // Writes a suggestion into the working tree when the snapshot still matches.
  // Returns { status, body } shaped like the HTTP response.
  const applySuggestion = (id) => withLock(`apply:${repoRoot}`, () => applyLocked(id));

  async function applyLocked(id) {
    const c = await getComment(repoRoot, id);
    if (!c) return { status: 404, body: { error: 'not found' } };
    if (!isLineRoot(c) || c.side !== 'new') return { status: 400, body: { error: 'not a new-side line comment' } };
    const sug = parseSuggestions(c.body)[0];
    if (!sug) return { status: 400, body: { error: 'no suggestion' } };
    const rel = safeRelPath(c.filePath);
    const abs = rel && insideRepo(repoRoot, rel);
    if (!abs) return { status: 400, body: { error: 'invalid path' } };
    if (c.applied) return { status: 409, body: { error: 'already applied', outdated: true } };
    if (c.handoff === 'agent') return { status: 409, body: { error: 'handed off to agent', outdated: true } };
    let text;
    try {
      text = await fs.readFile(abs, 'utf8');
    } catch {
      return { status: 409, body: { error: 'file missing', outdated: true } };
    }
    const nl = text.includes('\r\n') ? '\r\n' : '\n';
    const trailing = text.endsWith('\n');
    const all = splitLines(trailing ? text : text + '\n').map((l) => l.replace(/\r$/, ''));
    const snapshot = Array.isArray(c.lineSnapshot) ? c.lineSnapshot : [];
    const cur = all.slice(c.startLine - 1, c.endLine);
    if (!snapshot.length || !sameLines(cur, snapshot)) return { status: 409, body: { error: 'outdated', outdated: true } };
    const next = [...all.slice(0, c.startLine - 1), ...sug.lines, ...all.slice(c.endLine)];
    const out = next.join(nl) + (trailing ? nl : '');
    await writeFileAtomic(abs, out);
    const comment = await updateComment(repoRoot, c.id, {
      status: 'resolved',
      applied: { at: new Date().toISOString(), lines: sug.lines },
    });
    return { status: 200, body: { comment }, path: rel };
  }

  app.set('view engine', 'ejs');
  app.set('views', path.join(projectRoot, 'views'));

  const json1mb = express.json({ limit: '1mb' });
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.get('origin');
    if (!origin || origin === `${req.protocol}://${req.get('host')}`) return next();
    res.status(403).json({ error: 'cross-origin request rejected' });
  });
  app.use((req, res, next) => (req.path === '/api/attachments' ? next() : json1mb(req, res, next)));
  app.use('/static', express.static(path.join(projectRoot, 'public')));
  app.use(
    '/vendor/primer',
    express.static(path.join(projectRoot, 'node_modules/@primer/primitives/dist/css'))
  );

  app.get('/', async (req, res) => {
    const { view, colorMode, diffMode, requestedBase, query } = pageParams(req.query, defaultBase);

    let diff;
    let head;
    let base;
    let error = null;

    if (repoRoot) {
      try {
        const result = await loadDiff(diffMode, requestedBase);
        diff = result.diff;
        head = result.head;
        base = result.base;
      } catch (err) {
        error = err.message;
      }
    }

    if (!diff) {
      // No repo (or git failed): fall back to the built-in sample so the UI
      // still demonstrates. `error` surfaces any git failure.
      diff = sampleDiff;
      head = sampleDiff.head;
      base = sampleDiff.base;
    }

    const rev = revFor(diffMode);
    await prepareDiff(diff, rev);
    const { filesHtml, summary } = renderDiff(diff, { view, rev, query });
    const treeHtml = diff.files.length ? renderFileTree(diff) : '';
    res.render('review', {
      repoPath: repoRoot || process.cwd(),
      isRepo: Boolean(repoRoot),
      base,
      head,
      diffMode,
      colorMode,
      view,
      error,
      filesHtml,
      treeHtml,
      summary,
      commentsEnabled: Boolean(repoRoot),
    });
  });

  // Whole-file view with a repository tree. Content comes from the working tree
  // (working/all) or HEAD (branch); a deleted file shows its base revision.
  app.get('/file/*', async (req, res) => {
    if (!repoRoot) return res.status(404).send('no repo');
    const filePath = safeRelPath(req.params[0]);
    if (!filePath) return res.status(404).send('not found');
    const { view, colorMode, diffMode, requestedBase, query } = pageParams(req.query, defaultBase);

    let result;
    try {
      result = await loadDiff(diffMode, requestedBase);
    } catch (err) {
      return res.status(500).type('text/plain').send(err.message);
    }
    const { diff, head, base, baseRev } = result;
    const file = diff.files.find((f) => f.newPath === filePath || f.oldPath === filePath);
    const isDeleted = file?.status === 'removed';
    const viewRev = diffMode === 'branch' ? 'HEAD' : 'WORKTREE';
    const rev = isDeleted ? baseRev : viewRev;

    const text = await getBlobText(repoRoot, { rev, path: filePath });
    if (text === '' && !(await blobExists(repoRoot, { rev, path: filePath }))) {
      return res.status(404).send('not found');
    }
    const isBinary = Boolean(file?.isBinary) || isBinaryText(text);
    const commentable = Boolean(file) && !isDeleted && !isBinary;
    const lines = isBinary ? [] : splitLines(text);
    const plain = lines.length > MAX_HIGHLIGHT_LINES;
    const html = plain || isBinary ? null : await highlightLines(lines, inferLanguage(filePath));
    const changed = new Set();
    if (file && !isDeleted) {
      for (const h of file.hunks) for (const l of h.lines) if (l.type === 'add') changed.add(l.newNumber);
    }

    const changedByPath = new Map(diff.files.map((f) => [f.newPath, f.status]));
    const paths = await getRepoFiles(repoRoot, { rev: viewRev });
    for (const f of diff.files) if (f.status === 'removed') paths.push(f.newPath);
    const treeHtml = renderRepoTree([...new Set(paths)].sort(), {
      changedByPath,
      activePath: filePath,
      query,
    });
    const tableHtml = isBinary
      ? binaryNotice()
      : renderFileView({ path: filePath, lines, html, changed, commentable });

    res.render('file', {
      maxHighlight: MAX_HIGHLIGHT_LINES,
      repoPath: repoRoot,
      path: filePath,
      crumbs: filePath.split('/'),
      backHref: `/?${query}${file ? `#diff-${file.id}` : ''}`,
      colorMode,
      view,
      diffMode,
      base,
      head,
      branch: head,
      isDeleted,
      isBinary,
      commentable,
      plain,
      tableHtml,
      treeHtml,
      lineCount: lines.length,
    });
  });

  // On-demand context lines for hunk expansion.
  // ?path=&rev=HEAD|WORKTREE&start=&end= (new-side line numbers, 1-based).
  app.get('/api/context', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const filePath = String(req.query.path || '');
    const rev = req.query.rev === 'HEAD' ? 'HEAD' : 'WORKTREE';
    const start = parseInt(req.query.start, 10);
    const end = parseInt(req.query.end, 10);
    if (!filePath || !Number.isFinite(start) || !Number.isFinite(end)) {
      return res.status(400).json({ error: 'bad params' });
    }
    try {
      const { lines, from, eof } = await getBlobLines(repoRoot, { rev, path: filePath, start, end });
      const plain = lines.length > MAX_HIGHLIGHT_LINES;
      const html = plain ? null : await highlightLines(lines, inferLanguage(filePath));
      res.json({ from, eof, lines, html, plain, maxHighlight: MAX_HIGHLIGHT_LINES });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- live updates (SSE) -------------------------------------------------
  // Every mutation is broadcast so open pages reflect changes made elsewhere —
  // notably by Claude working the review through the API.
  const sseClients = new Set();

  // `origin` is the client id sent by whoever made the change; that client
  // already applied it locally and skips its own echo.
  function emit(type, data, req) {
    const payload = JSON.stringify({ type, origin: req?.get('x-prequel-client') || null, ...data });
    for (const client of sseClients) {
      try {
        client.write(`data: ${payload}\n\n`);
      } catch {
        /* dropped connection; the close handler will evict it */
      }
    }
  }

  app.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    sseClients.add(res);
    // Comment-only frames keep the connection from idling out.
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* ignore */
      }
    }, 25000);
    req.on('close', () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
  });

  // --- review comments ---------------------------------------------------
  app.post('/api/preview', async (req, res) => {
    const b = req.body || {};
    if (typeof b.body !== 'string') return res.status(400).json({ error: 'bad params' });
    const start = Number(b.startLine);
    const end = Number.isFinite(Number(b.endLine)) ? Number(b.endLine) : start;
    const anchored = repoRoot && b.side === 'new' && typeof b.filePath === 'string' && Number.isFinite(start);
    if (!anchored) return res.json({ html: renderMarkdown(b.body) });
    const filePath = safeRelPath(b.filePath);
    if (!filePath) return res.json({ html: renderMarkdown(b.body) });
    const { lines } = await getBlobLines(repoRoot, { rev: 'WORKTREE', path: filePath, start, end });
    const c = { body: b.body, side: 'new', parentId: null };
    res.json({ html: renderCommentHtml(c, { snapshot: lines, applicable: true }) });
  });

  app.get('/api/comments', async (req, res) => {
    if (!repoRoot) return res.json({ comments: [] });
    const branch = req.query.branch ? String(req.query.branch) : null;
    // Optional filters; omit them all to get everything (what the UI wants).
    //   ?status=open|resolved   ?author=user|claude   ?roots=1 (exclude replies)
    const status = ['open', 'resolved'].includes(req.query.status) ? req.query.status : null;
    const author = ['user', 'claude'].includes(req.query.author) ? req.query.author : null;
    const rootsOnly = req.query.roots === '1';
    let comments = await listComments(repoRoot, branch);
    // Comments predating these fields are treated as open, user-authored roots.
    if (status) comments = comments.filter((c) => (c.status || 'open') === status);
    if (author) comments = comments.filter((c) => (c.author || 'user') === author);
    if (rootsOnly) comments = comments.filter((c) => !c.parentId);
    const decorate = decorator(repoRoot);
    res.json({ comments: await Promise.all(comments.map(decorate)) });
  });

  app.post('/api/comments', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const b = req.body || {};
    const author = b.author === 'claude' ? 'claude' : 'user';

    // A reply carries only { parentId, body } — it inherits its anchor from the
    // comment it answers, so the two can never drift apart.
    if (b.parentId) {
      const parent = await getComment(repoRoot, String(b.parentId));
      if (!parent) return res.status(404).json({ error: 'parent not found' });
      if (parent.parentId) return res.status(400).json({ error: 'cannot reply to a reply' });
      if (!b.body) return res.status(400).json({ error: 'bad params' });
      const reply = await addComment(repoRoot, {
        parentId: parent.id,
        author,
        filePath: parent.filePath,
        side: parent.side,
        startLine: parent.startLine,
        endLine: parent.endLine,
        body: String(b.body),
        branch: parent.branch ?? null,
        lineSnapshot: [],
      });
      const out = await decorator(repoRoot)(reply);
      emit('comment.created', { comment: out }, req);
      return res.json({ comment: out });
    }

    const side = b.side === 'old' ? 'old' : b.side === 'file' ? 'file' : 'new';
    // file-level comments aren't tied to a line
    const startLine = side === 'file' ? 0 : Number(b.startLine);
    if (!b.filePath || !b.body || (side !== 'file' && !Number.isFinite(startLine))) {
      return res.status(400).json({ error: 'bad params' });
    }
    const comment = await addComment(repoRoot, {
      filePath: String(b.filePath),
      side,
      startLine,
      endLine: side === 'file' ? 0 : Number.isFinite(Number(b.endLine)) ? Number(b.endLine) : startLine,
      body: String(b.body),
      branch: b.branch ? String(b.branch) : null,
      lineSnapshot: Array.isArray(b.lineSnapshot) ? b.lineSnapshot.map(String) : [],
      author,
      parentId: null,
    });
    const out = await decorator(repoRoot)(comment);
    emit('comment.created', { comment: out }, req);
    res.json({ comment: out });
  });

  app.patch('/api/comments/:id', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const b = req.body || {};
    const patch = {};
    if (typeof b.body === 'string') patch.body = b.body;
    if (b.status === 'open' || b.status === 'resolved') patch.status = b.status;
    if (b.handoff === 'agent' || b.handoff === null) patch.handoff = b.handoff;
    let comment;
    if (b.taskIndex !== undefined) {
      if (!Number.isInteger(b.taskIndex) || b.taskIndex < 0) return res.status(400).json({ error: 'bad taskIndex' });
      const out = await updateCommentWith(repoRoot, req.params.id, (c) => {
        const body = toggleTask(c.body, b.taskIndex, Boolean(b.checked));
        return body === null ? null : { ...patch, body };
      });
      if (!out) return res.status(404).json({ error: 'not found' });
      if (out.rejected) return res.status(400).json({ error: 'taskIndex out of range' });
      comment = out;
    } else {
      comment = await updateComment(repoRoot, req.params.id, patch);
      if (!comment) return res.status(404).json({ error: 'not found' });
    }
    const out = await decorator(repoRoot)(comment);
    emit('comment.updated', { comment: out }, req);
    res.json({ comment: out });
  });

  app.delete('/api/comments/:id', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const removed = await deleteComment(repoRoot, req.params.id);
    if (removed) emit('comment.deleted', { id: req.params.id }, req);
    res.json({ ok: Boolean(removed), removed });
  });

  app.post('/api/comments/:id/apply', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const r = await applySuggestion(req.params.id);
    if (r.status !== 200) return res.status(r.status).json(r.body);
    const out = await decorator(repoRoot)(r.body.comment);
    emit('comment.updated', { comment: out }, req);
    emit('diff.changed', { path: r.path }, req);
    res.json({ comment: out });
  });

  // Applies every open, applicable, unflagged suggestion; bottom-up per file so
  // an earlier apply cannot shift the line numbers of a later one.
  app.post('/api/suggestions/apply-all', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const branch = req.query.branch ? String(req.query.branch) : null;
    const all = await listComments(repoRoot, branch);
    const candidates = all
      .filter((c) => isLineRoot(c) && c.side === 'new' && c.status === 'open' && c.handoff !== 'agent')
      .filter((c) => parseSuggestions(c.body).length > 0)
      .sort((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : b.startLine - a.startLine));
    const applied = [];
    const skipped = [];
    const changed = new Set();
    for (const c of candidates) {
      const r = await applySuggestion(c.id);
      if (r.status !== 200) {
        skipped.push({ id: c.id, reason: r.body.outdated ? 'outdated' : r.body.error });
        continue;
      }
      const out = await decorator(repoRoot)(r.body.comment);
      applied.push(out);
      changed.add(r.path);
      emit('comment.updated', { comment: out }, req);
    }
    for (const p of changed) emit('diff.changed', { path: p }, req);
    res.json({ applied, skipped });
  });

  // One file's diff section, re-rendered from the current working tree so the
  // client can swap it in place after an apply.
  app.get('/api/file-diff', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const rel = safeRelPath(req.query.path);
    if (!rel) return res.status(400).json({ error: 'invalid path' });
    const { view, diffMode, requestedBase, query } = pageParams(req.query, defaultBase);
    let diff;
    try {
      diff = (await loadDiff(diffMode, requestedBase)).diff;
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    const file = diff.files.find((f) => f.newPath === rel);
    if (!file) return res.status(404).json({ error: 'not in diff' });
    diff.files = [file];
    const rev = revFor(diffMode);
    await prepareDiff(diff, rev);
    res.type('html').send(renderFileHtml(file, { view, rev, query }));
  });

  // Bulk clear (with undo) for a clean slate between review rounds.
  app.post('/api/comments/clear', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const branch = req.body?.branch ? String(req.body.branch) : null;
    const cleared = await clearComments(repoRoot, branch);
    emit('comments.reset', {}, req);
    res.json({ cleared });
  });

  app.post('/api/comments/restore', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const restored = await restoreCleared(repoRoot);
    emit('comments.reset', {}, req);
    res.json({ restored });
  });

  // Build the Claude payload, write it to <repo>/.prequel/, and return it so the
  // client can also copy it to the clipboard.
  app.post('/api/export', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const branch = req.body?.branch ? String(req.body.branch) : null;
    const format = req.body?.format === 'json' ? 'json' : 'md';
    // Replies (and anything Claude wrote) are conversation, not asks — the
    // export is the list of things being requested.
    const all = await listComments(repoRoot, branch);
    const decorate = decorator(repoRoot);
    const comments = await Promise.all(
      all.filter((c) => !c.parentId && (c.author || 'user') === 'user').map(decorate)
    );
    if (!comments.length) return res.json({ count: 0, content: '', path: null });

    const content =
      format === 'json' ? buildJson(comments) : buildMarkdown(repoRoot, branch, comments);
    // filesystem-safe timestamp: 2026-07-17-16-40-00
    const ts = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const dir = path.join(repoRoot, '.prequel');
    const filename = `review-${ts}.${format}`;
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, filename), content);
      await ensureExcluded(repoRoot); // keep .prequel/ out of the diff & commits
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ count: comments.length, content, path: path.join('.prequel', filename) });
  });

  app.get('/api/saved-replies', async (req, res) => {
    res.json({ replies: await listSavedReplies() });
  });

  app.post('/api/saved-replies', async (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!name || !body) return res.status(400).json({ error: 'name and body required' });
    res.json({ reply: await addSavedReply({ name, body }) });
  });

  app.delete('/api/saved-replies/:id', async (req, res) => {
    if (!(await deleteSavedReply(req.params.id))) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  });

  const attachmentsDir = () => path.join(repoRoot, '.prequel', 'attachments');
  const attachmentJson = express.json({ limit: '15mb' });
  const attachmentJsonError = (err, req, res, next) => {
    if (err?.type === 'entity.too.large') return res.status(400).json({ error: 'too large' });
    next(err);
  };

  app.post('/api/attachments', attachmentJson, attachmentJsonError, async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const { name, type, data } = req.body || {};
    const ext = IMAGE_EXT[type];
    if (!ext || typeof data !== 'string') return res.status(400).json({ error: 'unsupported type' });
    const buf = Buffer.from(data, 'base64');
    if (!buf.length || !matchesMagic(buf, type)) return res.status(400).json({ error: 'bad image data' });
    const file = `${crypto.randomBytes(8).toString('hex')}.${ext}`;
    try {
      await fs.mkdir(attachmentsDir(), { recursive: true });
      await fs.writeFile(path.join(attachmentsDir(), file), buf);
      await ensureExcluded(repoRoot);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({
      url: `/attachments/${file}`,
      path: path.posix.join('.prequel', 'attachments', file),
      name: typeof name === 'string' ? name : file,
    });
  });

  app.get('/attachments/:file', (req, res) => {
    if (!repoRoot || !ATTACHMENT_NAME.test(req.params.file)) return res.status(404).send('not found');
    res.sendFile(req.params.file, { root: attachmentsDir() }, (err) => {
      if (err && !res.headersSent) res.status(404).send('not found');
    });
  });

  // Identifies this server and the repo it serves, so a client scanning ports
  // can find the instance belonging to the repo it cares about.
  app.get('/healthz', (req, res) => res.json({ ok: true, app: 'prequel', repoRoot }));

  return app;
}
