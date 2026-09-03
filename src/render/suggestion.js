const escapeHtml = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const FENCE = /^```suggestion[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;

export function parseSuggestions(body) {
  const out = [];
  for (const m of String(body || '').matchAll(FENCE)) {
    const text = m[1].replace(/\r?\n$/, '');
    out.push({ lines: text === '' ? [] : text.split(/\r?\n/) });
  }
  return out;
}

const row = (cls, marker, line) =>
  `<tr><td class="blob-code ${cls}"><span class="blob-code-inner"><span class="marker">${marker}</span>${escapeHtml(line)}</span></td></tr>`;

export function renderSuggestionBlock({ removed, added, applicable, handoff, id }) {
  const queued = handoff === 'agent';
  const label = queued ? 'Queued for agent' : applicable === false ? 'Outdated' : 'Suggested change';
  const state = queued ? 'is-queued' : applicable === false ? 'is-outdated' : '';
  const rows =
    removed.map((l) => row('blob-code-deletion', '-', l)).join('') +
    added.map((l) => row('blob-code-addition', '+', l)).join('');
  const apply = queued
    ? ''
    : applicable === false
      ? `<button class="suggestion-apply" disabled title="The file changed since this comment">Apply now</button>`
      : `<button class="suggestion-apply">Apply now</button>`;
  const hand = queued ? '' : `<button class="suggestion-handoff">Let agent do it</button>`;
  return (
    `<div class="suggestion${state ? ` ${state}` : ''}"${id ? ` data-comment-id="${escapeHtml(id)}"` : ''}>` +
    `<div class="suggestion-header"><span class="suggestion-label">${label}</span></div>` +
    `<table class="suggestion-diff"><tbody>${rows}</tbody></table>` +
    `<div class="suggestion-actions">${apply}${hand}<span class="suggestion-error" hidden></span></div>` +
    `</div>`
  );
}
