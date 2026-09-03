import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { binaryNotice, renderDiff, renderFileTree, renderFileView, renderRepoTree } from './render/renderer.js';
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
} from './git/gitService.js';
import { parseDiff, inferLanguage } from './git/diffParser.js';
import { sampleDiff } from './sampleDiff.js';
import {
  listComments,
  addComment,
  getComment,
  updateComment,
  deleteComment,
  clearComments,
  restoreCleared,
} from './comments/commentStore.js';
import { listSavedReplies, addSavedReply, deleteSavedReply } from './comments/savedReplies.js';
import { buildMarkdown, buildJson } from './export/claudeExport.js';
import crypto from 'node:crypto';
import { marked } from 'marked';

marked.setOptions({ breaks: true });

// Add rendered markdown (bodyHtml) for the client to display.
function withHtml(c) {
  return { ...c, bodyHtml: marked.parse(c.body || '') };
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

  app.set('view engine', 'ejs');
  app.set('views', path.join(projectRoot, 'views'));

  const json1mb = express.json({ limit: '1mb' });
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

    annotateWordDiffs(diff); // intra-line changed ranges (before highlighting)
    await highlightDiff(diff); // attaches per-line highlighted HTML in place
    // Which revision the "new" side comes from, for context expansion:
    // branch mode diffs against HEAD; all/working show the working tree.
    const rev = !repoRoot ? null : diffMode === 'branch' ? 'HEAD' : 'WORKTREE';
    if (repoRoot) {
      await Promise.all(
        diff.files
          .filter((f) => !f.isBinary && f.status !== 'removed')
          .map(async (f) => {
            f.newLineCount = await getLineCount(repoRoot, { rev, path: f.newPath });
          })
      );
    }
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
    res.json({ comments: comments.map(withHtml) });
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
      emit('comment.created', { comment: withHtml(reply) }, req);
      return res.json({ comment: withHtml(reply) });
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
    emit('comment.created', { comment: withHtml(comment) }, req);
    res.json({ comment: withHtml(comment) });
  });

  app.patch('/api/comments/:id', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const b = req.body || {};
    const patch = {};
    if (typeof b.body === 'string') patch.body = b.body;
    if (b.status === 'open' || b.status === 'resolved') patch.status = b.status;
    const comment = await updateComment(repoRoot, req.params.id, patch);
    if (!comment) return res.status(404).json({ error: 'not found' });
    emit('comment.updated', { comment: withHtml(comment) }, req);
    res.json({ comment: withHtml(comment) });
  });

  app.delete('/api/comments/:id', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const removed = await deleteComment(repoRoot, req.params.id);
    if (removed) emit('comment.deleted', { id: req.params.id }, req);
    res.json({ ok: Boolean(removed), removed });
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
    const comments = all.filter((c) => !c.parentId && (c.author || 'user') === 'user');
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
