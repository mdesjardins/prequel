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
    if (rendered === 'compare') continue; // two files compared: no changes-to-show mode applies
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

// Build a context (unchanged) row matching the current table layout.
function contextRow(split, oldNo, newNo, inner) {
  const code =
    '<td class="blob-code blob-code-context"><span class="blob-code-inner">' +
    '<span class="marker"> </span>' + inner + '</span></td>';
  const numOld = `<td class="blob-num blob-num-context" data-line-number="${oldNo}"></td>`;
  const numNew = `<td class="blob-num blob-num-context" data-line-number="${newNo}"></td>`;
  return split
    ? `<tr class="context-loaded">${numOld}${code}${numNew}${code}</tr>`
    : `<tr class="context-loaded">${numOld}${numNew}${code}</tr>`;
}

function disableExpander(row) {
  row.removeAttribute('data-expander');
  const btn = row.querySelector('.expander');
  if (btn) btn.remove();
}

const CHUNK = 20;

// Returns true when it made progress (rows inserted, or the gap found filled),
// false when the fetch failed and the expander was left for a retry.
async function expandContext(btn) {
  const row = btn.closest('tr[data-expander]');
  if (!row || row.dataset.loading) return false;
  if (row.dataset.tail !== undefined) return expandTail(row);
  const { path, rev } = row.dataset;
  const newStart = parseInt(row.dataset.newStart, 10);
  const oldStart = parseInt(row.dataset.oldStart, 10);
  const prevNewEnd = parseInt(row.dataset.prevNewEnd, 10) || 0;
  const offset = oldStart - newStart; // oldNo = newNo + offset (constant in a gap)
  const gapEndNew = newStart - 1;
  const bounded = prevNewEnd > 0; // gap between two hunks (fully known)
  const gapStartNew = bounded ? prevNewEnd + 1 : Math.max(1, gapEndNew - CHUNK + 1);
  if (gapEndNew < gapStartNew) {
    disableExpander(row);
    return true;
  }

  const split = row.closest('table').classList.contains('diff-table-split');
  row.dataset.loading = '1';
  try {
    const res = await fetch(
      `api/context?path=${encodeURIComponent(path)}&rev=${rev}` +
        `&start=${gapStartNew}&end=${gapEndNew}`
    );
    const data = await res.json();
    const lines = data.lines || [];
    let frag = '';
    lines.forEach((content, i) => {
      const n = data.from + i;
      const inner = data.html ? data.html[i] : escapeHtml(content);
      frag += contextRow(split, n + offset, n, inner);
    });
    // Above the chunks this expander loaded before, not between them and it:
    // expanding upward twice must read 1-6, 7-26, not 7-26, 1-6.  A bounded
    // gap fills in one fetch, so there it is the row itself.
    let anchor = row;
    while (anchor.previousElementSibling?.classList.contains('context-loaded')) anchor = anchor.previousElementSibling;
    if (frag) anchor.insertAdjacentHTML('beforebegin', frag);

    if (bounded || gapStartNew <= 1) {
      disableExpander(row); // gap fully filled (or reached top of file)
    } else {
      // top-of-file: continue upward on the next click
      row.dataset.newStart = String(gapStartNew);
      row.dataset.oldStart = String(gapStartNew + offset);
    }
    return true;
  } catch {
    return false; /* leave the expander in place so the user can retry */
  } finally {
    delete row.dataset.loading;
  }
}

// The tail row (after a file's last hunk) extends the file downward, CHUNK
// lines a click, and goes away once the blob ends.
async function expandTail(row) {
  const { path, rev } = row.dataset;
  const newStart = parseInt(row.dataset.newStart, 10);
  const oldStart = parseInt(row.dataset.oldStart, 10);
  const offset = oldStart - newStart;
  const split = row.closest('table').classList.contains('diff-table-split');
  row.dataset.loading = '1';
  try {
    const res = await fetch(
      `api/context?path=${encodeURIComponent(path)}&rev=${rev}` +
        `&start=${newStart}&end=${newStart + CHUNK - 1}`
    );
    const data = await res.json();
    const lines = data.lines || [];
    let frag = '';
    lines.forEach((content, i) => {
      const n = data.from + i;
      const inner = data.html ? data.html[i] : escapeHtml(content);
      frag += contextRow(split, n + offset, n, inner);
    });
    if (frag) row.insertAdjacentHTML('beforebegin', frag);
    if (data.eof || !lines.length) {
      row.remove(); // the file is shown to its end
    } else {
      row.dataset.newStart = String(newStart + lines.length);
      row.dataset.oldStart = String(oldStart + lines.length);
    }
    return true;
  } catch {
    return false;
  } finally {
    delete row.dataset.loading;
  }
}

