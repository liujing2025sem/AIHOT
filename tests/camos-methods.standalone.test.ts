import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';
import childProcess from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { camosMethods } from '../packages/backend/src/studio/camos-methods.ts';

const scratch = path.join(os.tmpdir(), 'aihot-camos-state');
let root: string;
let oldRoot: string | undefined;
let calls: { file: string; args: string[]; options: any }[];
let hits: any[];
let records: Record<string, any>;
let writingResult: (args: string[]) => any;

function record(id: string, text: string, extra = {}) {
  return { id: `expert_knowledge:${id}`, source_type: 'EXPERT_KNOWLEDGE',
    source_file: 'data/expert_knowledge/method.md', locator: 'original lines 1-12',
    metadata: { scope: 'METHOD_NOT_COMPANY_FACT', corrections_required: true }, text, ...extra };
}

beforeEach(async () => {
  oldRoot = process.env.AIHOT_CAMOS_ROOT;
  await mkdir(scratch, { recursive: true });
  root = await mkdtemp(path.join(scratch, 'test-fixture-'));
  for (const dir of ['app', 'runtime/python', 'data/expert_knowledge']) await mkdir(path.join(root, dir), { recursive: true });
  for (const file of ['app/research.py', 'app/run.py', 'runtime/python/python.exe']) await writeFile(path.join(root, file), '');
  await writeFile(path.join(root, 'data/expert_knowledge/expert-policy.md'), 'POLICY: method is not company fact.');
  await writeFile(path.join(root, 'data/expert_knowledge/corrections.md'), 'KA06: historical truncation claim is withdrawn.');
  process.env.AIHOT_CAMOS_ROOT = root;
  calls = [];
  records = { 'expert_knowledge:method-1': record('method-1', '先明确买家问题，再按来源核对每项判断。') };
  hits = Object.values(records);
  writingResult = args => {
    const site = args[args.indexOf('--site') + 1];
    const profile = site === 'unishineled.com' ? 'unishine-independent-writing' : 'chipshow-three-site-writing';
    const page = args[args.indexOf('--page-type') + 1];
    return { status: 'PREPARED_NOT_EXECUTED', model_called: false, cms_write: false,
      writing_rules: { site }, packet: { tasks: [{ id: 'write-page', skill_payloads: [{
        id: profile, site, revision: '2.1.0-camos.2', facts_approved: false, readability_scan: 'NOT_RUN',
        loaded_sources: [{ path: `skills/${profile}/references/rules.md`, sha256: 'fixture' }],
        body: `\n## Adopted editorial source: skills/${profile}/references/rules.md\nT1-07：先说明读者任务。\n\n`
          + `## Adopted editorial source: skills/${profile}/references/path-map.md\nINTERNAL_PATH_MAP_SENTINEL\n\n`
          + `## Adopted editorial source: skills/${profile}/references/service-provider-reserved-topics.md\nPRIVATE_TOPIC_SENTINEL\n\n`
          + (page === 'product' && site === 'chipshow.com' ? '## Current main-site product standard\nHero 50–70 words; post_excerpt.\n本次确认 C-Pad-M 产品 ID 9304 当前已发布。\n\n' : '')
          + '## CAMOS adoption amendment (takes precedence over bundle text)\n本次授权优先，参数必须有本产品证据。',
      }] }] } };
  };
  mock.method(childProcess, 'execFile', (file: string, args: string[], options: any, callback: any) => {
    calls.push({ file, args, options });
    let result: any;
    if (args.includes('search')) result = { results: hits };
    else if (args.includes('source')) result = records[args[args.indexOf('--id') + 1]];
    else result = writingResult(args);
    queueMicrotask(() => callback(null, JSON.stringify(result)));
    return {};
  });
});

afterEach(async () => {
  mock.restoreAll();
  if (oldRoot === undefined) delete process.env.AIHOT_CAMOS_ROOT;
  else process.env.AIHOT_CAMOS_ROOT = oldRoot;
  await rm(root, { recursive: true, force: true });
});

test('unconfigured and missing installations return empty safe results without a subprocess', async () => {
  delete process.env.AIHOT_CAMOS_ROOT;
  assert.deepEqual(await camosMethods({ query: '写作' }), { status: 'not_configured', ruleIds: [], text: '', provenance: {}, reason: 'AIHOT_CAMOS_ROOT 未配置' });
  process.env.AIHOT_CAMOS_ROOT = path.join(root, 'missing');
  const missing = await camosMethods({ query: '写作' });
  assert.equal(missing.status, 'unavailable');
  assert.deepEqual(missing.ruleIds, []);
  assert.equal(missing.text, '');
  assert.equal(calls.length, 0);
});

