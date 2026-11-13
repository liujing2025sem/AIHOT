// Read-only explanation of the same material and event rules used for brief composition.
import { CATEGORIES } from '@aihot/industry/taxonomy';
import { evaluateNewsEligibility, type NewsEligibility, type NewsKind } from '../../../../industry/news-eligibility.ts';
import { editorialVersionSourceIds } from '../../../../site/editorial-sources.ts';
import { sha256 } from '../../../../scripts/editorial-pilot-lib.ts';
import type { BriefMaterial } from './studio-brief.ts';
import type { BriefSelection } from './studio-brief-content.ts';

type IssueCode = 'missing_article' | 'missing_body' | 'invalid_url' | 'duplicate' | Exclude<NewsEligibility['reason'], 'eligible'>;
type DuplicateBasis = 'event_id' | 'canonical_url' | 'title' | 'body';
type Issue = { code: IssueCode; message_zh: string; action_zh: string };

export type BriefSelectionInspection = {
  checked_at: string;
  article_ids: string[];
  counts: { selected: number; independent_events: number; eligible_independent_events: number; additional_events_needed: number };
  can_compose: boolean;
  materials: Array<{
    article_id: string; revision: number | null; title: string; source_name: string | null;
    code: 'eligible' | IssueCode; issues: Issue[]; duplicate_of: string | null;
    kind: NewsKind | null; window_days: 14 | 30 | null; age_days: number | null;
    date_basis: NewsEligibility['dateBasis']; effective_at: string | null;
  }>;
  duplicates: Array<{ article_ids: string[]; matched_by: DuplicateBasis[] }>;
};

export type BriefMaterialAssessment = BriefSelectionInspection & {
  events: BriefSelection['events'];
  first_error: string | null;
};

const invalid = (message: string): never => { throw Object.assign(new Error(message), { statusCode: 400 }); };
const normalText = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
function canonicalUrl(value: string) {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_.+|fbclid|gclid)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}

function eligibilityIssue(value: NewsEligibility): Issue | null {
  const window = `${value.windowDays} 天`;
  switch (value.reason) {
    case 'eligible': return null;
    case 'reference_only': return { code: value.reason, message_zh: '这是参考资料，不能当作本期新闻。', action_zh: '移出本期，保留在资料池。' };
    case 'already_published': return { code: value.reason, message_zh: '本事件已发过，不能当作本期新动态。', action_zh: '移出本期，选择尚未报道的独立事件。' };
    case 'first_import_baseline': return { code: value.reason, message_zh: '首次导入的版本基线不算新动态。', action_zh: '等待有证据的新版本变化，或改选其他新闻。' };
    case 'missing_date': return { code: value.reason, message_zh: '缺少原文日期或新版本变化证据。', action_zh: '尝试补齐日期，再打开原文核对；不能用采集日代替。' };
    case 'invalid_date': return { code: value.reason, message_zh: '发布日期不符合可核对的日期格式。', action_zh: '打开原文核对日期，必要时调整信源提取。' };
    case 'future_date': return { code: value.reason, message_zh: '原文日期在未来。', action_zh: '核对原文和信源时区，暂不加入本期。' };
    case 'expired': return { code: value.reason, message_zh: `已超过这类新闻的 ${window} 时效窗口。`, action_zh: '移出本期，选择更近期的独立事件。' };
  }
}

