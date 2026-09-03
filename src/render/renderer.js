// Renders a diff model into GitHub-"Files changed"-faithful HTML.
// Supports unified (inline) and split (side-by-side) views.
// Phase 0: structure + classes only (no syntax highlighting yet — that's Shiki
// in Phase 1). The DOM/class semantics mirror GitHub so the CSS can match.

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STATUS_LABEL = {
  added: 'added',
  modified: '',
  removed: 'deleted',
  renamed: 'renamed',
  copied: 'copied',
};

function diffStat(file) {
  // GitHub's little green/red squares (max 5) proportional to churn.
  const total = file.additions + file.deletions;
  const blocks = 5;
  let green = 0;
  let red = 0;
  if (total > 0) {
    green = Math.round((file.additions / total) * blocks);
    red = Math.round((file.deletions / total) * blocks);
    if (file.additions > 0 && green === 0) green = 1;
    if (file.deletions > 0 && red === 0) red = 1;
    while (green + red > blocks) {
      if (green >= red) green--;
      else red--;
    }
  }
  const neutral = blocks - green - red;
  let squares = '';
  for (let i = 0; i < green; i++) squares += '<span class="diffstat-block diffstat-block-add"></span>';
  for (let i = 0; i < red; i++) squares += '<span class="diffstat-block diffstat-block-del"></span>';
  for (let i = 0; i < neutral; i++) squares += '<span class="diffstat-block diffstat-block-neutral"></span>';
  return `<span class="diffstat" aria-label="${total} changes">${squares}</span>`;
}

// --- cell builders -------------------------------------------------------
// `comment` = {side, line} marks the gutter cell as commentable (renders the
// hover "+" and carries the anchor data the client needs).
function numCell(number, extraClass, comment) {
  const numAttr = number == null ? '' : ` data-line-number="${number}"`;
  if (comment) {
    return (
      `<td class="blob-num ${extraClass} commentable" data-side="${comment.side}"` +
      ` data-comment-line="${comment.line}"${numAttr}>` +
      `<button class="add-comment" tabindex="-1" title="Add a comment" aria-label="Add a comment">+</button>` +
      `</td>`
    );
  }
  return `<td class="blob-num ${extraClass}"${numAttr}></td>`;
}

const MARKER = { context: ' ', add: '+', del: '-' };

// `line.html` is pre-highlighted (Shiki) and already escaped; otherwise escape
// the raw content here.
function codeCell(type, line, extraClass) {
  const cls = extraClass || `blob-code-${type === 'context' ? 'context' : type === 'add' ? 'addition' : 'deletion'}`;
  const inner = line.html != null ? line.html : escapeHtml(line.content);
  return `<td class="blob-code ${cls}"><span class="blob-code-inner"><span class="marker">${MARKER[type]}</span>${inner}</span></td>`;
}

// An empty side in split view (no corresponding line).
function emptyNumCell() {
  return '<td class="blob-num blob-num-empty"></td>';
}
function emptyCodeCell() {
  return '<td class="blob-code blob-code-empty"></td>';
}

// --- unified (inline) view ----------------------------------------------
function renderUnifiedLine(line) {
  if (line.type === 'context') {
    return (
      '<tr>' +
      numCell(line.oldNumber, 'blob-num-context') +
      numCell(line.newNumber, 'blob-num-context', { side: 'new', line: line.newNumber }) +
      codeCell('context', line) +
      '</tr>'
    );
  }
  if (line.type === 'del') {
    return (
      '<tr>' +
      numCell(line.oldNumber, 'blob-num-deletion', { side: 'old', line: line.oldNumber }) +
      numCell(null, 'blob-num-deletion') +
      codeCell('del', line) +
      '</tr>'
    );
  }
  if (line.type === 'add') {
    return (
      '<tr>' +
      numCell(null, 'blob-num-addition') +
      numCell(line.newNumber, 'blob-num-addition', { side: 'new', line: line.newNumber }) +
      codeCell('add', line) +
      '</tr>'
    );
  }
  return '';
}

// Line numbers reached at the end of a hunk (for computing the gap above the
// next hunk).
function hunkNewEnd(hunk) {
  for (let i = hunk.lines.length - 1; i >= 0; i--) {
    if (hunk.lines[i].newNumber != null) return hunk.lines[i].newNumber;
  }
  return hunk.newStart - 1;
}
function hunkOldEnd(hunk) {
  for (let i = hunk.lines.length - 1; i >= 0; i--) {
    if (hunk.lines[i].oldNumber != null) return hunk.lines[i].oldNumber;
  }
  return hunk.oldStart - 1;
}

function boundaryAttrs(ctx, gapStart, gapEnd, offset) {
  return (
    ` data-expander data-path="${escapeHtml(ctx.path)}" data-rev="${ctx.rev}"` +
    ` data-gap-start-new="${gapStart}" data-gap-end-new="${gapEnd}" data-offset="${offset}"`
  );
}

