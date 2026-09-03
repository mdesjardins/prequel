// File-tree pane shared by the review and file pages: show/hide, drag to
// resize, collapse folders. State persists in localStorage.

function syncSubnavHeight() {
  const subnav = document.querySelector('.pr-subnav');
  if (subnav) {
    document.documentElement.style.setProperty('--subnav-h', subnav.offsetHeight + 'px');
  }
}
syncSubnavHeight();
window.addEventListener('resize', syncSubnavHeight);
window.addEventListener('load', syncSubnavHeight);

const TREE_KEY = 'prequel:tree'; // 'hidden' | 'shown'
const TREE_W_KEY = 'prequel:tree-w';
const TREE_W_MIN = 180;
const treeWMax = () => Math.min(800, Math.round(window.innerWidth * 0.6));

(function applyTreeState() {
  if (localStorage.getItem(TREE_KEY) === 'hidden') {
    document.querySelector('.review-layout')?.classList.add('tree-hidden');
  }
})();

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

  resizer.addEventListener('dblclick', () => {
    document.querySelector('.review-layout')?.style.removeProperty('--tree-w');
    localStorage.removeItem(TREE_W_KEY);
  });
})();

document.addEventListener('click', (e) => {
  const treeToggle = e.target.closest('.tree-pane-toggle');
  if (treeToggle) {
    const layout = document.querySelector('.review-layout');
    const hidden = layout.classList.toggle('tree-hidden');
    localStorage.setItem(TREE_KEY, hidden ? 'hidden' : 'shown');
    return;
  }

  const dirRow = e.target.closest('.tree-dir-row');
  if (dirRow) dirRow.closest('.tree-dir').classList.toggle('is-collapsed');
});
