import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { Harness, canonical, emptyUsage, normalizeEndpoint, profileFingerprint, registerProfiles, type Executor, type Host, type Profile, type Submit, type Task } from "../backend/core.ts";
import { MockExecutor, syntheticOutcome } from "../backend/mock.ts";
import { LoopbackChatExecutor } from "../backend/loopback.ts";

const profile: Profile = { profile_id: "local", kind: "model_api", protocol: "openai_chat_completions", provider: "synthetic", model: "mock-model", endpoint: "http://127.0.0.1:12345/v1",
  auth: { mode: "none", secret_ref: null }, budget_policy_ref: "existing:llm", network_policy_ref: "test-loopback" };
function setup<E extends Executor = MockExecutor>(executor: E = new MockExecutor() as unknown as E, restored: Task[] = [], selected = profile, limits?: { timeout_ms: number; max_queries: number }) {
  let saved: Task[] = [];
  let authorized = 0;
  const profiles = registerProfiles([selected], { "test-loopback": { endpoints: [selected.endpoint], loopback_no_auth: true } });
  const host: Host = { executor: () => executor, persist: tasks => { saved = structuredClone([...tasks]); }, authorize: () => { authorized++; }, claim: () => true, cancelAccepted: () => true };
  return { harness: new Harness(profiles, host, restored, limits), executor, saved: () => saved, authorized: () => authorized, host, profiles };
}
const input = (patch: Partial<Submit> = {}): Submit => ({ project: "aihot", task_id: "original-attempt-1", original_task_id: "editorial-attempt-1", idempotency_key: "once-1", profile_id: "local", role: "summary", source_binding: { revision: "source-v1", config: "editorial-v1" }, input: { text: "A synthetic company announced a test product.", source_url: "https://example.invalid/source", source_date: "2026-10-26" }, ...patch });

test("canonical identity is sorted UTF-8 with safe integers and no Unicode normalization", () => {
  assert.equal(canonical({ z: [null, true, "中文"], a: 42 }), '{"a":42,"z":[null,true,"中文"]}');
  for (const value of [1.2, 2 ** 53, NaN, undefined, { 非ASCII: 1 }, Array(1)]) assert.throws(() => canonical(value));
  assert.notEqual(canonical("é"), canonical("e\u0301"));
});

test("profiles preserve endpoint path/percent case, reject aliases and never accept task URLs", () => {
  assert.equal(normalizeEndpoint("HTTPS://Example.COM:443/V1/%2f/"), "https://example.com/V1/%2f");
  const a = setup().profiles.get("local")!;
  assert.equal(profileFingerprint(a), profileFingerprint({ ...a, endpoint: "HTTP://127.0.0.1:12345/v1/" }));
  assert.notEqual(profileFingerprint(a), profileFingerprint({ ...a, endpoint: a.endpoint + "/other" }));
  for (const endpoint of ["http://localhost:12345/v1", "http://192.168.1.2/v1", "https://key:secret@example.com/v1", "https://example.com/v1?key=x", "http://127.0.0.1/v1/chat/completions"]) assert.throws(() => setup(new MockExecutor(), [], { ...profile, endpoint }));
  assert.throws(() => setup().harness.submit({ ...input(), endpoint: profile.endpoint } as Submit));
  assert.throws(() => setup().harness.submit(input({ profile_id: "unknown" })));
});

test("submit binds original business identity, project, source and profile without resubmission", async () => {
  const s = setup();
  const first = s.harness.submit(input());
  assert.deepEqual(s.harness.submit(input()), first);
  assert.equal(s.harness.submit(input({ task_id: "new-uuid", idempotency_key: "new-key" })).task_id, first.task_id);
  for (const patch of [{ input: { text: "different" } }, { source_binding: { revision: "v2" } }, { role: "translate" }]) assert.throws(() => s.harness.submit(input(patch)));
  assert.throws(() => s.harness.status("csm", first.task_id));
  s.harness.submit(input({ project: "csm" }));
  await s.harness.dispatch("aihot", first.task_id);
  await s.harness.dispatch("aihot", first.task_id);
  assert.deepEqual(s.executor.submitted, [first.task_id]);
  assert.equal(s.harness.result("aihot", first.task_id, { source_binding: input().source_binding, profile_fingerprint: first.profile_fingerprint }).eligible, true);
  assert.equal(s.harness.result("aihot", first.task_id, { source_binding: { revision: "new" }, profile_fingerprint: first.profile_fingerprint }).candidate, null);
});