test('reads source bodies rather than snippets, records real IDs, and uses only the reviewed CLI branches', async () => {
  hits[0] = { ...hits[0], snippet: 'UNTRUSTED_SEARCH_SNIPPET' };
  records['expert_knowledge:method-1'].raw_metadata = { customer: 'RAW_METADATA_BUSINESS_SENTINEL' };
  const result = await camosMethods({ query: 'buyer question $(must-stay-literal)' });
  assert.equal(result.status, 'connected');
  assert.deepEqual(result.ruleIds, ['expert_knowledge:method-1']);
  assert.match(result.text, /先明确买家问题/);
  assert.match(result.text, /必须逐项写出实际采用的 CAMOS 条目 ID/);
  assert.doesNotMatch(result.text, /UNTRUSTED_SEARCH_SNIPPET|RAW_METADATA_BUSINESS_SENTINEL/);
  assert.ok(result.text.indexOf('POLICY:') < result.text.indexOf('## CAMOS 条目'));
  assert.equal(result.provenance.businessLoaded, false);
  assert.equal(calls.length, 2);
  const search = calls[0];
  assert.equal(search.file, path.join(root, 'runtime/python/python.exe'));
  assert.equal(search.args[search.args.indexOf('--type') + 1], 'EXPERT_KNOWLEDGE');
  assert.equal(search.args[search.args.indexOf('--query') + 1], 'buyer question $(must-stay-literal)');
  assert.equal(search.options.shell, false);
  assert.equal(search.options.env.DATABASE_URL, undefined);
  const state = search.args[search.args.indexOf('--state') + 1];
  await assert.rejects(access(state));
});

test('mixed data installations are rejected before ResearchHub can index business or other datasets', async () => {
  for (const dataset of ['business', 'crm']) {
    const dir = path.join(root, 'data', dataset);
    await mkdir(dir);
    await writeFile(path.join(dir, 'records.jsonl'), 'BUSINESS_SENTINEL');
    const result = await camosMethods({ query: '写作' });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'CAMOS_METHOD_ONLY_ROOT_REQUIRED');
    assert.equal(result.text, '');
    await rm(dir, { recursive: true });
  }
  assert.equal(calls.length, 0);
});

test('rejects business hits, metadata dereferences and inactive IDs before source lookup', async () => {
  hits.push(
    record('crm-poison', 'BUSINESS_SENTINEL', { source_type: 'CRM' }),
    record('path-poison', 'BUSINESS_SENTINEL', { source_file: 'data/business/facts.md' }),
    record('traversal-poison', 'BUSINESS_SENTINEL', { source_file: 'data/expert_knowledge/../business/facts.md' }),
    record('ref-poison', 'BUSINESS_SENTINEL', { metadata_ref: { path: 'data/business/facts.json' } }),
    record('revoked', 'DEPRECATED_SENTINEL', { status: 'superseded' }),
    record('nested-revoked', 'DEPRECATED_SENTINEL', { metadata: { scope: 'METHOD_NOT_COMPANY_FACT', status: '废止' } }),
  );
  const result = await camosMethods({ query: '写作' });
  assert.equal(result.status, 'connected');
  assert.deepEqual(result.ruleIds, ['expert_knowledge:method-1']);
  assert.doesNotMatch(result.text, /BUSINESS_SENTINEL|DEPRECATED_SENTINEL/);
  assert.equal(calls.filter(call => call.args.includes('source')).length, 1);
});

test('rechecks source status and removes deprecated claims and brand examples from mixed method text', async () => {
  records['expert_knowledge:method-1'].text = '# 方法\n- 先查买家问题与来源。\n- 前6000字才可读，60%正面才采信。\n- YG25 旧定位 P1024 已认证。\n- 禾茂 DMK pipeline 已跑通，BUSINESS_SENTINEL。\n## 禾茂落地卡\n未标品牌的私有参数：BUSINESS_SENTINEL\n## 通用步骤\n- 给出来源定位和适用条件。';
  records['expert_knowledge:changed'] = record('changed', 'DEPRECATED_SENTINEL', { status: 'deprecated' });
  hits.push(record('changed', 'search was active'));
  const result = await camosMethods({ query: '写作' });
  assert.equal(result.status, 'connected');
  assert.match(result.text, /先查买家问题与来源/);
  assert.match(result.text, /给出来源定位和适用条件/);
  assert.doesNotMatch(result.text, /前6000字才可读|P1024|BUSINESS_SENTINEL|DEPRECATED_SENTINEL/);
  assert.deepEqual(result.ruleIds, ['expert_knowledge:method-1']);
});

