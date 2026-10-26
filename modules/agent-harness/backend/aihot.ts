// The Owner injects the existing chatJson and original task/receipt lookup. No new gateway, queue or credential reader.
import { z } from "zod";
import type { chatJson } from "../../../packages/backend/src/providers/llm.ts";
import { BudgetExceededError, ModelUnavailableError, ProviderRejectedError } from "../../../packages/backend/src/providers/receipts.ts";
import { NotSentError, emptyUsage, normalizeEndpoint, type Executor, type Observation, type Profile, type Task } from "./core.ts";

export interface ExistingModelBinding { model_key: string; endpoint: string; model: string; secret_ref: string; budget_policy_ref: string }
export function createAIhotExecutor(
  binding: (profile: Profile) => ExistingModelBinding,
  invoke: typeof chatJson,
  lookupOriginal: Executor["status"],
): Executor {
  return {
    async submit(task, context): Promise<Observation> {
      const profile = task.profile_snapshot;
      const current = binding(profile);
      if (profile.kind !== "model_api" || profile.protocol !== "openai_chat_completions" || profile.auth.mode !== "bearer_ref" ||
        normalizeEndpoint(current.endpoint) !== profile.endpoint || current.model !== profile.model || current.secret_ref !== profile.auth.secret_ref || current.budget_policy_ref !== profile.budget_policy_ref) throw new NotSentError("registered_model_binding_changed_or_unsupported");
      const input = task.input as { text: string; source_url: string; source_date: string };
      if (typeof input?.text !== "string" || typeof input.source_url !== "string" || typeof input.source_date !== "string" || Object.keys(input).some(key => !["text", "source_url", "source_date"].includes(key))) throw new NotSentError("unsupported_summary_payload");
      context.bind(task.task_id); // Exact original task/attempt mapping, not a replacement executor UUID.
      let answer: Awaited<ReturnType<typeof invoke>>;
      try { answer = await invoke({ model: current.model_key, purpose: "harness_summary", subject: `harness:${task.project}:${task.original_task_id}`,
        promptVersion: `selectable-api/0.1:${task.identity}`, system: "Write an original summary for human review. Preserve source facts.",
        user: input.text, schema: z.object({ summary: z.string() }), signal: context.signal }); }
      catch (error) {
        if (error instanceof ProviderRejectedError) return { state: "failed", code: "provider_rejected", upstream_http_status: error.status };
        if (error instanceof ModelUnavailableError || error instanceof BudgetExceededError) return { state: "failed", code: "existing_owner_stopped_before_send", upstream_http_status: null, certainty: "NOT_SENT" };
        throw error;
      }
      const usage = emptyUsage();
      usage.raw = answer.usage;
      usage.source = answer.usage ? "existing_aihot_receipt" : null;
      for (const [target, source] of [["input_tokens", "prompt_tokens"], ["output_tokens", "completion_tokens"], ["total_tokens", "total_tokens"]] as const) {
        const value = answer.usage?.[source];
        usage[target] = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
      }
      return { state: "succeeded", outcome: { output: { summary: (answer.data as { summary: string }).summary, source_url: input.source_url, source_date: input.source_date }, usage, estimated_cost: null } };
    },
    status: lookupOriginal,
    async cancel() { return "unsupported"; }, // Transport abort is local only; the original receipt remains authoritative.
  };
}
