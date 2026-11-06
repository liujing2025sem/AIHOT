import type { Response } from '../../../../scripts/editorial-pilot-lib.ts';
import { editorialDirection, assertPublicEnglish } from '../../../../site/editorial.ts';

type Draft = Response['drafts'][number];
type SourceDateContext = { publicationTime: string | null; utcOffset: string };

/** Source precision comes from stored metadata, never from a midnight timestamp. */
function originalDate(at: string | null, context?: SourceDateContext) {
  const unknown = { date: null, time: null, precision: 'unknown', utcOffset: null, label: 'not provided' };
  if (!at) return unknown;
  const day = context?.publicationTime ?? (/^\d{4}-\d{2}-\d{2}$/.test(at) ? at : null);
  const isDay = day !== null && /^\d{4}-\d{2}-\d{2}$/.test(day);
  const offset = context?.utcOffset;
  if (!isDay && !offset) return { ...unknown, label: 'not provided (source timezone unavailable)' };
  if (offset && !/^[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00)$/.test(offset)) throw new Error('Invalid source UTC offset');
  const offsetMinutes = offset ? (Number(offset.slice(1,3)) * 60 + Number(offset.slice(4))) * (offset[0] === '-' ? -1 : 1) : 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(at) && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(at)) throw new Error('Invalid original publication date');
  const instant = Date.parse(at);
  if (!Number.isFinite(instant)) throw new Error('Invalid original publication date');
  const local = new Date(instant + offsetMinutes * 60000).toISOString();
  const calendar = isDay ? day! : local.slice(0,10);
  const date = new Date(`${calendar}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== calendar) throw new Error('Invalid source calendar date');
  if (isDay && offset && !/^\d{4}-\d{2}-\d{2}$/.test(at) && calendar !== local.slice(0,10)) throw new Error('Source calendar date changed; review the source again');
  if (!isDay && context?.publicationTime && Date.parse(context.publicationTime) !== instant) throw new Error('Source publication time changed; review the source again');
  const precision = isDay ? 'day' : context?.publicationTime ? 'time' : 'unknown';
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
    source: { ...draft.source, published_at: date.date, publication_precision: date.precision, publication_time: date.time, utc_offset: date.utcOffset },
    title, body: `> ${notice}\n\n${draft.body_en}`,
    meta_description: status === 'reported' ? draft.meta_description_en : `${label}. ${draft.meta_description_en}`,
  };
}
