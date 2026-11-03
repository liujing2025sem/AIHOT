// Channel metadata uses settings; keys use the deployment's existing model credentials file.
import { z } from "zod";
import type { AdminChannel, AdminChannelId, AdminChannels, AdminChannelTest } from "@aihot/contracts/admin";
import { channelCredential, channelCredentialSource, config, saveChannelCredential } from "../config.ts";
import { sql } from "../db.ts";
import { audit, Conflict } from "../audit.ts";
import { sha256 } from "../lib/ids.ts";
import { assertAccepted, ModelUnavailableError, paidRequest, ProviderRejectedError } from "./receipts.ts";

export const channelIdSchema = z.enum(["opencode-go", "deepseek", "custom"]);
const modelSchema = z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/)
  .refine((value) => !/deepseek[^/]*pro/i.test(value), "DeepSeek Pro 已禁用，请使用 Flash");
const baseUrlSchema = z.string().trim().url().max(1000).transform((v) => v.replace(/\/+$/, ""))
  .refine((v) => { const u = new URL(v); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash; }, "地址需为 HTTP(S) API 根地址，不带账号、查询参数或片段");
export const channelUpdateSchema = z.object({
  baseUrl: baseUrlSchema.optional(), model: modelSchema.or(z.literal("")).optional(), enabled: z.boolean().optional(),
  key: z.string().trim().max(4096).refine((v) => !/[\r\n\0]/.test(v) && !(v.includes("'") && v.includes('"')), "密钥格式无效").optional(),
  deleteKey: z.boolean().optional(), activate: z.boolean().optional(), reason: z.string().trim().min(1).max(500),
}).strict().refine((v) => !(v.deleteKey && v.key), "不能同时设置并删除密钥");

interface ChannelConfig { id: AdminChannelId; name: string; baseUrl: string; model: string; enabled: boolean; keyRef: string }
interface ChannelSettings { activeId: AdminChannelId | null; channels: ChannelConfig[] }
export interface ResolvedChannel extends ChannelConfig { apiKey: string | null; service: string }
const SETTINGS_KEY = "providers.channels";
export const GO_BASE_URL = "https://opencode.ai/inference/go/openai/v1";

function defaults(): ChannelSettings {
  const base = channelCredential("LLM_BASE_URL") ?? "";
  const go = base.replace(/\/+$/, "") === GO_BASE_URL;
  return { activeId: null, channels: [
    { id: "opencode-go", name: "OpenCode Go", baseUrl: GO_BASE_URL, model: "deepseek-v4.1-flash", enabled: true,
      keyRef: channelCredential("OPENCODE_GO_API_KEY") ? "OPENCODE_GO_API_KEY" : go ? "LLM_API_KEY" : "OPENCODE_GO_API_KEY" },
    { id: "deepseek", name: "DeepSeek 标准 API", baseUrl: channelCredential("DEEPSEEK_BASE_URL") ?? "https://api.deepseek.com/v1",
      model: "deepseek-v4.1-flash", enabled: true, keyRef: "DEEPSEEK_API_KEY" },
    { id: "custom", name: "Custom OpenAI compatible", baseUrl: go ? "https://api.openai.com/v1" : base || "https://api.openai.com/v1",
      model: go ? "" : channelCredential("LLM_MODEL") ?? "", enabled: true,
      keyRef: channelCredential("CUSTOM_OPENAI_API_KEY") ? "CUSTOM_OPENAI_API_KEY" : !go && channelCredential("LLM_API_KEY") ? "LLM_API_KEY" : "CUSTOM_OPENAI_API_KEY" },
  ] };
}

async function readSettings(): Promise<ChannelSettings | null> {
  const [row] = await sql<{ value: ChannelSettings }[]>`SELECT value FROM settings WHERE key=${SETTINGS_KEY}`;
  return row?.value ?? null;
}

function publicChannel(c: ChannelConfig, activeId: AdminChannelId | null): AdminChannel {
  const key = channelCredential(c.keyRef);
  return { id: c.id, name: c.name, baseUrl: c.baseUrl, model: c.model, enabled: c.enabled,
    active: activeId === c.id, hasKey: !!key, maskedKey: key ? "••••••••" : null, keySource: channelCredentialSource(c.keyRef) };
}

export async function listChannels(): Promise<AdminChannels> {
  const saved = await readSettings();
  const state = saved ?? defaults();
  return { channels: state.channels.map((c) => publicChannel(c, state.activeId)), activeId: state.activeId,
    source: saved ? "settings" : "environment", modelCallsEnabled: config.modelCallsEnabled };
}

