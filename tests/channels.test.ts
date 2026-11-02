import { Reply, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { z } from "zod";
import { channelCredential, config, modelCredentialFile } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { passwordLogin, SESSION_COOKIE, sessionPrincipal } from "@aihot/backend/admin/auth";
import { GO_BASE_URL, listChannels, resolveChannel, testChannel, updateChannel } from "@aihot/backend/providers/channel";
import { chatJson } from "@aihot/backend/providers/llm";
import { registerAdminAuth } from "../apps/api/src/routes/admin-auth.ts";
import { registerAdminChannels } from "../apps/api/src/routes/admin-channels.ts";

const credentialsDir = await mkdtemp(path.join(tmpdir(), "channels-"));
const previous = { credentialsDir: config.credentialsDir, adminPassword: config.adminPassword, devAdmin: config.devAdmin, enabled: config.modelCallsEnabled };
const envNames = ["LLM_BASE_URL", "LLM_API_KEY", "LLM_MODEL", "CUSTOM_OPENAI_API_KEY", "OPENCODE_GO_API_KEY", "DEEPSEEK_API_KEY"];
const oldEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
config.credentialsDir = credentialsDir;
config.adminPassword = "synthetic-channel-admin-password";
config.devAdmin = null;
config.modelCallsEnabled = true;
const KEY = "synthetic-channel-secret-123456789";
let status = 200;
let malformed = false;
const seen: Array<{ endpoint: string; model: string; key: string | undefined }> = [];
const provider = await stub((_hit, req) => {
  if (req.url.endsWith("/models")) {
    if (status !== 200) return new Reply(status, { error: { message: `upstream refused Bearer ${KEY}` } });
    return malformed ? { message: "not a list" } : { data: [{ id: "fake-flash" }, { id: "deepseek-v4-pro" }] };
  }
  const body = JSON.parse(req.body);
  seen.push({ endpoint: "first", model: body.model, key: req.headers.authorization });
  return { model: body.model, choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
});
const second = await stub((_hit, req) => {
  const body = JSON.parse(req.body);
  seen.push({ endpoint: "second", model: body.model, key: req.headers.authorization });
  return { model: body.model, choices: [{ message: { content: '{"ok":true}' } }] };
});
const app = Fastify({ logger: false });
registerAdminAuth(app);
registerAdminChannels(app);
const baseInput = () => ({ baseUrl: `${provider.url}/v1`, model: "fake-flash", key: KEY, enabled: true, reason: "test channel" });
const ask = (subject: string) => chatJson({ model: "default", purpose: "channel_routing_test", subject, promptVersion: "1", system: "", user: "synthetic", schema: z.object({ ok: z.boolean() }) });
async function admin() {
  const { token } = await passwordLogin(config.adminPassword!, "/admin", "test");
  const cookie = `${SESSION_COOKIE}=${token}`;
  const principal = await sessionPrincipal(cookie);
  return { cookie, "x-csrf-token": principal!.csrf };
}

beforeEach(async () => {
  status = 200; malformed = false; seen.length = 0;
  config.modelCallsEnabled = true;
  for (const name of envNames) delete process.env[name];
  await writeFile(modelCredentialFile(), "# original operator comment\nUNRELATED_SETTING=retain-me\n");
  await sql`DELETE FROM settings WHERE key='providers.channels'`;
});
after(async () => {
  await app.close(); await provider.close(); await second.close();
  config.credentialsDir = previous.credentialsDir; config.adminPassword = previous.adminPassword; config.devAdmin = previous.devAdmin; config.modelCallsEnabled = previous.enabled;
  for (const [name, value] of Object.entries(oldEnv)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  await rm(credentialsDir, { recursive: true, force: true });
  await closeDb();
});

test("lists three real channel sources, preserves the existing local Go key, and never returns it", async () => {
  await writeFile(modelCredentialFile(), `LLM_BASE_URL=${GO_BASE_URL}\nLLM_MODEL=deepseek-v4.1-flash\nLLM_API_KEY=${KEY}\n`);
  const result = await listChannels();
  assert.deepEqual(result.channels.map((c) => c.id), ["opencode-go", "deepseek", "custom"]);
  assert.equal(result.channels[0].model, "deepseek-v4.1-flash");
  assert.equal(result.channels[0].hasKey, true);
  assert.equal(result.channels[0].keySource, "credential-file");
  assert.equal(result.channels[2].hasKey, false);
  assert.equal(JSON.stringify(result).includes(KEY), false);
  assert.equal((await resolveChannel("opencode-go"))!.apiKey, KEY);
});

test("API requires a real admin and CSRF, validates channel ids, and masks saved keys", async () => {
  assert.equal((await app.inject({ url: "/api/admin/channels" })).statusCode, 401);
  assert.equal((await app.inject({ method: "PUT", url: "/api/admin/channels/custom", payload: baseInput() })).statusCode, 401);
  const headers = await admin();
  const noCsrf = { cookie: headers.cookie };
  assert.equal((await app.inject({ method: "PUT", url: "/api/admin/channels/custom", headers: noCsrf, payload: baseInput() })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/channels/custom/test", headers: noCsrf, payload: { kind: "models" } })).statusCode, 403);
  const saved = await app.inject({ method: "PUT", url: "/api/admin/channels/custom", headers, payload: { ...baseInput(), activate: true } });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.body.includes(KEY), false);
  assert.equal(saved.json().activeId, "custom");
  const read = await app.inject({ url: "/api/admin/channels", headers: noCsrf });
  assert.equal(read.statusCode, 200); assert.equal(read.body.includes(KEY), false);
  assert.equal((await app.inject({ method: "PUT", url: "/api/admin/channels/unknown", headers, payload: baseInput() })).statusCode, 400);
});

test("blank keys retain, explicit deletion shadows old environment, and existing dotenv content survives", async () => {
  await updateChannel("custom", baseInput(), "test");
  await updateChannel("custom", { key: "   ", reason: "keep" }, "test");
  assert.equal(channelCredential("CUSTOM_OPENAI_API_KEY"), KEY);
  const file = await readFile(modelCredentialFile(), "utf8");
  assert.match(file, /original operator comment/); assert.match(file, /UNRELATED_SETTING=retain-me/);
  process.env.CUSTOM_OPENAI_API_KEY = KEY;
  await updateChannel("custom", { deleteKey: true, reason: "clear" }, "test");
  assert.equal(channelCredential("CUSTOM_OPENAI_API_KEY"), null);
  assert.equal((await listChannels()).channels[2].hasKey, false);
  await assert.rejects(updateChannel("custom", { activate: true, reason: "missing key" }, "test"), /密钥/);
  const audit = await sql`SELECT before, after FROM audit_log WHERE action='channels.update'`;
  const settings = await sql`SELECT value FROM settings WHERE key='providers.channels'`;
  assert.equal(JSON.stringify([audit, settings]).includes(KEY), false);
});

test("actual chat requests follow persisted endpoint, key and model changes; receipts do not reuse across endpoints", async () => {
  await updateChannel("custom", { ...baseInput(), activate: true }, "test");
  const subject = `switch-${tag()}`;
  const first = await ask(subject);
  assert.equal(first.data.ok, true);
  await updateChannel("custom", { baseUrl: `${second.url}/v1`, reason: "switch endpoint" }, "test");
  const next = await ask(subject);
  assert.notEqual(first.receiptId, next.receiptId);
  await updateChannel("custom", { model: "other-model", key: "synthetic-replacement-key", reason: "switch model and key" }, "test");
  await ask(subject);
  assert.deepEqual(seen, [
    { endpoint: "first", model: "fake-flash", key: `Bearer ${KEY}` },
    { endpoint: "second", model: "fake-flash", key: `Bearer ${KEY}` },
    { endpoint: "second", model: "other-model", key: "Bearer synthetic-replacement-key" },
  ]);
  await updateChannel("custom", { enabled: false, reason: "disable" }, "test");
  await assert.rejects(ask(`disabled-${tag()}`), /停用/);
  await updateChannel("custom", { enabled: true, reason: "enable" }, "test");
  await updateChannel("custom", { deleteKey: true, reason: "clear active" }, "test");
  await assert.rejects(ask(`deleted-${tag()}`), /not configured/);
  assert.equal(seen.length, 3);
});

test("a fresh process reads persisted selection and credentials and sends to the selected fake provider", async () => {
  await updateChannel("custom", { ...baseInput(), activate: true }, "test");
  // Asynchronous child: the fake HTTP server in this process must keep serving requests.
  const { spawn } = await import("node:child_process");
  const code = `import { chatJson } from '@aihot/backend/providers/llm'; import { closeDb } from '@aihot/backend/db'; import { z } from 'zod';
    const r=await chatJson({model:'default',purpose:'channel_restart_test',subject:'fresh-process',promptVersion:'1',system:'',user:'test',schema:z.object({ok:z.boolean()})});
    process.stdout.write(JSON.stringify({ok:r.data.ok})); await closeDb();`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
    cwd: process.cwd(), env: { ...process.env, AIHOT_CREDENTIALS_DIR: credentialsDir, MODEL_CALLS_ENABLED: "true" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = ""; let error = "";
  child.stdout.on("data", (v) => { output += v; }); child.stderr.on("data", (v) => { error += v; });
  const exit = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
  assert.equal(exit, 0, error); assert.deepEqual(JSON.parse(output), { ok: true });
  assert.equal(output.includes(KEY), false);
  assert.deepEqual(seen, [{ endpoint: "first", model: "fake-flash", key: `Bearer ${KEY}` }]);
});

test("models tests report real success, missing model, 404, refusal and malformed response without generating", async () => {
  await updateChannel("custom", baseInput(), "test");
  const available = await testChannel("custom", { kind: "models" }, "test");
  assert.equal(available.ok, true); assert.equal(available.status, 200);
  assert.deepEqual(available.models, ["fake-flash"]);
  await updateChannel("custom", { model: "absent-model", reason: "missing" }, "test");
  const missing = await testChannel("custom", { kind: "models" }, "test");
  assert.equal(missing.ok, false); assert.equal(missing.modelAvailable, false);
  for (const code of [404, 401, 429, 503]) {
    status = code;
    const result = await testChannel("custom", { kind: "models" }, "test");
    assert.equal(result.status, code); assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(KEY), false);
    if (code === 404) assert.match(result.detail, /未提供 \/models/);
  }
  status = 200; malformed = true;
  assert.equal((await testChannel("custom", { kind: "models" }, "test")).ok, false);
  assert.equal(seen.length, 0);
});

test("a new Custom channel can save its key and fetch models before choosing a model", async () => {
  await updateChannel("custom", { ...baseInput(), model: "" }, "test");
  const result = await testChannel("custom", { kind: "models" }, "test");
  assert.equal(result.status, 200); assert.equal(result.modelAvailable, null);
  assert.deepEqual(result.models, ["fake-flash"]);
  await assert.rejects(updateChannel("custom", { activate: true, reason: "no model" }, "test"));
  assert.equal(seen.length, 0);
});

test("completion requires explicit paid confirmation, valve and idempotency; successful requests use receipts", async () => {
  await updateChannel("custom", baseInput(), "test");
  const headers = { ...await admin(), "idempotency-key": `test-${tag()}` };
  assert.equal((await app.inject({ method: "POST", url: "/api/admin/channels/custom/test", headers, payload: { kind: "completion" } })).statusCode, 400);
  config.modelCallsEnabled = false;
  const off = await testChannel("custom", { kind: "completion", confirmPaid: true }, "test", "off");
  assert.equal(off.status, null); assert.equal(seen.length, 0);
  config.modelCallsEnabled = true;
  await assert.rejects(testChannel("custom", { kind: "completion", confirmPaid: true }, "test"), /Idempotency-Key/);
  const payload = { kind: "completion", confirmPaid: true };
  const first = await app.inject({ method: "POST", url: "/api/admin/channels/custom/test", headers, payload });
  const replay = await app.inject({ method: "POST", url: "/api/admin/channels/custom/test", headers, payload });
  assert.equal(first.statusCode, 200, first.body);
  assert.equal(first.json().ok, true); assert.equal(first.json().status, 200);
  assert.equal(first.json().returnedModel, "fake-flash");
  assert.equal(first.json().receiptId, replay.json().receiptId);
  assert.equal(seen.length, 1);
  const receipts = await sql`SELECT request, response FROM receipts WHERE purpose='channel_connection_test'`;
  assert.equal(JSON.stringify(receipts).includes(KEY), false);
});

test("DeepSeek Pro, credential-bearing addresses and bad Go endpoints are not accepted", async () => {
  for (const model of ["deepseek-v4-pro", "ark/deepseek-v4-pro", "deepseek-v4.1-pro"]) {
    await assert.rejects(updateChannel("custom", { ...baseInput(), model }, "test"));
  }
  for (const baseUrl of ["https://user:password@example.test/v1", "https://example.test/v1?key=secret", "file:///tmp/key"]) {
    await assert.rejects(updateChannel("custom", { ...baseInput(), baseUrl }, "test"));
  }
  await assert.rejects(updateChannel("opencode-go", { baseUrl: `${provider.url}/v1`, reason: "incorrect Go" }, "test"), /固定/);
  await writeFile(modelCredentialFile(), `LLM_BASE_URL=${GO_BASE_URL}\nLLM_API_KEY=${KEY}\n`);
  const go = await testChannel("opencode-go", { kind: "completion", confirmPaid: true }, "test", "go");
  assert.equal(go.ok, false); assert.match(go.detail, /sessionId/);
  await updateChannel("custom", { baseUrl: GO_BASE_URL, model: "deepseek-v4.1-flash", key: KEY, reason: "custom Go" }, "test");
  const customGo = await testChannel("custom", { kind: "completion", confirmPaid: true }, "test", "custom-go");
  assert.equal(customGo.ok, false); assert.match(customGo.detail, /sessionId/);
  assert.equal(seen.length, 0);
});
