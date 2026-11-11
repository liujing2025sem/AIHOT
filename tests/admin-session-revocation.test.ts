import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import Fastify from "fastify";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { sha256 } from "@aihot/backend/lib/ids";
import { completeLogin, endSession, loginRedirect, passwordLogin, SESSION_COOKIE, sessionPrincipal } from "@aihot/backend/admin/auth";
import { adminHandler, registerAdminAuth } from "../apps/api/src/routes/admin-auth.ts";

const T = tag();
const PASSWORD_A = `test-password-a-${T}`;
const PASSWORD_B = `test-password-b-${T}`;
const SECRET_A = `test-session-secret-a-${T}`;
const SECRET_B = `test-session-secret-b-${T}`;
const APP = `test-login-app-${T}`;
const original = { username: config.adminUsername, password: config.adminPassword, unions: config.adminUnionIds, emails: config.adminEmails, dev: config.devAdmin, environment: config.environmentName, siteUrl: config.siteUrl };
const envKeys = ["SESSION_SECRET", "FEISHU_LOGIN_APP_ID", "FEISHU_LOGIN_APP_SECRET"];
const oldEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
let profile: { union_id?: string; email?: string; enterprise_email?: string; name?: string } = {};
const oauth = await stub(async (_hit, req) => {
  if (req.url.endsWith("/token")) {
    const body = new URLSearchParams(req.body);
    assert.equal(body.get("client_id"), APP);
    assert.equal(body.get("client_secret"), "test-login-secret");
    return { access_token: "fictional-access-token" };
  }
  assert.ok(req.url.endsWith("/userinfo"));
  return profile;
});
// Production trusts its proxy, so req.protocol reads X-Forwarded-Proto.
const app = Fastify({ logger: false, trustProxy: true });
registerAdminAuth(app);
let writes = 0;
app.post("/api/admin/session-test", adminHandler(async () => ({ writes: ++writes })));
let base = "";
const realFetch = globalThis.fetch;
// OAuth 请求仅转发到本地假服务；测试之外的网络目的地一律拒绝。
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === base) return realFetch(input, init);
  assert.equal(url.origin, "https://passport.feishu.cn");
  return realFetch(`${oauth.url}${url.pathname}${url.search}`, init);
}) as typeof fetch;
const cookie = (token: string) => `${SESSION_COOKIE}=${token}`;
async function password(password = PASSWORD_A) {
  return (await passwordLogin(password, "/admin", "synthetic-agent")).token;
}
async function federated(claims = profile) {
  profile = claims;
  const redirect = loginRedirect("/admin");
  const state = new URL(redirect.url).searchParams.get("state")!;
  const login = await completeLogin("synthetic-code", state, redirect.stateCookie, "synthetic-agent");
  return login.token;
}
async function request(path: string, token: string, csrf?: string) {
  return realFetch(`${base}${path}`, { method: csrf === undefined ? "GET" : "POST",
    headers: { cookie: cookie(token), ...(csrf === undefined ? {} : { "x-csrf-token": csrf }) }, redirect: "manual" });
}
async function principal(token: string) {
  const response = await request("/api/admin/me", token);
  assert.equal(response.status, 200);
  return await response.json() as { csrf: string; dev: boolean; name: string };
}
async function revoked(token: string, csrf = "old-csrf") {
  const before = writes;
  assert.equal((await request("/api/auth/check", token)).status, 401);
  assert.equal((await request("/api/admin/me", token)).status, 401);
  assert.equal((await request("/api/admin/session-test", token, csrf)).status, 401);
  assert.equal(writes, before);
  assert.equal(await sessionPrincipal(cookie(token)), null);
}
async function exists(token: string) {
  return (await sql`SELECT 1 FROM admin_sessions WHERE id_hash=${sha256(token)}`).length > 0;
}

