import type { Response } from '../../../../scripts/editorial-pilot-lib.ts';
import { editorialDirection, assertPublicEnglish } from '../../../../site/editorial.ts';

type Draft = Response['drafts'][number];
/** Preserve a caution already present in either review language, including older stored drafts. */
export function publicationStatus(draft: Draft) {
  if (draft.news_status && draft.news_status !== 'reported') return draft.news_status;
  return /据传|尚未证实|未经证实|传闻|\bunconfirmed(?: report)?\b|\breportedly\b/i.test(
    `${draft.title_zh}\n${draft.review_zh}\n${draft.title_en}\n${draft.body_en}\n${draft.meta_description_en}`,
  ) ? 'unconfirmed' : 'reported';
}

export function publicDraft(draft: Draft, site: string = editorialDirection.publication_site) {
  assertPublicEnglish(draft);
  const status = publicationStatus(draft);
  const labels = { reported: 'Source report', unconfirmed: 'Unconfirmed report', confirmed: 'Confirmation', denied: 'Denial / update', corrected: 'Correction' };
  const label = labels[status];
  const title = status === 'reported' || draft.title_en.toLowerCase().startsWith(label.toLowerCase()) ? draft.title_en : `${label}: ${draft.title_en}`;
  const notice = `${label}. Original source date: ${draft.source.published_at ?? 'not provided'}. [Original source](${draft.source.url}).`;
  return {
    language: 'en', target_site: site, placement: site===editorialDirection.publication_site?editorialDirection.placement:'explicit_target',
    canonical: null, cms_mapping: 'PENDING', news_status: status, source: draft.source,
    title, body: `> ${notice}\n\n${draft.body_en}`,
    meta_description: status === 'reported' ? draft.meta_description_en : `${label}. ${draft.meta_description_en}`,
  };
}