export async function setChannelCalls(enabled: boolean, actor: string) {
  const before = config.modelCallsEnabled;
  await saveChannelCredential('MODEL_CALLS_ENABLED', enabled ? 'true' : 'false');
  await audit(actor, 'channels.generation', 'channels', '管理员调整 API 生成开关', { enabled: before }, { enabled });
  return listChannels();
}

/** No cache: API and worker processes observe the same persisted selection on their next call. */
export async function resolveChannel(id?: AdminChannelId, requireModel = true): Promise<ResolvedChannel | null> {
  const state = await readSettings();
  const chosen = id ?? state?.activeId;
  if (!chosen) return null;
  const c = (state ?? defaults()).channels.find((v) => v.id === chosen);
  if (!c || !c.enabled) throw new ModelUnavailableError("所选 API 渠道已停用");
  if (requireModel || c.model) modelSchema.parse(c.model);
  validateGo(c);
  return { ...c, apiKey: channelCredential(c.keyRef), service: c.id === "deepseek" ? "deepseek" : "llm" };
}

function validateGo(c: ChannelConfig) {
  const url = new URL(c.baseUrl);
  const goAddress = url.hostname === "opencode.ai" && url.pathname.startsWith("/inference/go");
  if ((c.id === "opencode-go" || goAddress) && (c.baseUrl !== GO_BASE_URL || c.model !== "deepseek-v4.1-flash")) {
    throw Object.assign(new Error("OpenCode Go 使用固定 HTTPS 接口及 deepseek-v4.1-flash；其他兼容服务请选 Custom"), { statusCode: 400 });
  }
}

export async function updateChannel(id: AdminChannelId, input: unknown, actor: string): Promise<AdminChannels> {
  const b = channelUpdateSchema.parse(input);
  await sql.begin(async (tx) => {
    await tx`INSERT INTO settings (key, value, updated_by) VALUES (${SETTINGS_KEY}, ${tx.json(defaults() as never)}, ${actor}) ON CONFLICT (key) DO NOTHING`;
    const [row] = await tx<{ value: ChannelSettings }[]>`SELECT value FROM settings WHERE key=${SETTINGS_KEY} FOR UPDATE`;
    const state = row!.value;
    const index = state.channels.findIndex((c) => c.id === id);
    if (index < 0) throw new Conflict("渠道不存在");
    const current = state.channels[index]!;
    const before = publicChannel(current, state.activeId);
    const next = { ...current, ...(b.baseUrl !== undefined ? { baseUrl: b.baseUrl } : {}),
      ...(b.model !== undefined ? { model: b.model } : {}), ...(b.enabled !== undefined ? { enabled: b.enabled } : {}) };
    validateGo(next);
    // Validate before writing a key: failed activation must leave credentials untouched.
    if (b.activate) {
      if (!next.enabled) throw new Conflict("请先启用此渠道");
      modelSchema.parse(next.model);
      if (b.deleteKey || !(b.key || channelCredential(next.keyRef))) throw new Conflict("请先保存渠道密钥");
      state.activeId = id;
    }
    if (b.deleteKey || b.key) await saveChannelCredential(next.keyRef, b.deleteKey ? "" : b.key!);
    state.channels[index] = next;
    await tx`UPDATE settings SET value=${tx.json(state as never)}, updated_by=${actor}, updated_at=now() WHERE key=${SETTINGS_KEY}`;
    await audit(actor, "channels.update", `channel:${id}`, b.reason, before,
      { ...publicChannel(next, state.activeId), keyChanged: !!b.key, keyDeleted: !!b.deleteKey }, { db: tx });
  });
  return listChannels();
}

/** Redact even provider error text and model names: some gateways echo Authorization back. */
export function redactChannelText(text: string, key: string | null): string {
  let safe = text;
  if (key) for (const secret of [key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)]) safe = safe.split(secret).join("[REDACTED]");
  return safe.replace(/Bearer\s+[^\s"'<>]+/gi, "Bearer [REDACTED]");
}

const testSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("models") }).strict(),
  z.object({ kind: z.literal("completion"), confirmPaid: z.literal(true), sessionId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/).optional() }).strict(),
]);

