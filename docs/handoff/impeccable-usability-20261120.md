# AIHOT usability review handoff — 2026-11-20

## Scope and decision

Review-only pull request for Opus 5.5. Base: `76392e3ee8f983d3271846c3160e076dae82ee68`.
This change improves the existing operator workflow; deployment and merge remain separate decisions.

| Operator task | Change | Regression evidence |
| --- | --- | --- |
| Read an English draft | Full read-only text first; source editing on demand; mobile DOM and visual order aligned; direct issue jump | Existing `studio-review-workbench.test.ts`: long synthetic draft, keyboard focus, unchanged source/version, dirty state |
| Choose a cover and deliver | Current choice first; optional upload disclosure; explicit “检查交付文件” action | Existing `studio-manual-delivery.test.ts`: 390/768/1440 layouts and keyboard disclosure |
| Edit a source while pausing it | Local edited fields survive refreshed status; untouched fields follow the saved record | Existing `local-state.test.ts` and `studio-shell.test.ts` |
| Switch API channel tabs | Existing Radix tabs; unsaved fields stay in memory; only the active panel is visible | Existing `studio-shell.test.ts`: arrow/Home/End keys, cross-channel save, no browser storage of keys |
| Use admin controls | Stronger control borders, labelled budgets and audit filters, keyboard-expandable benchmark cases | Existing `studio-shell.test.ts`: computed contrast, form submission, Space/Enter |
| Read action feedback | Repeated identical notifications coalesce; distinct errors remain; reduced-motion preference respected | Existing `studio-shell.test.ts`: synthetic failures and visual evidence |

## Invariants

- Source text, draft versioning, approval, cover validity, and delivery confirmation keep their existing write paths.
- Input preservation uses component memory only; no new persistence, API, schema, dependency, retry layer, or service.
- A changed/saved channel configuration clears old test results and paid-test consent.
- Collection, paid-model calls, WordPress publishing, deployment, and target-instance state are untouched.
- All browser fixtures are synthetic. Private manuscripts, credentials, and Drive content are excluded.
- `docs/LIVE.md` and the product-map decision in issue #29 are unchanged.

## Verification and merge review

1. Run root `npm run typecheck` and `npm run build -w @aihot/web`.
2. Existing GitHub Actions must run the complete web/backend suite and both `check` / `docker` jobs on this PR's current head. An earlier main run is not this patch's evidence.
3. Inspect the `workbench-visual-evidence` artifact for desktop/mobile manuscript, cover, and notification views.
4. Recheck current base and PR #27 before merge. The overlap is the existing `studio-shell.test.ts`; new admin regressions are appended, while its original selection tests are retained.
5. Return findings with severity, file/line, reproduction and minimum change. Do not broaden into navigation redesign or alter existing safety gates.

## Remaining questions

1. The English reading view is plain text, not a rich HTML/Markdown renderer. Complex tables and final export formatting still need a real-material comparison.
2. The 85-paragraph regression is synthetic. The stopped target instance and its real 6098/MiP material have not been replayed by this patch.
3. GitHub browser evidence covers automated behavior; manual screen-reader/zoom checks and final combined testing after any PR #27 integration remain separate acceptance work.

Methods: Impeccable `distill`, `harden`, `polish`, craft-floor at upstream `b49177d32788f2dc585c42831d845dacf1ebed2c`; Modern Web Guidance `forms`, `accessibility`, `tabs`. No automatic visual score is claimed.