// The gutter is empty here; the client fills it with up/down/all buttons from
// the gap attributes.
function boundaryRow(attrs, header, { split, trailing = false }) {
  const gutterCell = `<td class="blob-num blob-num-hunk blob-num-expand" colspan="${split ? 1 : 2}"></td>`;
  const codeCol = `<td class="blob-code blob-code-hunk"${split ? ' colspan="3"' : ''}>${escapeHtml(header)}</td>`;
  const cls = trailing ? 'hunk-header-row boundary-trailing' : 'hunk-header-row';
  return `<tr class="${cls}"${attrs}>${gutterCell}${codeCol}</tr>`;
}

// A hunk-header row. When there is hidden context above the hunk the row
// carries the gap's new-side range and old/new offset for the client.
function hunkHeaderRow(hunk, ctx, prevNewEnd, { split }) {
  const gapAbove = hunk.newStart - 1 - prevNewEnd;
  const attrs =
    ctx.rev && gapAbove > 0
      ? boundaryAttrs(ctx, prevNewEnd + 1, hunk.newStart - 1, hunk.oldStart - hunk.newStart)
      : '';
  return boundaryRow(attrs, hunk.header, { split });
}

function trailingRow(file, ctx, { split }) {
  const last = file.hunks[file.hunks.length - 1];
  if (!last || !ctx.rev || file.status === 'removed') return '';
  const newEnd = hunkNewEnd(last);
  if (!(file.newLineCount > newEnd)) return '';
  const attrs = boundaryAttrs(ctx, newEnd + 1, file.newLineCount, hunkOldEnd(last) - newEnd);
  return boundaryRow(attrs, '', { split, trailing: true });
}

function renderUnifiedTable(file, ctx) {
  let prevNewEnd = 0;
  let rows = '';
  for (const hunk of file.hunks) {
    rows += hunkHeaderRow(hunk, ctx, prevNewEnd, { split: false });
    rows += hunk.lines.map(renderUnifiedLine).join('');
    prevNewEnd = hunkNewEnd(hunk);
  }
  rows += trailingRow(file, ctx, { split: false });
  return (
    '<table class="diff-table diff-table-unified">' +
    '<colgroup><col class="col-num"><col class="col-num"><col class="col-code"></colgroup>' +
    `<tbody>${rows}</tbody></table>`
  );
}

// --- split (side-by-side) view ------------------------------------------
// GitHub pairs a run of consecutive deletions with the following run of
// additions row-by-row; leftover del/add lines get an empty cell opposite.
function renderSplitPair(dels, adds) {
  let out = '';
  const n = Math.max(dels.length, adds.length);
  for (let i = 0; i < n; i++) {
    const d = dels[i];
    const a = adds[i];
    let left;
    let right;
    if (d)
      left = numCell(d.oldNumber, 'blob-num-deletion', { side: 'old', line: d.oldNumber }) + codeCell('del', d);
    else left = emptyNumCell() + emptyCodeCell();
    if (a)
      right = numCell(a.newNumber, 'blob-num-addition', { side: 'new', line: a.newNumber }) + codeCell('add', a);
    else right = emptyNumCell() + emptyCodeCell();
    out += `<tr>${left}${right}</tr>`;
  }
  return out;
}

function renderSplitHunkBody(hunk) {
  let body = '';
  let dels = [];
  let adds = [];
  const flush = () => {
    if (dels.length || adds.length) {
      body += renderSplitPair(dels, adds);
      dels = [];
      adds = [];
    }
  };

  for (const line of hunk.lines) {
    if (line.type === 'del') {
      dels.push(line);
    } else if (line.type === 'add') {
      adds.push(line);
    } else {
      // context line: flush any pending change block, then emit both sides
      flush();
      body +=
        '<tr>' +
        numCell(line.oldNumber, 'blob-num-context') +
        codeCell('context', line) +
        numCell(line.newNumber, 'blob-num-context', { side: 'new', line: line.newNumber }) +
        codeCell('context', line) +
        '</tr>';
    }
  }
  flush();
  return body;
}

function renderSplitTable(file, ctx) {
  let prevNewEnd = 0;
  let rows = '';
  for (const hunk of file.hunks) {
    rows += hunkHeaderRow(hunk, ctx, prevNewEnd, { split: true });
    rows += renderSplitHunkBody(hunk);
    prevNewEnd = hunkNewEnd(hunk);
  }
  rows += trailingRow(file, ctx, { split: true });
  return (
    '<table class="diff-table diff-table-split">' +
    '<colgroup><col class="col-num"><col class="col-code"><col class="col-num"><col class="col-code"></colgroup>' +
    `<tbody>${rows}</tbody></table>`
  );
}

