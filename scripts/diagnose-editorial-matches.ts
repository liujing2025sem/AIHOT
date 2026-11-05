import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { questionKeywords, keywordMatch } from '../packages/backend/src/admin/studio-question-match.ts';

const baseline = '8824853';
const root = fileURLToPath(new URL('../', import.meta.url));
const questionMap = z.object({ questions: z.array(z.object({
  question: z.string(),
  keywords: z.array(z.string()).default([]),
  keywords_zh: z.array(z.string()).optional(),
  keywords_en: z.array(z.string()).optional(),
  active: z.boolean().default(true),
})) });
const preview = z.object({
  generatedAt: z.string().optional(),
  previews: z.array(z.object({
    id: z.string(),
    output: z.object({ items: z.array(z.object({
      title: z.string(),
      publishedAt: z.string().nullable().optional(),
    })) }).optional(),
  })),
});

// Exact literal matching used by studio-recommendations.ts at 8824853, including word boundaries.
function baselineKeywordMatch(q: z.infer<typeof questionMap>['questions'][number], text: string) {
  return q.keywords.filter(word => {
    if (/^[a-z0-9 ]+$/i.test(word)) {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(text);
    }
    return text.toLowerCase().includes(word.toLowerCase());
  }).length;
}

const json = (text: string): unknown => JSON.parse(text.replace(/^\uFEFF/, ''));
const tsvCell = (value: string) => value.replace(/[\t\r\n]+/g, ' ');

try {
  const { values } = parseArgs({ options: {
    input: { type: 'string' },
    format: { type: 'string', default: 'tsv' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    process.stdout.write('Usage: node scripts/diagnose-editorial-matches.ts --input <source-previews.json> [--format tsv|json]\nRead-only local title diagnostic; no DB, model, network, card generation or seven-day policy changes.\n');
  } else {
    if (!values.input) throw new Error('--input is required; provide an existing real preview JSON file.');
    if (values.format !== 'tsv' && values.format !== 'json') throw new Error('--format must be tsv or json.');
    const input = preview.parse(json(readFileSync(values.input, 'utf8')));
    const before = questionMap.parse(json(execFileSync('git', ['show', `${baseline}:industry/question-map.example.json`], {
      cwd: root, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024,
    }))).questions.filter(q => q.active);
    const after = questionMap.parse(json(readFileSync(new URL('../industry/question-map.example.json', import.meta.url), 'utf8'))).questions.filter(q => q.active);
    const rows = input.previews.flatMap(source => (source.output?.items ?? []).map(item => ({
      source: source.id,
      title: item.title,
      published_at: item.publishedAt ?? null,
      before_questions: before.filter(q => baselineKeywordMatch(q, item.title) > 0).map(q => q.question),
      after_questions: after.filter(q => keywordMatch(q, item.title) > 0).map(q => q.question),
    })));
    const summary = {
      input: values.input,
      input_generated_at: input.generatedAt ?? null,
      baseline_commit: baseline,
      before_question_count: before.length,
      after_question_count: after.length,
      current_keyword_count: new Set(after.flatMap(questionKeywords)).size,
      sample_count: rows.length,
      before_matched_items: rows.filter(row => row.before_questions.length > 0).length,
      after_matched_items: rows.filter(row => row.after_questions.length > 0).length,
      newly_matched_items: rows.filter(row => !row.before_questions.length && row.after_questions.length > 0).length,
      no_longer_matched_items: rows.filter(row => row.before_questions.length > 0 && !row.after_questions.length).length,
      unknown_date_items: rows.filter(row => !row.published_at).length,
      time_gate_applied: false,
      cards_generated: false,
      scope: '8824853 question map + original literal matcher versus current question map + actual questionKeywords/keywordMatch; combined changes, not an isolated matcher benchmark.',
      limitation: 'Title-only preview samples, not complete article bodies or stored articles; keyword matches do not establish relevance, source eligibility, editorial card quality or business results. No date exclusion is applied in this diagnostic; the production seven-day rule is unchanged.',
    };
    if (values.format === 'json') {
      process.stdout.write(JSON.stringify({ summary, rows }, null, 2) + '\n');
    } else {
      process.stderr.write(JSON.stringify(summary, null, 2) + '\n');
      process.stdout.write('source\ttitle\tpublished_at\tbefore_questions\tafter_questions\n');
      for (const row of rows) process.stdout.write([
        row.source, row.title, row.published_at ?? '', row.before_questions.join(' | '), row.after_questions.join(' | '),
      ].map(tsvCell).join('\t') + '\n');
    }
  }
} catch (error) {
  process.stderr.write(`Editorial match diagnostic failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
