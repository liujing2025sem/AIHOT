import { sql, type Db } from '../db.ts';

export function normalizePitch(text: string): string {
  return text.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

type RedactionKind = 'email' | 'phone' | 'url' | 'person' | 'company';

const address = String.raw`[^\s<>"'，。！？；：、（）【】]+`;
const domainLabel = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const domainSuffix = 'com|net|org|edu|gov|biz|info|io|ai|co|cn|uk|us|de|fr|jp|kr|au|ca|nl|hk|tw|in|sg|eu|me|ch|es|it|ru|br|mx|ae|sa|vn|id|my|th|nz|za|pro|shop|store|tech|online|site|solutions|group|global|xyz|dev|example|test|xn--[a-z0-9-]+';
const domain = new RegExp(String.raw`(?<![a-z0-9_@.-])(?:${domainLabel}\.)+(?:${domainSuffix})(?![a-z0-9_-]|\.[a-z0-9])(?::\d+)?(?:[/?#](?:${address})?)?`, 'gi');
const phoneStart = String.raw`(?<![A-Za-z0-9_./+-])`;
const phoneEnd = String.raw`(?![A-Za-z0-9_/+-]|\.\d)`;
const phoneSep = String.raw`[ \t.\-–‑]?`;
const phone = new RegExp(String.raw`${phoneStart}(?:\+(?:\d${phoneSep}){7,14}\d|\+?\d{1,3}[ \t-]?\(\d{2,4}\)(?:${phoneSep}\d){6,10}|1[3-9]\d{9}|(?:\(\d{3}\)|[2-9]\d{2})${phoneSep}\d{3}${phoneSep}\d{4}|0\d{2,3}[ \t-]\d{7,8})${phoneEnd}`, 'g');
const labeledPhone = new RegExp(String.raw`((?:\b(?:tel(?:ephone)?|phone|mobile|whatsapp|fax)\b|联系电话|手机|电话|传真)[ \t]*[.:：]?[ \t]*)(\+?(?:\(\d{2,4}\)|\d)(?:${phoneSep}\d){6,14})${phoneEnd}`, 'gi');

const englishName = String.raw`[A-Z][\p{Script=Latin}'’-]*(?:[ \t]+[A-Z][\p{Script=Latin}'’-]*){0,3}`;
const chineseName = String.raw`\p{Script=Han}{2,4}`;
const signoff = '(?:[Bb]est regards|[Kk]ind regards|[Ww]arm regards|[Rr]egards|[Bb]est|[Tt]hanks(?: and regards)?|[Ss]incerely|[Cc]heers|此致[ \t]*(?:敬礼)?|谢谢)';
const companySuffix = String.raw`(?:Co\.?[ \t]*,?[ \t]*Ltd\.?|Ltd\.?|Inc\.?|LLC|LLP|Corp\.?|GmbH|Limited|有限公司|集团)`;
const signatureCompany = String.raw`(?:${companySuffix}|[ \t]+(?:[Dd]isplays|[Tt]echnolog(?:y|ies)|[Ee]lectronics|[Ss]olutions)|公司|商行|工作室)`;
const labeledCompany = new RegExp(String.raw`((?:\b(?:company(?: name)?|organization)\b|客户公司|公司(?:名称|名)?|单位)[ \t]*[:：][ \t]*)(?![ \t\[])([\p{L}\p{N} &'’.,-]{1,80}?${companySuffix}(?=[\s.,，。；;!?！？]|$)|[^\r\n.,，。；;!?！？[\]]+)`, 'giu');
const technicalName = /^(?:Chipshow|NATIONSTAR|Macroblock|Colorlight|NovaStar|Huidu|Linsn|Mean Well|Kinglight|Absen|Unilumin|Leyard|LED(?:VISION|SET|Studio)?|MiP|COB|SMD|HDR|PWM|RGB|Sales(?: Team)?|Support(?: Team)?|Customer Service|Sir|Madam|Team)$/iu;

/** Context rules catch common names and signatures; operators still need to review the result. */
export function redactPitch(text: string): { text: string; redactions: { kind: string; count: number }[] } {
  const counts = new Map<RedactionKind, number>();
  const mark = (kind: RedactionKind) => {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    return `[${kind.toUpperCase()}]`;
  };
  const hideUrl = (value: string) => mark('url') + (/[.,;:!?)}\]]+$/.exec(value)?.[0] ?? '');
  const hidePerson = (name: string) => technicalName.test(name) ? name : mark('person');
  const hideCompany = (name: string) => {
    const brand = name.replace(new RegExp(String.raw`\s*${companySuffix}$`, 'iu'), '').trim();
    return technicalName.test(brand) ? name : mark('company');
  };
  text = text
    .replace(new RegExp(String.raw`(?:https?|ftp)://${address}`, 'gi'), hideUrl)
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/gi, () => mark('email'))
    .replace(domain, hideUrl)
    .replace(labeledPhone, (_value, prefix: string) => prefix + mark('phone'))
    .replace(phone, () => mark('phone'))
    .replace(new RegExp(String.raw`(\b(?:Mr|Mrs|Ms|Miss|Dr)\.?[ \t]+)(${englishName})(?![\p{Script=Latin}\d'’-])`, 'gu'), (_value, prefix: string, name: string) => prefix + hidePerson(name))
    .replace(new RegExp(String.raw`^([ \t]*(?:[Dd]ear|[Hh]i|[Hh]ello)[ \t]+)(${englishName})(?=[ \t]*(?:\r?$|[,，:：!！]))`, 'gmu'), (_value, prefix: string, name: string) => prefix + hidePerson(name))
    .replace(/(\p{Script=Han}{1,3})(先生|女士|小姐|经理)(?=[，。！？：、,\s]|您好|你好|$)/gu, (_value, name: string, suffix: string) => hidePerson(name) + suffix)
    .replace(/([赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦许何吕张孔曹严华金魏陶姜谢邹喻苏潘范彭鲁韦马方任袁柳唐薛雷贺倪汤罗郝傅程邓洪梁宋徐郭高夏蔡田胡霍万杜黄刘钟谭曾叶邱龚邵顾林贾])(工|总)(?=[，。！？：、,\s]|您好|你好|$)/gu, (_value, name: string, suffix: string) => hidePerson(name) + suffix)
    .replace(new RegExp(String.raw`((?:\b(?:[Cc]ontact(?: person)?|[Nn]ame)\b|联系人|姓名|署名)[ \t]*[:：][ \t]*)(${englishName}|${chineseName})(?=[ \t]*(?:\r?$|[,，;；]))`, 'gmu'), (_value, prefix: string, name: string) => prefix + hidePerson(name))
    .replace(new RegExp(String.raw`(^[ \t]*${signoff}[ \t]*[,，:：!]?[ \t]*(?:\r?\n[ \t]*)?)(${englishName}|${chineseName})([ \t]*(?=\r?$))(?:(\r?\n[ \t]*)([\p{L}\p{N} &'’.,-]{1,80}?${signatureCompany})(?=[ \t]*\r?$))?`, 'gmu'), (_value, prefix: string, name: string, space: string, nextLine?: string, company?: string) =>
      prefix + hidePerson(name) + space + (company ? (nextLine ?? '') + hideCompany(company) : ''))
    .replace(labeledCompany,
      (_value, prefix: string, company: string) => prefix + hideCompany(company.trimEnd()) + (/[ \t]+$/.exec(company)?.[0] ?? ''));
  return { text, redactions: [...counts].map(([kind, count]) => ({ kind, count })) };
}