before(async () => {
  base = await app.listen({ host: "127.0.0.1", port: 0 });
});
beforeEach(() => {
  config.adminUsername = null;
  config.adminPassword = PASSWORD_A;
  config.adminUnionIds = [];
  config.adminEmails = [];
  config.devAdmin = null;
  config.environmentName = "development";
  process.env.SESSION_SECRET = SECRET_A;
  process.env.FEISHU_LOGIN_APP_ID = APP;
  process.env.FEISHU_LOGIN_APP_SECRET = "test-login-secret";
  profile = {};
});
after(async () => {
  globalThis.fetch = realFetch;
  await app.close(); await oauth.close();
  config.adminUsername = original.username; config.adminPassword = original.password; config.adminUnionIds = original.unions; config.adminEmails = original.emails;
  config.devAdmin = original.dev; config.environmentName = original.environment; config.siteUrl = original.siteUrl;
  for (const [key, value] of oldEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  await closeDb();
});

test("effective password replacement revokes old cookies at actual read/write/check guards", async () => {
  const token = await password();
  const me = await principal(token);
  assert.equal((await request("/api/auth/check", token)).status, 204);
  assert.equal((await request("/api/admin/session-test", token, me.csrf)).status, 200);
  config.adminPassword = PASSWORD_B;
  const before = writes;
  assert.equal((await request("/api/admin/session-test", token, me.csrf)).status, 401, "the write guard itself observes credential revocation");
  assert.equal(writes, before);
  await revoked(token, me.csrf);
  assert.equal(await exists(token), false);
  const fresh = await password(PASSWORD_B);
  assert.equal((await request("/api/auth/check", fresh)).status, 204);
  await assert.rejects(passwordLogin(PASSWORD_A, "/admin", undefined));
  config.adminPassword = PASSWORD_A;
  await revoked(token, me.csrf);
});

for (const next of [null, "short"]) test(`password ${next === null ? "removal" : "invalid-short config"} revokes existing sessions`, async () => {
  const token = await password();
  config.adminPassword = next;
  await revoked(token);
  assert.equal(await exists(token), false);
});

test("unchanged sessions preserve CSRF, and neither the password nor the token is stored", async () => {
  const token = await password();
  const me = await principal(token);
  const options = await (await realFetch(`${base}/api/auth/options`)).json() as { usernameRequired: boolean };
  assert.equal(options.usernameRequired, false, "existing deployments still accept password-only sign-in");
  assert.equal((await principal(token)).csrf, me.csrf);
  assert.equal((await request("/api/admin/session-test", token, "wrong")).status, 403);
  assert.equal((await request("/api/admin/session-test", token, me.csrf)).status, 200);
  const rows = await sql`SELECT * FROM admin_sessions`;
  assert.ok(rows.length > 0 && !JSON.stringify(rows).includes(PASSWORD_A) && !JSON.stringify(rows).includes(token));
});

test("configured account name is enforced by the form endpoint and an eleven-character test password works", async () => {
  config.adminUsername = "editor-test";
  config.adminPassword = "qa-pass-123";
  assert.equal(config.adminPassword.length, 11);
  const options = await realFetch(`${base}/api/auth/options`);
  assert.equal(options.headers.get("cache-control"), "no-store");
  const body = await options.json() as Record<string, unknown>;
  assert.equal(body.usernameRequired, true);
  assert.equal(body.password, true);
  assert.equal(JSON.stringify(body).includes(config.adminUsername), false);
  assert.equal(JSON.stringify(body).includes(config.adminPassword), false);
  const login = (fields: Record<string, string>) => realFetch(`${base}/api/auth/password`, {
    method: "POST", redirect: "manual", body: new URLSearchParams({ return: "/admin/studio", ...fields }),
    headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "198.51.100.21" },
  });
  const [before] = await sql`SELECT count(*)::int AS n FROM admin_sessions`;
  const rejectedFields: Record<string, string>[] = [
    { password: config.adminPassword },
    { username: "Editor-test", password: config.adminPassword },
    { username: config.adminUsername, password: "wrong-test-password" },
  ];
  for (const fields of rejectedFields) {
    const rejected = await login(fields);
    assert.equal(rejected.status, 303);
    assert.equal(new URL(rejected.headers.get("location")!, base).searchParams.get("error"), "wrong");
    assert.equal(rejected.headers.getSetCookie().length, 0);
  }
  const [after] = await sql`SELECT count(*)::int AS n FROM admin_sessions`;
  assert.equal(after.n, before.n, "a password alone cannot create a named-account session");
  const accepted = await login({ username: config.adminUsername, password: config.adminPassword });
  assert.equal(accepted.status, 303);
  assert.equal(accepted.headers.get("location"), "/admin/studio");
  const header = accepted.headers.getSetCookie().find(line => line.startsWith(`${SESSION_COOKIE}=`))!;
  assert.ok(header);
  const token = decodeURIComponent(header.split(";")[0].slice(SESSION_COOKIE.length + 1));
  const me = await principal(token);
  assert.equal(me.name, config.adminUsername);
  assert.equal((await request("/api/admin/session-test", token, "wrong")).status, 403);
  assert.equal((await request("/api/admin/session-test", token, me.csrf)).status, 200);
  config.adminPassword = "qa-pass-12";
  await assert.rejects(passwordLogin(config.adminPassword, "/admin", undefined, config.adminUsername), /至少 11 位/);
  await revoked(token);
});