test("atomic cancellation before dispatch sends nothing and releases no invented cost", async () => {
  const s = setup(); const task = s.harness.submit(input());
  const cancelled = await s.harness.cancel("aihot", task.task_id);
  assert.equal(cancelled.state, "cancelled"); assert.equal(cancelled.cancellation, "confirmed");
  await s.harness.dispatch("aihot", task.task_id);
  assert.equal(s.executor.submitted.length, 0); assert.equal(s.authorized(), 0);
  assert.equal(cancelled.candidate, null);
});

test("original budget/network authority can stop before sending, without exposing its private error", async () => {
  const s = setup(); s.host.authorize = () => { throw new Error("private reservation detail"); };
  const task = s.harness.submit(input()); const result = await s.harness.dispatch("aihot", task.task_id);
  assert.equal(result.state, "failed"); assert.equal(result.error!.certainty, "NOT_SENT");
  assert.equal(result.error!.code, "owner_stopped_before_dispatch"); assert.equal(s.executor.submitted.length, 0);
});

test("inflight cancellation remains requested and racing success remains a review candidate", async () => {
  let finish!: (value: Awaited<ReturnType<MockExecutor["submit"]>>) => void;
  const executor = new MockExecutor(() => new Promise(resolve => { finish = resolve; }));
  const s = setup(executor); const task = s.harness.submit(input());
  const running = s.harness.dispatch("aihot", task.task_id); await Promise.resolve();
  const cancellation = await s.harness.cancel("aihot", task.task_id);
  assert.equal(cancellation.state, "running"); assert.equal(cancellation.cancellation, "requested");
  finish({ state: "succeeded", outcome: syntheticOutcome(task) }); await running;
  assert.equal(s.harness.status("aihot", task.task_id).state, "succeeded");
  assert.equal(s.harness.status("aihot", task.task_id).cancellation, "requested");
  assert.equal(s.harness.result("aihot", task.task_id, { source_binding: task.source_binding, profile_fingerprint: task.profile_fingerprint }).review_required, true);
});

test("timeout is unknown, late output is retained, query original confirms it without replay", async () => {
  let finish!: (value: Awaited<ReturnType<MockExecutor["submit"]>>) => void;
  const executor = new MockExecutor(() => new Promise(resolve => { finish = resolve; }));
  const s = setup(executor, [], profile, { timeout_ms: 10, max_queries: 1 });
  const task = s.harness.submit(input()); await s.harness.dispatch("aihot", task.task_id);
  assert.equal(s.harness.status("aihot", task.task_id).state, "unknown");
  finish({ state: "succeeded", outcome: syntheticOutcome(task) }); await new Promise(resolve => setImmediate(resolve));
  const saved = s.harness.status("aihot", task.task_id);
  assert.ok(saved.candidate); assert.equal(saved.state, "unknown");
  assert.equal(s.harness.result("aihot", task.task_id, { source_binding: task.source_binding, profile_fingerprint: task.profile_fingerprint }).candidate, null);
  executor.next = { state: "succeeded", outcome: saved.candidate! };
  await s.harness.reconcile("aihot", task.task_id); await s.harness.dispatch("aihot", task.task_id);
  assert.equal(s.harness.status("aihot", task.task_id).state, "succeeded");
  assert.equal(executor.submitted.length, 1); assert.deepEqual(executor.queried, [saved.upstream_ref]);
  assert.deepEqual(saved.candidate!.usage, emptyUsage());
});

