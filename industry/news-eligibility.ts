// G3 is an event-selection policy. It does not relax the separate rule for claims such as “today”.
export type NewsKind = 'upstream_update' | 'project_market';
export type NewsEligibilityInput = {
  title: string;
  bodyText?: string | null;
  category?: string | null;
  itemType?: string | null;
  publishedAt?: string | Date | null;
  now?: string | Date | number;
  referenceOnly?: boolean;
  alreadyPublished?: boolean;
  backfillReason?: string | null;
  versionSource?: boolean;
  discoveredAt?: string | Date | null;
  sourceBaselineAt?: string | Date | null;
  /** The earlier version of this same material and when the new version was first observed. */
  versionEvidence?: { baselineTitle: string; baselineBodyText?: string | null; observedAt: string | Date };
};
export type NewsEligibility = {
  eligible: boolean;
  windowDays: 14 | 30;
  kind: NewsKind;
  reason: 'eligible' | 'reference_only' | 'already_published' | 'first_import_baseline' | 'missing_date' | 'invalid_date' | 'future_date' | 'expired';
  ageDays: number | null;
  dateBasis: 'published' | 'observed_version' | null;
  effectiveAt: string | null;
};

const DAY = 86_400_000;
const time = (value: string | Date | number | null | undefined) => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:$|T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$)/.test(value)) return NaN;
  const date = Date.parse(value), day = Date.parse(value.slice(0, 10));
  return Number.isFinite(date) && Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value.slice(0, 10) ? date : NaN;
};
export const newsVersions = (text: string) => [...new Set((text.match(/\bv?\d+\.\d+(?:\.\d+){0,2}\b/gi) ?? []).map(v => v.toLowerCase().replace(/^v/, '')))].sort();
const versionContext = /\b(?:NovaLCT|ViPlex|LEDVISION|LEDStudio|HDPlayer|firmware|software|release notes)\b|固件|软件|版本更新/iu;
const component = /\b(?:driver\s+ics?|led\s+drivers?|integrated\s+circuits?|ics?|led\s+(?:chips?|packages?|beads?)|power\s+suppl(?:y|ies)|receiv(?:er|ing)\s+cards?|send(?:er|ing)\s+cards?|video\s+processors?|display\s+controllers?|controller\s+(?:cards?|firmware)|SMD|COB|MiP|microLED\s+chips?)\b|驱动芯片|驱动\s*IC|灯珠|封装|电源|芯片|接收卡|发送卡|视频处理器|控制器|箱体材料/iu;
const release = /\b(?:launch(?:es|ed|ing)?|introduc(?:e|es|ed|ing)|releas(?:e|es|ed|ing)|unveil(?:s|ed|ing)?|announc(?:e|es|ed|ing|ement)|new|updat(?:e|es|ed|ing)|revis(?:ed|ion)|specification\s+changes?)\b|发布|推出|新款|新品|更新|修订|规格变更|参数变更|新增支持/iu;
const market = /\b(?:revenue|earnings|financial|profit|fiscal|quarterly|acquisition|merger|investment|partnership|awards?|exhibition|trade\s+show|exhibit(?:s|ed|ing)?|showcase(?:s|d)?|projects?|install(?:s|ed|ation)?|deploy(?:s|ed|ment)?|stadium|billboard|factory|plant|production\s+capacity)\b|营收|财报|利润|订单|收购|并购|签约|展会|参展|展示|项目|安装|交付|亮屏|球场|工厂|产能/iu;
const projectOrBusiness = /\b(?:revenue|earnings|financial|profit|fiscal|quarterly|acquisition|merger|investment|partnership|awards?|projects?|install(?:s|ed|ation)?|deploy(?:s|ed|ment)?|stadium|billboard|factory|plant|production\s+capacity)\b|营收|财报|利润|订单|收购|并购|签约|项目|安装|交付|亮屏|球场|工厂|产能/iu;
const explicitLaunch = /\b(?:launch(?:es|ed|ing)?|introduc(?:e|es|ed|ing)|releas(?:e|es|ed|ing)|unveil(?:s|ed|ing)?)\b|发布|推出/iu;
const reference = /\b(?:guide|tutorial|how\s+to|explained|comparison|review|retrospective)\b|教程|指南|科普|如何|怎么|复盘|选型|对比/iu;

