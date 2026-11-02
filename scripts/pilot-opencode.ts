// One explicitly authorized coding request through the existing provider and PostgreSQL receipt.
// Re-running reads the local outcome; it never submits a second request.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
const target = path.resolve(process.argv[2] || '.data/opencode-coding-pilot.json');
if (existsSync(target)) {
  console.log(readFileSync(target, 'utf8'));
} else {
  const db = new URL(process.env.DATABASE_URL || 'postgres://unset/unset');
  if (!['127.0.0.1', 'localhost'].includes(db.hostname) || !db.pathname.endsWith('_test')) throw Error('Use the isolated local *_test database');
  if (process.env.LLM_BASE_URL !== 'https://opencode.ai/inference/go/openai/v1' || process.env.LLM_MODEL !== 'deepseek-v4.1-flash') throw Error('Expected the user-selected OpenCode Go DeepSeek V4.1 Flash configuration');
  if (!process.env.LLM_API_KEY) throw Error('Local credential is missing');
  // Only this explicit pilot process opens the model valve, not the API server or worker.
  process.env.MODEL_CALLS_ENABLED = 'true';
  const { chatJson } = await import('@aihot/backend/providers/llm');
  const { sql, closeDb } = await import('@aihot/backend/db');
  const task = { task_id: 'aihot-opencode-coding-20261029', session_id: 'aihot-opencode-coding-20261029', model: 'deepseek-v4.1-flash', started_at: new Date().toISOString(), scope: 'single TypeScript code review; no news generation or publishing' };
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify({ ...task, status: 'SUBMISSION_INTENT_RECORDED', cost: null }, null, 2), { flag: 'wx' });
  const started = Date.now();
  let report: Record<string, unknown>;
  try {
    const result = await chatJson({ model: 'default', sessionId: task.session_id, purpose: 'coding_pilot', subject: task.task_id, promptVersion: 'coding-review-1',
      system: 'You are reviewing TypeScript code for an LED news software project. Return only JSON with finding, correctedCode, and testCases (an array of strings). Keep your answer concise. No tools or external access.',
      user: 'Review this TypeScript date parser. Requirement: return null for an invalid timestamp; preserve a valid date. function parseDate(value: string): Date | null { const date = new Date(value); return date ? date : null; } Identify the bug and propose the smallest correct replacement with two test cases.',
      schema: z.object({ finding: z.string(), correctedCode: z.string(), testCases: z.array(z.string()).min(2) }), maxTokens: 512, timeoutMs: 60000,
    });
    const [receipt] = await sql`SELECT id,service,model,status,request_id,usage,cost,response->>'model' AS returned_model FROM receipts WHERE id=${result.receiptId}`;
    const usage = result.usage as { cost?: number; opencode?: { billing_source?: string; allowance?: unknown } } | null;
    report = { ...task, status: 'SUCCEEDED', elapsed_ms: Date.now()-started, result: result.data, receipt, reused: result.reused, billing_source: usage?.opencode?.billing_source ?? null, reported_cost_usd: usage?.cost ?? null, allowance: usage?.opencode?.allowance ?? null, requested_model: task.model, actual_model: receipt?.returned_model ?? null };
  } catch (error) {
    const receipts = await sql`SELECT id,service,model,status,request_id,usage,cost,error FROM receipts WHERE subject=${task.task_id} ORDER BY id`;
    const e = error as { name?: string; message?: string; status?: number; receiptId?: number };
    const message = (e.message || String(error)).replaceAll(process.env.LLM_API_KEY!, '[REDACTED]');
    report = { ...task, status: 'STOPPED', elapsed_ms: Date.now()-started, error: { name: e.name, message, http_status: e.status ?? null }, receipts, reported_cost_usd: null, next_action: 'Read the saved receipt; do not change identity or resend an uncertain/refused request.' };
    process.exitCode = 1;
  } finally { await closeDb(); }
  const safeReport = JSON.stringify(report, null, 2).replaceAll(process.env.LLM_API_KEY!, '[REDACTED]');
  writeFileSync(target, safeReport);
  console.log(safeReport);
}
