import { createHash } from 'node:crypto';
import type { Packet } from '../../../../scripts/editorial-pilot-lib.ts';
import { Conflict } from '../audit.ts';
import { assembleFragments } from './studio-pitch-fragments.ts';
import { sameWordPressHtml } from './studio-publishing-content.ts';

export const publicStudioTitle = (title: string) => title.replace(/\[UPDATE\]\s*/gi, '').trim();
export function samePage(first: string, second: string) {
  try {
    const a = new URL(first), b = new URL(second);
    if ([a, b].some(u => u.protocol !== 'https:' || u.username || u.password || u.hash)) return false;
    return a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '') && a.port === b.port &&
      a.pathname.replace(/\/+$/, '') === b.pathname.replace(/\/+$/, '') && a.search === b.search;
  } catch { return false; }
}
export const updateBaselineHash = (title: string, html: string) => createHash('sha256')
  .update(JSON.stringify([title.replace(/\r\n?/g, '\n'), html.replace(/\r\n?/g, '\n')])).digest('hex');

/** The task owns update identity. A changed title or frontend kind cannot turn it into a new page. */
export function studioUpgradeContext(packet: Packet) {
  const isUpdate = packet.pitch?.output_type === 'update' || packet.editorial_plan?.action === 'update_page';
  if (!isUpdate) return null;
  const urls = [packet.pitch?.output_type === 'update' ? packet.pitch.existing_url : '',
    packet.editorial_plan?.action === 'update_page' ? packet.editorial_plan.existing_url : ''].filter(Boolean);
  const target = urls[0];
  if (!target || urls.some(url => !samePage(target, url)) || !packet.articles.some(a => samePage(a.binding.url, target))) {
    throw new Conflict('升级任务的原页绑定缺失或冲突；请核对任务材料，不能改为新建文章。');
  }
  const plan = packet.pitch?.fragments_plan;
  const queryId = Number(new URL(target).searchParams.get('p'));
  const baseline = !!plan?.source_html && !!plan.original_title;
  return {
    delivery: 'shadow_draft' as const,
    target_existing_url: target,
    target_post_id: Number.isSafeInteger(queryId) && queryId > 0 ? queryId : null,
    baseline_sha256: baseline ? updateBaselineHash(plan.original_title, plan.source_html) : null,
    changes: (plan?.edit_plan ?? []).filter(edit => edit.op !== 'keep').map(edit => ({
      operation: edit.op, paragraph: edit.paragraph, reason: edit.reason ?? edit.heading ?? '请核对该段修改',
    })),
    notice: '这是独立影子预览稿，不修改原页面。请勿在 WordPress 直接发布影子稿；覆盖原页需单独确认。',
  };
}

type LivePage = { id: number; link: string; status: string; title: { raw: string }; content: { raw: string } };
export type UpdateConfirmation = { target_post_id: number; baseline_sha256: string };

/** A read-before-write check is deliberately fail-closed. It is not an atomic WordPress CAS. */
export function checkedUpdatePatch(packet: Packet, english: string, current: LivePage, confirmation: UpdateConfirmation) {
  const context = studioUpgradeContext(packet), plan = packet.pitch?.fragments_plan;
  if (!context || !plan?.source_html || !context.baseline_sha256 || !plan.fragments?.length) {
    throw new Conflict('原页升级缺少完整基线或已核对片段，仅可交付影子草稿。');
  }
  if (current.status !== 'publish' || !samePage(current.link, context.target_existing_url) ||
      confirmation.target_post_id !== current.id || context.target_post_id && current.id !== context.target_post_id ||
      confirmation.baseline_sha256 !== context.baseline_sha256 ||
      current.title.raw !== plan.original_title || !sameWordPressHtml(current.content.raw, plan.source_html)) {
    throw new Conflict('原页面已变化或确认对象不符；保留影子草稿，重新核对原页后再覆盖。');
  }
  const assembled = assembleFragments(plan.paragraphs, plan.edit_plan, plan.fragments);
  if (!assembled.complete || !sameWordPressHtml(english, assembled.html_en)) {
    throw new Conflict('英文稿与已核对的改动片段不一致，仅可交付影子草稿。');
  }
  // Apply only planned ranges onto the exact current raw HTML. Keep surrounding markup untouched.
  let content = current.content.raw;
  const patches = assembled.diff.filter(change => change.op !== 'keep');
  for (const change of patches.toReversed()) {
    const original = plan.paragraphs.find(paragraph => paragraph.id === change.paragraph)?.html;
    const at = original ? content.indexOf(original) : -1;
    if (!original || at < 0 || content.indexOf(original, at + original.length) !== -1) {
      throw new Conflict('原页段落无法唯一匹配，仅保留影子草稿，不覆盖其他段落。');
    }
    const replacement = change.op === 'insert_after' ? original + change.after : change.after;
    content = content.slice(0, at) + replacement + content.slice(at + original.length);
  }
  return { content, title: current.title.raw, baseline_sha256: updateBaselineHash(current.title.raw, current.content.raw) };
}
