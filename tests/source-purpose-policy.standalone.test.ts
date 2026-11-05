import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrateBindings, validateBinding, editPurpose, planCollection, finishEvaluation, routeEvidence, unseenProposals,
  type Binding, type Evidence } from '../site/source-purpose-policy.ts';

const sample = JSON.parse(readFileSync(new URL('../docs/issue12/public-replays.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../industry/source-purposes.json', import.meta.url), 'utf8'));
const now = '2026-11-05T04:00:00Z';
function active(source_id: string): Binding {
  const b = migrateBindings([{ id: source_id }])[0];
  for (const name of ['supply_chain','news'] as const) Object.assign(b.purposes[name], {
    enabled: true, priority: name === 'news' ? 5 : 1, priority_reason: 'Replay configuration only',
    review_status: 'APPROVED', review_ref: 'TEST_ONLY', interval_minutes: name === 'news' ? 60 : 1440,
    scope: { document_kinds: ['specification','software_release'], entity_ids: [] },
    backfill_policy: name === 'news' ? 'none' : 'baseline_only',
    destinations: name === 'news' ? ['news_review'] : ['evidence_review','version_review','page_update_review'],
  });
  return b;
}
function software(patch: Partial<Evidence> = {}): Evidence { return { ...sample.software.evidence, ...patch }; }

