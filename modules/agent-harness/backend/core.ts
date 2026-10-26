// selectable-api/0.1 candidate: synthetic core, not a production scheduler or CSM wire protocol.
import { createHash } from "node:crypto";

export type Project = "aihot" | "csm";
export type State = "accepted" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";
export type Cancellation = "none" | "requested" | "confirmed" | "unsupported";
export interface Profile {
  profile_id: string;
  kind: "model_api" | "opencode_server";
  protocol: "openai_chat_completions" | "opencode_http_1.19.4";
  provider: string;
  model: string;
  endpoint: string;
  auth: { mode: "none" | "bearer_ref" | "basic_ref"; secret_ref: string | null };
  budget_policy_ref: string;
  network_policy_ref: string;
}
export interface NetworkPolicy { endpoints: readonly string[]; loopback_no_auth: boolean }
// The exact upstream task.schema.json is pending. These are AIHOT mock adapter fields, not a replacement for CSM v2.
export interface Submit {
  project: Project;
  task_id: string;
  original_task_id: string;
  idempotency_key: string;
  profile_id: string;
  role: string;
  source_binding: Record<string, unknown>;
  input: unknown;
}
export interface Usage {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  reported_cost: number | null;
  currency: string | null;
  raw: Record<string, unknown> | null;
  source: string | null;
}
export interface Outcome { output: unknown; usage: Usage; estimated_cost: { amount: number; currency: string; rate_version: string } | null }
export const emptyUsage = (): Usage => ({ input_tokens: null, output_tokens: null, total_tokens: null, reported_cost: null, currency: null, raw: null, source: null });
export interface Failure {
  code: string;
  stage: "submit" | "status" | "cancel" | "recovery";
  certainty: "NOT_SENT" | "UNKNOWN" | "CONFIRMED";
  upstream_http_status: number | null;
  retry_disposition: "stop" | "query_original";
  upstream_ref: string | null;
  usage_source: string | null;
}
export interface Task extends Submit {
  identity: string;
  profile_fingerprint: string;
  profile_snapshot: Profile;
  attempt: number;
  state: State;
  cancellation: Cancellation;
  upstream_ref: string | null;
  candidate: Outcome | null;
  error: Failure | null;
  queries: number;
}
export type Observation =
  | { state: "running" | "unknown" }
  | { state: "succeeded"; outcome: Outcome }
  | { state: "failed"; code: string; upstream_http_status: number | null; certainty?: "NOT_SENT" }
  | { state: "cancelled"; termination_evidence: string };
export interface Context { signal: AbortSignal; bind: (upstream_ref: string) => void }
export interface Executor {
  submit(task: Readonly<Task>, context: Context): Promise<Observation>;
  status(upstream_ref: string, task: Readonly<Task>, signal: AbortSignal): Promise<Observation>;
  cancel(upstream_ref: string, task: Readonly<Task>): Promise<"requested" | "unsupported">;
}
export interface Host {
  executor(profile: Readonly<Profile>): Executor;
  persist(tasks: readonly Task[]): void;
  authorize(profile: Readonly<Profile>): void;
  // Owner-supplied original atomic operations. The mock host uses the single-process core state only.
  claim(task: Readonly<Task>): boolean;
  cancelAccepted(task: Readonly<Task>): boolean;
}

export class NotSentError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
export class UpstreamHTTPError extends Error {
  readonly status: number;
  constructor(status: number) { super("upstream_http_error"); this.status = status; }
}