// --- file + document ----------------------------------------------------
function renderFileBody(file, view, rev) {
  if (file.isBinary) {
    return '<div class="binary-notice">Binary file not shown.</div>';
  }
  const ctx = { path: file.newPath, rev };
  return view === 'split' ? renderSplitTable(file, ctx) : renderUnifiedTable(file, ctx);
}

function renderFile(file, view, rev) {
  const path = escapeHtml(file.newPath);
  const renamedFrom =
    file.status === 'renamed' && file.oldPath !== file.newPath
      ? `<span class="file-rename">${escapeHtml(file.oldPath)} → </span>`
      : '';
  const statusLabel = STATUS_LABEL[file.status]
    ? `<span class="file-status-tag file-status-${file.status}">${STATUS_LABEL[file.status]}</span>`
    : '';
  const counts =
    `<span class="file-additions">+${file.additions}</span>` +
    `<span class="file-deletions">−${file.deletions}</span>`;

  return `
  <div class="file" id="diff-${file.id}" data-path="${path}">
    <div class="file-header" data-file-id="${file.id}">
      <button class="collapse-btn" aria-label="Toggle diff" aria-expanded="true">
        <svg class="chevron" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z"></path>
        </svg>
      </button>
      ${diffStat(file)}
      ${counts}
      <span class="file-info">
        ${renamedFrom}<span class="file-path" title="${path}">${path}</span>
        <button class="copy-path" data-path="${path}" title="Copy path" aria-label="Copy path">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>
        </button>
        ${statusLabel}
      </span>
      <button class="add-file-comment" title="Comment on this file" aria-label="Comment on this file">
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>
      </button>
      <label class="viewed-toggle">
        <input type="checkbox" class="viewed-checkbox" data-file-id="${file.id}"> Viewed
      </label>
    </div>
    <div class="file-body">
      <div class="file-comments"></div>
      ${renderFileBody(file, view, rev)}
    </div>
  </div>`;
}

// --- changed-files tree -------------------------------------------------
function buildTree(files) {
  const root = { name: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = (f.newPath || f.oldPath).split('/');
    const fileName = parts.pop();
    let node = root;
    for (const part of parts) {
      if (!node.dirs.has(part)) node.dirs.set(part, { name: part, dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push({ name: fileName, file: f });
  }
  compressTree(root);
  return root;
}

// Collapse chains of single-child directories (src → src/pricing), like GitHub.
function compressTree(node) {
  const merged = new Map();
  for (let dir of node.dirs.values()) {
    while (dir.files.length === 0 && dir.dirs.size === 1) {
      const child = [...dir.dirs.values()][0];
      child.name = dir.name + '/' + child.name;
      dir = child;
    }
    compressTree(dir);
    merged.set(dir.name, dir);
  }
  node.dirs = merged;
}

const FOLDER_ICON =
  '<svg class="tree-folder-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"></path></svg>';
const TREE_CHEVRON =
  '<svg class="tree-chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z"></path></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';

function renderTreeNode(node, depth) {
  let html = '';
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const dir of dirs) {
    const pad = 8 + depth * 14;
    html +=
      `<div class="tree-dir">` +
      `<div class="tree-row tree-dir-row" style="padding-left:${pad}px">` +
      TREE_CHEVRON +
      FOLDER_ICON +
      `<span class="tree-name">${escapeHtml(dir.name)}</span>` +
      `</div>` +
      `<div class="tree-children">${renderTreeNode(dir, depth + 1)}</div>` +
      `</div>`;
  }
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  for (const { name, file } of files) {
    const pad = 8 + depth * 14 + 14;
    html +=
      `<a class="tree-row tree-file-row" href="#diff-${file.id}" data-file-id="${file.id}"` +
      ` style="padding-left:${pad}px" title="${escapeHtml(file.newPath)}">` +
      `<span class="tree-status tree-status-${file.status}" aria-hidden="true"></span>` +
      `<span class="tree-name">${escapeHtml(name)}</span>` +
      `<span class="tree-counts"><span class="tree-add">+${file.additions}</span> <span class="tree-del">−${file.deletions}</span></span>` +
      `<span class="tree-check" aria-hidden="true">${CHECK_ICON}</span>` +
      `</a>`;
  }
  return html;
}

export function renderFileTree(diff) {
  return renderTreeNode(buildTree(diff.files), 0);
}

export function renderDiff(diff, { view = 'split', rev = null } = {}) {
  const totalAdd = diff.files.reduce((a, f) => a + f.additions, 0);
  const totalDel = diff.files.reduce((a, f) => a + f.deletions, 0);
  const summary = {
    fileCount: diff.files.length,
    additions: totalAdd,
    deletions: totalDel,
  };
  const filesHtml = diff.files.map((f) => renderFile(f, view, rev)).join('\n');
  return { filesHtml, summary };
}