test('34 source identities preserved; all 68 new purpose bindings disabled and UNKNOWN', () => {
  const legacy = JSON.parse(readFileSync(new URL('../industry/sources.json', import.meta.url), 'utf8')).sources;
  assert.deepEqual(manifest.bindings, migrateBindings(legacy));
  assert.equal(manifest.bindings.length, 34);
  assert.equal(new Set(manifest.bindings.map((b: Binding) => b.source_id)).size, 34);
  for (const b of manifest.bindings) {
    validateBinding(b);
    for (const p of Object.values(b.purposes) as any[]) {
      assert.equal(p.enabled, false); assert.equal(p.review_status, 'UNKNOWN'); assert.equal(p.priority, null);
    }
  }
});
test('migration is deterministic and leaves legacy data including approvals untouched', () => {
  const old = [{id:'original-id',enabled:true,tier:'T1',interval_minutes:30,approval:'original-human-record'}];
  const before = structuredClone(old);
  assert.deepEqual(migrateBindings(old), migrateBindings(old)); assert.deepEqual(old, before);
  assert.equal(migrateBindings(old)[0].source_id, old[0].id);
});
test('duplicate source identity blocks migration', () => assert.throws(() => migrateBindings([{id:'x'},{id:'x'}])));
test('enabled UNKNOWN purpose fails closed', () => {
  const b = migrateBindings([{id:'x'}])[0]; b.purposes.news.enabled = true;
  assert.throws(() => validateBinding(b));
});
test('news priority/cadence edit leaves supply settings intact and requires reapproval', () => {
  const b = active('x'), next = editPurpose(b, 'news', {priority:99,interval_minutes:720});
  assert.deepEqual(next.purposes.supply_chain, b.purposes.supply_chain);
  assert.equal(next.purposes.news.enabled, false); assert.equal(next.purposes.news.review_status, 'PENDING');
  assert.equal(b.purposes.news.priority, 5);
});
test('both purposes due produce one collection request with two references', () => {
  assert.deepEqual(planCollection(active('x'),true,true,{},now), [{source_id:'x',due:['supply_chain','news']}]);
});
test('faster news cadence does not make supply review due', () => {
  assert.deepEqual(planCollection(active('x'),true,true,{supply_chain:'2026-11-05T02:00:00Z',news:'2026-11-05T02:00:00Z'},now)[0].due,['news']);
});
test('global and source collection switches both remain hard gates', () => {
  assert.deepEqual(planCollection(active('x'),false,true,{},now),[]);
  assert.deepEqual(planCollection(active('x'),true,false,{},now),[]);
});
test('failed review never advances last success', () => {
  const old={last_evaluated_at:null,last_success_at:'2026-11-01T00:00:00Z',last_error:null};
  assert.equal(finishEvaluation(old,now,false,'403').last_success_at,old.last_success_at);
});
test('real old MEAN WELL specification baseline yields evidence review and zero news', () => {
  const e = sample.specification.evidence as Evidence;
  const r = routeEvidence(active(e.source_id),e,now,7);
  assert.equal(r[0].status,'PENDING'); assert.deepEqual(r[0].actions,['evidence_review']);
  assert.equal(r[1].status,'SKIP'); assert.deepEqual(r[1].actions,[]);
});
test('real Colorlight version comparison yields maintenance; undated news held independently', () => {
  const e = software(), r = routeEvidence(active(e.source_id),e,now,7);
  assert.deepEqual(r[0].actions,['evidence_review','version_review','page_update_review']);
  assert.equal(r[1].status,'HOLD'); assert.deepEqual(r[0].reference,r[1].reference);
});
test('first software import never becomes news even with synthetic recent publication date', () => {
  const e = software({first_baseline:true,publication_at:now,event_at:now,news_value:'YES'});
  const r = routeEvidence(active(e.source_id),e,now,7);
  assert.deepEqual(r[0].actions,['evidence_review']); assert.equal(r[1].status,'SKIP');
});
test('a known event date still requires an independent news value decision', () => {
  const e=software({event_at:'2026-11-04T00:00:00Z'});
  assert.equal(routeEvidence(active(e.source_id),e,now,7)[1].status,'HOLD');
});
test('approved news value creates only a review candidate; never approval or publication', () => {
  const e=software({event_at:'2026-11-04T00:00:00Z',news_value:'YES'});
  const r=routeEvidence(active(e.source_id),e,now,7);
  assert.equal(r[1].status,'PENDING'); assert.deepEqual(r[1].actions,['news_review']);
});
test('low value publicity cannot remove technical evidence', () => {
  const e=software({news_value:'NO'}), r=routeEvidence(active(e.source_id),e,now,7);
  assert.equal(r[0].status,'PENDING'); assert.equal(r[1].status,'SKIP');
});
test('conflicts in a shared material hold both uses, preserving reference', () => {
  const e=software({conflict:true}), r=routeEvidence(active(e.source_id),e,now,7);
  assert.ok(r.every(p=>p.status==='HOLD' && p.actions.length===0));
});
test('version claim without predecessor reference is held', () => {
  const e=software({previous_ref:null});
  assert.equal(routeEvidence(active(e.source_id),e,now,7)[0].status,'HOLD');
});
test('same material revision has one reference per purpose across repeated replay', () => {
  const e=software(), r=routeEvidence(active(e.source_id),e,now,7), seen=new Set<string>();
  assert.equal(unseenProposals(r,seen).length,2); assert.equal(unseenProposals(r,seen).length,0);
  const next=routeEvidence(active(e.source_id),{...e,revision:e.revision+1},now,7);
  assert.equal(unseenProposals(next,seen).length,2);
});
test('future and invalid dates cannot be replaced by collection date', () => {
  for(const event_at of ['2027-01-01T00:00:00Z','not-a-date',null]){
    const e=software({event_at,news_value:'YES'});
    assert.equal(routeEvidence(active(e.source_id),e,now,7)[1].status,'HOLD');
  }
});
test('unchanged text or layout-only delta generates no update actions', () => {
  const e=software({substantive_change:false});
  assert.ok(routeEvidence(active(e.source_id),e,now,7).every(r=>r.status==='SKIP'&&r.actions.length===0));
});
test('scope and source binding prevent accidental cross-purpose delivery', () => {
  const e=software(),b=active(e.source_id); b.purposes.news.scope.entity_ids=['unrelated'];
  assert.equal(routeEvidence(b,e,now,7).length,1);
  assert.throws(()=>routeEvidence(active('unresolved'),e,now,7));
});
test('disabling both purpose policies yields no new routes and keeps input immutable', () => {
  const e=software(), before=structuredClone(e);
  assert.deepEqual(routeEvidence(migrateBindings([{id:e.source_id}])[0],e,now,7),[]);
  assert.deepEqual(e,before);
});