test("account-name configuration changes revoke prior password sessions", async () => {
  const legacy = await password();
  config.adminUsername = "editor-test";
  await revoked(legacy);
  await assert.rejects(passwordLogin(PASSWORD_A, "/admin", undefined), /账户名或密码/);
  const named = (await passwordLogin(PASSWORD_A, "/admin", undefined, "editor-test")).token;
  await principal(named);
  config.adminUsername = "replacement-editor";
  await revoked(named);
  config.adminUsername = "editor-test";
  await revoked(named);
  const replacement = (await passwordLogin(PASSWORD_A, "/admin", undefined, "editor-test")).token;
  config.adminUsername = null;
  await revoked(replacement);
  await principal(await password());
});

test("changing attempted account names does not reset the existing login attempt limit", async () => {
  config.adminUsername = "editor-test";
  for (let i = 0; i <= 10; i++) {
    const response: Response = await realFetch(`${base}/api/auth/password`, {
      method: "POST", redirect: "manual",
      body: new URLSearchParams({ username: i === 10 ? config.adminUsername : `wrong-editor-${i}`, password: PASSWORD_A }),
      headers: { "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "198.51.100.22" },
    });
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get("location")!, base).searchParams.get("error"), i === 10 ? "too-many" : "wrong");
    assert.equal(response.headers.getSetCookie().length, 0);
  }
});

test("Feishu original union or normalized email remains authorized under OR semantics", async () => {
  const union = `union-or-${T}`; const email = `person-${T}@example.test`;
  config.adminUnionIds = [union]; config.adminEmails = [email];
  const token = await federated({ union_id: union, enterprise_email: email.toUpperCase(), email: "unused@example.test" });
  const before = oauth.hits();
  config.adminUnionIds = [];
  await principal(token);
  config.adminUnionIds = [union]; config.adminEmails = [];
  await principal(token);
  assert.equal(oauth.hits(), before, "session checks never contact the identity provider");
  config.adminUnionIds = [];
  await revoked(token);
  assert.equal(await exists(token), false);
  config.adminUnionIds = [union];
  await revoked(token);
});

test("a coalesced older profile email cannot keep a newly verified identity authorized", async () => {
  const union = `union-stale-${T}`; const oldEmail = `old-${T}@example.test`; const newEmail = `new-${T}@example.test`;
  const [user] = await sql<{ id: number }[]>`INSERT INTO admin_users(feishu_union_id,email) VALUES(${union},${oldEmail}) RETURNING id`;
  config.adminUnionIds = [union];
  const token = await federated({ union_id: union, email: newEmail });
  const [profileRow] = await sql<{ email: string }[]>`SELECT email FROM admin_users WHERE id=${user!.id}`;
  assert.equal(profileRow!.email, oldEmail);
  config.adminUnionIds = []; config.adminEmails = [oldEmail];
  await revoked(token);
});

test("new profile claims cannot replace the original verified session claims", async () => {
  const email = `original-${T}@example.test`; const replacement = `replacement-${T}@example.test`;
  config.adminEmails = [email];
  const token = await federated({ email });
  await sql`UPDATE admin_users SET email=${replacement} WHERE email=${email}`;
  config.adminEmails = [replacement];
  await revoked(token);
});

test("password and Feishu sessions sharing admin@local retain independent authority", async () => {
  const passwordToken = await password();
  config.adminEmails = ["admin@local"];
  const feishuToken = await federated({ union_id: `union-shared-${T}`, email: "admin@local" });
  const [pw] = await sql<{ user_id: number }[]>`SELECT user_id FROM admin_sessions WHERE id_hash=${sha256(passwordToken)}`;
  const [fs] = await sql<{ user_id: number }[]>`SELECT user_id FROM admin_sessions WHERE id_hash=${sha256(feishuToken)}`;
  assert.equal(pw!.user_id, fs!.user_id);
  config.adminPassword = PASSWORD_B;
  await revoked(passwordToken);
  await principal(feishuToken);
  const freshPassword = await password(PASSWORD_B);
  config.adminEmails = [];
  await revoked(feishuToken);
  await principal(freshPassword);
});

