// GitHub-style comment composer: Write/Preview tabs, toolbar, shortcuts.
// comments.js asks for the form markup and mounts behavior on it.
(function () {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const mod = mac ? '⌘' : 'Ctrl+';
  const shift = mac ? '⇧' : 'Shift+';

  const esc = (s) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const I = {
    suggestion:
      '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V4.664a.25.25 0 0 0-.073-.177l-2.914-2.914a.25.25 0 0 0-.177-.073ZM8 6.5a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0v-1.5h-1.5a.75.75 0 0 1 0-1.5h1.5v-1.5A.75.75 0 0 1 8 6.5Z"/></svg>',
    heading:
      '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M3.75 2a.75.75 0 0 1 .75.75V7h7V2.75a.75.75 0 0 1 1.5 0v10.5a.75.75 0 0 1-1.5 0V8.5h-7v4.75a.75.75 0 0 1-1.5 0V2.75A.75.75 0 0 1 3.75 2Z"/></svg>',
    bold: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M4 2h4.5a3.501 3.501 0 0 1 2.852 5.53A3.499 3.499 0 0 1 9.5 14H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm1 7v3h4.5a1.5 1.5 0 0 0 0-3Zm3.5-2a1.5 1.5 0 0 0 0-3H5v3Z"/></svg>',
    italic:
      '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M6 2.75A.75.75 0 0 1 6.75 2h6.5a.75.75 0 0 1 0 1.5h-2.505l-3.858 9H9.25a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h2.505l3.858-9H6.75A.75.75 0 0 1 6 2.75Z"/></svg>',
    quote:
      '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M1.75 2.5h10.5a.75.75 0 0 1 0 1.5H1.75a.75.75 0 0 1 0-1.5Zm4 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5ZM2.5 7.75v6a.75.75 0 0 1-1.5 0v-6a.75.75 0 0 1 1.5 0Z"/></svg>',
    code: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.47 8.53a.75.75 0 0 1 0-1.06Z"/></svg>',
    link: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="m7.775 3.275 1.25-1.25a3.5 3.5 0 1 1 4.95 4.95l-2.5 2.5a3.5 3.5 0 0 1-4.95 0 .751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018 1.998 1.998 0 0 0 2.83 0l2.5-2.5a2.002 2.002 0 0 0-2.83-2.83l-1.25 1.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042Zm-4.69 9.64a1.998 1.998 0 0 0 2.83 0l1.25-1.25a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042l-1.25 1.25a3.5 3.5 0 1 1-4.95-4.95l2.5-2.5a3.5 3.5 0 0 1 4.95 0 .751.751 0 0 1-.018 1.042.751.751 0 0 1-1.042.018 1.998 1.998 0 0 0-2.83 0l-2.5 2.5a1.998 1.998 0 0 0 0 2.83Z"/></svg>',
    ul: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M5.75 2.5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5ZM2 14a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm1-6a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm-1-4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
    ol: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M5 3.25a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 5 3.25Zm0 5a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 5 8.25Zm0 5a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1-.75-.75ZM.924 10.32a.5.5 0 0 1-.851-.525l.001-.001.001-.002.002-.004.007-.011c.097-.144.215-.273.348-.384.228-.19.588-.392 1.068-.392.468 0 .858.181 1.126.484.259.294.377.673.377 1.038 0 .987-.686 1.495-1.156 1.845l-.047.035c-.303.225-.522.4-.654.597h1.357a.5.5 0 0 1 0 1H.5a.5.5 0 0 1-.5-.5c0-1.005.692-1.52 1.167-1.875l.035-.025c.531-.395.8-.625.8-1.078a.57.57 0 0 0-.128-.376C1.806 10.068 1.695 10 1.5 10a.658.658 0 0 0-.429.163.835.835 0 0 0-.144.153ZM2.003 2.5V6h.541a.5.5 0 0 1 0 1H.457a.5.5 0 0 1 0-1h.546V3.31L.354 3.75a.5.5 0 0 1-.708-.706l1.5-1.5A.5.5 0 0 1 2.003 2.5Z"/></svg>',
    task: '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M2.5 1.75v11.5c0 .138.112.25.25.25h3.17a.75.75 0 0 1 0 1.5H2.75A1.75 1.75 0 0 1 1 13.25V1.75C1 .784 1.784 0 2.75 0h8.5C12.216 0 13 .784 13 1.75v7.736a.75.75 0 0 1-1.5 0V1.75a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13.274 9.537v-.001l-4.557 4.45a.75.75 0 0 1-1.055-.008l-1.943-1.95a.75.75 0 0 1 1.062-1.058l1.419 1.425 4.026-3.932a.75.75 0 1 1 1.048 1.074ZM4.75 4h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5ZM4 7.75A.75.75 0 0 1 4.75 7h2a.75.75 0 0 1 0 1.5h-2A.75.75 0 0 1 4 7.75Z"/></svg>',
    mention:
      '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M4.75 2.37a6.5 6.5 0 0 0 6.5 11.26.75.75 0 0 1 .75 1.298A8 8 0 1 1 16 8v.5a2.75 2.75 0 0 1-4.525 2.1.75.75 0 0 1-.107-.05A4 4 0 1 1 12 8.5v.5a1.25 1.25 0 0 0 2.5 0V8a6.5 6.5 0 0 0-9.75-5.63ZM10.5 8a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"/></svg>',
    saved:
      '<svg viewBox="0 0 16 16" width="16" height="16"><path d="M6.78 1.97a.75.75 0 0 1 0 1.06L3.81 6h6.44A4.75 4.75 0 0 1 15 10.75v2.5a.75.75 0 0 1-1.5 0v-2.5a3.25 3.25 0 0 0-3.25-3.25H3.81l2.97 2.97a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L1.47 7.28a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z"/></svg>',
  };

  const TOOLS = [
    ['suggestion', 'Add a suggestion', ''],
    ['heading', 'Heading', ''],
    ['bold', 'Bold', `${mod}B`],
    ['italic', 'Italic', `${mod}I`],
    ['quote', 'Quote', `${mod}${shift}.`],
    ['code', 'Code', `${mod}E`],
    ['link', 'Link', `${mod}K`],
    ['|'],
    ['ul', 'Bulleted list', `${mod}${shift}8`],
    ['ol', 'Numbered list', `${mod}${shift}7`],
    ['task', 'Task list', `${mod}${shift}L`],
    ['|'],
    ['mention', 'Ask the agent', ''],
    ['saved', 'Saved replies', `${mod}.`],
  ];

  function headerText(a) {
    if (a.kind === 'reply') return 'Reply';
    if (a.kind === 'file') return 'Add a comment on this file';
    const p = a.side === 'old' ? 'L' : 'R';
    const lo = Number(a.startLine);
    const hi = Number(a.endLine || a.startLine);
    return hi > lo ? `Add a comment on lines ${p}${lo} to ${p}${hi}` : `Add a comment on line ${p}${lo}`;
  }

  function html(a) {
    const canSuggest = a.kind === 'line' && a.side !== 'old';
    const tools = TOOLS.filter(([act]) => act !== 'suggestion' || canSuggest)
      .map(([act, label, key]) =>
        act === '|'
          ? '<span class="composer-sep"></span>'
          : `<button type="button" class="composer-tool" data-act="${act}" title="${esc(label)}${key ? ` (${key})` : ''}" aria-label="${esc(label)}">${I[act]}</button>`
      )
      .join('');
    return (
      `<form class="comment-compose">` +
      `<div class="composer-header">${esc(headerText(a))}</div>` +
      `<div class="composer-bar">` +
      `<div class="composer-tabs" role="tablist">` +
      `<button type="button" class="composer-tab is-active" data-tab="write" role="tab" aria-selected="true">Write</button>` +
      `<button type="button" class="composer-tab" data-tab="preview" role="tab" aria-selected="false">Preview</button>` +
      `</div><div class="composer-tools">${tools}</div>` +
      `<div class="composer-saved-menu" role="menu" tabindex="-1" hidden></div></div>` +
      `<div class="composer-notice" hidden></div>` +
      `<textarea class="comment-input" rows="4" placeholder="Leave a comment"></textarea>` +
      `<div class="comment-preview markdown-body" hidden></div>` +
      `<div class="comment-compose-actions">` +
      `<span class="composer-hints">${esc(mod)}B ${esc(mod)}I ${esc(mod)}E ${esc(mod)}K · ${esc(mod)}⏎ to comment · Paste or drop images</span>` +
      `<button type="button" class="btn comment-cancel">Cancel</button>` +
      `<button type="submit" class="btn btn-primary">Comment</button>` +
      `</div></form>`
    );
  }

  // --- text transforms ----------------------------------------------------
  function replaceSel(ta, text, selStart, selEnd) {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    ta.value = v.slice(0, s) + text + v.slice(e);
    ta.setSelectionRange(selStart, selEnd);
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function wrap(ta, before, after, placeholder) {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const sel = v.slice(s, e);
    const inner = sel || placeholder;
    const text = before + inner + after;
    replaceSel(ta, text, s + before.length, s + before.length + inner.length);
  }

  function prefixLines(ta, prefix) {
    const { value: v } = ta;
    let s = ta.selectionStart;
    let e = ta.selectionEnd;
    s = v.lastIndexOf('\n', s - 1) + 1;
    const nl = v.indexOf('\n', e);
    e = nl === -1 ? v.length : nl;
    const lines = v.slice(s, e).split('\n');
    const out = lines
      .map((l, i) => (typeof prefix === 'function' ? prefix(i) : prefix) + l)
      .join('\n');
    ta.value = v.slice(0, s) + out + v.slice(e);
    ta.setSelectionRange(s, s + out.length);
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function insertBlock(ta, text) {
    const { selectionStart: s, value: v } = ta;
    const needNl = s > 0 && v[s - 1] !== '\n';
    const block = (needNl ? '\n' : '') + text;
    replaceSel(ta, block, s + block.length, s + block.length);
  }

  function suggestionBlock(form) {
    let lines = [];
    try {
      lines = JSON.parse(form.dataset.snapshot || '[]');
    } catch {
      lines = [];
    }
    return '```suggestion\n' + lines.join('\n') + (lines.length ? '\n' : '') + '```\n';
  }

  const ACTIONS = {
    heading: (ta) => prefixLines(ta, '### '),
    bold: (ta) => wrap(ta, '**', '**', 'bold text'),
    italic: (ta) => wrap(ta, '_', '_', 'italic text'),
    quote: (ta) => prefixLines(ta, '> '),
    code: (ta) => {
      const sel = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      return sel.includes('\n') ? wrap(ta, '```\n', '\n```', '') : wrap(ta, '`', '`', 'code');
    },
    link: (ta) => wrap(ta, '[', '](url)', 'link text'),
    ul: (ta) => prefixLines(ta, '- '),
    ol: (ta) => prefixLines(ta, (i) => `${i + 1}. `),
    task: (ta) => prefixLines(ta, '- [ ] '),
    mention: (ta) => wrap(ta, '@agent ', '', ''),
  };

  const KEYS = {
    b: 'bold',
    i: 'italic',
    e: 'code',
    k: 'link',
    '.': 'quote',
    '8': 'ul',
    '7': 'ol',
    l: 'task',
  };

  // --- preview ------------------------------------------------------------
  async function showPreview(form) {
    const ta = form.querySelector('.comment-input');
    const pane = form.querySelector('.comment-preview');
    pane.hidden = false;
    ta.hidden = true;
    pane.innerHTML = '<span class="composer-muted">Loading preview</span>';
    try {
      const d = form.dataset;
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          body: ta.value,
          filePath: d.filePath,
          side: d.side,
          startLine: Number(d.startLine),
          endLine: Number(d.endLine),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'preview failed');
      pane.innerHTML = ta.value.trim() ? data.html : '<span class="composer-muted">Nothing to preview</span>';
    } catch (err) {
      pane.innerHTML = `<span class="composer-error">Preview failed: ${esc(err.message)}</span>`;
    }
  }

  function showWrite(form) {
    form.querySelector('.comment-preview').hidden = true;
    const ta = form.querySelector('.comment-input');
    ta.hidden = false;
    ta.focus();
  }

  function setTab(form, tab) {
    form.querySelectorAll('.composer-tab').forEach((b) => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
    });
    if (tab === 'preview') showPreview(form);
    else showWrite(form);
  }

  function insertAt(ta, text) {
    const { selectionStart: s, value: v } = ta;
    ta.value = v.slice(0, s) + text + v.slice(s);
    ta.setSelectionRange(s + text.length, s + text.length);
    ta.focus();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function notice(form, msg) {
    const el = form.querySelector('.composer-notice');
    el.hidden = !msg;
    el.innerHTML = msg ? `<span class="composer-error">${esc(msg)}</span>` : '';
  }

  // --- saved replies ------------------------------------------------------
  let savedCache = null;

  async function loadSaved(force) {
    if (savedCache && !force) return savedCache;
    const res = await fetch('/api/saved-replies');
    if (!res.ok) throw new Error('could not load saved replies');
    savedCache = (await res.json()).replies || [];
    return savedCache;
  }

  function renderSaved(menu, items) {
    const rows = items
      .map(
        (r, i) =>
          `<div class="composer-saved-row">` +
          `<button type="button" class="composer-saved-item" role="menuitem" data-idx="${i}" title="${esc(r.body)}">${esc(r.name)}</button>` +
          `<button type="button" class="composer-saved-del" data-id="${esc(r.id)}" title="Delete saved reply" aria-label="Delete ${esc(r.name)}">×</button>` +
          `</div>`
      )
      .join('');
    menu.innerHTML =
      (rows || '<div class="composer-muted composer-saved-empty">No saved replies yet</div>') +
      `<button type="button" class="composer-saved-add" role="menuitem">Save current as reply…</button>`;
  }

  function closeSaved(form, refocus = true) {
    const menu = form.querySelector('.composer-saved-menu');
    if (menu.hidden) return;
    menu.hidden = true;
    document.removeEventListener('mousedown', menu._outside);
    if (refocus) form.querySelector('.comment-input').focus();
  }

  async function openSaved(form, force) {
    const menu = form.querySelector('.composer-saved-menu');
    menu.hidden = false;
    menu.innerHTML = '<div class="composer-muted composer-saved-empty">Loading…</div>';
    try {
      renderSaved(menu, await loadSaved(force));
    } catch (err) {
      menu.innerHTML = `<div class="composer-error composer-saved-empty">${esc(err.message)}</div>`;
    }
    document.removeEventListener('mousedown', menu._outside);
    menu._outside = (e) => {
      if (!menu.contains(e.target) && !e.target.closest('[data-act="saved"]')) closeSaved(form, false);
    };
    document.addEventListener('mousedown', menu._outside);
    (menu.querySelector('[role="menuitem"]') || menu).focus();
  }

  function toggleSaved(form) {
    const menu = form.querySelector('.composer-saved-menu');
    return menu.hidden ? openSaved(form) : closeSaved(form);
  }

  async function savedAction(form, target) {
    const ta = form.querySelector('.comment-input');
    const item = target.closest('.composer-saved-item');
    if (item) {
      const r = (savedCache || [])[Number(item.dataset.idx)];
      closeSaved(form);
      if (r) insertAt(ta, r.body);
      return;
    }
    const del = target.closest('.composer-saved-del');
    if (del) {
      if (!confirm('Delete this saved reply?')) return;
      const res = await fetch(`/api/saved-replies/${encodeURIComponent(del.dataset.id)}`, { method: 'DELETE' });
      if (!res.ok) return notice(form, 'Could not delete saved reply');
      return openSaved(form, true);
    }
    if (target.closest('.composer-saved-add')) {
      const body = ta.value.trim();
      if (!body) return notice(form, 'Write the reply text first, then save it');
      const name = prompt('Name this saved reply');
      if (!name || !name.trim()) return;
      const res = await fetch('/api/saved-replies', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), body }),
      });
      if (!res.ok) return notice(form, 'Could not save reply');
      notice(form, '');
      return openSaved(form, true);
    }
  }

  function savedKeys(form, e) {
    const menu = form.querySelector('.composer-saved-menu');
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      return closeSaved(form);
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = items.length;
      if (!n) return;
      items[e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n].focus();
      return;
    }
    if (e.key === 'Enter' && i >= 0) {
      e.preventDefault();
      savedAction(form, items[i]);
    }
  }

  // --- attachments --------------------------------------------------------
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

  const readBase64 = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(new Error('could not read file'));
      r.readAsDataURL(file);
    });

  async function uploadImage(form, ta, file) {
    const name = file.name || 'image';
    const placeholder = `![Uploading ${name}…]()`;
    insertAt(ta, placeholder);
    notice(form, '');
    const swap = (text) => {
      const at = ta.value.indexOf(placeholder);
      if (at === -1) return;
      const { selectionStart: s, selectionEnd: e } = ta;
      ta.value = ta.value.slice(0, at) + text + ta.value.slice(at + placeholder.length);
      const shift = text.length - placeholder.length;
      ta.setSelectionRange(s > at ? s + shift : s, e > at ? e + shift : e);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    };
    try {
      const data = await readBase64(file);
      const res = await fetch('/api/attachments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, type: file.type, data }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'upload failed');
      swap(`![${name}](${out.url})`);
    } catch (err) {
      swap('');
      notice(form, `Upload failed: ${err.message}`);
    }
  }

  const imageFiles = (list) => [...(list || [])].filter((f) => IMAGE_TYPES.includes(f.type));

  function mountAttachments(form, ta) {
    ta.addEventListener('paste', (e) => {
      const files = imageFiles(e.clipboardData?.files);
      if (!files.length) return;
      e.preventDefault();
      files.forEach((f) => uploadImage(form, ta, f));
    });
    ta.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      ta.classList.add('is-dragover');
    });
    ta.addEventListener('dragleave', () => ta.classList.remove('is-dragover'));
    ta.addEventListener('drop', (e) => {
      ta.classList.remove('is-dragover');
      const files = imageFiles(e.dataTransfer?.files);
      if (!files.length) return;
      e.preventDefault();
      files.forEach((f) => uploadImage(form, ta, f));
    });
  }

  function mount(form) {
    const ta = form.querySelector('.comment-input');
    const menu = form.querySelector('.composer-saved-menu');
    menu.addEventListener('click', (e) => {
      e.preventDefault();
      savedAction(form, e.target);
    });
    menu.addEventListener('keydown', (e) => savedKeys(form, e));
    mountAttachments(form, ta);
    form.addEventListener('click', (e) => {
      if (e.target.closest('.composer-saved-menu')) return;
      const tab = e.target.closest('.composer-tab');
      if (tab) return setTab(form, tab.dataset.tab);
      const tool = e.target.closest('.composer-tool');
      if (!tool) return;
      e.preventDefault();
      if (!form.querySelector('.comment-preview').hidden) setTab(form, 'write');
      const act = tool.dataset.act;
      if (act === 'suggestion') return insertBlock(ta, suggestionBlock(form));
      if (act === 'saved') return toggleSaved(form);
      ACTIONS[act]?.(ta);
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        return form.querySelector('.comment-cancel')?.click();
      }
      const cmd = mac ? e.metaKey : e.ctrlKey;
      if (!cmd) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        return form.requestSubmit();
      }
      if (e.key === '.' && !e.shiftKey) {
        e.preventDefault();
        return toggleSaved(form);
      }
      const k = e.key.toLowerCase();
      const act = KEYS[k];
      if (!act) return;
      const needsShift = ['.', '8', '7', 'l'].includes(k);
      if (needsShift !== e.shiftKey) return;
      e.preventDefault();
      ACTIONS[act](ta);
    });
  }

  window.prequelComposer = { html, mount, headerText };
})();
