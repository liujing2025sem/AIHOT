// Fixed-v1.19.4 operation mapping over an injected FAKE transport. No SDK, process, credentials or live service.
import { createHash } from "node:crypto";
import { NotSentError, UpstreamHTTPError, emptyUsage, type Executor, type Observation, type Task } from "./core.ts";

export interface FakeOpenCodeTransport {
  mode: "fake";
  request(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: unknown }>;
}
interface Assistant {
  info: { id: string; role: string; parentID: string; providerID: string; modelID: string; time?: { completed?: number }; error?: unknown; tokens?: { input?: number; output?: number; total?: number }; cost?: number };
  parts: Array<{ type: string; text?: string }>;
}
export class MockOpenCodeExecutor implements Executor {
  private readonly sessions = new Map<string, string>();
  private readonly transport: FakeOpenCodeTransport;
  private readonly messageId: (task: Task) => string;
  private readonly evidence: (data: { upstream_ref: string; assistant_id: string; response_sha256: string }) => void;
  constructor(transport: FakeOpenCodeTransport, messageId: (task: Task) => string,
    evidence: (data: { upstream_ref: string; assistant_id: string; response_sha256: string }) => void) {
    if (transport.mode !== "fake") throw new Error("only fake OpenCode transport is authorized by this candidate");
    this.transport = transport; this.messageId = messageId; this.evidence = evidence;
  }
  private own(session_id: string, task: Task): void {
    const prior = this.sessions.get(session_id);
    if (prior && prior !== task.identity) throw new Error("session belongs to another task");
    this.sessions.set(session_id, task.identity);
  }
  async submit(task: Task, context: Parameters<Executor["submit"]>[1]): Promise<Observation> {
    const profile = task.profile_snapshot;
    if (profile.kind !== "opencode_server" || profile.protocol !== "opencode_http_1.19.4") throw new NotSentError("unsupported_executor_protocol");
    const input = task.input as { text?: unknown; source_url?: unknown; source_date?: unknown };
    if (typeof input?.text !== "string" || Object.keys(input).some(key => !["text", "source_url", "source_date"].includes(key)) ||
      (task.project === "aihot" && (typeof input.source_url !== "string" || typeof input.source_date !== "string"))) throw new NotSentError("unsupported_opencode_payload");
    const message = this.messageId(task);
    if (!message) throw new NotSentError("missing_original_message_binding");
    // Harness has persisted running intent before this non-idempotent creation. Unknown creation is never replayed.
    const session = await this.transport.request("POST", "/session", { title: `candidate:${task.project}:${task.task_id}` });
    if (session.status < 200 || session.status >= 300) return { state: "failed", code: "opencode_create_rejected", upstream_http_status: session.status };
    const id = (session.body as { id?: string })?.id;
    if (!id || !message) throw new Error("unknown OpenCode session identity");
    this.own(id, task);
    const reference = JSON.stringify({ session_id: id, message_id: message });
    context.bind(reference); // Persist session + original attempt mapping before prompt_async.
    const submitted = await this.transport.request("POST", `/session/${encodeURIComponent(id)}/prompt_async`, {
      messageID: message, model: { providerID: profile.provider, modelID: profile.model }, parts: [{ type: "text", text: input.text }],
    });
    if (submitted.status !== 204) return { state: "failed", code: "opencode_prompt_rejected", upstream_http_status: submitted.status };
    return { state: "running" };
  }
  async status(upstream_ref: string, task: Task): Promise<Observation> {
    const { session_id, message_id } = JSON.parse(upstream_ref) as { session_id: string; message_id: string };
    this.own(session_id, task);
    const status = await this.transport.request("GET", "/session/status"); // idle alone is deliberately never a success signal.
    if (status.status !== 200) return { state: "failed", code: "opencode_status_rejected", upstream_http_status: status.status };
    const response = await this.transport.request("GET", `/session/${encodeURIComponent(session_id)}/message`);
    if (response.status !== 200) return { state: "failed", code: "opencode_query_rejected", upstream_http_status: response.status };
    if (!Array.isArray(response.body)) return { state: "unknown" };
    const messages = (response.body as Assistant[]).filter(message => message.info?.role === "assistant" && message.info.parentID === message_id);
    if (messages.length !== 1) return { state: "unknown" };
    const message = messages[0]!;
    if (message.info.error) return { state: "failed", code: "opencode_assistant_error", upstream_http_status: null };
    if (!Number.isSafeInteger(message.info.time?.completed)) return { state: "running" };
    if (message.info.providerID !== task.profile_snapshot.provider || message.info.modelID !== task.profile_snapshot.model) return { state: "failed", code: "opencode_model_mismatch", upstream_http_status: null };
    if (message.parts.some(part => part.type !== "text")) return { state: "failed", code: "unsupported_opencode_parts", upstream_http_status: null };
    const usage = emptyUsage();
    usage.source = "opencode_assistant";
    usage.raw = message.info.tokens ?? null;
    for (const [target, source] of [["input_tokens", "input"], ["output_tokens", "output"], ["total_tokens", "total"]] as const) {
      const value = message.info.tokens?.[source];
      usage[target] = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
    }
    usage.reported_cost = typeof message.info.cost === "number" && Number.isFinite(message.info.cost) && message.info.cost >= 0 ? message.info.cost : null;
    this.evidence({ upstream_ref, assistant_id: message.info.id, response_sha256: createHash("sha256").update(JSON.stringify(message)).digest("hex") });
    const input = task.input as { source_url?: string; source_date?: string };
    return { state: "succeeded", outcome: { output: { summary: message.parts.map(part => part.text ?? "").join(""), source_url: input.source_url ?? null, source_date: input.source_date ?? null,
      origin: "opencode_assistant", actual_provider: message.info.providerID, actual_model: message.info.modelID }, usage, estimated_cost: null } };
  }
  async cancel(upstream_ref: string, task: Task): Promise<"requested" | "unsupported"> {
    const { session_id } = JSON.parse(upstream_ref) as { session_id: string };
    this.own(session_id, task);
    const response = await this.transport.request("POST", `/session/${encodeURIComponent(session_id)}/abort`);
    if (response.status === 404) return "unsupported";
    if (response.status !== 200) throw new UpstreamHTTPError(response.status);
    if (response.body !== true) throw new Error("OpenCode abort outcome unknown");
    return "requested"; // true is only a session-level acknowledgement, never termination proof.
  }
}
