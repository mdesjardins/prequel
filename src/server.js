import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { renderDiff, renderFileTree } from './render/renderer.js';
import { highlightDiff, highlightLines } from './render/highlighter.js';
import { annotateWordDiffs } from './render/wordDiff.js';
import {
  getDiff,
  getBlobLines,
  getHead,
  getBranches,
  getReviewBase,
  getGitCommonDir,
  resolveRef,
  repoFingerprint,
  resolveBlobSpec,
  getBlobPairDiff,
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
import { buildMarkdown, buildJson } from './export/claudeExport.js';
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

/**
 * The prequel app: the review page and its JSON API over one repository
 * (docs/http-api.md).  The CLI builds one per run; the package does not yet
 * offer it as a library API.
 *
 * @param {object} [options]
 * @param {string|null} [options.repoRoot] The repository's top level; null serves the built-in sample diff.
 * @param {string|null} [options.defaultBase] The base ref when neither ?base= nor a branch's review base names one (--base).
 * @param {'all'|'branch'|'working'|null} [options.defaultDiff] The mode a page opened without ?diff= shows (--diff); 'working' when unset.
 * @param {string} [options.basePath] '' or '/prefix': every route mounts under it, and /healthz at the root too (--base-path).
 * @param {string|null} [options.staticDir] A directory served at '/' beside the app; needs basePath (--static).
 * @returns {import('express').Express} The app, to listen() on.
 */
export function createServer({ repoRoot = null, defaultBase = null, defaultDiff = null, basePath = '', staticDir = null } = {}) {
  // The mode a bare '/' renders; ?diff= on the URL always wins.
  const fallbackDiff = DIFF_MODES.includes(defaultDiff) ? defaultDiff : 'working';
  const app = express();
  // Every page and API route lives under basePath ('' at the root), so the app
  // can sit behind a reverse proxy at https://host/diffs/ unchanged.
  const router = express.Router();

  app.set('view engine', 'ejs');
  app.set('views', path.join(projectRoot, 'views'));

  app.use(express.json({ limit: '1mb' }));
  router.use('/static', express.static(path.join(projectRoot, 'public')));
  router.use(
    '/vendor/primer',
    express.static(path.join(projectRoot, 'node_modules/@primer/primitives/dist/css'))
  );

  // <base href> carries this request's query string, so a fragment link
  // ('#diff-<id>' in the file tree) resolves to this very page and scrolls,
  // instead of navigating to basePath/ without ?branch=... .
  const baseHrefOf = (req) => {
    const qIdx = req.originalUrl.indexOf('?');
    return `${basePath}/${qIdx >= 0 ? req.originalUrl.slice(qIdx) : ''}`;
  };

  // ?a=<rev>:<path>&b=<rev>:<path> (&la=&lb= labels): two files compared as
  // one, read-only -- comments belong to a branch, and this page has none.  b
  // alone (or a alone) shows that file whole, as new.  The page is a branch
  // review's: the same parse, highlighting and rendering, and context
  // expansion reads b's side from b's commit.
  async function renderCompare(req, res, { view, colorMode }) {
    const label = (v) => (typeof v === 'string' && v ? v.slice(0, 120) : null);
    let wantA = typeof req.query.a === 'string' && req.query.a ? req.query.a : null;
    let wantB = typeof req.query.b === 'string' && req.query.b ? req.query.b : null;
    let la = label(req.query.la);
    let lb = label(req.query.lb);
    if (!wantB) [wantA, wantB, la, lb] = [null, wantA, null, la];
    const a = wantA ? await resolveBlobSpec(repoRoot, wantA) : null;
    const b = await resolveBlobSpec(repoRoot, wantB);
    let error = null;
    if (!b) error = `Not a file in a commit: ${wantB}`;
    else if (wantA && !a) error = `Not a file in a commit: ${wantA}`;
    let diff = { files: [] };
    let identical = false;
    if (!error) {
      try {
        const result = await getBlobPairDiff(repoRoot, { a, b });
        diff = parseDiff(result.patch);
        identical = result.identical;
      } catch (err) {
        error = err.message;
      }
    }
    annotateWordDiffs(diff);
    await highlightDiff(diff);
    const { filesHtml, summary } = renderDiff(diff, { view, rev: b ? b.rev : null });
    res.render('review', {
      repoPath: repoRoot,
      isRepo: true,
      base: a ? a.spec : '(nothing)',
      head: b ? b.spec : wantB,
      currentHead: await getHead(repoRoot),
      pinned: true,
      branches: [],
      diffMode: 'compare',
      colorMode,
      view,
      error,
      filesHtml,
      treeHtml: '',
      summary,
      commentsEnabled: false,
      basePath,
      baseHref: baseHrefOf(req),
      compare: { a, b, la, lb, identical },
    });
  }

  router.get('/', async (req, res) => {
    // ?view=split|unified (layout); ?mode=light|dark (color); default auto.
    const view = req.query.view === 'unified' ? 'unified' : 'split';
    const colorMode = ['light', 'dark'].includes(req.query.mode) ? req.query.mode : 'auto';
    if (repoRoot && (req.query.a || req.query.b)) return renderCompare(req, res, { view, colorMode });
    // ?branch=<ref>: review a branch other than the checked-out one, straight
    // from git. Its working tree does not exist here, so the mode is 'branch'.
    const currentHead = repoRoot ? await getHead(repoRoot) : null;
    const wantRef = typeof req.query.branch === 'string' && req.query.branch ? req.query.branch : null;
    let ref = null;
    let refError = null;
    if (repoRoot && wantRef && wantRef !== currentHead) {
      ref = await resolveRef(repoRoot, wantRef);
      if (!ref) refError = `Unknown branch: ${wantRef}`;
    }
    const pinned = Boolean(ref);
    // ?diff=all|branch|working (which changes to show); ?base=<ref>. Without
    // a base, a branch's recorded review base (fleet-review.sh sets one) wins
    // over the server default.
    let diffMode = DIFF_MODES.includes(req.query.diff) ? req.query.diff : fallbackDiff;
    if (pinned) diffMode = 'branch';
    const viewRef = ref || currentHead;
    const reviewBase = repoRoot && viewRef ? await getReviewBase(repoRoot, viewRef) : null;
    const requestedBase =
      (typeof req.query.base === 'string' && req.query.base ? req.query.base : null) ||
      reviewBase ||
      defaultBase;
    const branches = repoRoot ? await getBranches(repoRoot) : [];

    let diff;
    let head;
    let base;
    let error = refError;

    if (repoRoot) {
      try {
        const result = await getDiff(repoRoot, { base: requestedBase, mode: diffMode, ref });
        diff = parseDiff(result.patch);
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
    const rev = repoRoot && diffMode === 'branch' ? ref || 'HEAD' : 'WORKTREE';
    const { filesHtml, summary } = renderDiff(diff, { view, rev });
    const treeHtml = diff.files.length ? renderFileTree(diff) : '';
    const baseHref = baseHrefOf(req);
    res.render('review', {
      repoPath: repoRoot || process.cwd(),
      isRepo: Boolean(repoRoot),
      base,
      head,
      currentHead,
      pinned,
      branches,
      diffMode,
      colorMode,
      view,
      error,
      filesHtml,
      treeHtml,
      summary,
      commentsEnabled: Boolean(repoRoot),
      basePath,
      baseHref,
    });
  });

  // On-demand context lines for hunk expansion.
  // ?path=&rev=HEAD|WORKTREE&start=&end= (new-side line numbers, 1-based).
  router.get('/api/context', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const filePath = String(req.query.path || '');
    const revParam = String(req.query.rev || 'WORKTREE');
    let rev = 'WORKTREE';
    if (revParam !== 'WORKTREE') {
      rev = revParam === 'HEAD' ? 'HEAD' : await resolveRef(repoRoot, revParam);
      if (!rev) return res.status(400).json({ error: 'bad rev' });
    }
    const start = parseInt(req.query.start, 10);
    const end = parseInt(req.query.end, 10);
    if (!filePath || !Number.isFinite(start) || !Number.isFinite(end)) {
      return res.status(400).json({ error: 'bad params' });
    }
    try {
      const { lines, from, eof } = await getBlobLines(repoRoot, { rev, path: filePath, start, end });
      const html = await highlightLines(lines, inferLanguage(filePath));
      res.json({ from, eof, lines, html });
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

  // Comments stream live, but the diff itself is rendered server-side at page
  // load — so code edited after that (by Claude working the review, or by the
  // user in an editor) goes stale on screen. Poll for repo changes while a page
  // is watching, and tell it so it can refresh.
  let lastFingerprint = null;
  let watchTimer = null;

  async function pollRepo() {
    if (!repoRoot) return;
    try {
      const fp = await repoFingerprint(repoRoot);
      if (lastFingerprint !== null && fp !== lastFingerprint) emit('diff.changed', {});
      lastFingerprint = fp;
    } catch {
      /* transient git failure (e.g. mid-rebase index.lock) — try again next tick */
    }
  }

  // Only poll while someone is watching, so an idle server does no git work.
  function syncWatcher() {
    const shouldWatch = repoRoot && sseClients.size > 0;
    if (shouldWatch && !watchTimer) {
      lastFingerprint = null; // re-baseline; don't fire for changes made while nobody watched
      pollRepo();
      watchTimer = setInterval(pollRepo, 1500);
      watchTimer.unref?.(); // never hold the process open
    } else if (!shouldWatch && watchTimer) {
      clearInterval(watchTimer);
      watchTimer = null;
    }
  }

  router.get('/api/events', (req, res) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    sseClients.add(res);
    syncWatcher();
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
      syncWatcher();
    });
  });

  // --- review comments ---------------------------------------------------
  router.get('/api/comments', async (req, res) => {
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

  router.post('/api/comments', async (req, res) => {
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

  router.patch('/api/comments/:id', async (req, res) => {
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

  router.delete('/api/comments/:id', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const removed = await deleteComment(repoRoot, req.params.id);
    if (removed) emit('comment.deleted', { id: req.params.id }, req);
    res.json({ ok: Boolean(removed), removed });
  });

  // Bulk clear (with undo) for a clean slate between review rounds.
  router.post('/api/comments/clear', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const branch = req.body?.branch ? String(req.body.branch) : null;
    const cleared = await clearComments(repoRoot, branch);
    emit('comments.reset', {}, req);
    res.json({ cleared });
  });

  router.post('/api/comments/restore', async (req, res) => {
    if (!repoRoot) return res.status(400).json({ error: 'no repo' });
    const restored = await restoreCleared(repoRoot);
    emit('comments.reset', {}, req);
    res.json({ restored });
  });

  // Build the Claude payload, write it to <repo>/.prequel/, and return it so the
  // client can also copy it to the clipboard.
  router.post('/api/export', async (req, res) => {
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

  // Identifies this server and the repo it serves, so a client scanning ports
  // can find the instance belonging to the repo it cares about.
  // Branches this server can review (?branch=), with any recorded review base.
  router.get('/api/branches', async (req, res) => {
    if (!repoRoot) return res.json({ branches: [] });
    const current = await getHead(repoRoot);
    const names = await getBranches(repoRoot);
    const branches = [];
    for (const name of names) {
      branches.push({ name, current: name === current, reviewBase: await getReviewBase(repoRoot, name) });
    }
    res.json({ branches });
  });

  // gitCommonDir is shared by every worktree of the repository, so a client
  // in any of them can tell this server is theirs; head is what is checked
  // out here (the only branch whose working tree this server can show).
  const healthz = async (req, res) => {
    const gitCommonDir = repoRoot ? await getGitCommonDir(repoRoot) : null;
    const head = repoRoot ? await getHead(repoRoot) : null;
    res.json({ ok: true, app: 'prequel', repoRoot, gitCommonDir, head, basePath });
  };
  router.get('/healthz', healthz);
  app.get('/healthz', healthz);
  app.use(basePath || '/', router);
  if (staticDir) {
    // --static: a site at the root beside the app (under basePath), so one
    // process serves both and the site's relative links to the app resolve.
    app.use('/', express.static(path.resolve(staticDir)));
  } else if (basePath) {
    app.get('/', (req, res) => res.redirect(basePath + '/'));
  }

  return app;
}
