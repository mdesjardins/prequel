// Review comments: hover-"+" for a line comment (or the file-header button for
// a file-level comment), save, render as inline threads, delete. Plus bulk
// clear (with undo) and export-then-clear, for the review→hand-off→re-review loop.

(function () {
  const root = document.documentElement;
  if (root.dataset.commentsEnabled !== '1') return;
  const branch = root.dataset.branch || '';

  const exportBtn = document.getElementById('export-btn');
  const clearBtn = document.getElementById('clear-btn');
  let commentCount = 0;

  const isSplitTable = (table) => table.classList.contains('diff-table-split');

  // Identifies this tab so it can ignore the echo of its own mutations coming
  // back over the event stream (it already applied them locally).
  const CLIENT_ID =
    (window.crypto && crypto.randomUUID && crypto.randomUUID()) || String(Math.random());
  const jsonHeaders = () => ({ 'content-type': 'application/json', 'x-prequel-client': CLIENT_ID });
  const clientHeaders = () => ({ 'x-prequel-client': CLIENT_ID });

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- subnav buttons ----------------------------------------------------
  function updateButtons() {
    if (exportBtn) {
      exportBtn.hidden = commentCount === 0;
      exportBtn.textContent =
        commentCount === 1 ? 'Export 1 comment for Claude' : `Export ${commentCount} comments for Claude`;
    }
    if (clearBtn) clearBtn.hidden = commentCount === 0;
  }

  // --- toast (with optional action) --------------------------------------
  let toastTimer = null;
  function toast(message, action, { sticky = false } = {}) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = '';
    const span = document.createElement('span');
    span.textContent = message;
    el.appendChild(span);
    if (action) {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        el.hidden = true;
        action.fn();
      });
      el.appendChild(btn);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => (el.hidden = true), 6000);
  }

  // --- shared thread markup ---------------------------------------------
  // A thread is one root comment plus its replies, rendered as stacked cards
  // inside a single container — the shape GitHub uses.
  function timeLabel(c) {
    try {
      return new Date(c.createdAt).toLocaleString();
    } catch {
      return '';
    }
  }

  function commentCardHtml(c, { isRoot, outdated = false }) {
    const author = c.author === 'claude' ? 'claude' : 'you';
    const range =
      isRoot && c.side !== 'file' && c.endLine > c.startLine
        ? `<span class="comment-lines">Lines ${c.startLine}–${c.endLine}</span>`
        : '';
    const resolved = isRoot && c.status === 'resolved';
    const outdatedPill =
      isRoot && outdated
        ? `<span class="comment-outdated-pill">Outdated${c.side === 'file' ? '' : ` · was line ${c.startLine}`}</span>`
        : '';
    const tools = isRoot
      ? `<button class="comment-resolve">${resolved ? 'Reopen' : 'Resolve'}</button>` +
        `<button class="comment-reply-btn">Reply</button>`
      : '';
    return (
      `<div class="comment" data-comment-id="${c.id}" data-author="${author}">` +
      `<div class="comment-header">` +
      `<span class="comment-author comment-author-${author}">${author === 'claude' ? 'Claude' : 'You'}</span>` +
      range +
      `<span class="comment-time">${escapeHtml(timeLabel(c))}</span>` +
      outdatedPill +
      (resolved ? '<span class="comment-resolved-pill">Resolved</span>' : '') +
      `<span class="comment-tools">${tools}` +
      `<button class="comment-delete" title="Delete comment">Delete</button></span>` +
      `</div>` +
      `<div class="comment-body markdown-body">${c.bodyHtml || escapeHtml(c.body || '')}</div>` +
      `</div>`
    );
  }

  function threadInner(root, replies, { outdated = false } = {}) {
    const cards = [commentCardHtml(root, { isRoot: true, outdated })].concat(
      (replies || []).map((r) => commentCardHtml(r, { isRoot: false }))
    );
    const cls =
      (root.status === 'resolved' ? ' is-resolved' : '') + (outdated ? ' is-outdated' : '');
    return `<div class="comment-thread${cls}" data-root-id="${root.id}">${cards.join('')}</div>`;
  }

  function composeInner() {
    return (
      `<form class="comment-compose">` +
      `<textarea class="comment-input" rows="3" placeholder="Leave a comment. Markdown supported."></textarea>` +
      `<div class="comment-compose-actions">` +
      `<button type="button" class="btn comment-cancel">Cancel</button>` +
      `<button type="submit" class="btn btn-primary">Comment</button>` +
      `</div></form>`
    );
  }

  // Unified spans the code column (colspan 3); split confines the thread to the
  // side it was made on (2 of 4 columns), leaving the other side empty.
  function threadCells(isSplit, side, inner) {
    if (!isSplit) return `<td class="comment-cell" colspan="3">${inner}</td>`;
    const cell = `<td class="comment-cell" colspan="2">${inner}</td>`;
    const empty = '<td class="comment-cell-empty" colspan="2"></td>';
    return side === 'old' ? cell + empty : empty + cell;
  }

  const commentRowHtml = (c, isSplit, replies) =>
    `<tr class="comment-row" data-root-id="${c.id}">${threadCells(isSplit, c.side, threadInner(c, replies))}</tr>`;
  const fileCommentHtml = (c, replies, opts) =>
    `<div class="file-comment" data-root-id="${c.id}">${threadInner(c, replies, opts)}</div>`;

  // --- anchoring helpers -------------------------------------------------
  function findAnchorCell(filePath, side, line) {
    const file = document.querySelector(`.file[data-path="${CSS.escape(filePath)}"]`);
    if (!file) return null;
    return file.querySelector(
      `.blob-num.commentable[data-side="${side}"][data-comment-line="${line}"]`
    );
  }

  // The code cell that belongs to a gutter cell (same row, next .blob-code).
  function codeCellFor(gutterCell) {
    const cells = [...gutterCell.closest('tr').children];
    const start = cells.indexOf(gutterCell);
    for (let i = start + 1; i < cells.length; i++) {
      if (cells[i].classList.contains('blob-code')) return cells[i];
    }
    return null;
  }

  function snapshotFor(gutterCell) {
    const code = codeCellFor(gutterCell);
    const inner = code && code.querySelector('.blob-code-inner');
    return inner ? inner.textContent.slice(1) : ''; // drop the +/-/space marker
  }

  // Capture every line's code across a range on one side (for export context).
  function snapshotForRange(filePath, side, lo, hi) {
    const out = [];
    for (let n = lo; n <= hi; n++) {
      const cell = findAnchorCell(filePath, side, n);
      if (cell) out.push(snapshotFor(cell));
    }
    return out.length ? out : [''];
  }

  // Tint the selected line range (gutter + code) while composing / dragging.
  function clearRangeHighlight() {
    document.querySelectorAll('.mq-range-line').forEach((el) => el.classList.remove('mq-range-line'));
  }
  function highlightRange(filePath, side, lo, hi) {
    clearRangeHighlight();
    if (hi <= lo) return;
    for (let n = lo; n <= hi; n++) {
      const g = findAnchorCell(filePath, side, n);
      if (!g) continue;
      g.classList.add('mq-range-line');
      const code = codeCellFor(g);
      if (code) code.classList.add('mq-range-line');
    }
  }

  function insertionPointAfter(row) {
    let last = row;
    while (last.nextElementSibling && last.nextElementSibling.classList.contains('comment-row')) {
      last = last.nextElementSibling;
    }
    return last;
  }

  // --- composing ---------------------------------------------------------
  // Single line = range where start === end. The thread is anchored after the
  // END line (GitHub's convention), and the snapshot captures the whole block.
  function openLineCompose(filePath, side, a, b) {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);

    // Re-focus if the identical range is already being composed.
    const same = [...document.querySelectorAll('.comment-compose-row')].find(
      (r) =>
        r.dataset.filePath === filePath &&
        r.dataset.side === side &&
        Number(r.dataset.startLine) === lo &&
        Number(r.dataset.endLine) === hi
    );
    if (same) return same.querySelector('.comment-input').focus();

    // Otherwise replace any open line-compose and (re)highlight this range.
    document.querySelectorAll('.comment-compose-row').forEach((r) => r.remove());
    const cell = findAnchorCell(filePath, side, hi);
    if (!cell) return clearRangeHighlight();

    const isSplit = isSplitTable(cell.closest('table'));
    const at = insertionPointAfter(cell.closest('tr'));
    at.insertAdjacentHTML(
      'afterend',
      `<tr class="comment-row comment-compose-row">${threadCells(isSplit, side, composeInner())}</tr>`
    );
    const composeRow = at.nextElementSibling;
    Object.assign(composeRow.dataset, {
      filePath,
      side,
      startLine: String(lo),
      endLine: String(hi),
      snapshot: JSON.stringify(snapshotForRange(filePath, side, lo, hi)),
    });
    setFormContext(composeRow);
    highlightRange(filePath, side, lo, hi);
    composeRow.querySelector('.comment-input').focus();
  }

  function openFileCompose(fileEl) {
    const filePath = fileEl.dataset.path;
    const container = fileEl.querySelector('.file-comments');
    let compose = container.querySelector('.file-comment-compose');
    if (!compose) {
      container.insertAdjacentHTML('beforeend', `<div class="file-comment-compose">${composeInner()}</div>`);
      compose = container.querySelector('.file-comment-compose');
      Object.assign(compose.dataset, { filePath, side: 'file', startLine: '0', endLine: '0', snapshot: '[]' });
      setFormContext(compose);
    }
    compose.querySelector('.comment-input').focus();
  }

  // Copy anchor context onto the form so submit is container-agnostic.
  function setFormContext(container) {
    const form = container.querySelector('.comment-compose');
    Object.assign(form.dataset, {
      filePath: container.dataset.filePath,
      side: container.dataset.side,
      startLine: container.dataset.startLine,
      endLine: container.dataset.endLine,
      snapshot: container.dataset.snapshot,
    });
  }

  async function submitCompose(form) {
    const container = form.closest('.comment-compose-row, .file-comment-compose');
    const body = form.querySelector('.comment-input').value.trim();
    if (!body) return;
    form.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const res = await fetch('api/comments', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          filePath: form.dataset.filePath,
          side: form.dataset.side,
          startLine: Number(form.dataset.startLine),
          endLine: Number(form.dataset.endLine),
          body,
          branch,
          lineSnapshot: JSON.parse(form.dataset.snapshot || '[]'),
        }),
      });
      const { comment } = await res.json();
      if (comment.side === 'file') {
        container.outerHTML = fileCommentHtml(comment);
      } else {
        const isSplit = isSplitTable(container.closest('table'));
        container.insertAdjacentHTML('afterend', commentRowHtml(comment, isSplit));
        container.remove();
      }
      clearRangeHighlight();
      commentCount++;
      updateButtons();
    } catch {
      form.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  }

  // Removing a root takes the whole thread (the server cascades its replies);
  // removing a reply takes just that card.
  function dropComment(id) {
    const container = document.querySelector(`[data-root-id="${CSS.escape(id)}"]`);
    if (container) {
      container.remove();
      commentCount = Math.max(0, commentCount - 1);
      updateButtons();
      return;
    }
    const card = document.querySelector(`.comment[data-comment-id="${CSS.escape(id)}"]`);
    if (card) card.remove();
  }

  async function removeComment(card) {
    const id = card.dataset.commentId;
    try {
      await fetch(`api/comments/${id}`, { method: 'DELETE', headers: clientHeaders() });
      dropComment(id);
    } catch {
      /* leave it in place on failure */
    }
  }

  async function setStatus(id, status) {
    try {
      const res = await fetch(`api/comments/${id}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ status }),
      });
      const { comment } = await res.json();
      applyStatus(comment);
    } catch {
      /* leave the UI as-is on failure */
    }
  }

  // Repaint a root card in place so its pill and Resolve/Reopen label match.
  function applyStatus(c) {
    const card = document.querySelector(`.comment[data-comment-id="${CSS.escape(c.id)}"]`);
    if (!card) return;
    const thread = card.closest('.comment-thread');
    const isRoot = thread && thread.dataset.rootId === c.id;
    card.outerHTML = commentCardHtml(c, { isRoot: Boolean(isRoot) });
    if (isRoot) thread.classList.toggle('is-resolved', c.status === 'resolved');
  }

  async function submitReply(form) {
    const thread = form.closest('.comment-thread');
    const body = form.querySelector('.comment-input').value.trim();
    if (!body || !thread) return;
    form.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const res = await fetch('api/comments', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ parentId: thread.dataset.rootId, body }),
      });
      const { comment } = await res.json();
      form.closest('.comment-reply-compose').remove();
      thread.insertAdjacentHTML('beforeend', commentCardHtml(comment, { isRoot: false }));
    } catch {
      form.querySelectorAll('button').forEach((b) => (b.disabled = false));
    }
  }

  // --- load, export, clear ----------------------------------------------
  // Returns false when the comment has nowhere to attach — its line is no
  // longer in the diff (the code moved or the fix landed), or the whole file is
  // gone from it. Callers decide what to do with the leftovers.
  function renderComment(c, replies) {
    const file = document.querySelector(`.file[data-path="${CSS.escape(c.filePath)}"]`);
    if (c.side === 'file') {
      if (!file) return false;
      file.querySelector('.file-comments').insertAdjacentHTML('beforeend', fileCommentHtml(c, replies));
      return true;
    }
    // ranges anchor after the end line (GitHub's convention)
    const cell = findAnchorCell(c.filePath, c.side, c.endLine || c.startLine);
    if (!cell) {
      // The line is gone, but if the file is still on screen we can keep the
      // thread visible at file level rather than have it silently vanish.
      if (!file) return false;
      file
        .querySelector('.file-comments')
        .insertAdjacentHTML('beforeend', fileCommentHtml(c, replies, { outdated: true }));
      return true;
    }
    const row = cell.closest('tr');
    const isSplit = isSplitTable(cell.closest('table'));
    insertionPointAfter(row).insertAdjacentHTML('afterend', commentRowHtml(c, isSplit, replies));
    return true;
  }

  // Replies arrive as flat records; bucket them under the root they answer.
  function groupThreads(comments) {
    const roots = comments.filter((c) => !c.parentId);
    const byParent = new Map();
    for (const c of comments) {
      if (!c.parentId) continue;
      if (!byParent.has(c.parentId)) byParent.set(c.parentId, []);
      byParent.get(c.parentId).push(c);
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    }
    return roots.map((root) => ({ root, replies: byParent.get(root.id) || [] }));
  }

  async function loadComments() {
    let comments = [];
    try {
      const res = await fetch(`api/comments?branch=${encodeURIComponent(branch)}`);
      ({ comments } = await res.json());
    } catch {
      return;
    }
    const threads = groupThreads(comments);
    commentCount = threads.length; // the button counts asks, not messages
    updateButtons();
    let offscreen = 0;
    threads.forEach(({ root, replies }) => {
      if (!renderComment(root, replies)) offscreen++;
    });
    // Comments on files that are no longer in this diff still exist, they just
    // have nowhere to render — say so rather than appear to have lost them.
    if (offscreen) {
      toast(
        `${offscreen} comment${offscreen === 1 ? '' : 's'} not shown — ${
          offscreen === 1 ? 'its file is' : 'their files are'
        } no longer in this diff`
      );
    }
  }

  async function runExport() {
    if (commentCount === 0) return;
    exportBtn.disabled = true;
    try {
      const res = await fetch('api/export', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ branch, format: 'md' }),
      });
      const data = await res.json();
      if (!data.count) return toast('No comments to export.');
      let copied = false;
      try {
        await navigator.clipboard.writeText(data.content);
        copied = true;
      } catch {
        /* clipboard may be blocked; the file write still succeeded */
      }
      toast(
        `Wrote ${data.path}${copied ? ' · copied to clipboard' : ' (clipboard blocked)'}`,
        { label: 'Clear now', fn: runClear }
      );
    } catch {
      toast('Export failed.');
    } finally {
      exportBtn.disabled = false;
    }
  }

  function removeAllCommentEls() {
    document
      .querySelectorAll('.comment-row, .file-comment, .file-comment-compose')
      .forEach((el) => el.remove());
  }

  async function runClear() {
    if (commentCount === 0) return;
    if (clearBtn) clearBtn.disabled = true;
    try {
      const res = await fetch('api/comments/clear', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ branch }),
      });
      const { cleared } = await res.json();
      removeAllCommentEls();
      commentCount = 0;
      updateButtons();
      toast(`Cleared ${cleared} comment${cleared === 1 ? '' : 's'}`, { label: 'Undo', fn: undoClear });
    } finally {
      if (clearBtn) clearBtn.disabled = false;
    }
  }

  async function undoClear() {
    try {
      const res = await fetch('api/comments/restore', { method: 'POST', headers: clientHeaders() });
      const { restored } = await res.json();
      if (!restored) return;
      removeAllCommentEls();
      await loadComments();
      toast(`Restored ${restored} comment${restored === 1 ? '' : 's'}`);
    } catch {
      /* ignore */
    }
  }

  // --- events ------------------------------------------------------------
  if (exportBtn) exportBtn.addEventListener('click', runExport);
  if (clearBtn) clearBtn.addEventListener('click', runClear);

  // --- range selection state (shift-click + drag) ------------------------
  let dragStart = null; // {filePath, side, line}
  let dragging = false;
  let suppressClick = false; // set after a drag so the trailing click is ignored

  document.addEventListener('click', (e) => {
    const add = e.target.closest('.add-comment');
    if (add) {
      e.preventDefault();
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const gutter = add.closest('.commentable');
      const filePath = gutter.closest('.file').dataset.path;
      const side = gutter.dataset.side;
      const line = Number(gutter.dataset.commentLine);
      // shift-click extends from the line of an already-open compose (same side)
      if (e.shiftKey) {
        const open = [...document.querySelectorAll('.comment-compose-row')].find(
          (r) => r.dataset.filePath === filePath && r.dataset.side === side
        );
        const anchor = open ? Number(open.dataset.startLine) : line;
        openLineCompose(filePath, side, anchor, line);
      } else {
        openLineCompose(filePath, side, line, line);
      }
      return;
    }
    const fileAdd = e.target.closest('.add-file-comment');
    if (fileAdd) {
      e.preventDefault();
      return openFileCompose(fileAdd.closest('.file'));
    }
    const cancel = e.target.closest('.comment-cancel');
    if (cancel) {
      e.preventDefault();
      cancel.closest('.comment-compose-row, .file-comment-compose, .comment-reply-compose').remove();
      return clearRangeHighlight();
    }
    const reply = e.target.closest('.comment-reply-btn');
    if (reply) {
      e.preventDefault();
      const thread = reply.closest('.comment-thread');
      let compose = thread.querySelector('.comment-reply-compose');
      if (!compose) {
        thread.insertAdjacentHTML(
          'beforeend',
          `<div class="comment-reply-compose">${composeInner()}</div>`
        );
        compose = thread.querySelector('.comment-reply-compose');
      }
      compose.querySelector('.comment-input').focus();
      return;
    }
    const resolve = e.target.closest('.comment-resolve');
    if (resolve) {
      e.preventDefault();
      const card = resolve.closest('.comment');
      const isResolved = resolve.textContent.trim() === 'Reopen';
      setStatus(card.dataset.commentId, isResolved ? 'open' : 'resolved');
      return;
    }
    const del = e.target.closest('.comment-delete');
    if (del) {
      e.preventDefault();
      removeComment(del.closest('.comment'));
    }
  });

  // Drag across the gutter to select a range.
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const gutter = e.target.closest('.commentable');
    if (!gutter) return;
    dragStart = {
      filePath: gutter.closest('.file').dataset.path,
      side: gutter.dataset.side,
      line: Number(gutter.dataset.commentLine),
    };
    dragging = false;
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragStart) return;
    const row = e.target.closest('tr');
    const cell = row && row.querySelector(`.commentable[data-side="${dragStart.side}"]`);
    if (!cell) return; // no commentable line for this side on this row
    const line = Number(cell.dataset.commentLine);
    if (line === dragStart.line && !dragging) return;
    dragging = true;
    e.preventDefault(); // suppress text selection while dragging
    document.body.style.userSelect = 'none';
    highlightRange(dragStart.filePath, dragStart.side, Math.min(dragStart.line, line), Math.max(dragStart.line, line));
  });

  document.addEventListener('mouseup', (e) => {
    if (!dragStart) return;
    const ds = dragStart;
    dragStart = null;
    document.body.style.userSelect = '';
    if (!dragging) return; // a plain click — let the click handler open a single-line compose
    dragging = false;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 300); // clear even if no click follows
    const row = e.target.closest('tr');
    const cell = row && row.querySelector(`.commentable[data-side="${ds.side}"]`);
    const endLine = cell ? Number(cell.dataset.commentLine) : ds.line;
    openLineCompose(ds.filePath, ds.side, ds.line, endLine);
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('.comment-compose');
    if (!form) return;
    e.preventDefault();
    if (form.closest('.comment-reply-compose')) submitReply(form);
    else submitCompose(form);
  });

  // --- live updates -------------------------------------------------------
  // Apply changes made outside this tab (Claude working the review via the
  // API, or a second browser window) without a reload.
  function applyRemote(msg) {
    if (msg.origin === CLIENT_ID) return; // our own change, already applied
    switch (msg.type) {
      case 'comment.created': {
        const c = msg.comment;
        if (c.branch && branch && c.branch !== branch) return;
        if (c.parentId) {
          const thread = document.querySelector(
            `.comment-thread[data-root-id="${CSS.escape(c.parentId)}"]`
          );
          if (!thread || thread.querySelector(`.comment[data-comment-id="${CSS.escape(c.id)}"]`)) return;
          const compose = thread.querySelector('.comment-reply-compose');
          const html = commentCardHtml(c, { isRoot: false });
          if (compose) compose.insertAdjacentHTML('beforebegin', html);
          else thread.insertAdjacentHTML('beforeend', html);
          return;
        }
        if (document.querySelector(`[data-root-id="${CSS.escape(c.id)}"]`)) return;
        renderComment(c, []);
        commentCount++;
        updateButtons();
        return;
      }
      case 'comment.updated':
        applyStatus(msg.comment);
        return;
      case 'comment.deleted':
        dropComment(msg.id);
        return;
      case 'comments.reset':
        removeAllCommentEls();
        loadComments();
        return;
      case 'diff.changed':
        scheduleRefresh();
        return;
    }
  }

  // The diff is rendered server-side, so picking up code changes means
  // reloading. Debounced, because a run of edits arrives as a burst.
  let refreshTimer = null;
  let refreshing = false;
  function composeInProgress() {
    return [...document.querySelectorAll('.comment-input')].some((el) => el.value.trim() !== '');
  }
  function scheduleRefresh() {
    if (refreshing) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      // Never blow away a comment being typed — offer the reload instead.
      if (composeInProgress()) {
        toast('The code changed on disk.', { label: 'Reload', fn: () => location.reload() }, { sticky: true });
        return;
      }
      refreshing = true;
      location.reload();
    }, 700);
  }

  function connectEvents() {
    if (!window.EventSource) return; // no live updates; reload still works
    // ?live=0 opts out — useful when a tool (or a headless browser) needs the
    // page to finish loading rather than hold a stream open.
    if (new URLSearchParams(location.search).get('live') === '0') return;
    const es = new EventSource('api/events');
    es.addEventListener('message', (e) => {
      try {
        applyRemote(JSON.parse(e.data));
      } catch {
        /* ignore malformed frames */
      }
    });
    // EventSource reconnects on its own; on reconnect we may have missed
    // events, so resync from the server.
    es.addEventListener('open', () => {
      if (es.dataset_seen) {
        removeAllCommentEls();
        loadComments();
      }
      es.dataset_seen = true;
    });
  }

  loadComments();
  connectEvents();
})();
