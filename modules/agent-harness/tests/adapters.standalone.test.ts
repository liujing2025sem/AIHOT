import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { Harness, emptyUsage, registerProfiles, type Host, type Profile, type Submit, type Task } from "../backend/core.ts";
import { MockExecutor } from "../backend/mock.ts";
import { MockOpenCodeExecutor, type FakeOpenCodeTransport } from "../backend/opencode.ts";
import { createAIhotExecutor } from "../backend/aihot.ts";
import { registerHarnessRoutes } from "../server.ts";
import type { chatJson } from "../../../packages/backend/src/providers/llm.ts";

const profile: Profile = { profile_id: "selected", kind: "opencode_server", protocol: "opencode_http_1.19.4", provider: "fixture-provider", model: "fixture-model", endpoint: "http://127.0.0.1:43210",
  auth: { mode: "none", secret_ref: null }, budget_policy_ref: "existing:llm", network_policy_ref: "fixture" };
const input = (): Submit => ({ project: "aihot", task_id: "original-attempt", original_task_id: "original-owner-attempt", idempotency_key: "request-once", profile_id: "selected", role: "summary", source_binding: { source: "fixture-v1" }, input: { text: "Synthetic announcement.", source_url: "https://example.invalid/item", source_date: "2026-10-26" } });
function create(executor: Host["executor"], selected = profile) {
  const profiles = registerProfiles([selected], { fixture: { endpoints: [selected.endpoint], loopback_no_auth: true } });
  return new Harness(profiles, { executor, persist: () => {}, authorize: () => {}, claim: () => true, cancelAccepted: () => true });
}

test("OpenCode fake transport uses one exclusive session, queries matching assistant and treats abort=true as requested", async () => {
  const calls: string[] = [];
  let completed = false;
  const evidence: unknown[] = [];
  const transport: FakeOpenCodeTransport = { mode: "fake", async request(method, path, body) {
    calls.push(`${method} ${path}`);
    if (path === "/session") return { status: 200, body: { id: "ses_fixture" } };
    if (path.endsWith("/prompt_async")) {
      assert.deepEqual((body as { model: unknown }).model, { providerID: "fixture-provider", modelID: "fixture-model" });
      assert.equal((body as { messageID: string }).messageID, "msg_original");
      return { status: 204, body: null };
    }
    if (path.endsWith("/abort")) return { status: 200, body: true };
    if (path === "/session/status") return { status: 200, body: { ses_fixture: { type: "idle" } } };
    return { status: 200, body: completed ? [{ info: { id: "msg_assistant", role: "assistant", parentID: "msg_original", providerID: "fixture-provider", modelID: "fixture-model", time: { completed: 10 }, tokens: { input: 3 } }, parts: [{ type: "text", text: "A synthetic reviewed candidate." }] }] : [] };
  } };
  const executor = new MockOpenCodeExecutor(transport, () => "msg_original", value => evidence.push(value));
  const harness = create(() => executor); const task = harness.submit(input());
  await harness.dispatch("aihot", task.task_id); await harness.reconcile("aihot", task.task_id);
  assert.equal(harness.status("aihot", task.task_id).state, "unknown", "idle is insufficient proof");
  const cancelled = await harness.cancel("aihot", task.task_id);
  assert.equal(cancelled.cancellation, "requested"); assert.notEqual(cancelled.state, "cancelled");
  completed = true; await harness.reconcile("aihot", task.task_id);
  const result = harness.result("aihot", task.task_id, { source_binding: task.source_binding, profile_fingerprint: task.profile_fingerprint });
  assert.equal(result.state, "succeeded"); assert.equal(result.review_required, true);
  assert.equal(result.candidate!.usage.input_tokens, 3); assert.equal(result.candidate!.usage.total_tokens, null); assert.equal(result.candidate!.usage.reported_cost, null);
  assert.equal(calls.filter(call => call === "POST /session").length, 1); assert.equal(evidence.length, 1);
});

test("unknown OpenCode creation is never followed by another create or fallback", async () => {
  let attempts = 0;
  const transport: FakeOpenCodeTransport = { mode: "fake", async request() { attempts++; throw new Error("synthetic connection outcome unknown"); } };
  const harness = create(() => new MockOpenCodeExecutor(transport, () => "msg_original", () => {}));
  const task = harness.submit(input()); await harness.dispatch("aihot", task.task_id); await harness.dispatch("aihot", task.task_id); await harness.reconcile("aihot", task.task_id);
  assert.equal(attempts, 1); assert.equal(harness.status("aihot", task.task_id).state, "unknown");
});

