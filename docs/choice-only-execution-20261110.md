# Choice-only editorial execution

## Goal

An operator enters a topic once. AIHOT discovers and fetches public evidence, proposes an angle and outline, accepts optional multiple-choice additions and optional notes, and generates only after explicit outline approval. Missing evidence offers useful, explicitly chosen scope changes. No subsequent required text field may block the path.

Baseline: `84d3a47ab9b1a3777c2423f26fe2e3d84f1a8ccb`.

## Throughput checkpoint

- [x] Read the Principles section of poteto-mode
- [x] Phase A: Frame
- [x] Phase B: Design the workflow
- [x] Phase C: Run the loop
- [x] Phase D: Keep the audit trail
- [x] Phase E: Verify and hand back with runtime limitations

The critical dependency is evidence acquisition. The existing preparation worker searches stored articles and imports supplied URLs. Its missing-evidence screen requires the operator to supply the next URL. The first unit repairs that behavior; the next unit exposes and persists choices without authorizing generation accidentally.

Design exploration phases completed: Frame, Fan out, Cross-judge, Pick, Graft, Verify. Two independent repository-grounded candidates were compared for safe evidence acquisition, compatibility with existing receipts/jobs, explicit scope approval, small change surface, and executable verification. The original skill's alternate model families were unavailable; native agents were used. Cross-family judgment and native plugin hooks were not run.

## Verification predicate

1. A topic-only request can discover and import a public document through the worker, without a supplied URL.
2. Missing or inaccessible evidence produces choices, including a useful scoped alternative. Unsupported stock, warehouse, lead-time and case-study claims remain excluded.
3. An operator can choose a direction, select compatible additions, leave all optional notes empty, and explicitly approve the visible outline before full generation.
4. Choice state survives reload and is included in generation inputs. A checkbox change never generates a draft.
5. The review starts with a Chinese decision summary and actionable original-sentence changes.
6. Unknown paid-model receipts are not silently retried. Existing publishing and live-page protections remain intact.

Deterministic integration tests use local services. They do not prove public-network availability or production deployment. Browser results and live acquisition, if executable under host permissions, are recorded separately.

## Boundaries

Continue the existing repository, contracts, worker queues and receipt accounting. Preserve unrelated edits and stored data. Do not deploy, publish, alter credentials, enable paid services or overwrite live WordPress pages. No new product-wide architecture or schema migration unless the scoped change demonstrates it is necessary.

## Decision trail

- User confirmed direction-first, explicit scope changes and Chinese-summary-first review. Optional multi-select requirements and optional free text belong below each primary choice.
- The latest implementation request supersedes the previous handoff's waiting-for-confirmation status.
- Implementation, tests, independent review, public acquisition and deployment will receive separate result labels.
- Both independent candidates selected the existing preparation record and queue. The base is a saved decision card with its own revision, so saving preferences does not change paid-request identities. A separate research table and job framework were rejected.
- Acquire public URLs through bounded configured official-site directory/sitemap discovery and the existing guarded HTTP/extraction boundary. This supersedes the proposed public-search provider. The official sites and bundled reference pages do not provide full-web discovery or guarantee evidence for arbitrary buyer topics. Listing results are discovery pointers, not evidence; only fetched source bodies can support claims. Network failure remains visible.
- Backend and frontend changes use isolated worktrees. The root integrates and independently verifies them.

## Implemented result

Repository implementation commit: `b449862765003e1352f66411db3fd95b579cd777`.
Tested local implementation commit: `6a0904f50964943c7044a44d1e6705215fabaea0`.
Both have exactly the same code tree: `a263d78353ac8903c161ac9491a170ad0d02a123`.
The local Git transport had no configured login. The existing authenticated GitHub connector transferred the committed files; every blob and the complete code tree matched the local tested version. No new credential was read or installed.
Branch: `codex/choice-only-editorial-20261110`, based on PR #22's `codex/editorial-closeout-20261109`.
Maturity: **STATIC_PASS**. Feature scope is frozen; database integration, browser interaction and the real topic-to-draft pilot remain unproven.

- Preparation discovers URLs from configured official roots and relevant reference entries, then imports bodies. It honors the existing collection valve, robots restrictions, URL guards, request limits and failure reporting. It does not turn collection on or add a paid search provider.
- Missing evidence can trigger research with no supplied URL. Supported scope options show what remains and what is omitted; the operator explicitly chooses a scope before replanning.
- Direction, outline, compatible multiple-choice additions and optional notes are saved separately from generation. Reload restores saved choices; confirmation checks their revision. Additions and notes reach the fragment writer, but do not become evidence.
- Review starts with a Chinese decision summary, original problem sentences and suggested results. Full text is expandable; publishing controls remain downstream of approval.
- A selected revision goal works with a blank note. Revision requests use the existing worker/receipt infrastructure; a model patch changes only exact current text and is rechecked against all content gates. English edits retain stale-Chinese warnings.
- Unknown or interrupted revisions expose receipt recovery and keeping the original. Neither recovery action re-sends a paid model call. Cancellation changes the version, so a late result cannot overwrite the retained draft.

## Verification and independent review

| Gate | Actual result | Boundary |
|---|---|---|
| `npm run typecheck` | PASS | Contracts, backend, API, worker, tests, modules and web |
| `npm run build -w @aihot/web` | PASS | Client and server build; no browser interaction proof |
| `npm run test:standalone` | 453/453 PASS, zero skipped | Pure/local-service tests; no PostgreSQL or production model calls |
| Backend research independent rerun | 25/25 PASS | Includes four new robots/redirect regressions |
| Revision/brief regression | PASS in final standalone suite | Exact edits, source preservation, stale Chinese, locked old-page paragraphs |
| Database regressions | Authored, NOT RUN | PostgreSQL unavailable on this host |
| Browser regressions | Authored, syntax/type checked, NOT RUN | Browser launch explicitly denied; no alternate launch attempted |
| `git diff --check` | PASS | No whitespace errors |
| Added code-comment review | Zero added comment lines | Existing comments preserved |
| Real Europe-warehouse topic | NOT RUN | No claim of a completed article, actual inventory or delivery SLA |
| Original instance deployment | NOT RUN | No publishing, environment changes or WordPress writes |

Independent reviewers identified and verified fixes for revision recovery, stale Chinese, multi-source brief preservation, false dirty state during metadata refresh, delayed recovery polling, outline whitespace conflicts and robots boundaries. The final scoped reviews reported no remaining P0/P1 in their reviewed changes. This is not an assertion that the entire system has no defects.

## Next minimum proof

In the existing authorized pipeline and original-instance workflow, first verify the database and browser regressions against this candidate. A source-only topic request must actually discover a document and resume planning with no operator URL. Then run the user's Europe-stock example, leave all optional text blank, explicitly choose the angle and any narrower scope, and obtain a concrete evidence-backed draft. Preserve unresolved inventory, dates, warehouse identity and real-case claims as unsupported; never manufacture them to satisfy the path.

Do not retry the refused local browser using a different environment as a workaround. Deployment, paid model execution and production publishing require the existing explicit authority and configuration. Save the actual command, task/version identifiers, discovered source URLs, chosen scope and resulting draft for the pilot receipt. The five-second comprehension and 15–30-second decision targets require operator observation; they are not measured by the current tests.
