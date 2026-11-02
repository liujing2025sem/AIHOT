// Reproducible local DB -> file handoff -> internal review. No worker, model API or public writes.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { packetSchema, safeId, sha256, instructions, responseFormat, validateResponse, renderReview, writingHandoffFiles, type Packet } from './editorial-pilot-lib.ts';

const [command, directory, argument] = process.argv.slice(2);
if (!directory || !['export', 'receive', 'status'].includes(command)) throw Error('Usage: editorial-pilot.ts export <dir> <task-id> | receive <dir> <response.json> | status <dir>');
const root = path.resolve(directory);
const requestPath = path.join(root, 'request.json');
// Resume a partial receive without replacing a colleague's edits.
function writeOnce(file: string, text: string) {
  if (existsSync(file)) {
    if (readFileSync(file, 'utf8') !== text) throw Error(`Existing output differs; preserve it for review: ${path.basename(file)}`);
  } else writeFileSync(file, text, { flag: 'wx' });
}
if (command === 'export') {
  const taskId = safeId.parse(argument);
  const { config } = await import('@aihot/backend/config');
  const db = new URL(config.databaseUrl);
  if (!['127.0.0.1', 'localhost'].includes(db.hostname) || !db.pathname.endsWith('_test')) throw Error('Export uses the isolated loopback *_test database only');
  const { sql, closeDb } = await import('@aihot/backend/db');
  try {
    const rows = await sql`SELECT a.id,a.source_id,s.name AS source_name,a.revision,a.title,a.url,a.published_at,a.body_status,a.body_text FROM articles a JOIN sources s ON a.source_id=s.id WHERE a.source_id IN ('web-macroblock-news','web-kinglight-news','web-nationstar-product-news') ORDER BY a.source_id,a.id`;
    const articles = rows.map(a => ({ binding: { article_id: a.id, revision: a.revision, content_sha256: sha256(JSON.stringify([a.title,a.body_status,a.body_text])), url: a.url, published_at: a.published_at?.toISOString() ?? null }, source_id: a.source_id, source_name: a.source_name, title: a.title, body_status: a.body_status, body_text: a.body_text }));
    const selected = articles.filter(a => a.binding.url.includes('LED_Display_Symposium_LED_Driver_IC') || a.binding.url.includes('kinglight-2-in-1-led-for-outdoor')).map(a => a.binding.article_id);
    if (selected.length !== 2) throw Error('The two real pilot source articles are required');
    const packet = packetSchema.parse({ schema: 'aihot-editorial-pilot/1', task_id: taskId, created_at: new Date().toISOString(), scope: 'LOCAL_AGENT_HANDOFF_NOT_AUTOMATED_AIHOT_PIPELINE', articles, draft_article_ids: selected });
    mkdirSync(root, { recursive: true });
    let exportedPacket = packet;
    let exportStatus = 'EXPORTED';
    if (existsSync(requestPath)) {
      const prior = packetSchema.parse(JSON.parse(readFileSync(requestPath, 'utf8')));
      if (prior.task_id !== taskId || JSON.stringify(prior.articles) !== JSON.stringify(packet.articles)) throw Error('Existing handoff has different inputs; use a new task directory for a new source revision');
      exportedPacket = prior;
      exportStatus = 'EXISTING_INPUT_REUSED';
    } else {
      writeFileSync(requestPath, JSON.stringify(packet, null, 2), { flag: 'wx' });
      writeFileSync(path.join(root, 'START_HERE.md'), instructions(packet), { flag: 'wx' });
      writeFileSync(path.join(root, 'RESPONSE_FORMAT.json'), JSON.stringify(responseFormat(packet), null, 2), { flag: 'wx' });

    }
    // Supplement old packets without replacing their START_HERE or colleague drafts.
    for (const [name, text] of Object.entries(writingHandoffFiles(exportedPacket))) {
      const file = path.join(root, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeOnce(file, text);
    }
    console.log(JSON.stringify({ status: exportStatus, task_id: taskId, article_count: articles.length, draft_article_ids: selected, writing_entry: 'WRITING_START_HERE.md' }));
  } finally { await closeDb(); }
} else {
  const packet: Packet = packetSchema.parse(JSON.parse(readFileSync(requestPath, 'utf8')));
  if (command === 'status') {
    console.log(JSON.stringify({ task_id: packet.task_id, articles: packet.articles.length, draft_article_ids: packet.draft_article_ids, state: 'LOCAL_REVIEW_ONLY', source: requestPath }));
  } else {
    if (!argument) throw Error('Response path required');
    const bytes = readFileSync(path.resolve(argument), 'utf8');
    const response = validateResponse(packet, JSON.parse(bytes));
    const out = path.join(root, 'received', response.run_id);
    const receiptFile = path.join(out, 'receipt.json');
    if (existsSync(receiptFile)) {
      const old = JSON.parse(readFileSync(receiptFile, 'utf8'));
      if (old.response_sha256 !== sha256(bytes)) throw Error('Run already received with different output; preserve the reviewed result and use a new run ID');
      console.log(JSON.stringify({ status: 'ALREADY_RECEIVED', task_id: packet.task_id, run_id: response.run_id }));
    } else {
      mkdirSync(out, { recursive: true });
      writeOnce(path.join(out, 'response.json'), bytes);
      writeOnce(path.join(out, 'review.html'), renderReview(packet, response));
      for (const draft of response.drafts) {
        writeOnce(path.join(out, `${draft.source.article_id}.zh.md`), `# ${draft.title_zh}\n\n待审核；外部 Agent 接棒试验。\n\n${draft.review_zh}\n\n原文：${draft.source.url}\n`);
        writeOnce(path.join(out, `${draft.source.article_id}.en.md`), `# ${draft.title_en}\n\nInternal draft, not approved for publication.\n\n${draft.body_en}\n`);
      }
      const receipt = { task_id: packet.task_id, run_id: response.run_id, received_at: new Date().toISOString(), response_sha256: sha256(bytes), source_match: true, source_state: 'EXPORTED_SNAPSHOT_ONLY', decisions: response.decisions.length, drafts: response.drafts.length, human_approval: 'PENDING', publication: 'NOT_REQUESTED', model_api_called_by_aihot: false, harness_module_used: false, model: response.producer.model, reported_cost: null, currency: null };
      writeFileSync(receiptFile, JSON.stringify(receipt, null, 2), { flag: 'wx' });
      console.log(JSON.stringify(receipt));
    }
  }
}
