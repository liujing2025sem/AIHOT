// Issue #12 review candidate. Pure policy only; no worker, database or publication wiring.
export const purposeNames = ['supply_chain', 'news'] as const;
export type Purpose = typeof purposeNames[number];
export type Review = 'UNKNOWN' | 'PENDING' | 'APPROVED' | 'REJECTED';
export type Policy = {
  enabled: boolean;
  priority: number | null;
  priority_reason: string;
  review_status: Review;
  review_ref: string | null;
  interval_minutes: number | null;
  scope: { document_kinds: string[]; entity_ids: string[] };
  backfill_policy: 'UNKNOWN' | 'baseline_only' | 'none';
  destinations: string[];
};
export type Binding = { source_id: string; config_revision: number; purposes: Record<Purpose, Policy> };
export type LegacySource = { id: string; enabled?: boolean; [key: string]: unknown };
const blank = (): Policy => ({ enabled: false, priority: null, priority_reason: 'UNKNOWN: operator confirmation required',
  review_status: 'UNKNOWN', review_ref: null, interval_minutes: null,
  scope: { document_kinds: [], entity_ids: [] }, backfill_policy: 'UNKNOWN', destinations: [] });

export function migrateBindings(sources: LegacySource[]): Binding[] {
  const ids = new Set<string>();
  return sources.map(source => {
    if (!source.id || ids.has(source.id)) throw new Error('Missing or duplicate source_id');
    ids.add(source.id);
    return { source_id: source.id, config_revision: 1, purposes: { supply_chain: blank(), news: blank() } };
  });
}

export function validateBinding(binding: Binding): void {
  if (!binding.source_id || !Number.isInteger(binding.config_revision) || binding.config_revision < 1) throw new Error('Invalid binding');
  for (const name of purposeNames) {
    const p = binding.purposes[name];
    if (!p || typeof p.enabled !== 'boolean' || !['UNKNOWN','PENDING','APPROVED','REJECTED'].includes(p.review_status)) throw new Error('Invalid policy');
    if (p.priority !== null && (!Number.isInteger(p.priority) || p.priority < 0)) throw new Error('Invalid priority');
    if (p.interval_minutes !== null && (!Number.isInteger(p.interval_minutes) || p.interval_minutes < 1)) throw new Error('Invalid interval');
    if (!p.priority_reason.trim() || !Array.isArray(p.scope.document_kinds) || !Array.isArray(p.scope.entity_ids) || !Array.isArray(p.destinations)) throw new Error('Invalid scope');
    if (!['UNKNOWN','baseline_only','none'].includes(p.backfill_policy)) throw new Error('Invalid backfill policy');
    if (p.enabled && (p.review_status !== 'APPROVED' || !p.review_ref?.trim() || p.priority === null || p.interval_minutes === null ||
      !p.scope.document_kinds.length || !p.destinations.length || p.backfill_policy === 'UNKNOWN')) throw new Error('Enabled policy lacks approval or explicit configuration');
    const allowed = name === 'news' ? ['news_review'] : ['evidence_review','page_update_review','version_review'];
    if (p.destinations.some(d => !allowed.includes(d))) throw new Error('Unsupported destination');
    if (name === 'news' && p.backfill_policy === 'baseline_only') throw new Error('News cannot consume historical baselines');
  }
}

// Editing policy invalidates approval. It never changes the sibling purpose or legacy source.
export function editPurpose(binding: Binding, purpose: Purpose, patch: Partial<Policy>): Binding {
  const next = structuredClone(binding);
  next.config_revision++;
  next.purposes[purpose] = { ...next.purposes[purpose], ...structuredClone(patch), enabled: false, review_status: 'PENDING', review_ref: null };
  validateBinding(next);
  return next;
}

export type State = { last_evaluated_at: string | null; last_success_at: string | null; last_error: string | null };
export function finishEvaluation(previous: State, at: string, ok: boolean, error: string | null): State {
  return { last_evaluated_at: at, last_success_at: ok ? at : previous.last_success_at, last_error: ok ? null : error };
}

// One request per source for all due purposes. This does not perform an HTTP request or enqueue a job.
export function planCollection(binding: Binding, sourceEnabled: boolean, collectEnabled: boolean,
  last: Partial<Record<Purpose, string>>, now: string): { source_id: string; due: Purpose[] }[] {
  validateBinding(binding);
  const time = Date.parse(now);
  if (!Number.isFinite(time)) throw new Error('Invalid clock');
  if (!sourceEnabled || !collectEnabled) return [];
  const due = purposeNames.filter(name => {
    const p = binding.purposes[name];
    if (!p.enabled) return false;
    const before = last[name] ? Date.parse(last[name]!) : NaN;
    return !Number.isFinite(before) || time - before >= p.interval_minutes! * 60_000;
  });
  return due.length ? [{ source_id: binding.source_id, due }] : [];
}