test('maps exactly the four real CAMOS sites and forwards the requested writing scope', async () => {
  for (const [site, expected] of [
    ['https://www.chipshow.com', 'chipshow-three-site-writing'],
    ['chipshowledusa.com', 'chipshow-three-site-writing'],
    ['chipshow.eu', 'chipshow-three-site-writing'],
    ['unishineled.com', 'unishine-independent-writing'],
  ]) {
    const domain = site.includes('://') ? new URL(site).hostname.replace(/^www\./, '') : site;
    const result = await camosMethods({ query: 'buyer decision', writing: {
      site, target_url: `https://www.${domain}/guide/`, page_type: 'article', language_profile: 'technical',
    } });
    assert.equal(result.status, 'connected');
    assert.ok(result.ruleIds.includes(expected));
    const args = calls.at(-1)!.args;
    for (const [flag, value] of [['--site', domain], ['--page-type', 'article'], ['--language-profile', 'technical']]) {
      assert.equal(args[args.indexOf(flag) + 1], value);
    }
    assert.ok(args.includes('writing'));
    assert.ok(!args.includes('task') && !args.includes('run'));
    assert.doesNotMatch(result.text, /PRIVATE_TOPIC_SENTINEL|INTERNAL_PATH_MAP_SENTINEL/);
  }
});

test('main-site product rules preserve the SOP without injecting the reference product facts', async () => {
  const result = await camosMethods({ query: '新品', writing: { site: 'chipshow.com', target_url: 'https://chipshow.com/product/new/', page_type: 'product' } });
  assert.equal(result.status, 'connected');
  assert.match(result.text, /Hero 50–70 words; post_excerpt/);
  assert.match(result.text, /CAMOS adoption amendment/);
  assert.doesNotMatch(result.text, /9304|C-Pad-M|PRIVATE_TOPIC_SENTINEL/);
  assert.equal(calls.at(-1)!.args[calls.at(-1)!.args.indexOf('--language-profile') + 1], 'clear');
});

test('unknown hosts, shortcuts, cross-site URLs and unsupported language profiles do not start CAMOS', async () => {
  for (const writing of [
    { site: 'chipshow.us', target_url: 'https://chipshow.us/a/', page_type: 'article' },
    { site: 'us', target_url: 'https://chipshowledusa.com/a/', page_type: 'article' },
    { site: 'chipshow.com', target_url: 'https://unishineled.com/a/', page_type: 'article' },
    { site: 'chipshow.com', target_url: 'https://chipshow.com/a/', page_type: '' },
    { site: 'chipshow.com', target_url: 'https://chipshow.com/a/', page_type: 'article', language_profile: 'unreviewed' },
  ]) {
    const result = await camosMethods({ query: '写作', writing });
    assert.equal(result.status, 'unavailable');
    assert.equal(result.text, '');
  }
  assert.equal(calls.length, 0);
});

test('empty searches still return policy context without inventing retrieved IDs', async () => {
  hits = [];
  const result = await camosMethods({ query: 'no matching method' });
  assert.equal(result.status, 'connected');
  assert.deepEqual(result.ruleIds, []);
  assert.match(result.text, /POLICY:/);
});

test('missing policy or non-local writing results fail closed and discard partial prompt text', async () => {
  const original = writingResult;
  writingResult = args => ({ ...original(args), model_called: true });
  const result = await camosMethods({ query: '写作', writing: { site: 'chipshow.com', target_url: 'https://chipshow.com/a/', page_type: 'article' } });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.text, '');
  assert.deepEqual(result.ruleIds, []);
  await rm(path.join(root, 'data/expert_knowledge/corrections.md'));
  const count = calls.length;
  assert.equal((await camosMethods({ query: '写作' })).status, 'unavailable');
  assert.equal(calls.length, count);
});