for (const change of ["app ID", "missing ID", "missing secret"]) test(`Feishu ${change} revokes only federated sessions`, async () => {
  const pw = await password();
  const email = `${change.replaceAll(" ", "-").toLowerCase()}-${T}@example.test`;
  config.adminEmails = [email];
  const fs = await federated({ email });
  if (change === "app ID") process.env.FEISHU_LOGIN_APP_ID = APP + "-replacement";
  if (change === "missing ID") delete process.env.FEISHU_LOGIN_APP_ID;
  if (change === "missing secret") delete process.env.FEISHU_LOGIN_APP_SECRET;
  await revoked(fs); await principal(pw);
});

test("Feishu app-secret-only rotation preserves same-app authorized sessions", async () => {
  const email = `secret-rotation-${T}@example.test`; config.adminEmails = [email];
  const token = await federated({ email });
  process.env.FEISHU_LOGIN_APP_SECRET = "test-replacement-secret";
  await principal(token);
});

for (const next of [SECRET_B, ""]) test(`session-secret ${next ? "rotation" : "removal"} revokes both methods`, async () => {
  const pw = await password();
  const email = `both-${next ? "rotate" : "remove"}-${T}@example.test`; config.adminEmails = [email];
  const fs = await federated({ email });
  process.env.SESSION_SECRET = next;
  await revoked(pw); await revoked(fs);
});

test("legacy unbound sessions fail closed and are deleted", async () => {
  const valid = await password();
  const [user] = await sql<{ user_id: number }[]>`SELECT user_id FROM admin_sessions WHERE id_hash=${sha256(valid)}`;
  const token = randomBytes(32).toString("base64url");
  await sql`INSERT INTO admin_sessions(id_hash,user_id,csrf_token,expires_at) VALUES(${sha256(token)},${user!.user_id},'legacy-csrf',now()+interval '1 day')`;
  await revoked(token, "legacy-csrf");
  assert.equal(await exists(token), false);
  await principal(valid);
});

test("malformed bindings and Feishu claims fail closed", async () => {
  for (const binding of [null, "not-a-binding", "0".repeat(64)]) {
    const token = await password();
    await sql`UPDATE admin_sessions SET auth_binding=${binding} WHERE id_hash=${sha256(token)}`;
    await revoked(token); assert.equal(await exists(token), false);
  }
  for (const claims of [null, {}, { appId: APP, unionId: 42, email: "admin@local" }, { appId: APP, unionId: null, email: [] }]) {
    config.adminEmails = ["admin@local"];
    const token = await federated({ email: "admin@local" });
    await sql`UPDATE admin_sessions SET auth_claims=${claims === null ? null : sql.json(claims as never)} WHERE id_hash=${sha256(token)}`;
    await revoked(token); assert.equal(await exists(token), false);
  }
});

test("expiry, unknown token, logout isolation and explicit development mode retain their guards", async () => {
  const one = await password(); const two = await password();
  await endSession(cookie(one)); await revoked(one); await principal(two);
  await sql`UPDATE admin_sessions SET expires_at=now()-interval '1 second' WHERE id_hash=${sha256(two)}`;
  await revoked(two); await revoked("unknown-test-token");
  config.devAdmin = { displayName: "Synthetic developer" };
  assert.equal((await sessionPrincipal(undefined))!.dev, true);
  assert.equal((await request("/api/auth/check", "unknown")).status, 401);
  config.environmentName = "production";
  assert.equal(await sessionPrincipal(undefined), null);
});

test("the session cookie is Secure only when the request itself is HTTPS, whatever SITE_URL says", async () => {
  config.siteUrl = "https://example.test";
  const sessionCookie = async (path: string, headers: Record<string, string>) => {
    const res = await realFetch(`${base}${path}`, { method: "POST", redirect: "manual", body: `password=${encodeURIComponent(PASSWORD_A)}`,
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers } });
    assert.equal(res.status, 303);
    return res.headers.getSetCookie().find((line) => line.startsWith(`${SESSION_COOKIE}=`))!;
  };
  // A browser drops a Secure cookie on a plain-HTTP page (a LAN address, a published container port).
  assert.doesNotMatch(await sessionCookie("/api/auth/password", {}), /;\s*Secure\b/);
  assert.match(await sessionCookie("/api/auth/password", { "x-forwarded-proto": "https" }), /;\s*Secure\b/);
  assert.doesNotMatch(await sessionCookie("/api/auth/logout", {}), /;\s*Secure\b/);
  assert.match(await sessionCookie("/api/auth/logout", { "x-forwarded-proto": "https" }), /;\s*Secure\b/);
});
