// Native OpenCode harness exercise. Uses an isolated project profile and explicit continuation.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const [runtimeArg, outputArg, action = 'start'] = process.argv.slice(2);
if (!runtimeArg || !outputArg || !['start', 'resume'].includes(action)) throw Error('Pass runtime directory, output directory and start|resume');
if (!process.env.LLM_API_KEY) throw Error('Load the local project credential first');
const runtime = path.resolve(runtimeArg), output = path.resolve(outputArg);
const stateFile = path.join(runtime, 'coding-session.json');
const prior = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null;
if (action === 'start' && prior) throw Error('Session already has an attempt; read its receipt or explicitly resume a successful session');
if (action === 'resume' && (prior?.status !== 'SUCCEEDED' || !prior.session_id || prior.turn !== 1)) throw Error('Resume only the completed first turn, using its original session');
const model = 'opencode-go/deepseek-v4.1-flash';
for (const name of ['config', 'data', 'state', 'work']) mkdirSync(path.join(runtime, name), { recursive: true });
mkdirSync(output, { recursive: true });
const env = { ...process.env,
  XDG_CONFIG_HOME: path.join(runtime, 'config'), XDG_DATA_HOME: path.join(runtime, 'data'), XDG_STATE_HOME: path.join(runtime, 'state'),
  XDG_CACHE_HOME: process.env.OPENCODE_PILOT_CACHE || path.join(runtime, 'cache'),
  OPENCODE_DISABLE_CLAUDE_CODE: 'true', OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true', OPENCODE_DISABLE_LSP_DOWNLOAD: 'true',
  OPENCODE_CONFIG_CONTENT: JSON.stringify({ model, small_model: model, enabled_providers: ['opencode-go'], autoupdate: false, snapshot: false, share: 'disabled', permission: 'deny', provider: { 'opencode-go': { options: { apiKey: '{env:LLM_API_KEY}', baseURL: 'https://opencode.ai/inference/go/openai/v1', maxRetries: 0 }, models: { 'deepseek-v4.1-flash': { options: { thinking: { type: 'disabled' } } } } } }),
};
// The native coding harness does not need the site's database or administrator credentials.
for (const key of ['DATABASE_URL', 'POSTGRES_PASSWORD', 'ADMIN_PASSWORD', 'SESSION_SECRET', 'IMG_PROXY_SIGN_SECRET']) delete env[key];
const prompt = action === 'start'
  ? 'Code review for an LED news software project. Without tools, review: function validDate(value) { const d = new Date(value); return d ? d : null; }. The requirement is null for invalid dates. Explain the bug and give the corrected JavaScript function plus two edge cases in under 150 words. Remember marker LED-COLDSTART-29 for this coding session.'
  : 'Continue the same code review without tools. State the marker from the previous turn, repeat the corrected function and explain why an Invalid Date object is truthy. Keep under 100 words.';
const executable = process.env.OPENCODE_PILOT_EXE;
if (!executable) throw Error('Set OPENCODE_PILOT_EXE to an explicitly configured native client; no old-machine path is assumed');
const args = ['run', '--pure', '--format', 'json', '--model', model, '--title', 'AIHOT coding cold start 2026-10-29', ...(prior ? ['--session', prior.session_id] : []), prompt];
const intent = { turn: action === 'start' ? 1 : 2, status: 'SUBMISSION_INTENT_RECORDED', session_id: prior?.session_id ?? null, requested_model: model, at: new Date().toISOString() };
writeFileSync(stateFile, JSON.stringify(intent, null, 2));
const started = Date.now();
const result = spawnSync(executable, args, { cwd: path.join(runtime, 'work'), env, encoding: 'utf8', windowsHide: true, timeout: 90000, maxBuffer: 4*1024*1024 });
const redact = s => (s || '').replaceAll(process.env.LLM_API_KEY, '[REDACTED]');
const stdout = redact(result.stdout), stderr = redact(result.stderr);
writeFileSync(path.join(output, `opencode-native-turn-${intent.turn}.jsonl`), stdout);
const events = stdout.split(/\r?\n/).filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
const session = events.find(e => e.sessionID)?.sessionID ?? prior?.session_id ?? null;
const text = events.filter(e => e.type === 'text').map(e => e.part?.text ?? '').join('\n');
const errors = events.filter(e => e.type === 'error');
const receipt = { ...intent, status: result.status === 0 && text && errors.length === 0 ? 'SUCCEEDED' : 'UNKNOWN_OR_FAILED', session_id: session, same_session: prior ? session === prior.session_id : null, elapsed_ms: Date.now()-started, native_cli_version: '1.18.30', exit_code: result.status, error: result.error?.message ?? null, errors, stderr, text, steps: events.filter(e => e.type === 'step_finish').map(e => e.part), marker_preserved: action === 'resume' ? text.includes('LED-COLDSTART-29') : null, actual_model: null, billing_source: null, reported_cost_usd: null };
writeFileSync(stateFile, JSON.stringify(receipt, null, 2));
writeFileSync(path.join(output, `opencode-native-turn-${intent.turn}.json`), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt, null, 2));
if (receipt.status !== 'SUCCEEDED') process.exitCode = 1;