type PitchTerm = { like: string; pattern: string; needsBoundary: boolean };

function pitchTerms(keywords: string[]): PitchTerm[] {
  const terms = new Set(keywords.flatMap((word) => {
    const term = word.trim().replace(/\s+/gu, ' ').toLowerCase();
    return /\p{Script=Han}/u.test(term) ? term.split(' ') : [term];
  }).filter(Boolean));
  return [...terms].map((term) => {
    const start = /^[a-z0-9_]/.test(term), end = /[a-z0-9_]$/.test(term);
    const literal = term.replace(/[.*+?^$(){}|[\]\\]/g, '\\$&');
    // ASCII boundaries keep English terms whole without treating adjacent Chinese as part of a word.
    const pattern = `${start ? '(^|[^a-z0-9_])' : '()'}(${literal})${end ? '(?=$|[^a-z0-9_])' : ''}`;
    return { pattern, needsBoundary: start || end, like: `%${term.replace(/[!%_]/g, '!$&')}%` };
  });
}

function materialHits(terms: PitchTerm[], db: Db) {
  if (!terms.length) return db`0`;
  return db`(SELECT count(*)::int
    FROM unnest(${db.array(terms.map(t => t.like))}::text[],
      ${db.array(terms.map(t => t.needsBoundary ? t.pattern : null))}::text[]) AS term(like_pattern, word_pattern)
    WHERE (a.title ILIKE term.like_pattern ESCAPE '!'
      AND (term.word_pattern IS NULL OR a.title COLLATE "C" ~* term.word_pattern))
      OR (a.body_text ILIKE term.like_pattern ESCAPE '!'
      AND (term.word_pattern IS NULL OR a.body_text COLLATE "C" ~* term.word_pattern)))`;
}

