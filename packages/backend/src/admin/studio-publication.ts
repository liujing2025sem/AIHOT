import type { Response } from '../../../../scripts/editorial-pilot-lib.ts';
import { editorialDirection, assertPublicEnglish } from '../../../../site/editorial.ts';

type Draft = Response['drafts'][number];
type SourceDateContext = { publicationTime: string | null; utcOffset: string };

const UTC_OFFSET = /^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/;

/** Validate before Date.parse: it silently rolls February 30 into March. */
function sourceDateValue(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/i.exec(value);
  if (!match) throw new Error('Invalid source publication date');
  const day = match[1]!;
  const calendar = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0,10) !== day) throw new Error('Invalid source calendar date');
  if (match[2] !== undefined && (Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59
    || (match[5]!.toUpperCase() !== 'Z' && !UTC_OFFSET.test(match[5]!)))) throw new Error('Invalid source publication time');
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) throw new Error('Invalid source publication date');
  return { day, instant, precision: match[2] === undefined ? 'day' as const : 'time' as const };
}

/** Source precision comes from stored metadata, never from a midnight timestamp. */
function originalDate(at: string | null, context?: SourceDateContext) {
  const unknown = { date: null, time: null, precision: 'unknown', utcOffset: null, label: 'not provided' };
  const metadata = context?.publicationTime == null ? null : sourceDateValue(context.publicationTime);
  const offset = context?.utcOffset;
  if (context && (!offset || !UTC_OFFSET.test(offset))) throw new Error('Invalid source UTC offset');
  if (at === null) return unknown;
  const original = sourceDateValue(at);
  const precision = metadata?.precision ?? (original.precision === 'day' ? 'day' : 'unknown');
  if (precision !== 'day' && !offset) return { ...unknown, label: 'not provided (source timezone unavailable)' };
  const offsetMinutes = offset ? (Number(offset.slice(1,3)) * 60 + Number(offset.slice(4))) * (offset[0] === '-' ? -1 : 1) : 0;
  const local = new Date(original.instant + offsetMinutes * 60000).toISOString();
  const originalDay = original.precision === 'day' ? original.day : local.slice(0,10);
  if (metadata?.precision === 'day' && metadata.day !== originalDay) throw new Error('Source calendar date changed; review the source again');
  if (metadata?.precision === 'time' && metadata.instant !== original.instant) throw new Error('Source publication time changed; review the source again');
  const calendar = metadata?.precision === 'day' ? metadata.day : originalDay;
  const date = new Date(`${calendar}T00:00:00Z`);
  const time = precision === 'time' ? local.slice(11,19) : null;
  const dateLabel = new Intl.DateTimeFormat('en-US',{year:'numeric',month:'long',day:'numeric',timeZone:'UTC'}).format(date);
  const detail = precision === 'day' ? 'date only; time not provided' : precision === 'time' ? `${time} UTC${offset}` : `original precision unknown; source timezone UTC${offset}`;
  return { date: calendar, time, precision, utcOffset: offset ?? null, label: `${dateLabel} (${detail})` };
}

/** Preserve a caution already present in either review language, including older stored drafts. */
export function publicationStatus(draft: Draft) {
  if (draft.news_status && draft.news_status !== 'reported') return draft.news_status;
  return /据传|尚未证实|未经证实|传闻|\bunconfirmed(?: report)?\b|\breportedly\b/i.test(
    `${draft.title_zh}\n${draft.review_zh}\n${draft.title_en}\n${draft.body_en}\n${draft.meta_description_en}`,
  ) ? 'unconfirmed' : 'reported';
}

export function publicDraft(draft: Draft, site: string = editorialDirection.publication_site, sourceDate?: SourceDateContext) {
  assertPublicEnglish(draft);
  const status = publicationStatus(draft);
  const labels = { reported: 'Source report', unconfirmed: 'Unconfirmed report', confirmed: 'Confirmation', denied: 'Denial / update', corrected: 'Correction' };
  const label = labels[status];
  const title = status === 'reported' || draft.title_en.toLowerCase().startsWith(label.toLowerCase()) ? draft.title_en : `${label}: ${draft.title_en}`;
  const date = originalDate(draft.source.published_at,sourceDate);
  const notice = `${label}. Original source date: ${date.label}. [Original source](${draft.source.url}).`;
  return {
    language: 'en', target_site: site, placement: site===editorialDirection.publication_site?editorialDirection.placement:'explicit_target',
    canonical: null, cms_mapping: 'PENDING', news_status: status,
    source: { ...draft.source, publication_date: date.date, publication_precision: date.precision, publication_time: date.time, utc_offset: date.utcOffset },
    title, body: `> ${notice}\n\n${draft.body_en}`,
    meta_description: status === 'reported' ? draft.meta_description_en : `${label}. ${draft.meta_description_en}`,
  };
}
