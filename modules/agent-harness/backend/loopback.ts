// Direct literal-loopback transport for a synthetic OpenAI-compatible fixture, never a live provider gateway.
import http from "node:http";
import { NotSentError, emptyUsage, type Executor, type Observation, type Task } from "./core.ts";

export class LoopbackChatExecutor implements Executor {
  async submit(task: Task, context: Parameters<Executor["submit"]>[1]): Promise<Observation> {
    const profile = task.profile_snapshot;
    const url = new URL(profile.endpoint + "/chat/completions");
    if (profile.kind !== "model_api" || profile.protocol !== "openai_chat_completions" || profile.auth.mode !== "none" || url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)) throw new NotSentError("unsupported_loopback_transport");
    const input = task.input as { text?: unknown; source_url?: unknown; source_date?: unknown };
    if (typeof input?.text !== "string" || typeof input.source_url !== "string" || typeof input.source_date !== "string" || Object.keys(input).some(key => !["text", "source_url", "source_date"].includes(key))) throw new NotSentError("unsupported_summary_payload");
    context.bind(`local:${task.project}:${task.task_id}`);
    const body = JSON.stringify({ model: profile.model, messages: [
      { role: "system", content: "Write an original short summary for human editorial review. Do not invent source facts." },
      { role: "user", content: input.text },
    ] });
    // http.request uses no environment proxy and follows no redirects. No Authorization is constructed.
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = http.request(url, { method: "POST", signal: context.signal, headers: { "content-type": "application/json" } }, res => {
        let received = "";
        res.setEncoding("utf8");
        res.on("data", chunk => { received += chunk; if (received.length > 1_000_000) request.destroy(new Error("mock response too large")); });
        res.on("end", () => resolve({ status: res.statusCode ?? 500, body: received }));
        res.on("error", reject);
      });
      request.on("error", reject);
      request.end(body);
    });
    if (response.status < 200 || response.status >= 300) return { state: "failed", code: `provider_http_${response.status}`, upstream_http_status: response.status };
    const data = JSON.parse(response.body);
    const summary = data?.choices?.[0]?.message?.content;
    if (typeof summary !== "string") return { state: "failed", code: "invalid_model_output", upstream_http_status: response.status };
    const usage = emptyUsage();
    usage.raw = data.usage && typeof data.usage === "object" ? data.usage : null;
    usage.source = usage.raw ? "provider_reported" : null;
    for (const [target, source] of [["input_tokens", "prompt_tokens"], ["output_tokens", "completion_tokens"], ["total_tokens", "total_tokens"]] as const) {
      const value = usage.raw?.[source];
      usage[target] = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
    }
    return { state: "succeeded", outcome: { output: { summary, source_url: input.source_url, source_date: input.source_date }, usage, estimated_cost: null } };
  }
  async status(): Promise<Observation> { return { state: "unknown" }; }
  async cancel(): Promise<"unsupported"> { return "unsupported"; }
}
