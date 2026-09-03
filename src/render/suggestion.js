import { escapeHtml } from './renderer.js';

export const FENCE = /^```suggestion[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm;

export const stripSuggestions = (body) => String(body || '').replace(FENCE, '').trim();

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

const STATUS = {
  applied: { label: 'Applied', cls: 'is-applied', actions: false },
  queued: { label: 'Queued for agent', cls: 'is-queued', actions: false },
  outdated: { label: 'Outdated', cls: 'is-outdated', actions: true, canApply: false },
  ready: { label: 'Suggested change', cls: '', actions: true, canApply: true },
};

const statusOf = ({ applied, handoff, applicable }) => {
  if (applied) return 'applied';
  if (handoff === 'agent') return 'queued';
  if (applicable === false) return 'outdated';
  return 'ready';
};

export function renderSuggestionBlock({ removed, added, applicable, handoff, applied, id }) {
  const st = STATUS[statusOf({ applied, handoff, applicable })];
  const rows =
    removed.map((l) => row('blob-code-deletion', '-', l)).join('') +
    added.map((l) => row('blob-code-addition', '+', l)).join('');
  const apply = st.canApply
    ? `<button class="suggestion-apply">Apply now</button>`
    : `<button class="suggestion-apply" disabled title="The file changed since this comment">Apply now</button>`;
  const actions = st.actions
    ? `<div class="suggestion-actions">${apply}<button class="suggestion-handoff">Let agent do it</button><span class="suggestion-error" hidden></span></div>`
    : '';
  return (
    `<div class="suggestion${st.cls ? ` ${st.cls}` : ''}"${id ? ` data-comment-id="${escapeHtml(id)}"` : ''}>` +
    `<div class="suggestion-header"><span class="suggestion-label">${st.label}</span></div>` +
    `<table class="suggestion-diff"><tbody>${rows}</tbody></table>` +
    actions +
    `</div>`
  );
}