export type Evidence = {
  article_id: string; revision: number; source_id: string; original_url: string;
  document_kind: string; entity_ids: string[]; content_hash: string | null;
  evidence_ready: boolean; conflict: boolean; first_baseline: boolean;
  publication_at: string | null; event_at: string | null; collected_at: string;
  previous_ref: { article_id: string; revision: number } | null;
  substantive_change: boolean | null; version_change_verified: boolean;
  affected_page: string | null; news_value: 'UNKNOWN' | 'YES' | 'NO';
};
export type Proposal = { purpose: Purpose; status: 'PENDING' | 'HOLD' | 'SKIP'; reason: string;
  reference: { article_id: string; revision: number }; actions: string[]; key: string };

export function routeEvidence(binding: Binding, evidence: Evidence, now: string, newsWindowDays: number): Proposal[] {
  validateBinding(binding);
  if (binding.source_id !== evidence.source_id) throw new Error('Unresolved source binding');
  if (!Number.isFinite(Date.parse(now)) || !Number.isFinite(newsWindowDays) || newsWindowDays <= 0) throw new Error('Invalid news window');
  if (!evidence.article_id || !Number.isInteger(evidence.revision) || evidence.revision < 1) throw new Error('Invalid material reference');
  const result: Proposal[] = [];
  for (const purpose of purposeNames) {
    const p = binding.purposes[purpose];
    if (!p.enabled || !p.scope.document_kinds.includes(evidence.document_kind) ||
      p.scope.entity_ids.length && !evidence.entity_ids.some(id => p.scope.entity_ids.includes(id))) continue;
    const add = (status: Proposal['status'], reason: string, actions: string[] = []) => {
      result.push({ purpose, status, reason, reference: { article_id: evidence.article_id, revision: evidence.revision },
        key: JSON.stringify([purpose, evidence.article_id, evidence.revision]), actions: actions.filter(a => p.destinations.includes(a)) });
    };
    if (evidence.conflict) { add('HOLD', 'Unresolved evidence conflict'); continue; }
    if (!evidence.evidence_ready || !evidence.content_hash || !evidence.original_url) { add('HOLD', 'Incomplete evidence'); continue; }
    if (purpose === 'supply_chain') {
      if (evidence.first_baseline) {
        add(p.backfill_policy === 'baseline_only' ? 'PENDING' : 'SKIP', 'Historical baseline', ['evidence_review']); continue;
      }
      if (evidence.substantive_change === null) { add('HOLD', 'Change not assessed'); continue; }
      if (!evidence.substantive_change) { add('SKIP', 'No substantive change'); continue; }
      if (evidence.version_change_verified && !evidence.previous_ref) { add('HOLD', 'Version comparison lacks previous material reference'); continue; }
      const actions = ['evidence_review'];
      if (evidence.version_change_verified) actions.push('version_review');
      if (evidence.affected_page) actions.push('page_update_review');
      add('PENDING', 'Review evidence and affected content', actions);
    } else {
      if (evidence.first_baseline) { add('SKIP', 'First import is not news'); continue; }
      if (evidence.substantive_change === false || evidence.news_value === 'NO') { add('SKIP', 'No reportable customer change'); continue; }
      const event = evidence.event_at ?? evidence.publication_at;
      const age = event ? (Date.parse(now) - Date.parse(event)) / 86_400_000 : NaN;
      if (!Number.isFinite(age) || age < 0) { add('HOLD', 'Unknown or future event date'); continue; }
      if (age > newsWindowDays) { add('SKIP', 'Historical event'); continue; }
      if (evidence.substantive_change !== true || evidence.news_value !== 'YES') { add('HOLD', 'Independent news value review required'); continue; }
      add('PENDING', 'News candidate requires human approval', ['news_review']);
    }
  }
  return result;
}

// Replay helper only. Runtime must enforce the same key transactionally; this Set is not durable storage.
export function unseenProposals(proposals: Proposal[], seen: Set<string>): Proposal[] {
  return proposals.filter(p => { if (seen.has(p.key)) return false; seen.add(p.key); return true; });
}
