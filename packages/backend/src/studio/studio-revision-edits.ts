import { z } from 'zod';
import { responseSchema, validateResponse, type Packet, type Response } from '../../../../scripts/editorial-pilot-lib.ts';
import { editedFragmentPacket } from './studio-review-edits.ts';

export const revisionGoalSchema = z.enum(['clarify_buyer_answer', 'shorten', 'evidence_only']);
export const revisionGoalLabels = {
  clarify_buyer_answer: '先回答买家问题，保留适用条件',
  shorten: '压缩重复表述，保留关键事实和出处',
  evidence_only: '删除无依据的承诺，保留能核对的内容',
} as const;
export const revisionResultSchema = z.object({
  edits: z.array(z.object({
    field: z.enum(['title_en', 'body_en', 'meta_description_en', 'title_zh', 'review_zh']),
    original: z.string().min(1).max(12000),
    replacement: z.string().max(12000),
  }).strict()).min(1).max(16),
}).strict();

export type RevisionRequest = {
  version: number;
  status: 'queued' | 'running' | 'done' | 'failed' | 'unknown' | 'cancelled';
  goals: z.infer<typeof revisionGoalSchema>[];
  note: string;
  base_hash: string;
  receipt_id?: number | null;
  error?: string;
};

export function applyDraftRevision(packet: Packet, before: Response['drafts'][number], input: unknown) {
  const { edits } = revisionResultSchema.parse(input);
  const changes = edits.map(edit => {
    const start = before[edit.field].indexOf(edit.original);
    if (start < 0 || before[edit.field].indexOf(edit.original, start + 1) >= 0) {
      throw new Error('修改原句已变化或出现多次，保留原稿。');
    }
    if (edit.original === edit.replacement) throw new Error('修改建议没有改变原句，保留原稿。');
    return { ...edit, start, end: start + edit.original.length };
  });
  const next = structuredClone(before);
  let nextPacket = packet;
  for (const field of new Set(changes.map(change => change.field))) {
    const patches = changes.filter(change => change.field === field).sort((a, b) => b.start - a.start);
    for (let i = 1; i < patches.length; i++) {
      if (patches[i]!.end > patches[i - 1]!.start) throw new Error('修改建议互相重叠，保留原稿。');
    }
    for (const patch of patches) {
      if (field === 'body_en') {
        const updated = editedFragmentPacket(nextPacket, next, patch.start, patch.end, patch.replacement);
        if (!updated) throw new Error('修改超出已批准的片段，保留原稿。');
        nextPacket = updated;
      }
      next[field] = next[field].slice(0, patch.start) + patch.replacement + next[field].slice(patch.end);
    }
    if (!next[field].trim()) throw new Error('修改会清空必要内容，保留原稿。');
  }
  const plan = packet.pitch?.fragments_plan;
  if (packet.pitch?.output_type === 'update' && plan) {
    let previousEnd = 0;
    for (const operation of plan.edit_plan.filter(operation => operation.op === 'keep')) {
      const paragraph = plan.paragraphs.find(paragraph => paragraph.id === operation.paragraph);
      if (!paragraph) throw new Error('原页保留段落不存在，保留原稿。');
      const at = next.body_en.indexOf(paragraph.html, previousEnd);
      if (at < 0) throw new Error('修改涉及原页已锁定的保留段落，保留原稿。');
      previousEnd = at + paragraph.html.length;
    }
  }
  const selected = nextPacket.brief ? nextPacket : { ...nextPacket, draft_article_ids: [before.source.article_id] };
  const response = responseSchema.parse({
    task_id: packet.task_id, run_id: 'revision-validation',
    producer: { agent_id: 'studio-revision', model: null, input_files: ['saved-task', 'saved-draft'] },
    decisions: packet.articles.map(article => ({
      article_id: article.binding.article_id,
      decision: packet.brief || article.binding.article_id === before.source.article_id ? 'KEEP' : 'SKIP',
      reason_zh: '沿用本篇已绑定的事实来源，未改变选题范围。',
    })),
    drafts: [next],
  });
  validateResponse(selected, response);
  return {
    draft: next,
    packet: nextPacket,
    chineseStale: changes.some(change => ['title_en', 'body_en', 'meta_description_en'].includes(change.field)),
  };
}
