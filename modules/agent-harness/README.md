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

## Four operations and evidence

- `submit`: accept the task established/restored by the original Owner. Match the project, original business task/attempt, idempotency key, input, complete source binding, role and profile fingerprint. A new UUID/key cannot bypass the same-business-task guard.
- `status`: read the bound task in its project namespace. HTTP responses omit input, credential references and private profile snapshots.
- `cancel`: accepted work is cancelled only if the Owner's atomic operation confirms it cannot start. Inflight work records requested/unsupported. Local abort, OpenCode `abort=true` and idle do not prove termination or zero cost.
- `result`: return a candidate only when succeeded and the current source/profile binding matches. Every result still requires the original editorial/quality review. Source URL and date are preserved by the summary adapters.

The state machine preserves UNKNOWN after transport uncertainty, timeout or recovery. It neither resubmits nor changes provider/model/task identity. Queries are bounded. Late output is retained privately as a candidate; it does not silently become a public result. Missing tokens, reported cost and currency remain null. No budget release is inferred from cancellation, HTTP refusal or null cost.

Canonical identity supports ASCII keys, Unicode strings without normalization, booleans, null, arrays, objects and safe integers. It rejects floats in identity. Endpoint path case and percent spelling are retained. This is the local v0 implementation, not an RFC 8785 implementation.

## Original AIHOT composition boundary

`createHarnessModule`/`registerHarnessRoutes` requires the original session+CSRF guard and an original atomic accept/restore callback. `Host.claim`, `Host.cancelAccepted`, `Host.authorize` and `Host.persist` are original-Owner hooks; the demo's in-memory hooks are **only a synthetic oracle**, not production concurrency or persistence guarantees. No module queue is declared and the module is not enabled in `site/modules`.

`createAIhotExecutor` accepts the existing `chatJson` function, a snapshot-checked registered model binding and the original task/receipt lookup. It passes the per-task abort signal through the original provider path, includes the profile/source/task identity in the receipt prompt version, uses no implicit fallback, and returns local abort as uncertainty rather than remote cancellation. The only shared-engine delta is optional `ChatJsonOptions.signal`, combined with the existing timeout. No existing key rule is relaxed. An Owner budget/network refusal before dispatch is recorded as NOT_SENT; actual unknown execution keeps its liability with the original Owner.

Production pg-boss and DB receipt integration is not activated or tested here. The Owner must bind these hooks to existing atomic task transactions and budget/receipt persistence before enabling the module. This candidate must not be installed by substituting an identity guard or another task store.

## OpenCode is an executor, not a model API

`MockOpenCodeExecutor` uses only an injected **fake transport** for the audited `v1.19.4` operation mapping (source reference `148842ef7cb1bc34192b3fff57d0f9721ab9c801`). It records intent before `POST /session`, binds one session/message to the original attempt, sends one `prompt_async`, queries only the matching assistant, checks its actual provider/model, and treats abort acknowledgement as requested. It does not read credentials, start a CLI/server, install npm providers, grant tools or contact a real OpenCode service.

Native wire shapes, permissions and `/doc` must be checked by the original Owner before live use. Responses, native Anthropic, streaming, tool loops and unsupported input parameters are not implemented. CSM stdin/stdout/failure envelopes and its replay whitelist are untouched; this is not a claim that the translation plugin now supports cancellation.

## Version, license and delivery limits

The parent supplied the frozen specification as new text; its Owner-reported UTF-8 size/hash is 10956 bytes / `3f3b2cef57859224eb854e433d8c9a20fe2a2d815ecea31ae4664c18e7360223`. The referenced `task.schema.json` and `golden.json` have not been received. Local mock tests are not cross-language golden, CSM rc1.8, real API, real OpenCode, CI or cross-OS validation.

No third-party source/binary or new SDK is bundled. This original code uses the repository MIT license; host adapters use already-installed Fastify/zod and the existing AIHOT engine under their existing licenses. No OpenCode/Vercel SDK is vendored or dynamically installed.

The packer emits source files, MIT license, an A2A entry and SHA256 manifest. Consumers must read the files and verify hashes in their own environment; a local output path is not a delivery receipt. Existing Library upload 401, Actions permissions 403 and private database DENIED remain stopped. The older private ZIP is unchanged and does not contain this candidate.
