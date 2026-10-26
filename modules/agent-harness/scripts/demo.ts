// Reproducible mock-only cold-start demo. No real provider, credentials, DB, scheduler or publication.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { Harness, registerProfiles, type Host, type Profile, type Submit, type Task } from "../backend/core.ts";
import { MockExecutor } from "../backend/mock.ts";

const { values } = parseArgs({ options: { out: { type: "string" }, restore: { type: "string" } } });
const profile: Profile = { profile_id: "demo", kind: "model_api", protocol: "openai_chat_completions", provider: "synthetic-only", model: "mock-summary", endpoint: "http://127.0.0.1:12345/v1",
  auth: { mode: "none", secret_ref: null }, budget_policy_ref: "existing-owner:llm", network_policy_ref: "explicit-demo-loopback" };
const profiles = registerProfiles([profile], { "explicit-demo-loopback": { endpoints: [profile.endpoint], loopback_no_auth: true } });
const executor = new MockExecutor(async () => ({ state: "running" }));
let saved: Task[] = [];
const host: Host = { executor: () => executor, authorize: () => {}, claim: () => true, cancelAccepted: () => true, persist: tasks => { saved = structuredClone([...tasks]); } };
const restored: Task[] = values.restore ? JSON.parse(readFileSync(values.restore, "utf8")) : [];
const harness = new Harness(profiles, host, restored);
const taskInput: Submit = { project: "aihot", task_id: "synthetic-original-attempt", original_task_id: "synthetic-owner-attempt", idempotency_key: "synthetic-idempotency-key", role: "summary", profile_id: "demo",
  source_binding: { revision: "synthetic-source-v1", config: "synthetic-editorial-v1" }, input: { text: "A synthetic product was announced for review.", source_url: "https://example.invalid/source", source_date: "2026-10-26" } };
if (!values.restore) {
  harness.submit(taskInput);
  await harness.dispatch("aihot", taskInput.task_id);
} else {
  await harness.dispatch("aihot", taskInput.task_id); // Recovered UNKNOWN must NOT submit again.
  await harness.reconcile("aihot", taskInput.task_id); // Queries only the saved mock upstream reference.
}
const result = { mode: "mock-only", restored: !!values.restore, state: harness.status("aihot", taskInput.task_id).state,
  upstream_ref: harness.status("aihot", taskInput.task_id).upstream_ref, submit_calls: executor.submitted.length, query_calls: executor.queried.length,
  private_archive_received: false, production_connected: false, publication_performed: false };
if (values.out) {
  mkdirSync(values.out, { recursive: true });
  writeFileSync(path.join(values.out, "checkpoint.json"), JSON.stringify(saved, null, 2) + "\n");
  writeFileSync(path.join(values.out, "result.json"), JSON.stringify(result, null, 2) + "\n");
}
console.log(JSON.stringify(result));