/** Classify the event's subject/action, never grant 30 days solely for a manufacturer or feed name. */
export function classifyNewsKind(input: Pick<NewsEligibilityInput, 'title' | 'bodyText' | 'category' | 'itemType' | 'versionSource'>): NewsKind {
  const title = input.title, text = `${title}\n${input.bodyText ?? ''}`;
  // A maker's financial result, project, or trade-show attendance is still a 14-day event.
  if (market.test(title) && !(explicitLaunch.test(title) && component.test(title) && !projectOrBusiness.test(title))) return 'project_market';
  const titledVersions = newsVersions(title);
  if (!reference.test(title) && titledVersions.length && (input.versionSource || versionContext.test(title))) return 'upstream_update';
  if (!reference.test(title) && release.test(title) && component.test(title)) return 'upstream_update';
  // A short launch headline may name only the model. Require component evidence in its actual body.
  if (!reference.test(title) && release.test(title) && component.test(text)
    && (input.category === 'components-ics' || input.category === 'control-software' || input.itemType === 'product_launch')) return 'upstream_update';
  return 'project_market';
}

/** Pure shared gate for recommendations and brief composition. Publication/event dedupe is supplied by the caller. */
export function evaluateNewsEligibility(input: NewsEligibilityInput): NewsEligibility {
  const kind = classifyNewsKind(input), windowDays = kind === 'upstream_update' ? 30 : 14;
  const result = (reason: NewsEligibility['reason'], ageDays: number | null = null, dateBasis: NewsEligibility['dateBasis'] = null, at?: number): NewsEligibility => ({ eligible: reason === 'eligible', kind, windowDays, reason, ageDays, dateBasis, effectiveAt: at !== undefined && Number.isFinite(at) ? new Date(at).toISOString() : null });
  if (input.referenceOnly) return result('reference_only');
  if (input.alreadyPublished) return result('already_published');
  const now = time(input.now ?? Date.now());
  if (!Number.isFinite(now)) return result('invalid_date');
  const currentVersions = newsVersions(input.title).length ? newsVersions(input.title) : newsVersions(input.bodyText ?? '');
  const baseline = input.versionEvidence;
  const baselineVersions = baseline ? newsVersions(baseline.baselineTitle).length ? newsVersions(baseline.baselineTitle) : newsVersions(baseline.baselineBodyText ?? '') : [];
  const isVersion = kind === 'upstream_update' && currentVersions.length > 0 && (input.versionSource || versionContext.test(`${input.title}\n${input.bodyText ?? ''}`));
  const changedVersion = isVersion && baselineVersions.length > 0 && currentVersions.some(v => !baselineVersions.includes(v));
  if (input.versionSource && input.backfillReason === 'first-import' && !changedVersion) return result('first_import_baseline');
  let date = time(input.publishedAt), basis: NewsEligibility['dateBasis'] = 'published';
  if (!input.publishedAt) {
    const discovered = time(input.discoveredAt), initialized = time(input.sourceBaselineAt);
    const postBaselineNewIdentity = input.versionSource && input.backfillReason !== 'first-import'
      && Number.isFinite(initialized) && Number.isFinite(discovered) && discovered > initialized;
    date = changedVersion ? time(baseline!.observedAt) : postBaselineNewIdentity && isVersion ? discovered : NaN;
    if (!Number.isFinite(date)) return result('missing_date');
    basis = 'observed_version';
  }
  if (!Number.isFinite(date)) return result('invalid_date');
  const age = (now - date) / DAY;
  if (age < 0) return result('future_date', age, basis, date);
  if (age > windowDays) return result('expired', age, basis, date);
  return result('eligible', age, basis, date);
}

/** Recheck the age of a previously classified card without reclassifying its buyer-question title. */
export function newsCardExpired(kind: NewsKind, at: string | Date | null | undefined, now: string | Date | number = Date.now()): boolean {
  const date = time(at), current = time(now), age = (current - date) / DAY;
  return !Number.isFinite(age) || age < 0 || age > (kind === 'upstream_update' ? 30 : 14);
}