// "Expand the whole file": work every expander in the file until none is
// left, so the file reads in full with its changes in place.  Bounded gaps
// fill in one fetch; the top-of-file and tail rows re-arm a chunk at a time
// until they reach an end.  Stops at the first failed fetch.
async function expandAll(fileEl) {
  for (let guard = 0; guard < 5000; guard++) {
    const btn = fileEl.querySelector('tr[data-expander] .expander');
    if (!btn) return;
    if (!(await expandContext(btn))) return;
  }
}

// Keep --subnav-h in sync with the sticky subnav's real height (it changes if
// the header wraps), so sticky file headers and the tree pane offset correctly.
function syncSubnavHeight() {
  const subnav = document.querySelector('.pr-subnav');
  if (subnav) {
    document.documentElement.style.setProperty('--subnav-h', subnav.offsetHeight + 'px');
  }
}
syncSubnavHeight();
window.addEventListener('resize', syncSubnavHeight);
window.addEventListener('load', syncSubnavHeight);

// --- file tree ----------------------------------------------------------
const TREE_KEY = 'prequel:tree'; // 'hidden' | 'shown'

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

(function applyTreeState() {
  if (localStorage.getItem(TREE_KEY) === 'hidden') {
    document.querySelector('.review-layout')?.classList.add('tree-hidden');
  }
})();

// --- resizable file pane (drag the divider; width persists) --------------
const TREE_W_KEY = 'prequel:tree-w';
const TREE_W_MIN = 180;
const treeWMax = () => Math.min(800, Math.round(window.innerWidth * 0.6));

function setTreeWidth(px) {
  const w = Math.max(TREE_W_MIN, Math.min(treeWMax(), Math.round(px)));
  document.querySelector('.review-layout')?.style.setProperty('--tree-w', w + 'px');
  return w;
}

(function applySavedTreeWidth() {
  const saved = parseInt(localStorage.getItem(TREE_W_KEY), 10);
  if (Number.isFinite(saved)) setTreeWidth(saved);
})();

(function initTreeResizer() {
  const resizer = document.querySelector('.tree-resizer');
  const pane = document.querySelector('.file-tree-pane');
  if (!resizer || !pane) return;

  let startX = 0;
  let startW = 0;

  const onMove = (e) => {
    setTreeWidth(startW + (e.clientX - startX));
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    resizer.classList.remove('is-dragging');
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    const w = parseInt(getComputedStyle(pane).width, 10);
    if (Number.isFinite(w)) localStorage.setItem(TREE_W_KEY, String(w));
  };

  resizer.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    startX = e.clientX;
    startW = parseInt(getComputedStyle(pane).width, 10) || 300;
    resizer.classList.add('is-dragging');
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // double-click the divider to reset to the default width
  resizer.addEventListener('dblclick', () => {
    document.querySelector('.review-layout')?.style.removeProperty('--tree-w');
    localStorage.removeItem(TREE_W_KEY);
  });
})();

document.addEventListener('click', (e) => {
  // Expand the whole file
  const expandAllBtn = e.target.closest('.expand-all');
  if (expandAllBtn) {
    e.preventDefault();
    e.stopPropagation();
    expandAll(expandAllBtn.closest('.file'));
    return;
  }

  // Hunk context expander
  const expander = e.target.closest('.expander');
  if (expander) {
    e.preventDefault();
    expandContext(expander);
    return;
  }

  // Toggle the file-tree pane
  const treeToggle = e.target.closest('.tree-pane-toggle');
  if (treeToggle) {
    const layout = document.querySelector('.review-layout');
    const hidden = layout.classList.toggle('tree-hidden');
    localStorage.setItem(TREE_KEY, hidden ? 'hidden' : 'shown');
    return;
  }

  // Collapse/expand a tree folder
  const dirRow = e.target.closest('.tree-dir-row');
  if (dirRow) {
    dirRow.closest('.tree-dir').classList.toggle('is-collapsed');
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
    if (segBtn.classList.contains('is-disabled')) return;
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

// Branch picker: review any local branch straight from git. Dropping `base`
// lets the branch's recorded review base (if any) apply.
document.getElementById('branch-picker')?.addEventListener('change', (e) => {
  const params = new URLSearchParams(location.search);
  params.set('branch', e.target.value);
  params.delete('base');
  params.set('diff', 'branch');
  location.search = params.toString();
});
