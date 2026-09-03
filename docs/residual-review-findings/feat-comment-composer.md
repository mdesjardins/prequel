# Residual review findings: feat/comment-composer

Review run `20260903-192312-c0cfe33a` (9 reviewers incl. a Codex cross-model pass) against base `22bb216`.
Nineteen findings were fixed on the branch. The items below were judged out of scope for this PR.

| Sev | Location | Finding | Suggested fix |
|---|---|---|---|
| P2 | `public/js/comments.js:314` | Suggestion range crossing an unexpanded hunk boundary snapshots only visible lines, so it is permanently outdated | manual: block range selection across a boundary or auto-expand before snapshotting |
| P3 | `src/render/suggestion.js:3` | FENCE regex and marked disagree on unclosed/~~~/indented suggestion fences (Apply renders, then 400s) | parse suggestions from marked's lexer so render/list/apply share one parser |
| P3 | `public/js/comments.js:171` | refreshFileDiff replaces the whole .file section and drops an open composer draft when another tab applies | preserve or re-insert compose rows across refresh |
| P3 | `src/server.js` | /api/file-diff 404s when an apply makes the file identical to HEAD; section and tree entry go stale | return an empty section marker and remove the file from the tree |
| P3 | `views/file.ejs` | File page has no window.prequelReview, so Apply now there leaves the blob view stale | refresh the blob view or hide Apply on the file page |
| P3 | `src/render/suggestion.js` | renderSuggestionBlock ignores status: a resolved, unapplied suggestion still shows Apply now while apply-all skips it | treat resolved like handed-off in statusOf |
| P3 | `src/server.js` | Pasted images upload immediately; cancelled composes leak files in .prequel/attachments | delete unreferenced attachments on cancel or on a sweep |
| P3 | `src/server.js` | apply-all reports a generic failure if a later file throws after earlier ones applied | per-item try/catch so the response lists partial results |
| P3 | `src/comments/commentStore.js` | Store and apply locks are process-local; two prequel processes on one repo can clobber each other | cross-process file lock if multi-process is ever supported |
| P3 | `src/server.js` | GET /attachments/:file 404 is text/plain, unlike the {error} JSON shape elsewhere | cosmetic |
| P3 | `src/comments/savedReplies.js` | camelCase filename follows sibling commentStore.js, not the global kebab-case rule | rename alongside the sibling if ever touched |