test("two attempts cannot share one OpenCode session and cancel each other's work", async () => {
  let prompts = 0; let aborts = 0;
  const transport: FakeOpenCodeTransport = { mode: "fake", async request(_method, path) {
    if (path === "/session") return { status: 200, body: { id: "same-session" } };
    if (path.endsWith("/prompt_async")) { prompts++; return { status: 204, body: null }; }
    if (path.endsWith("/abort")) aborts++;
    return { status: 200, body: true };
  } };
  const executor = new MockOpenCodeExecutor(transport, task => `message-${task.task_id}`, () => {});
  const harness = create(() => executor); const first = harness.submit(input()); await harness.dispatch("aihot", first.task_id);
  const second = harness.submit({ ...input(), task_id: "second", original_task_id: "second-original", idempotency_key: "second-key" });
  await harness.dispatch("aihot", second.task_id); await harness.cancel("aihot", second.task_id);
  assert.equal(harness.status("aihot", second.task_id).state, "unknown"); assert.equal(prompts, 1); assert.equal(aborts, 0);
});

test("OpenCode status refusal stops at that request instead of querying another endpoint", async () => {
  const calls: string[] = [];
  const transport: FakeOpenCodeTransport = { mode: "fake", async request(_method, path) {
    calls.push(path);
    if (path === "/session") return { status: 200, body: { id: "ses_fixture" } };
    if (path.endsWith("/prompt_async")) return { status: 204, body: null };
    return { status: 403, body: "not retained" };
  } };
  const harness = create(() => new MockOpenCodeExecutor(transport, () => "msg_original", () => {}));
  const task = harness.submit(input()); await harness.dispatch("aihot", task.task_id); await harness.reconcile("aihot", task.task_id); await harness.reconcile("aihot", task.task_id);
  assert.equal(harness.status("aihot", task.task_id).state, "failed");
  assert.deepEqual(calls, ["/session", "/session/ses_fixture/prompt_async", "/session/status"]);
});

test("OpenCode rejects mismatched actual models rather than claiming requested-model execution", async () => {
  const transport: FakeOpenCodeTransport = { mode: "fake", async request(_method, path) {
    if (path === "/session") return { status: 200, body: { id: "ses_fixture" } };
    if (path.endsWith("/prompt_async")) return { status: 204, body: null };
    return { status: 200, body: [{ info: { id: "a", role: "assistant", parentID: "msg_original", providerID: "other", modelID: "other", time: { completed: 10 } }, parts: [] }] };
  } };
  const harness = create(() => new MockOpenCodeExecutor(transport, () => "msg_original", () => {}));
  const task = harness.submit(input()); await harness.dispatch("aihot", task.task_id); await harness.reconcile("aihot", task.task_id);
  assert.equal(harness.status("aihot", task.task_id).error!.code, "opencode_model_mismatch");
});

test("AIHOT adapter passes the task abort signal to existing chatJson and binds its profile identity in receipts", async () => {
  const selected: Profile = { ...profile, kind: "model_api", protocol: "openai_chat_completions", endpoint: "https://fixture.invalid/v1", auth: { mode: "bearer_ref", secret_ref: "env:REFERENCE_ONLY" } };
  let captured: Parameters<typeof chatJson>[0] | undefined;
  const invoke = (async (options: Parameters<typeof chatJson>[0]) => { captured = options; return { data: { summary: "Synthetic summary." }, receiptId: 123, reused: false, model: "registered", usage: null }; }) as typeof chatJson;
  const executor = createAIhotExecutor(() => ({ model_key: "registered", model: selected.model, endpoint: selected.endpoint, secret_ref: selected.auth.secret_ref!, budget_policy_ref: selected.budget_policy_ref }), invoke, async () => ({ state: "unknown" }));
  const harness = create(() => executor, selected); const task = harness.submit(input()); await harness.dispatch("aihot", task.task_id);
  assert.equal(captured!.promptVersion, `selectable-api/0.1:${task.identity}`); assert.ok(captured!.signal instanceof AbortSignal);
  assert.equal(captured!.fallbackModel, undefined); assert.equal(harness.status("aihot", task.task_id).candidate!.usage.reported_cost, null);
});

test("module facade uses injected original guard/host, rejects visitors, exposes no profile/input in status", async t => {
  const harness = create(() => new MockExecutor()); const app = Fastify(); let accepted = 0;
  registerHarnessRoutes(app, harness, handler => async (req, reply) => {
    if (req.headers["x-test-owner"] !== "synthetic") return reply.code(401).send({ error: "unauthorized" });
    return handler(req, reply);
  }, async task => { accepted++; return task; });
  t.after(() => app.close());
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/agent-harness/tasks", payload: input() })).statusCode, 401);
  const headers = { "x-test-owner": "synthetic" };
  const submitted = await app.inject({ method: "POST", url: "/api/admin/agent-harness/tasks", headers, payload: input() });
  assert.equal(submitted.statusCode, 200); assert.equal(accepted, 1);
  const status = (await app.inject({ method: "GET", url: "/api/admin/agent-harness/aihot/original-attempt/status", headers })).json();
  assert.equal(status.state, "accepted"); assert.equal(status.input, undefined); assert.equal(status.profile_snapshot, undefined);
  const cancelled = (await app.inject({ method: "POST", url: "/api/admin/agent-harness/aihot/original-attempt/cancel", headers })).json();
  assert.equal(cancelled.state, "cancelled"); assert.equal(cancelled.cancellation, "confirmed");
});
