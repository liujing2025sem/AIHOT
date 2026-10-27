# Selectable API harness v0 candidate

This is a runnable synthetic candidate for `selectable-api/0.1`. It adds no scheduler, queue, gateway, SDK, production service or publication path. The site module lists remain unchanged. Existing CAMOS and AIHOT Owners retain task, budget, credential, review and publication authority.

## Run without a provider or database

Node 24.11+ is required. The portable core and its mock tests need no npm install:

```sh
node --test modules/agent-harness/tests/harness.standalone.test.ts modules/agent-harness/tests/recovery.standalone.test.ts
node modules/agent-harness/scripts/demo.ts --out /tmp/aihot-harness-demo
node modules/agent-harness/scripts/demo.ts --restore /tmp/aihot-harness-demo/checkpoint.json
python3 modules/agent-harness/scripts/package.py --out /tmp/aihot-harness-package
```

The first demo process records a synthetic running task. A new process restores it as UNKNOWN and queries the original mock reference, with **zero submit calls**. No API key, external HTTP request, model, OpenCode process, database or publisher is involved. The HTTP test separately starts a synthetic server on literal loopback, checks the selected model, and verifies that no Authorization header is sent.

## Choosing a connection

Profiles are registered by the existing configuration Owner, never supplied as URLs in a task. The fields are exactly:

```json
{
  "profile_id": "demo",
  "kind": "model_api",
  "protocol": "openai_chat_completions",
  "provider": "synthetic-only",
  "model": "mock-summary",
  "endpoint": "http://127.0.0.1:12345/v1",
  "auth": { "mode": "none", "secret_ref": null },
  "budget_policy_ref": "existing-owner:llm",
  "network_policy_ref": "explicit-demo-loopback"
}
```

Auth modes are `none`, `bearer_ref`, `basic_ref`. Credential references look like `env:MODEL_KEY_REFERENCE_ONLY`; no secret value belongs in this source package or its checkpoints. `none` requires a literal `127.0.0.1`/`::1` endpoint explicitly listed by its network policy, sends no Authorization, and does not invent a token. Remote model endpoints require HTTPS and credential references. OpenCode is loopback-only. URL credentials, query strings, fragments and completion URLs used as API bases are rejected.

`LoopbackChatExecutor` only talks directly to a registered, synthetic HTTP loopback fixture, without proxy or redirect support. It is not a remote provider transport. Its string/URL validation does not prove production DNS, network or tenant isolation.

### Connected compatible API path

`createConfiguredAIhotExecutor` is the ready-to-call provider path, with **the real original `chatJson` function**, not an injected invoke stub. The caller selects only `profile_id`; the registered profile supplies endpoint/model/auth references and an explicit mapping to an original model/budget slot:

```ts
const executor = createConfiguredAIhotExecutor(registeredProfiles, {
  "my-local-api": { model_key: "default", budget_policy_ref: "existing-owner:llm" },
  "my-registered-remote": { model_key: "deepseek-flash", budget_policy_ref: "existing-owner:deepseek" },
}, originalTaskAndReceiptLookup);
// Original worker: harness.submit(await originalOwnerAccept({ ...boundTask, profile_id: "my-local-api" }));
// Host.executor returns executor; the original worker calls harness.dispatch(project, task_id).
```

The call chain is profile selection → `createConfiguredAIhotExecutor` → original `chatJson` → original `paidRequest` callback → HTTP transport. An explicit keyless HTTP loopback profile overrides endpoint/model per request without changing process globals or reading a key. It sends no Authorization, follows no redirects and uses no proxy. A bearer-authenticated remote profile must match its existing registered model's current endpoint/model/credential reference; it follows the original provider path and key rules. New remote endpoints are registered through the existing Owner configuration, not accepted from task input. Actual remote service use remains HOLD.

`profile-http.standalone.test.ts` tests this real call chain with a local fake HTTP server and only receipt DB operations mocked. Two selected profiles reach different endpoints/models, preserve original source metadata and null costs, and produce distinct receipt identities. A third in-flight request is aborted through the original LLM transport and stays UNKNOWN/unsupported rather than claiming remote cancellation. No real API key or external request is used. This verifies HTTP adapter code, not production budget/DB integration or a real provider account.

### OpenCode Go transport preparation

The original `chatJson` transport identifies this candidate as `selectable-api-harness/0.1`. Its optional `sessionId` becomes `x-opencode-session` and participates in the receipt identity. The Owner must persist an opaque conversation ID (1-128 ASCII letters/digits/`._:-`, starting with a letter/digit) and reuse it for every turn and recovery of that conversation. The transport never invents or rotates IDs. News/translation adapters do not supply this coding-conversation option.

For this bounded candidate, Go configuration requires `LLM_BASE_URL=https://opencode.ai/inference/go/openai/v1`, `LLM_MODEL=deepseek-v4.1-flash` and a `sessionId`. It appends `/chat/completions` once. It rejects a completion URL as the base, HTTP, URL credentials/query/fragment, a different model, extra JSON overriding model/messages, and implicit fallback before creating a receipt or sending a request. No free-model or pay-as-you-go endpoint is selected automatically. Other compatible providers keep their original credential rules.

The existing backend consumes `LLM_API_KEY` from its environment/credential configuration; this patch adds no secret input UI, injection tool, logging or key storage. A secure injection channel is **not verified available**. Do not put a real key in a chat, command argument, source file, checkpoint or package.

