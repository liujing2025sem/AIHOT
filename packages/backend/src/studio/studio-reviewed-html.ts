import sanitizeHtml from 'sanitize-html';

/** Preserve approved article markup and omit scripts, event handlers and site-wide styles. */
export function sanitizeReviewedHtml(html: string) {
  return sanitizeHtml(html, {
    allowedTags: [...new Set([...sanitizeHtml.defaults.allowedTags, 'section', 'aside', 'article', 'figure', 'figcaption', 'img'])],
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes, '*': ['id'],
      a: ['href', 'title', 'name', 'rel', 'target'],
      section: ['class', 'id'], div: ['class', 'id'], article: ['class', 'id'], aside: ['class', 'id'], p: ['class', 'id'],
      figure: ['class'], img: ['src', 'alt', 'width', 'height', 'loading'], th: ['scope', 'colspan'], td: ['colspan'] },
    allowedClasses: { section: ['cs-brief', 'cs-brief-*'], div: ['cs-brief', 'cs-brief-*'],
      article: ['cs-brief-*'], aside: ['cs-brief-*'], p: ['cs-brief-*'], figure: ['cs-figure'] },
    allowedSchemes: ['https', 'http'],
  });
}
