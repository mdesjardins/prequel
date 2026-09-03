// Builds the payload handed to Claude Code from review comments. Default is
// grouped-by-file, code-fenced markdown (embeds the repo root + each comment's
// code snapshot so Claude can locate the spot even if line numbers shifted).

import { inferLanguage } from '../git/diffParser.js';
import { stripSuggestions } from '../render/suggestion.js';

function lineLabel(c) {
  return c.startLine === c.endLine ? `Line ${c.startLine}` : `Lines ${c.startLine}–${c.endLine}`;
}

// Comment ids ride along as HTML comments: invisible in rendered markdown,
// but readable by anything reading the raw text — which is how a client marks
// the right comment resolved once it has addressed it.
function idMarker(c) {
  return `<!-- prequel:id ${c.id} -->`;
}

const ATTACHMENT_URL = /(^|[(\s"'])\/attachments\/([a-f0-9]+\.\w+)/g;
const localizeAttachments = (body) => String(body || '').replace(ATTACHMENT_URL, '$1.prequel/attachments/$2');

function suggestionNote(c) {
  if (c.handoff === 'agent') return 'Queued for agent: apply this change on their behalf.';
  if (c.applied) return 'Already applied.';
  if (c.applicable === false) return 'Outdated: the lines changed since this was written; adapt the intent.';
  return 'Suggested change (apply verbatim when the snapshot matches; adapt otherwise).';
}

function blockquote(body) {
  return String(body || '')
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
}

function bySortedFile(comments) {
  const groups = new Map();
  for (const c of comments) {
    if (!groups.has(c.filePath)) groups.set(c.filePath, []);
    groups.get(c.filePath).push(c);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([file, list]) => [file, list.sort((a, b) => a.startLine - b.startLine)]);
}

export function buildMarkdown(repoRoot, branch, comments) {
  const out = [];
  out.push(`# Review feedback${branch ? ` — ${branch}` : ''}`);
  out.push(`Repo: ${repoRoot}`);
  out.push('');
  out.push('Please address each review comment below; make the requested change for each.');
  out.push('');

  for (const [file, list] of bySortedFile(comments)) {
    out.push(`## ${file}`);
    out.push('');
    const lang = inferLanguage(file) || '';
    for (const c of list) {
      if (c.side === 'file') {
        out.push('### File comment');
        out.push(idMarker(c));
        if (c.kind === 'question') out.push('Question for the agent: reply and resolve, do not edit code.');
        out.push(blockquote(localizeAttachments(c.body)));
        out.push('');
        continue;
      }
      out.push(`### ${lineLabel(c)}${c.side === 'old' ? ' (old side)' : ''}`);
      out.push(idMarker(c));
      const code = (c.lineSnapshot || []).join('\n');
      if (code) {
        out.push('```' + lang);
        out.push(code);
        out.push('```');
      }
      if (c.kind === 'question') out.push('Question for the agent: reply and resolve, do not edit code.');
      if (c.kind === 'suggestion' && c.suggestion) {
        const prose = stripSuggestions(localizeAttachments(c.body));
        if (prose) out.push(blockquote(prose));
        out.push(suggestionNote(c));
        out.push('```suggestion');
        for (const l of c.suggestion.lines) out.push(l);
        out.push('```');
      } else {
        out.push(blockquote(localizeAttachments(c.body)));
      }
      out.push('');
    }
  }
  return out.join('\n').replace(/\n+$/, '') + '\n';
}

export function buildJson(comments) {
  return JSON.stringify(
    bySortedFile(comments).flatMap(([file, list]) =>
      list.map((c) => ({
        id: c.id,
        file,
        side: c.side,
        lines: c.side === 'file' ? null : [c.startLine, c.endLine],
        code: (c.lineSnapshot || []).join('\n'),
        comment: localizeAttachments(c.body),
        kind: c.kind || 'comment',
        suggestion: c.suggestion || null,
        applicable: c.applicable ?? null,
        handoff: c.handoff || null,
        applied: Boolean(c.applied),
      }))
    ),
    null,
    2
  );
}
