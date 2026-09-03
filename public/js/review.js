// Interactivity: segmented toggles (view/diff), collapse/expand, copy path,
// "Viewed" state. Toggle choices persist in localStorage and are re-applied
// on loads where the URL doesn't pin them.

// Segmented toggles that persist across loads: display 'view' (split/unified)
// and 'diff' mode (all/branch/working). Each is re-applied on loads where the
// URL doesn't pin it.
const PERSIST_PARAMS = ['view', 'diff'];

// Navigate, setting `param=value` and preserving all other query params.
function goToParam(param, value) {
  if (PERSIST_PARAMS.includes(param)) localStorage.setItem('prequel:' + param, value);
  const params = new URLSearchParams(location.search);
  params.set(param, value);
  location.search = params.toString();
}

// On load, honor saved preferences for params not pinned in the URL.
(function applySavedParams() {
  const params = new URLSearchParams(location.search);
  let changed = false;
  for (const param of PERSIST_PARAMS) {
    if (params.has(param)) continue; // explicit choice in URL wins
    const saved = localStorage.getItem('prequel:' + param);
    const rendered = document.documentElement.getAttribute('data-' + param);
    if (saved && saved !== rendered) {
      params.set(param, saved);
      changed = true;
    }
  }
  if (changed) location.replace(location.pathname + '?' + params.toString());
})();

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

const ADD_COMMENT_BTN =
  '<button class="add-comment" tabindex="-1" title="Add a comment" aria-label="Add a comment">+</button>';

// Build a context (unchanged) row matching the current table layout. The new
// side carries the same commentable gutter contract as server-rendered rows.
function contextRow(split, oldNo, newNo, inner) {
  const code =
    '<td class="blob-code blob-code-context"><span class="blob-code-inner">' +
    '<span class="marker"> </span>' + inner + '</span></td>';
  const numOld = `<td class="blob-num blob-num-context" data-line-number="${oldNo}"></td>`;
  const numNew =
    `<td class="blob-num blob-num-context commentable" data-side="new"` +
    ` data-comment-line="${newNo}" data-line-number="${newNo}">${ADD_COMMENT_BTN}</td>`;
  return split
    ? `<tr class="context-loaded">${numOld}${code}${numNew}${code}</tr>`
    : `<tr class="context-loaded">${numOld}${numNew}${code}</tr>`;
}

const CHUNK = 20;

const ICONS = {
  up: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M7.823 1.677 4.927 4.573A.25.25 0 0 0 5.104 5H7.25v3.236a.75.75 0 1 0 1.5 0V5h2.146a.25.25 0 0 0 .177-.427L8.177 1.677a.25.25 0 0 0-.354 0ZM13.75 11a.75.75 0 0 0 0 1.5h.5a.75.75 0 0 0 0-1.5h-.5Zm-3.75.75a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1-.75-.75ZM7.75 11a.75.75 0 0 0 0 1.5h.5a.75.75 0 0 0 0-1.5h-.5ZM4 11.75a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 0 1.5h-.5a.75.75 0 0 1-.75-.75ZM1.75 11a.75.75 0 0 0 0 1.5h.5a.75.75 0 0 0 0-1.5h-.5Z"></path></svg>',
  down: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8.177 14.323l2.896-2.896a.25.25 0 0 0-.177-.427H8.75V7.764a.75.75 0 1 0-1.5 0V11H5.104a.25.25 0 0 0-.177.427l2.896 2.896a.25.25 0 0 0 .354 0ZM2.25 5a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 4.25a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5a.75.75 0 0 1 .75.75ZM8.25 5a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 4.25a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5a.75.75 0 0 1 .75.75ZM14.25 5a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5Z"></path></svg>',
  all: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8.177.677l2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25a.75.75 0 0 1-1.5 0V4H5.104a.25.25 0 0 1-.177-.427L7.823.677a.25.25 0 0 1 .354 0ZM7.25 10.75a.75.75 0 0 1 1.5 0V12h2.146a.25.25 0 0 1 .177.427l-2.896 2.896a.25.25 0 0 1-.354 0l-2.896-2.896A.25.25 0 0 1 5.104 12H7.25v-1.25Zm-5-2a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5Z"></path></svg>',
};
const TITLES = { up: 'Expand up', down: 'Expand down', all: 'Expand all' };

function gapOf(row) {
  const start = parseInt(row.dataset.gapStartNew, 10);
  const end = parseInt(row.dataset.gapEndNew, 10);
  return { start, end, size: end - start + 1 };
}

function boundaryDirs(row) {
  const { start, size } = gapOf(row);
  if (row.classList.contains('boundary-trailing')) return ['down'];
  if (start === 1) return ['up'];
  return size <= CHUNK ? ['all'] : ['up', 'down'];
}