export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${Array.from(value, canonical).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value!);
    if (keys.some(key => /[^\x00-\x7f]/.test(key))) throw new Error("canonical keys must be ASCII");
    return `{${keys.sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  throw new Error("identity must contain JSON values and safe integers only");
}
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const clone = <T>(value: T): T => structuredClone(value);
const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const key = (project: Project, id: string) => canonical([project, id]);
function exactKeys(value: object, expected: string[]): void {
  if (Object.keys(value).sort().join(",") !== [...expected].sort().join(",")) throw new Error("unexpected or missing contract fields");
}
export function normalizeEndpoint(endpoint: string): string {
  if (typeof endpoint !== "string" || /[\\\s\x00-\x1f]/.test(endpoint)) throw new Error("invalid endpoint");
  const parts = /^(https?):\/\/([^/?#]+)([^?#]*)$/i.exec(endpoint);
  const url = new URL(endpoint);
  if (!parts || url.username || url.password || url.search || url.hash) throw new Error("invalid endpoint");
  // Keep original path case and percent spelling; URL.origin normalizes scheme/host/default port.
  return url.origin + parts[3]!.replace(/\/+$/, "");
}
export const profileFingerprint = (profile: Profile): string => hash({ ...profile, endpoint: normalizeEndpoint(profile.endpoint) });
export function registerProfiles(profiles: readonly Profile[], policies: Readonly<Record<string, NetworkPolicy>>): ReadonlyMap<string, Profile> {
  const registered = new Map<string, Profile>();
  for (const raw of profiles) {
    exactKeys(raw, ["profile_id", "kind", "protocol", "provider", "model", "endpoint", "auth", "budget_policy_ref", "network_policy_ref"]);
    const profile = clone(raw);
    exactKeys(profile.auth, ["mode", "secret_ref"]);
    for (const value of [profile.profile_id, profile.provider, profile.model, profile.budget_policy_ref, profile.network_policy_ref]) if (!nonempty(value)) throw new Error("missing profile value");
    if (!((profile.kind === "model_api" && profile.protocol === "openai_chat_completions") || (profile.kind === "opencode_server" && profile.protocol === "opencode_http_1.19.4"))) throw new Error("unsupported kind/protocol");
    if (registered.has(profile.profile_id)) throw new Error("duplicate profile");
    profile.endpoint = normalizeEndpoint(profile.endpoint);
    const url = new URL(profile.endpoint);
    const loopback = ["127.0.0.1", "[::1]"].includes(url.hostname);
    const policy = policies[profile.network_policy_ref];
    if (!policy || !policy.endpoints.some(endpoint => normalizeEndpoint(endpoint) === profile.endpoint)) throw new Error("endpoint is not registered");
    if ((!loopback && url.protocol !== "https:") || (profile.kind === "opencode_server" && !loopback)) throw new Error("remote HTTP and remote OpenCode are unsupported");
    if (profile.kind === "model_api" && url.pathname.endsWith("/chat/completions")) throw new Error("register an API base, not a completion URL");
    if (profile.auth.mode === "none") {
      if (profile.auth.secret_ref !== null || !loopback || !policy.loopback_no_auth) throw new Error("none auth requires explicitly registered literal loopback");
    } else if (!["bearer_ref", "basic_ref"].includes(profile.auth.mode) || !profile.auth.secret_ref || !/^env:[A-Z][A-Z0-9_]*$/.test(profile.auth.secret_ref)) throw new Error("authentication must use an env reference");
    canonical(profile);
    registered.set(profile.profile_id, profile);
  }
  return registered;
}

export class Harness {
  private readonly tasks = new Map<string, Task>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly profiles: ReadonlyMap<string, Profile>;
  private readonly host: Host;
  private readonly limits: { timeout_ms: number; max_queries: number };
  constructor(profiles: ReadonlyMap<string, Profile>, host: Host,
    restored: readonly Task[] = [], limits = { timeout_ms: 1000, max_queries: 2 }) {
    this.profiles = profiles;
    this.host = host;
    this.limits = limits;
    if (!Number.isSafeInteger(limits.timeout_ms) || limits.timeout_ms <= 0 || !Number.isSafeInteger(limits.max_queries) || limits.max_queries < 0) throw new Error("invalid query limits");
    for (const source of restored) {
      const task = clone(source);
      if (!["aihot", "csm"].includes(task.project) || ![task.task_id, task.original_task_id, task.idempotency_key, task.role].every(nonempty) || !Number.isSafeInteger(task.queries) || task.queries < 0 || !Number.isSafeInteger(task.attempt) || task.attempt < 1) throw new Error("invalid snapshot task binding");
      const profile = profiles.get(task.profile_id);
      if (!profile || canonical(profile) !== canonical(task.profile_snapshot) || task.profile_fingerprint !== profileFingerprint(profile) || task.identity !== this.identity(task, profile)) throw new Error("snapshot binding mismatch");
      if (!["accepted", "running", "succeeded", "failed", "cancelled", "unknown"].includes(task.state) || !["none", "requested", "confirmed", "unsupported"].includes(task.cancellation)) throw new Error("invalid snapshot state");
      if (this.find(task).length || this.tasks.has(key(task.project, task.task_id))) throw new Error("duplicate snapshot identity");
      if (task.state === "running") { task.state = "unknown"; task.error = this.failure(task, "process_interrupted", "recovery"); }
      this.tasks.set(key(task.project, task.task_id), task);
    }
  }
  private identity(input: Submit, profile: Profile): string {
    return hash({ project: input.project, original_task_id: input.original_task_id, input: input.input,
      source_binding: input.source_binding, role: input.role, profile_fingerprint: profileFingerprint(profile) });
  }
  private find(input: Submit): Task[] {
    return [...this.tasks.values()].filter(task => task.project === input.project && (task.idempotency_key === input.idempotency_key || task.original_task_id === input.original_task_id));
  }
  private get(project: Project, task_id: string): Task {
    const task = this.tasks.get(key(project, task_id));
    if (!task) throw new Error("unknown task in project");
    return task;
  }
  private save(): void { this.host.persist(this.snapshot()); }
  private failure(task: Task, code: string, stage: Failure["stage"], status: number | null = null): Failure {
    return { code, stage, certainty: status !== null && status < 500 ? "CONFIRMED" : "UNKNOWN", upstream_http_status: status,
      retry_disposition: status !== null && status < 500 ? "stop" : "query_original", upstream_ref: task.upstream_ref, usage_source: task.candidate?.usage.source ?? null };
  }
  snapshot(): Task[] { return clone([...this.tasks.values()]); }
  submit(input: Submit): Task {
    exactKeys(input, ["project", "task_id", "original_task_id", "idempotency_key", "profile_id", "role", "source_binding", "input"]);
    if (!["aihot", "csm"].includes(input.project)) throw new Error("unknown project");
    for (const value of [input.task_id, input.original_task_id, input.idempotency_key, input.profile_id, input.role]) if (!nonempty(value)) throw new Error("missing task binding");
    const profile = this.profiles.get(input.profile_id);
    if (!profile) throw new Error("unregistered profile");
    const identity = this.identity(input, profile);
    const matches = this.find(input);
    if (matches.some(task => task.identity !== identity)) throw new Error("task identity conflict");
    const existing = this.tasks.get(key(input.project, input.task_id)) ?? matches[0];
    if (existing) {
      if (existing.identity !== identity) throw new Error("task identity conflict");
      return clone(existing);
    }
    const task: Task = { ...clone(input), identity, profile_fingerprint: profileFingerprint(profile), profile_snapshot: clone(profile),
      attempt: 1, state: "accepted", cancellation: "none", upstream_ref: null, candidate: null, error: null, queries: 0 };
    this.tasks.set(key(task.project, task.task_id), task);
    this.save();
    return clone(task);
  }
  status(project: Project, task_id: string): Task { return clone(this.get(project, task_id)); }
  result(project: Project, task_id: string, current_binding: { source_binding: Record<string, unknown>; profile_fingerprint: string }) {
    const task = this.get(project, task_id);
    const eligible = task.state === "succeeded" && canonical(current_binding.source_binding) === canonical(task.source_binding) && current_binding.profile_fingerprint === task.profile_fingerprint;
    return { state: task.state, eligible, candidate: eligible ? clone(task.candidate) : null, review_required: true as const };
  }
  // Existing host worker calls dispatch. submit/status do not create a queue or send requests.
  async dispatch(project: Project, task_id: string): Promise<Task> {
    const task = this.get(project, task_id);
    if (task.state !== "accepted" || task.cancellation !== "none" || !this.host.claim(clone(task))) return clone(task);
    try { this.host.authorize(task.profile_snapshot); }
    catch {
      task.state = "failed";
      task.error = { ...this.failure(task, "owner_stopped_before_dispatch", "submit"), certainty: "NOT_SENT", retry_disposition: "stop" };
      this.save();
      return clone(task);
    }
    const controller = new AbortController();
    this.controllers.set(key(project, task_id), controller);
    task.state = "running";
    this.save();
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = Promise.resolve().then(() => this.host.executor(task.profile_snapshot).submit(clone(task), {
      signal: controller.signal,
      bind: upstream_ref => {
        if (!nonempty(upstream_ref) || (task.upstream_ref && task.upstream_ref !== upstream_ref)) throw new Error("upstream identity changed");
        task.upstream_ref = upstream_ref;
        this.save();
      },
    })).then(observed => {
      if (expired) { if (observed.state === "succeeded") task.candidate = clone(observed.outcome); this.save(); }
      return observed;
    });
    try {
      const observation = await Promise.race([pending, new Promise<Observation>(resolve => { timer = setTimeout(() => {
        expired = true; controller.abort(); resolve({ state: "unknown" });
      }, this.limits.timeout_ms); })]);
      this.observe(task, observation, "submit");
    } catch (error) {
      if (this.get(project, task_id).state !== "cancelled") {
        task.state = error instanceof NotSentError ? "failed" : "unknown";
        task.error = this.failure(task, error instanceof NotSentError ? error.code : "submit_outcome_unknown", "submit");
        if (error instanceof NotSentError) { task.error.certainty = "NOT_SENT"; task.error.retry_disposition = "stop"; }
      }
    }
    finally { clearTimeout(timer); this.controllers.delete(key(project, task_id)); this.save(); }
    return clone(task);
  }
  async reconcile(project: Project, task_id: string): Promise<Task> {
    const task = this.get(project, task_id);
    if (!["running", "unknown"].includes(task.state) || task.error?.retry_disposition === "stop" || !task.upstream_ref || task.queries >= this.limits.max_queries) return clone(task);
    task.queries += 1;
    this.save();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    let expired = false;
    try {
      const pending = this.host.executor(task.profile_snapshot).status(task.upstream_ref, clone(task), controller.signal).then(observed => {
        if (expired && observed.state === "succeeded") { task.candidate = clone(observed.outcome); this.save(); }
        return observed;
      });
      const observed = await Promise.race([pending,
        new Promise<Observation>(resolve => { timer = setTimeout(() => { expired = true; controller.abort(); resolve({ state: "unknown" }); }, this.limits.timeout_ms); })]);
      this.observe(task, observed, "status");
    } catch { task.state = "unknown"; task.error = this.failure(task, "status_outcome_unknown", "status"); }
    finally { clearTimeout(timer); this.save(); }
    return clone(task);
  }
  async cancel(project: Project, task_id: string): Promise<Task> {
    const task = this.get(project, task_id);
    if (["succeeded", "failed", "cancelled"].includes(task.state) || task.error?.retry_disposition === "stop" || task.cancellation !== "none") return clone(task);
    task.cancellation = "requested";
    if (task.state === "accepted" && this.host.cancelAccepted(clone(task))) {
      task.state = "cancelled"; task.cancellation = "confirmed"; this.save(); return clone(task);
    }
    if (task.state === "accepted") {
      task.state = "unknown";
      task.error = this.failure(task, "cancel_not_confirmed_by_owner", "cancel");
    }
    this.save();
    this.controllers.get(key(project, task_id))?.abort();
    if (task.upstream_ref) {
      try { task.cancellation = await this.host.executor(task.profile_snapshot).cancel(task.upstream_ref, clone(task)); }
      catch (error) {
        task.error = this.failure(task, "cancel_outcome_unknown", "cancel", error instanceof UpstreamHTTPError ? error.status : null);
        if (!["succeeded", "failed", "cancelled"].includes(task.state)) task.state = "unknown";
      }
    }
    this.save();
    return clone(task);
  }
  private observe(task: Task, observed: Observation, stage: Failure["stage"]): void {
    if (task.state === "cancelled") { if (observed.state === "succeeded") task.candidate = clone(observed.outcome); return; }
    if (observed.state === "succeeded") {
      task.candidate = clone(observed.outcome);
      task.state = "succeeded"; task.error = null;
    } else if (observed.state === "failed") {
      const status = observed.upstream_http_status;
      task.state = status !== null && status >= 500 ? "unknown" : "failed";
      task.error = this.failure(task, /^[a-zA-Z0-9_:-]{1,80}$/.test(observed.code) ? observed.code : "executor_failure", stage, status);
      if (observed.certainty === "NOT_SENT") { task.error.certainty = "NOT_SENT"; task.error.retry_disposition = "stop"; }
    } else if (observed.state === "cancelled") {
      if (!nonempty(observed.termination_evidence)) throw new Error("missing termination evidence");
      task.state = "cancelled"; task.cancellation = "confirmed";
    } else {
      task.state = observed.state;
      if (observed.state === "unknown") task.error = this.failure(task, "outcome_unknown", stage);
    }
  }
}