/** SQL expression for queries where articles is aliased as a; empty keywords count as zero. */
export function pitchMaterialHits(keywords: string[], db: Db = sql) {
  return materialHits(pitchTerms(keywords), db);
}

type PitchMaterial = {
  id: string;
  title: string;
  url: string;
  source_name: string;
  source_id: string;
  revision: number;
  published_at: Date | null;
  publication_time: string | null;
  body_status: string;
  body_text: string | null;
  first_party: boolean;
  hit_count: number;
};

function matchingSnippet(source: string, patterns: RegExp[]): string | undefined {
  let hitStart = source.length, hitEnd = source.length;
  for (const pattern of patterns) {
    const hit = pattern.exec(source);
    if (!hit) continue;
    const start = hit.index + hit[1].length;
    if (start < hitStart || (start === hitStart && start + hit[2].length > hitEnd)) {
      hitStart = start;
      hitEnd = start + hit[2].length;
    }
  }
  if (hitStart === source.length) return undefined;
  let start = 0, end = source.length;
  for (const stop of source.matchAll(/[。！？!?]+|\.(?=\s|$)|[\r\n]+/g)) {
    const after = stop.index + stop[0].length;
    if (after <= hitStart) start = after;
    else if (stop.index >= hitEnd) { end = after; break; }
  }
  if (end - start > 240) {
    start = Math.max(start, hitStart - 60);
    end = Math.min(end, Math.max(hitEnd, start + 240));
  }
  return source.slice(start, end).trim();
}

export async function searchPitchMaterials(keywords: string[], limit = 8, db: Db = sql, { offset = 0 }: { offset?: number } = {}): Promise<(PitchMaterial & { snippet: string })[]> {
  const terms = pitchTerms(keywords);
  if (!terms.length || !Number.isSafeInteger(limit) || limit <= 0) return [];
  const rows = await db<PitchMaterial[]>`SELECT a.id,a.title,a.url,s.name AS source_name,a.source_id,a.revision,
    a.published_at,a.publication_time,a.body_status,a.body_text,s.first_party,pitch.hit_count
    FROM articles a JOIN sources s ON s.id=a.source_id
    CROSS JOIN LATERAL (SELECT ${materialHits(terms, db)} AS hit_count) pitch
    WHERE pitch.hit_count > 0
    ORDER BY pitch.hit_count DESC,s.first_party DESC,a.published_at DESC NULLS LAST,a.id
    LIMIT ${limit} OFFSET ${Number.isSafeInteger(offset) && offset > 0 ? offset : 0}`;
  const patterns = terms.map(({ pattern }) => new RegExp(pattern, 'iu'));
  return rows.map((row) => ({
    ...row,
    snippet: matchingSnippet(row.body_text ?? '', patterns) ?? matchingSnippet(row.title, patterns) ?? row.title,
  }));
}