function decorateBoundary(row) {
  const cell = row.querySelector('.blob-num-expand');
  if (!cell) return;
  row.dataset.gapStartOrig ??= row.dataset.gapStartNew;
  row.dataset.gapEndOrig ??= row.dataset.gapEndNew;
  const dirs = boundaryDirs(row);
  cell.innerHTML = dirs
    .map(
      (d) =>
        `<button class="expander" data-dir="${d}" title="${TITLES[d]}" aria-label="${TITLES[d]}">${ICONS[d]}</button>`
    )
    .join('');
  cell.classList.toggle('blob-num-expand-2', dirs.length === 2);
}

document.querySelectorAll('tr[data-expander]').forEach(decorateBoundary);

function closeBoundary(row) {
  row.hidden = true;
  row.upTop = null;
}

const visibleBoundaries = (file) => file.querySelectorAll('tr[data-expander]:not([hidden])');

function syncExpandAll(file) {
  const btn = file.querySelector('.expand-all-btn');
  if (!btn) return;
  const open = visibleBoundaries(file).length > 0;
  const loaded = file.querySelector('tr.context-loaded');
  btn.disabled = !open && !loaded;
  btn.textContent = !open && loaded ? 'Collapse' : 'Expand all';
}

document.querySelectorAll('.file').forEach(syncExpandAll);

function noticePlain(file, max) {
  if (file.querySelector('.context-notice')) return;
  const tbody = file.querySelector('tbody');
  const cols = file.querySelector('.diff-table-split') ? 4 : 3;
  tbody.insertAdjacentHTML(
    'afterbegin',
    `<tr class="context-notice"><td colspan="${cols}">Syntax highlighting off for ranges over ${max.toLocaleString('en-US')} lines</td></tr>`
  );
}

function rowsFromHtml(html) {
  const tbody = document.createElement('tbody');
  tbody.innerHTML = html;
  return [...tbody.children];
}

// Reveal part of the hidden gap a boundary row stands for. Loaded rows sit
// above the boundary row: "up" chunks stack upward from it (row.upTop tracks
// the topmost one) and "down" chunks fill in above that block.
function splitAbove(row, s, e) {
  const upper = row.cloneNode(true);
  upper.classList.remove('boundary-trailing');
  upper.hidden = false;
  upper.upTop = null;
  delete upper.dataset.loading;
  upper.dataset.split = '1';
  upper.dataset.gapStartNew = String(s);
  upper.dataset.gapEndNew = String(e);
  (row.upTop || row).before(upper);
  decorateBoundary(upper);
}

// `range` reveals an explicit slice from the middle of the gap; the part above
// the slice becomes a new boundary row and `row` keeps the part below.
async function expandBoundary(row, dir, range) {
  if (!row.isConnected || row.hidden || row.dataset.loading) return;
  const { start, end } = gapOf(row);
  if (end < start) return closeBoundary(row);
  let from = start;
  let to = end;
  if (range) ({ from, to } = range);
  else if (dir === 'down') to = Math.min(end, start + CHUNK - 1);
  else if (dir === 'up') from = Math.max(start, end - CHUNK + 1);

  const { path, rev } = row.dataset;
  const offset = parseInt(row.dataset.offset, 10) || 0;
  const split = row.closest('table').classList.contains('diff-table-split');
  row.dataset.loading = '1';
  try {
    const res = await fetch(
      `/api/context?path=${encodeURIComponent(path)}&rev=${rev}&start=${from}&end=${to}`
    );
    const data = await res.json();
    if (!res.ok || data.error) return;
    const lines = data.lines || [];
    const html = lines
      .map((content, i) => {
        const n = data.from + i;
        const inner = data.html ? data.html[i] : escapeHtml(content);
        return contextRow(split, n + offset, n, inner);
      })
      .join('');
    if (data.plain) noticePlain(row.closest('.file'), data.maxHighlight);
    const rows = rowsFromHtml(html);
    if (range && from > start) splitAbove(row, start, from - 1);
    const anchor = row.upTop || row;
    rows.forEach((r) => anchor.before(r));
    if (dir === 'up' && rows.length) row.upTop = rows[0];

    if (range || dir === 'down') row.dataset.gapStartNew = String(to + 1);
    else if (dir === 'up') row.dataset.gapEndNew = String(from - 1);
    else row.dataset.gapStartNew = String(end + 1);
    if (gapOf(row).size <= 0) closeBoundary(row);
    else decorateBoundary(row);
    syncExpandAll(row.closest('.file'));
    document.dispatchEvent(
      new CustomEvent('prequel:context-loaded', { detail: { filePath: path } })
    );
  } catch {
    /* leave the expander in place so the user can retry */
  } finally {
    delete row.dataset.loading;
  }
}