export async function testChannel(id: AdminChannelId, input: unknown, actor: string, requestKey?: string): Promise<AdminChannelTest> {
  const b = testSchema.parse(input);
  const c = await resolveChannel(id, b.kind === "completion");
  const result: AdminChannelTest = { channelId: id, kind: b.kind, ok: false, status: null, model: c!.model,
    returnedModel: null, models: [], modelAvailable: null, detail: "" };
  if (!c!.apiKey) return { ...result, detail: "尚未配置密钥，未发送请求。" };
  if (b.kind === "completion" && !config.modelCallsEnabled) return { ...result, detail: "MODEL_CALLS_ENABLED=false，未发送生成请求。" };
  if (b.kind === "completion" && c!.baseUrl === GO_BASE_URL && !b.sessionId) return { ...result, detail: "OpenCode Go 需要已有任务或会话的稳定 sessionId，未发送生成请求。" };
  if (b.kind === "completion" && !requestKey) throw Object.assign(new Error("生成测试需要 Idempotency-Key"), { statusCode: 400 });
  const clean = (s: string) => redactChannelText(s, c!.apiKey);
  try {
    if (b.kind === "models") {
      const res = await fetch(`${c!.baseUrl}/models`, { headers: { authorization: `Bearer ${c!.apiKey}` }, redirect: "error", signal: AbortSignal.timeout(15_000) });
      result.status = res.status;
      if (res.status === 404) return { ...result, detail: "服务返回 HTTP 404：未提供 /models 列表；尚不能证明模型可调用，也没有执行付费生成。" };
      const body = clean(await res.text());
      if (!res.ok) return { ...result, detail: `HTTP ${res.status}: ${body.slice(0, 600)}` };
      const data = z.object({ data: z.array(z.object({ id: z.string() })) }).safeParse(JSON.parse(body));
      if (!data.success) return { ...result, detail: "HTTP 成功，但返回内容不是 OpenAI 模型列表。" };
      result.models = data.data.data.map((v) => clean(v.id)).filter((v) => !/deepseek[^/]*pro/i.test(v)).slice(0, 500);
      result.modelAvailable = c!.model ? result.models.includes(c!.model) : null;
      return { ...result, ok: result.modelAvailable === true, detail: result.modelAvailable === null ? "已返回模型列表，请选择模型并保存；尚未验证生成。" : result.modelAvailable ? "模型列表已返回，包含所选模型；尚未验证生成。" : "接口已连接，但模型列表未包含所选模型。" };
    }
    const receipt = await paidRequest({ service: c!.service, model: c!.model, purpose: "channel_connection_test", subject: `channel:${id}`,
      identity: { endpoint: sha256(c!.baseUrl), model: c!.model, requestKey, sessionId: b.sessionId ?? null }, attemptTag: requestKey,
      requestSummary: { channelId: id, model: c!.model, maxTokens: 16 } }, async () => {
      const res = await fetch(`${c!.baseUrl}/chat/completions`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { "content-type": "application/json", authorization: `Bearer ${c!.apiKey}`, "user-agent": "chipshow-studio/0.1", ...(b.sessionId ? { "x-opencode-session": b.sessionId } : {}) },
        body: JSON.stringify({ model: c!.model, messages: [{ role: "user", content: "Reply OK." }], max_tokens: 16 }) });
      result.status = res.status;
      const text = clean(await res.text());
      assertAccepted(c!.service, res.status, text);
      const response = JSON.parse(text) as Record<string, unknown>;
      return { response: { ...response, _httpStatus: res.status } };
    });
    const response = receipt.response as { model?: string; _httpStatus?: number; choices?: Array<{ message?: { content?: string } }> };
    result.status = response._httpStatus ?? null;
    result.returnedModel = typeof response.model === "string" ? clean(response.model) : null;
    result.ok = !!response.choices?.some((v) => typeof v.message?.content === "string" && v.message.content.trim());
    result.receiptId = receipt.receiptId;
    result.detail = result.ok ? "已收到真实生成响应；请求已记入回执和预算。" : "HTTP 成功，但没有收到可用的生成内容。";
    await audit(actor, "channels.test-completion", `channel:${id}`, null, null, { receiptId: receipt.receiptId, ok: result.ok });
    return result;
  } catch (error) {
    if (error instanceof ProviderRejectedError) result.status = error.status;
    return { ...result, detail: clean(error instanceof SyntaxError ? "服务返回的内容不是有效 JSON。" : error instanceof Error ? error.message : "连接失败").slice(0, 1000) };
  }
}