After the Owner resolves secure injection and the existing receipt/database access block, a separately authorized single-call test can invoke original `chatJson` with `model: "default"`, an Owner-persisted `sessionId`, no `fallbackModel`, `maxTokens: 512`, `LLM_REASONING_TOKENS=0`, and a short synthetic TypeScript review. Use an actual coding task: this does not authorize routing news summaries or bulk translation through Go. Keep the model valve disabled until that specific test is authorized; do not start a worker or queue. A refusal (401/403/429) stops the test, and a timeout remains uncertain with no resend. Retain reported `usage.opencode.billing_source` and `allowance`; a zero cost alone does not establish subscription billing. Before live use the Owner must confirm existing account/privacy eligibility and that Extra Usage will not bill a balance, without this patch changing those settings.

The no-key regression replaces only credential/receipt persistence and the remote fetch with synthetic fixtures, and separately checks actual HTTP headers on literal loopback. It covers stable/different sessions, receipt identity, invalid configuration before dispatch, refusal/timeout without automatic retry, and preserved billing evidence. **External inference calls: zero.** It does not validate a real subscription, database, production wiring or the outstanding Astra safety audit. See the official [Go requirements](https://opencode.ai/v2/docs/console/go/) and [inference usage fields](https://opencode.ai/v2/docs/console/api/inference/).

## Four operations and evidence

- `submit`: accept the task established/restored by the original Owner. Match the project, original business task/attempt, idempotency key, input, complete source binding, role and profile fingerprint. A new UUID/key cannot bypass the same-business-task guard.
- `status`: read the bound task in its project namespace. HTTP responses omit input, credential references and private profile snapshots.
- `cancel`: accepted work is cancelled only if the Owner's atomic operation confirms it cannot start. Inflight work records requested/unsupported. Local abort, OpenCode `abort=true` and idle do not prove termination or zero cost.
- `result`: return a candidate only when succeeded and the current source/profile binding matches. Every result still requires the original editorial/quality review. Source URL and date are preserved by the summary adapters.

The state machine preserves UNKNOWN after transport uncertainty, timeout or recovery. It neither resubmits nor changes provider/model/task identity. Queries are bounded. Late output is retained privately as a candidate; it does not silently become a public result. Missing tokens, reported cost and currency remain null. No budget release is inferred from cancellation, HTTP refusal or null cost.

Canonical identity supports ASCII keys, Unicode strings without normalization, booleans, null, arrays, objects and safe integers. It rejects floats in identity. Endpoint path case and percent spelling are retained. This is the local v0 implementation, not an RFC 8785 implementation.

## Original AIHOT composition boundary

`createHarnessModule`/`registerHarnessRoutes` requires the original session+CSRF guard and an original atomic accept/restore callback. `Host.claim`, `Host.cancelAccepted`, `Host.authorize` and `Host.persist` are original-Owner hooks; the demo's in-memory hooks are **only a synthetic oracle**, not production concurrency or persistence guarantees. No module queue is declared and the module is not enabled in `site/modules`.

`createAIhotExecutor` also supports dependency injection for isolated tests. Both forms pass the per-task abort signal through the original provider path, include profile/source/task identity in receipts, use no implicit fallback, and return local abort as uncertainty rather than remote cancellation. Shared-engine deltas are optional task signal handling and the explicitly registered `loopbackProfile` path; the existing remote key rule is unchanged. An Owner budget/network refusal before dispatch is recorded as NOT_SENT; actual unknown execution keeps its liability with the original Owner.

Production pg-boss and DB receipt integration is not activated or tested here. The Owner must bind these hooks to existing atomic task transactions and budget/receipt persistence before enabling the module. This candidate must not be installed by substituting an identity guard or another task store.

## OpenCode is an executor, not a model API

`MockOpenCodeExecutor` uses only an injected **fake transport** for the audited `v1.19.4` operation mapping (source reference `148842ef7cb1bc34192b3fff57d0f9721ab9c801`). It records intent before `POST /session`, binds one session/message to the original attempt, sends one `prompt_async`, queries only the matching assistant, checks its actual provider/model, and treats abort acknowledgement as requested. It does not read credentials, start a CLI/server, install npm providers, grant tools or contact a real OpenCode service.

Native wire shapes, permissions and `/doc` must be checked by the original Owner before live use. Responses, native Anthropic, streaming, tool loops and unsupported input parameters are not implemented. CSM stdin/stdout/failure envelopes and its replay whitelist are untouched; this is not a claim that the translation plugin now supports cancellation.

## Version, license and delivery limits

The parent supplied the frozen specification as new text; its Owner-reported UTF-8 size/hash is 10956 bytes / `3f3b2cef57859224eb854e433d8c9a20fe2a2d815ecea31ae4664c18e7360223`. The referenced `task.schema.json` and `golden.json` have not been received. Local mock tests are not cross-language golden, CSM rc1.8, real API, real OpenCode, CI or cross-OS validation.

No third-party source/binary or new SDK is bundled. This original code uses the repository MIT license; host adapters use already-installed Fastify/zod and the existing AIHOT engine under their existing licenses. No OpenCode/Vercel SDK is vendored or dynamically installed.

The packer emits standalone core source, MIT license, A2A entry, SHA256 manifest, and `host-integration/changes.patch` containing the actual AIHOT adapter/provider/test delta against `6ec842f`. In that original repository checkout, first run `git apply --check <package>/host-integration/changes.patch`; applying the patch and production activation are separate Owner actions. Consumers must read the files and verify hashes in their own environment; a local output path is not a delivery receipt. Existing Library upload 401, Actions permissions 403 and private database DENIED remain stopped. The older private ZIP is unchanged and does not contain this candidate.