/** Pure assessment shared by selection preview, API composition, and the worker. */
export function assessBriefMaterials(materials: BriefMaterial[], ids: string[], now = new Date().toISOString()): BriefMaterialAssessment {
  if (!ids.length || ids.length > 12 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== 'string' || !id.trim())) {
    return invalid('请提供 1–12 条不同且有效的材料编号。');
  }
  const byId = new Map(materials.map(a => [a.id, a]));
  const parent = ids.map((_, index) => index);
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]!));
  const join = (a: number, b: number) => { const first = find(a), second = find(b); if (first !== second) parent[second] = first; };
  const identities = new Map<string, number>();
  const overlaps: { a: number; b: number; basis: DuplicateBasis }[] = [];
  const selected = ids.map(id => byId.get(id));
  const events: BriefSelection['events'] = [];
  const rows = selected.map((material, index) => {
    const issues: Issue[] = [];
    if (!material) issues.push({ code: 'missing_article', message_zh: '这条材料已不在资料池。', action_zh: '刷新选稿列表，移除无效选择。' });
    if (material && (material.body_status !== 'ok' || !material.body_text?.trim())) {
      issues.push({ code: 'missing_body', message_zh: '尚无完整正文。', action_zh: '尝试补齐正文；仍失败则打开来源核对或移除。' });
    }
    if (material) {
      const keys: [DuplicateBasis, string][] = [];
      if (material.event_id) keys.push(['event_id', `event:${material.event_id}`]);
      try { keys.push(['canonical_url', `url:${canonicalUrl(material.url)}`]); }
      catch { issues.push({ code: 'invalid_url', message_zh: '原文链接无效。', action_zh: '打开材料详情核对链接，或移除这条材料。' }); }
      keys.push(['title', `title:${normalText(material.title)}`]);
      if (material.body_text?.trim()) keys.push(['body', `body:${sha256(normalText(material.body_text))}`]);
      for (const [basis, key] of keys) {
        const previous = identities.get(key);
        if (previous !== undefined) { join(previous, index); overlaps.push({ a: previous, b: index, basis }); }
        else identities.set(key, index);
      }
      const eligibility = evaluateNewsEligibility({ title: material.title, bodyText: material.body_text, category: material.category, now,
        publishedAt: material.published_at, referenceOnly: material.reference_only, alreadyPublished: material.already_published,
        backfillReason: material.backfill_reason, versionSource: editorialVersionSourceIds.includes(material.source_id),
        discoveredAt: material.discovered_at, sourceBaselineAt: material.source_baseline_at,
        ...(material.baseline_title && material.version_observed_at ? { versionEvidence: { baselineTitle: material.baseline_title, baselineBodyText: material.baseline_body, observedAt: material.version_observed_at } } : {}),
      });
      const newsIssue = eligibilityIssue(eligibility);
      if (newsIssue) issues.push(newsIssue);
      if (!issues.length) events.push({ article_id: material.id, event_id: material.event_id,
        section: CATEGORIES.some(category => category.key === material.category) ? material.category as BriefSelection['events'][number]['section'] : 'industry',
        publication_time: material.publication_time, source_utc_offset: material.source_utc_offset,
        date_basis: eligibility.dateBasis!, observed_version_at: eligibility.dateBasis === 'observed_version' ? eligibility.effectiveAt : null,
      });
      return { article_id: material.id, revision: material.revision, title: material.title, source_name: material.source_name,
        code: (issues[0]?.code ?? 'eligible') as 'eligible' | IssueCode, issues, duplicate_of: null as string | null,
        kind: eligibility.kind, window_days: eligibility.windowDays, age_days: eligibility.ageDays,
        date_basis: eligibility.dateBasis, effective_at: eligibility.effectiveAt };
    }
    return { article_id: ids[index]!, revision: null, title: ids[index]!, source_name: null,
      code: 'missing_article' as const, issues, duplicate_of: null as string | null,
      kind: null, window_days: null, age_days: null, date_basis: null, effective_at: null };
  });

  const groups = new Map<number, number[]>();
  for (let index = 0; index < selected.length; index++) if (selected[index]) {
    const root = find(index); groups.set(root, [...(groups.get(root) ?? []), index]);
  }
  const duplicates: BriefSelectionInspection['duplicates'] = [];
  for (const members of groups.values()) {
    if (members.length === 1) continue;
    const matched_by = [...new Set(overlaps.filter(pair => members.includes(pair.a) && members.includes(pair.b)).map(pair => pair.basis))];
    duplicates.push({ article_ids: members.map(i => ids[i]!), matched_by });
    for (const index of members.slice(1)) {
      const first = members[0]!;
      const item = rows[index]!;
      item.duplicate_of = ids[first]!;
      item.issues.push({ code: 'duplicate', message_zh: `与「${rows[first]!.title}」初步识别为同一事件或重复原文。`, action_zh: '核对两条来源，决定保留哪一条，再移除重复材料。' });
      if (item.code === 'eligible') item.code = 'duplicate';
    }
  }
  const eligible = groups.size === 0 ? 0 : [...groups.values()].filter(members => members.some(index =>
    rows[index]!.issues.every(issue => issue.code === 'duplicate'))).length;
  const first = rows.find(row => row.issues.length)?.issues[0];
  const firstRow = rows.find(row => row.issues.length);
  const first_error = first?.code === 'missing_article' ? '部分所选材料不存在，请刷新选稿列表。'
    : first?.code === 'missing_body' ? `“${firstRow!.title.slice(0, 45)}”尚无完整正文，请补齐或移除。`
    : first?.code === 'duplicate' ? `“${firstRow!.title.slice(0, 45)}”与已选材料属于同一事件或重复原文，请只保留主出处。`
    : first ? `“${firstRow!.title.slice(0, 45)}”：${first.message_zh}${firstRow!.window_days ? `（${firstRow!.window_days} 天）。` : ''}` : null;
  return { checked_at: now, article_ids: [...ids],
    counts: { selected: ids.length, independent_events: groups.size, eligible_independent_events: eligible, additional_events_needed: Math.max(0, 5 - eligible) },
    can_compose: ids.length >= 5 && !first && eligible >= 5,
    materials: rows, duplicates, events, first_error };
}