test("cold restart changes running to unknown, preserves identity and only queries original", async () => {
  const executor = new MockExecutor(async () => ({ state: "running" }));
  const s = setup(executor); const task = s.harness.submit(input()); await s.harness.dispatch("aihot", task.task_id);
  const restored = setup(executor, JSON.parse(JSON.stringify(s.saved())));
  assert.equal(restored.harness.status("aihot", task.task_id).state, "unknown");
  assert.equal(restored.harness.status("aihot", task.task_id).identity, task.identity);
  await restored.harness.dispatch("aihot", task.task_id);
  await restored.harness.reconcile("aihot", task.task_id); await restored.harness.reconcile("aihot", task.task_id); await restored.harness.reconcile("aihot", task.task_id);
  assert.equal(executor.submitted.length, 1); assert.equal(executor.queried.length, 2);
  assert.throws(() => setup(executor, s.saved(), { ...profile, model: "changed" }));
});

test("a late bounded query retains evidence without silently adopting it", async () => {
  let answer!: (value: Awaited<ReturnType<MockExecutor["status"]>>) => void;
  const executor = new MockExecutor(async () => ({ state: "running" }));
  executor.status = async () => new Promise(resolve => { answer = resolve; });
  const s = setup(executor, [], profile, { timeout_ms: 10, max_queries: 1 });
  const task = s.harness.submit(input()); await s.harness.dispatch("aihot", task.task_id); await s.harness.reconcile("aihot", task.task_id);
  answer({ state: "succeeded", outcome: syntheticOutcome(task) }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(s.harness.status("aihot", task.task_id).state, "unknown"); assert.ok(s.harness.status("aihot", task.task_id).candidate);
  assert.equal(s.harness.result("aihot", task.task_id, { source_binding: task.source_binding, profile_fingerprint: task.profile_fingerprint }).eligible, false);
});

test("uncertain original atomic cancellation cannot leave accepted work dispatchable", async () => {
  const s = setup(); s.host.cancelAccepted = () => false;
  const task = s.harness.submit(input()); await s.harness.cancel("aihot", task.task_id); await s.harness.dispatch("aihot", task.task_id);
  assert.equal(s.harness.status("aihot", task.task_id).state, "unknown"); assert.equal(s.executor.submitted.length, 0);
});

for (const status of [401, 403, 429, 503]) test(`HTTP ${status} preserves stop/unknown evidence without retry or fallback`, async () => {
  const executor = new MockExecutor(async () => ({ state: "failed", code: `provider_http_${status}`, upstream_http_status: status }));
  const s = setup(executor); const task = s.harness.submit(input()); await s.harness.dispatch("aihot", task.task_id); await s.harness.dispatch("aihot", task.task_id);
  const result = s.harness.status("aihot", task.task_id);
  assert.equal(result.state, status >= 500 ? "unknown" : "failed");
  assert.equal(result.error!.retry_disposition, status >= 500 ? "query_original" : "stop");
  assert.equal(result.error!.upstream_http_status, status); assert.equal(executor.submitted.length, 1);
  assert.equal(result.error!.usage_source, null);
});

test("literal-loopback mock endpoint receives selected model once and no Authorization", async t => {
  let hits = 0;
  const server = createServer(async (req, res) => {
    hits++; assert.equal(req.url, "/v1/chat/completions"); assert.equal(req.headers.authorization, undefined);
    let body = ""; for await (const chunk of req) body += chunk;
    assert.equal(JSON.parse(body).model, "mock-model");
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: "An original synthetic summary." } }], usage: { prompt_tokens: 7 } }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const port = (server.address() as import("node:net").AddressInfo).port;
  const selected = { ...profile, endpoint: `http://127.0.0.1:${port}/v1` };
  const s = setup(new LoopbackChatExecutor(), [], selected);
  const task = s.harness.submit(input()); await s.harness.dispatch("aihot", task.task_id);
  const result = s.harness.result("aihot", task.task_id, { source_binding: task.source_binding, profile_fingerprint: task.profile_fingerprint });
  assert.equal(result.state, "succeeded"); assert.equal(hits, 1);
  const candidate = result.candidate!; assert.equal(candidate.usage.input_tokens, 7); assert.equal(candidate.usage.output_tokens, null); assert.equal(candidate.usage.total_tokens, null); assert.equal(candidate.usage.reported_cost, null);
  assert.equal((candidate.output as { source_url: string }).source_url, "https://example.invalid/source");
});