// comments.js asks for a hidden line to be revealed (a thread anchors there).
document.addEventListener('prequel:reveal-line', (e) => {
  const { filePath, side, line } = e.detail;
  const file = document.querySelector(`.file[data-path="${CSS.escape(filePath)}"]`);
  if (!file) return;
  for (const row of visibleBoundaries(file)) {
    const { start, end } = gapOf(row);
    const offset = parseInt(row.dataset.offset, 10) || 0;
    const n = side === 'old' ? line - offset : line;
    if (n < start || n > end) continue;
    let from = Math.max(start, n - Math.floor(CHUNK / 2));
    const to = Math.min(end, from + CHUNK - 1);
    from = Math.max(start, to - CHUNK + 1);
    return expandBoundary(row, 'mid', { from, to });
  }
});

async function expandAll(file) {
  await Promise.all([...visibleBoundaries(file)].map((r) => expandBoundary(r, 'all')));
  syncExpandAll(file);
}

function collapseAll(file) {
  file
    .querySelectorAll('tr.context-loaded, tr.context-notice, tr[data-expander][data-split]')
    .forEach((r) => r.remove());
  for (const row of file.querySelectorAll('tr[data-expander]')) {
    row.dataset.gapStartNew = row.dataset.gapStartOrig;
    row.dataset.gapEndNew = row.dataset.gapEndOrig;
    row.hidden = false;
    row.upTop = null;
    decorateBoundary(row);
  }
  syncExpandAll(file);
  document.dispatchEvent(
    new CustomEvent('prequel:context-loaded', { detail: { filePath: file.dataset.path } })
  );
}

// --- file tree ----------------------------------------------------------
function markTreeViewed(id, viewed) {
  const row = document.querySelector(`.tree-file-row[data-file-id="${id}"]`);
  if (row) row.classList.toggle('is-viewed', viewed);
}

function setActiveTreeFile(id) {
  document
    .querySelectorAll('.tree-file-row.is-active')
    .forEach((r) => r.classList.remove('is-active'));
  const row = document.querySelector(`.tree-file-row[data-file-id="${id}"]`);
  if (row) row.classList.add('is-active');
}

document.addEventListener('click', (e) => {
  // Hunk context expander
  const expander = e.target.closest('.expander');
  if (expander) {
    e.preventDefault();
    expandBoundary(expander.closest('tr[data-expander]'), expander.dataset.dir);
    return;
  }

  const expandAllBtn = e.target.closest('.expand-all-btn');
  if (expandAllBtn) {
    const file = expandAllBtn.closest('.file');
    if (visibleBoundaries(file).length) expandAll(file);
    else collapseAll(file);
    return;
  }

  // Click a file in the tree → scroll to it (anchor handles scroll)
  const fileRow = e.target.closest('.tree-file-row');
  if (fileRow) {
    setActiveTreeFile(fileRow.getAttribute('data-file-id'));
    // let the default #anchor navigation scroll to the file
    return;
  }

  // Segmented toggles (Unified/Split, All/Branch/Working)
  const segBtn = e.target.closest('.seg-btn');
  if (segBtn) {
    e.preventDefault();
    goToParam(segBtn.getAttribute('data-param'), segBtn.getAttribute('data-value'));
    return;
  }

  // collapse/expand the whole file
  const collapse = e.target.closest('.collapse-btn');
  if (collapse) {
    const file = collapse.closest('.file');
    const collapsed = file.classList.toggle('is-collapsed');
    collapse.setAttribute('aria-expanded', String(!collapsed));
    return;
  }

  // copy file path
  const copyBtn = e.target.closest('.copy-path');
  if (copyBtn) {
    const path = copyBtn.getAttribute('data-path');
    navigator.clipboard?.writeText(path).then(
      () => flash(copyBtn),
      () => {}
    );
  }
});

function flash(el) {
  el.classList.add('copied');
  setTimeout(() => el.classList.remove('copied'), 800);
}

// "Viewed" checkboxes persist per file id in localStorage and collapse the file.
const VIEWED_KEY = 'prequel:viewed';
function loadViewed() {
  try {
    return JSON.parse(localStorage.getItem(VIEWED_KEY) || '{}');
  } catch {
    return {};
  }
}
function saveViewed(state) {
  localStorage.setItem(VIEWED_KEY, JSON.stringify(state));
}

const viewedState = loadViewed();
document.querySelectorAll('.viewed-checkbox').forEach((cb) => {
  const id = cb.getAttribute('data-file-id');
  if (viewedState[id]) {
    cb.checked = true;
    cb.closest('.file').classList.add('is-collapsed');
    markTreeViewed(id, true);
  }
  cb.addEventListener('change', () => {
    viewedState[id] = cb.checked;
    saveViewed(viewedState);
    cb.closest('.file').classList.toggle('is-collapsed', cb.checked);
    markTreeViewed(id, cb.checked);
  });
});
