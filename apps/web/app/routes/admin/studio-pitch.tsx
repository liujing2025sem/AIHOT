import { useEffect, useState } from 'react';
import { Link, useNavigate, useRevalidator } from 'react-router';
import type { Route } from './+types/studio-pitch';
import { adminGet } from '../../lib/admin.server';
import { copyText } from '../../lib/clipboard';
import { useAdminAction } from '../../features/admin/action';
import { AdminPage, Badge, Button, ButtonLink, Card, Field, Input, Select, Textarea, Time } from '../../features/admin/ui';

const base = '/api/admin/studio';
const desk = '/admin/studio/pitch';
const pitchPath = (id: string) => base + '/pitches/' + encodeURIComponent(id);
const pitchLink = (id: string) => desk + '?' + new URLSearchParams({ id });
const taskLink = (id: string) => '/admin/studio?tab=tasks#task-' + encodeURIComponent(id);

const outputLabels = { auto: '请系统建议', update: '升级已有页', guide: '新长文', short: '短文章' };
type OutputType = keyof typeof outputLabels;
type FinalOutput = Exclude<OutputType, 'auto'>;
const outputChoices: FinalOutput[] = ['update', 'guide', 'short'];
const isFinalOutput = (value: string): value is FinalOutput => outputChoices.some(choice => choice === value);
const statusLabels = { unprepared: '未备料', preparing: '备料中', ready: '待确认', insufficient: '证据不足', failed: '备料失败', confirmed: '已确认' };
type Status = keyof typeof statusLabels;

type Brief = { output_type: OutputType; existing_url: string; links: string[] };
type Material = {
  id: string; title: string; url: string; revision: number | null; published_at: string | null;
  publication_time: string | null; snippet: string; hit_count: number; first_party: boolean; existing_page?: boolean; body_status?: string;
};
type Section = { id: string; heading: string; evidence: { article_id: string; quote: string }[]; gap: string | null; action: string | null };
type Title = { title: string; anchor: string; article_id?: string; quote?: string };
type EngineerOption = { id: string; label: string; instruction: string; conservative: boolean };
type EngineerQuestion = { id: string; question: string; section_ids: string[]; options: EngineerOption[]; withheld_numbers: string[] };
const coverageLabels = {
  page_good: '旧页已答好', page_weak: '旧页答得弱', direct: '有直接证据',
  calc: '可计算', engineer: '需工程确认', missing: '缺证据',
};
type CoverageStatus = keyof typeof coverageLabels;
type Fact = { id: string; kind: string; statement: string; quote?: string; url?: string; attribution?: string; article_id?: string };
type Subquestion = {
  id: string; zh: string; en: string; need: string; answer_shape: string; terms: string[];
  coverage: { status: CoverageStatus; page_paragraphs: string[]; evidence: (string | Partial<Fact>)[]; reason?: string; action?: string };
  demand?: { queries: { query: string; impressions: number; position: number | null }[]; inquiries: number };
};
const opLabels = { keep: '保留', revise: '改写', insert_after: '新增' };
type Edit = { op: keyof typeof opLabels; paragraph: string; subquestion?: string; reason?: string; heading?: string; facts?: string[] };
const additionLabels = { comparison: '增加条件对照表', checklist: '增加买家核对清单', decision_summary: '先给结论与适用条件' };
type Addition = keyof typeof additionLabels;
type EditorialChoices = { revision: number; selected_title: string; article_ids: string[]; outline: { id: string; heading: string; include: boolean }[]; additions: Addition[]; note: string };
type ScopeOption = { id: string; question: string; includes: string[]; omits: string[]; subquestion_ids: string[] };
const fragmentLabels = { pending: '待处理', running: '生成中', done: '已完成', unknown: '结果待核对', failed: '未完成' };
type Fragment = {
  op_index: number; status: keyof typeof fragmentLabels; html_en?: string; zh_review?: string;
  used_facts?: string[]; receipt_id?: string | number | null; error?: string;
};
type V2 = {
  subquestions: Subquestion[]; facts: Fact[]; paragraphs: { id: string; text: string }[];
  edit_plan: Edit[]; weak_material_ids: string[]; fragments: Fragment[];
  assembled?: { diff: { op: Edit['op']; paragraph: string; before?: string | null; after?: string | null }[]; draft_id?: string | null } | null;
  conclusion?: 'upgrade' | 'no_change';
};
type Prep = Brief & {
  editorial_choices?: EditorialChoices;
  research?: { state: 'complete' | 'partial' | 'unavailable'; queries: string[]; imported: number; failures: { url: string; reason: string }[] };
  scope_options?: ScopeOption[];
  scope?: { original_question: string; question: string; omitted_questions: string[] };
  model_outcome?: 'unknown'; pending_receipt_id?: number | null;
  question: string; question_en: string; keywords: string[]; materials: Material[]; related_pages: { url: string; title: string }[];
  outline: Section[]; titles: Title[]; hooks: Title[]; engineer_questions: EngineerQuestion[];
  blacklist?: { configured: boolean; blocked: number; pending: number }; error?: string | null;
  link_errors?: { url: string; reason: string }[]; started_at?: string | null;
  v2: V2 | null;
};
type PitchRow = { id: string; title: string; status: Status; version: number; task_id: string | null; task_state?: string | null };
type Pitch = PitchRow & { prep: Prep | null };
type PrepResults = 'question_en' | 'keywords' | 'materials' | 'related_pages' | 'outline' | 'titles' | 'hooks' | 'engineer_questions';
type PitchResponse = PitchRow & { prep: (Omit<Prep, PrepResults | 'v2'> & Partial<Omit<Pick<Prep, PrepResults>, 'materials'>> &
  Partial<V2> & { workflow_version?: number; materials?: (Material & { body_text?: string | null })[] }) | null };
type SavedQuestion = { id: string; document: { question: string; existing_url: string; active: boolean } };
type Preview = { text: string; redactions: { kind: string; count: number }[] };
type Answer = { question_id: string; choice: string; note: string };
type Engineer = { mode: 'conservative' | 'engineer'; name: string; reply: string; answers: Answer[] };
type Run = ReturnType<typeof useAdminAction>['run'];

const muted = 'text-sm leading-6 text-ink-3';
const linkClass = 'break-all text-sm text-accent underline underline-offset-2';
const warning = 'rounded-control bg-amber/10 p-3 text-sm leading-6 text-ink';
const redactionLabels: Record<string, string> = {
  email: '邮箱', phone: '电话', url: '网址', domain: '域名', name: '姓名', person: '姓名', company: '公司名',
};

function readPrep(raw: PitchResponse['prep']): Prep | null {
  if (!raw) return null;
  const { workflow_version, subquestions, facts, paragraphs, edit_plan, weak_material_ids, fragments, assembled, conclusion } = raw;
  return {
    question: raw.question, output_type: raw.output_type, existing_url: raw.existing_url, links: raw.links,
    model_outcome:raw.model_outcome,pending_receipt_id:raw.pending_receipt_id,
    editorial_choices: raw.editorial_choices, research: raw.research, scope_options: raw.scope_options, scope: raw.scope,
    blacklist: raw.blacklist, error: raw.error, link_errors: raw.link_errors, started_at: raw.started_at,
    question_en: raw.question_en ?? '', keywords: raw.keywords ?? [], related_pages: raw.related_pages ?? [],
    outline: raw.outline ?? [], titles: raw.titles ?? [], hooks: raw.hooks ?? [], engineer_questions: raw.engineer_questions ?? [],
    materials: (raw.materials ?? []).map(({ id, title, url, revision, published_at, publication_time, snippet, hit_count, first_party, existing_page, body_status }) =>
      ({ id, title, url, revision, published_at, publication_time, snippet, hit_count, first_party, existing_page, body_status })),
    v2: workflow_version === 2 ? {
      subquestions: subquestions ?? [], facts: facts ?? [], paragraphs: (paragraphs ?? []).map(({ id, text }) => ({ id, text })), edit_plan: edit_plan ?? [],
      weak_material_ids: weak_material_ids ?? [], fragments: fragments ?? [], conclusion,
      assembled: assembled && { draft_id: assembled.draft_id, diff: assembled.diff.filter(change => change.op !== 'keep') },
    } : null,
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const query = new URL(request.url).searchParams;
  const id = query.get('id'), questionId = query.get('question_id');
  const [history, pitch, questions] = await Promise.all([
    adminGet<{ rows: PitchRow[] }>(request, base + '/pitches'),
    id ? adminGet<PitchResponse>(request, pitchPath(id)) : null,
    !id && questionId ? adminGet<{ rows: SavedQuestion[] }>(request, base + '/questions') : null,
  ]);
  return {
    history: history.rows.map(({ id, title, status, version, task_id }) => ({ id, title, status, version, task_id })),
    pitch: pitch ? { ...pitch, prep: readPrep(pitch.prep) } : null,
    questionId, question: questions?.rows.find(row => row.id === questionId) ?? null,
  };
}

export const meta = () => [{ title: '命题采编 · Chipshow Studio' }];

function httpUrl(value: string) {
  try {
    const url = new URL(value);
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}

function SourceLink({ url, title }: { url: string; title: string }) {
  const href = httpUrl(url);
  return href ? <a href={href} target="_blank" rel="noreferrer" className={linkClass}>{title}</a> : <span className="break-all">{title}</span>;
}

function parseLinks(input: string) {
  return [...new Set(input.split(/\r?\n/).map(value => value.trim()).filter(Boolean))];
}

function briefError(output: OutputType, existingUrl: string, links: string[]) {
  if (output === 'update' && !existingUrl) return '升级已有页时，请填写已有页面 URL。';
  if (existingUrl && !httpUrl(existingUrl)) return '已有页面 URL 应以 http:// 或 https:// 开头。';
  if (links.length > 3) return '最多填写 3 条线索链接。';
  if (links.some(link => !httpUrl(link))) return '每条线索都应是完整的 http:// 或 https:// 链接。';
  return '';
}

function BriefFields({ output, setOutput, url, setUrl, links, setLinks, disabled }: {
  output: OutputType; setOutput: (value: OutputType) => void; url: string; setUrl: (value: string) => void;
  links: string; setLinks: (value: string) => void; disabled: boolean;
}) {
  return <fieldset disabled={disabled} className="min-w-0 space-y-4">
    <Field label="产出类型">
      <Select aria-label="产出类型" value={output} onChange={e => setOutput(isFinalOutput(e.target.value) ? e.target.value : 'auto')}>
        <option value="auto">{outputLabels.auto}</option>
        {outputChoices.map(choice => <option key={choice} value={choice}>{outputLabels[choice]}</option>)}
      </Select>
    </Field>
    <Field label={'已有页面 URL' + (output === 'update' ? '（必填）' : '（可选）')}>
      <Input type="url" aria-label="已有页面 URL" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" />
    </Field>
    <Field label="公开线索链接（可选）" hint="每行一个，最多 3 个。只填可用于采编的公开页面或 PDF。">
      <Textarea aria-label="公开线索链接" rows={2} value={links} onChange={e => setLinks(e.target.value)} />
    </Field>
  </fieldset>;
}

function Progress({ current }: { current: number }) {
  return <ol aria-label="命题进度" className="mb-5 grid grid-cols-4 gap-1 rounded-panel bg-bg-sunk p-1 sm:gap-2">
    {['写题', '备料', '确认', '成稿'].map((step, i) => <li key={step} aria-current={i === current ? 'step' : undefined}
      className={'rounded-control px-1 py-2 text-center text-xs sm:text-sm ' + (i === current ? 'bg-accent font-semibold text-white' : i < current ? 'text-ok' : 'text-ink-3')}>
      {i < current ? '✓' : i + 1} {step}
    </li>)}
  </ol>;
}

function History({ rows, activeId }: { rows: PitchRow[]; activeId?: string }) {
  return <Card title="已保存的命题">
    {rows.length ? <ul className="max-h-80 divide-y divide-line overflow-y-auto">
      {rows.map(row => <li key={row.id} className="flex min-w-0 flex-wrap items-start gap-2 py-2 first:pt-0 last:pb-0">
        <Link to={pitchLink(row.id)} aria-current={activeId === row.id ? 'page' : undefined}
          className="min-w-24 flex-1 break-words text-sm text-accent aria-[current=page]:font-semibold">{row.title}</Link>
        <Badge tone={row.status === 'insufficient' || row.status === 'failed' ? 'warn' : 'muted'}>{statusLabels[row.status]}</Badge>
      </li>)}
    </ul> : <p className={muted}>还没有命题。写下一个要回答的问题就能开始。</p>}
  </Card>;
}

function NewPitch({ question, missing }: { question: SavedQuestion | null; missing: boolean }) {
  const [raw, setRaw] = useState(question?.document.question ?? '');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [checked, setChecked] = useState(false);
  const [output, setOutput] = useState<OutputType>(question?.document.existing_url ? 'update' : 'auto');
  const [url, setUrl] = useState(question?.document.existing_url ?? '');
  const [links, setLinks] = useState('');
  const { run, busy, pending } = useAdminAction();
  const navigate = useNavigate();
  const parsedLinks = parseLinks(links);
  const error = briefError(output, url.trim(), parsedLinks);
  const blocked = missing || question?.document.active === false;
  const questionError = preview && (preview.text.trim().length < 4 || preview.text.trim().length > 1000)
    ? '脱敏后的题目需有 4 至 1000 个字符。请修改后重新预览。' : '';

  async function redact() {
    setChecked(false);
    setPreview(null);
    const result = await run<Preview>('POST', base + '/pitch/redact', { question: raw }, { revalidate: false });
    if (result) setPreview(result);
  }

  async function save() {
    if (!preview || !checked || blocked || error || questionError) return;
    const result = await run<{ id: string; reused: boolean; task_id?: string | null }>('POST', base + '/pitches', {
      question: preview.text.trim(), privacy_confirmed: true, output_type: output, existing_url: url.trim(), links: parsedLinks,
      ...(question ? { question_id: question.id } : {}),
    }, { revalidate: false });
    if (!result) return;
    setRaw('');
    setPreview(null);
    setChecked(false);
    navigate(result.task_id ? taskLink(result.task_id) : pitchLink(result.id));
  }

  return <div className="space-y-4">
    <Card title="写下要回答的问题">
      {blocked ? <p role="alert" className={warning}>{missing ? '问题地图里找不到这条记录。' : '这条问题已暂停。'} <Link to={desk} className="text-accent">另写一个题目</Link></p> :
        <div className="space-y-4">
          {question && <p className={muted}>已从问题地图带入题目，可以修改后再预览。</p>}
          <Field label="问题或命题" hint="原话不会随命题保存，只在点击预览时送往脱敏接口。">
            <Textarea aria-label="问题或命题" disabled={busy} maxLength={4000} value={raw} onChange={e => { setRaw(e.target.value); setPreview(null); setChecked(false); }}
              placeholder="输入一个客户问题，或写下你希望文章回答的问题" />
          </Field>
          <Button tone="primary" disabled={busy || !raw.trim()} busy={pending === 'POST ' + base + '/pitch/redact'} onClick={() => void redact()}>预览脱敏</Button>
          {preview && <div className="space-y-2 rounded-control bg-bg-sunk p-3">
            <p className="text-sm font-semibold">脱敏预览</p>
            <p className="whitespace-pre-wrap break-words text-sm">{preview.text || '没有可保存的内容。'}</p>
            <p className={muted}>{preview.redactions.length ? preview.redactions.map(item => (redactionLabels[item.kind] ?? item.kind) + ' ' + item.count + ' 处').join(' · ') : '未识别到需要替换的内容。'} 如仍有客户信息，请先改写原话，再重新预览。</p>
            {questionError && <p className={warning}>{questionError}</p>}
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={checked} disabled={busy || !!questionError} onChange={e => setChecked(e.target.checked)} />
              我已核对，脱敏文本可以保存
            </label>
          </div>}
        </div>}
    </Card>
    {!blocked && <Card title="告诉系统要准备什么">
      <BriefFields output={output} setOutput={setOutput} url={url} setUrl={setUrl} links={links} setLinks={setLinks} disabled={busy} />
      {error && <p className="mt-3 text-sm text-ink-3">{error}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button tone="primary" disabled={busy || !checked || !!error} onClick={() => void save()}>保存并开始备料</Button>
        <p className={muted}>保存后，后台开始找素材和拟大纲。</p>
      </div>
    </Card>}
  </div>;
}

const readable = (material: Material) => !material.body_status || material.body_status === 'ok';
const disclosure = 'cursor-pointer break-words text-sm font-medium text-accent';
const inset = 'min-w-0 space-y-2 rounded-control bg-bg-sunk p-3 [overflow-wrap:anywhere]';
const changeEntries = (v2: V2) => v2.edit_plan.map((edit, index) => ({ edit, index })).filter(({ edit }) => edit.op !== 'keep');
const changeHeading = (v2: V2, edit: Edit) => edit.heading?.trim()
  || v2.subquestions.find(question => question.id === edit.subquestion)?.zh || (edit.paragraph ? '原文 ' + edit.paragraph : '新章节');

function Demand({ demand }: { demand: Subquestion['demand'] }) {
  if (!demand?.queries.length && !demand?.inquiries) return <p className={muted}>无需求数据</p>;
  return <div className={muted}>
    <p>需求信号：{demand?.inquiries ?? 0} 条已登记询盘</p>
    {!!demand?.queries.length && <ul className="mt-1 space-y-1">
      {demand.queries.map(({ query, impressions, position }, i) => <li key={i}>{query} · 曝光 {impressions} · {position == null ? '无排名数据' : '排名 ' + position}</li>)}
    </ul>}
  </div>;
}

function EvidenceList({ entries, v2 }: { entries: (string | Partial<Fact>)[]; v2: V2 }) {
  if (!entries.length) return null;
  return <ul className="space-y-2 text-sm">
    {entries.map((entry, i) => {
      const id = typeof entry === 'string' ? entry : entry.id;
      const fact = v2.facts.find(item => item.id === id) ?? (typeof entry === 'string' ? null : entry);
      return <li key={i} className="space-y-1 border-l-2 border-line-strong pl-2 [overflow-wrap:anywhere]">
        {fact ? <>
          {fact.statement && <p>{fact.statement}</p>}
          {fact.quote && <blockquote className={muted}>原文：{fact.quote}</blockquote>}
          {fact.url ? <SourceLink url={fact.url} title={fact.attribution || fact.url} /> : fact.attribution && <p className={muted}>{fact.attribution}</p>}
        </> : <p className={muted}>未返回证据详情{id ? '（' + id + '）' : ''}</p>}
      </li>;
    })}
  </ul>;
}

function EvidenceLookup({ pitch, question, run, busy }: { pitch: PitchRow; question: Subquestion; run: Run; busy: boolean }) {
  const [url, setUrl] = useState('');
  const valid = !url.trim() || !!httpUrl(url.trim());
  return <form className="space-y-2" onSubmit={async e => {
    e.preventDefault();
    if (busy || !valid) return;
    if (await run('POST', pitchPath(pitch.id) + '/evidence', { version: pitch.version, subquestion_id: question.id, ...(url.trim() ? { url: url.trim() } : {}) },
      { success: '已安排自动查找。取得原文后会重新核对范围与大纲。' })) setUrl('');
  }}>
    <p className={muted}>系统查找并读取公开资料，补齐这一题的回答依据。无需自己找链接。</p>
    <Button type="submit" size="sm" disabled={busy || !valid}>自动查找这一题</Button>
    <details>
      <summary className={disclosure}>我有参考链接（选填）</summary>
      <Field label="补充公开证据链接（选填）" hint="已有原始资料时可加快核对。留空也能自动查找。">
        <Input type="url" aria-label={'补充证据链接：' + question.zh} placeholder="https://" value={url} onChange={e => setUrl(e.target.value)} disabled={busy} />
      </Field>
    </details>
  </form>;
}

function Coverage({ pitch, v2, run, busy, editable, pendingPlan = false }: { pitch: PitchRow; v2: V2; run: Run; busy: boolean; editable: boolean; pendingPlan?: boolean }) {
  const statuses: CoverageStatus[] = ['missing', 'engineer', 'page_weak', 'direct', 'calc', 'page_good'];
  return <div className="space-y-3">
    <h3 className="text-sm font-semibold">买家子问题覆盖</h3>
    {pendingPlan && !!v2.subquestions.length && <p className={muted}>编辑计划尚未返回。以下仅为自动检索和计算结果；未命中不代表旧页没有答案。</p>}
    {!v2.subquestions.length && <p className={muted}>本次未返回买家子问题。</p>}
    {statuses.map(status => {
      const questions = v2.subquestions.filter(question => question.coverage.status === status);
      if (!questions.length) return null;
      return <section key={status} className="space-y-2">
        <h4 className="text-sm font-medium">{status === 'missing' && pendingPlan ? '待核对旧页与资料' : coverageLabels[status]} · {questions.length} 题</h4>
        {questions.map(question => <article key={question.id} className={inset}>
          <h5 className="text-sm font-medium">{question.zh || question.en}</h5>
          {question.coverage.reason && <p className={muted}>{question.coverage.reason}</p>}
          {question.coverage.action && <p className={muted}>下一步：{question.coverage.action}</p>}
          {!!question.coverage.page_paragraphs?.length && <details>
            <summary className={disclosure}>查看旧页依据（{question.coverage.page_paragraphs.join('、')}）</summary>
            <ul className="mt-2 space-y-2 text-sm">{question.coverage.page_paragraphs.map(id => <li key={id}>
              {id}：{v2.paragraphs.find(paragraph => paragraph.id === id)?.text || '未返回段落原文'}
            </li>)}</ul>
          </details>}
          <EvidenceList entries={question.coverage.evidence ?? []} v2={v2} />
          <Demand demand={question.demand} />
          {editable && (status === 'missing' || status === 'page_weak') && <EvidenceLookup pitch={pitch} question={question} run={run} busy={busy} />}
        </article>)}
      </section>;
    })}
  </div>;
}

function EditPlan({ v2, inclusion }: { v2: V2; inclusion?: { included: boolean[]; toggle: (index: number) => void; busy: boolean } }) {
  const keeps = v2.edit_plan.filter(edit => edit.op === 'keep');
  const changes = changeEntries(v2);
  return <div className="space-y-3">
    <h3 className="text-sm font-semibold">编辑计划：这次补了什么</h3>
    {v2.conclusion === 'no_change' ? <p className={muted}>无需升级。旧页已经覆盖本次要回答的问题，可以保留原文。</p>
      : !changes.length && <p className={muted}>还没有可确认的改写或新增项。</p>}
    {changes.map(({ edit, index }, i) => {
      const question = v2.subquestions.find(item => item.id === edit.subquestion);
      const heading = changeHeading(v2, edit);
      return <article key={index} className={inset}>
        <h4 className="text-sm font-medium">{opLabels[edit.op]} · {heading}</h4>
        {inclusion && <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={inclusion.included[i]} disabled={inclusion.busy} onChange={() => inclusion.toggle(i)} aria-label={'保留改动：' + heading} />
          本次纳入
        </label>}
        {edit.paragraph && <p className={muted}>{edit.op === 'insert_after' ? '插入在原文之后：' : '改写原文：'}{edit.paragraph}</p>}
        <p className="text-sm">买家问题：{question?.zh || question?.en || '未返回对应问题'}</p>
        {edit.reason && <p className={muted}>修改理由：{edit.reason}</p>}
        <p className={muted}>所用依据：{edit.facts?.length ? '' : question?.coverage.action || '没有列出可用事实'}</p>
        <EvidenceList entries={edit.facts ?? []} v2={v2} />
        <Demand demand={question?.demand} />
      </article>;
    })}
    {!!keeps.length && <details className={inset}>
      <summary className={disclosure}>原样保留 {keeps.length} 段</summary>
      <ul className="space-y-2 text-sm">{keeps.map(({ paragraph }, i) => <li key={i}>
        {paragraph}：{v2.paragraphs.find(item => item.id === paragraph)?.text || '保留原文'}
      </li>)}</ul>
    </details>}
  </div>;
}

function MaterialList({ materials, selected, toggle, busy }: { materials: Material[]; selected: string[]; toggle: (id: string) => void; busy: boolean }) {
  return <div className="divide-y divide-line">
    {materials.map(material => <div key={material.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 py-3 first:pt-0 last:pb-0">
      <input type="checkbox" className="mt-1" aria-label={'选用 ' + material.title} disabled={busy || !readable(material)} checked={selected.includes(material.id)} onChange={() => toggle(material.id)} />
      <div className="space-y-1">
        <SourceLink url={material.url} title={material.title || material.url} />
        <p className="text-xs leading-5 text-ink-3">
          {material.existing_page ? '已有页面正文' : material.first_party ? '一手来源' : '其他来源'}
          {' · '}原文日期：{material.publication_time && /^\d{4}-\d{2}-\d{2}$/.test(material.publication_time) ? material.publication_time : material.published_at ? <Time at={material.published_at} /> : '未知'}
          {' · '}版本：{material.revision ?? '未知'} · 命中 {material.hit_count} 项
        </p>
        {material.snippet && <blockquote className="break-words border-l-2 border-accent pl-2 text-sm">{material.snippet}</blockquote>}
        {!readable(material) && <Badge tone="warn">缺完整正文</Badge>}
      </div>
    </div>)}
  </div>;
}

function CandidateMaterials({ prep, selected, toggle, busy }: { prep: Prep; selected: string[]; toggle?: (id: string) => void; busy: boolean }) {
  const weak = new Set(prep.v2?.weak_material_ids);
  const strong = prep.materials.filter(material => !weak.has(material.id));
  const weakMaterials = prep.materials.filter(material => weak.has(material.id));
  const list = (materials: Material[]) => toggle ? <MaterialList materials={materials} selected={selected} toggle={toggle} busy={busy} />
    : <ul className="space-y-1">{materials.map(material => <li key={material.id}><SourceLink url={material.url} title={material.title || material.url} /></li>)}</ul>;
  return <div className="space-y-3">
    {strong.length ? list(strong) : <p className={warning}>暂未取得可用原文。可继续自动查找，或选择系统给出的有依据范围。</p>}
    {!!weakMaterials.length && <details className={inset}>
      <summary className={disclosure}>弱相关 {weakMaterials.length} 条</summary>
      <p className={muted}>这些候选没有找到能直接回答子问题的句子。</p>
      {list(weakMaterials)}
    </details>}
  </div>;
}

function Confirmation({ pitch, prep, onConfirmed }: { pitch: PitchRow; prep: Prep; onConfirmed: (taskId: string | null, queued: boolean) => void }) {
  const v2 = prep.v2;
  const tabs = [{ id: 2, label: '方向与大纲' }, { id: 0, label: '核对依据' }, { id: 3, label: '工程确认' }];
  const [panel, setPanel] = useState(2);
  const [selected, setSelected] = useState(() => {
    if (prep.editorial_choices) return prep.editorial_choices.article_ids;
    const cited = new Set([...prep.outline.flatMap(s => s.evidence.map(e => e.article_id)), ...prep.titles.map(t => t.article_id),
      ...(v2?.facts.filter(fact => v2.edit_plan.some(edit => edit.facts?.includes(fact.id))).map(fact => fact.article_id) ?? [])]);
    return prep.materials.filter(m => readable(m) && !v2?.weak_material_ids.includes(m.id) && (m.existing_page || cited.has(m.id)))
      .sort((a, b) => Number(!!b.existing_page) - Number(!!a.existing_page)).slice(0, 12).map(m => m.id);
  });
  const [outline, setOutline] = useState(() => prep.editorial_choices?.outline ?? (v2 ? changeEntries(v2).map(({ edit }, i) => ({
    id: 'change-' + i, heading: (prep.outline[i]?.heading || changeHeading(v2, edit)).slice(0, 200), include: true,
  })) : prep.outline.map(({ id, heading }) => ({ id, heading, include: true }))));
  const [output, setOutput] = useState<FinalOutput>(prep.output_type === 'auto' ? (prep.existing_url ? 'update' : 'guide') : prep.output_type);
  const [title, setTitle] = useState(prep.editorial_choices?.selected_title ?? prep.titles.find(candidate => !candidate.article_id || selected.includes(candidate.article_id))?.title ?? '');
  const [additions, setAdditions] = useState<Addition[]>(prep.editorial_choices?.additions ?? []);
  const [note, setNote] = useState(prep.editorial_choices?.note ?? '');
  const [choiceRevision, setChoiceRevision] = useState(prep.editorial_choices?.revision ?? 0);
  const choices = { selected_title: title, article_ids: selected,
    outline: outline.map((section, i) => ({ ...section, heading: section.heading.trim() || prep.outline[i]?.heading.trim() || '' })), additions, note };
  const [savedChoices, setSavedChoices] = useState(() => prep.editorial_choices ? JSON.stringify({ selected_title: prep.editorial_choices.selected_title, article_ids: prep.editorial_choices.article_ids, outline: prep.editorial_choices.outline, additions: prep.editorial_choices.additions, note: prep.editorial_choices.note }) : '');
  const unsavedChoices = JSON.stringify(choices) !== savedChoices;
  const [submitting, setSubmitting] = useState(false);
  const [conservative, setConservative] = useState(true);
  const [name, setName] = useState('');
  const [reply, setReply] = useState('');
  const { run, busy: actionBusy } = useAdminAction();
  const busy = actionBusy || submitting;

  const candidates = prep.titles;
  const titleSupported = (candidate: Title) => !candidate.article_id || selected.includes(candidate.article_id);
  const validTitle = candidates.some(candidate => candidate.title === title && candidate.title.trim() && titleSupported(candidate));
  const selectedExistingPage = prep.materials.some(material => material.existing_page && selected.includes(material.id));
  const enoughEvidence = selected.length >= 2 || selectedExistingPage;
  const conservativeAnswers = prep.engineer_questions.flatMap(question => {
    const option = question.options.find(item => item.conservative);
    return option ? [{ question_id: question.id, choice: option.id, note: '' }] : [];
  });
  const engineerAnswers = !conservative && name.trim() && reply.trim() ? parseEngineerReply(prep.engineer_questions, reply) : null;
  const engineer: Engineer | null = conservative
    ? conservativeAnswers.length === prep.engineer_questions.length ? { mode: 'conservative', name: '', reply: '', answers: conservativeAnswers } : null
    : engineerAnswers ? { mode: 'engineer', name: name.trim(), reply: reply.trim(), answers: engineerAnswers } : null;
  const includedSections = outline.filter(section => section.include);
  const supportedSection = (section: Section) => section.evidence.some(evidence => selected.includes(evidence.article_id))
    || prep.engineer_questions.some(question => question.section_ids.includes(section.id));
  const blocker = !v2 && !enoughEvidence ? '请选至少 2 条素材，或选用已有页面正文。'
    : output === 'update' && !prep.existing_url ? '当前未绑定已有页，可选择新长文，或选系统找到的已有页重新备料。'
    : output === 'update' && !selectedExistingPage && (!v2 || prep.materials.some(material => material.existing_page) || !v2.paragraphs.length) ? '升级稿需要已有页面正文。'
    : selected.length > 12 ? '本次最多采用 12 份原文，请取消不需要的素材。'
    : !validTitle ? '请选择一个有已选素材支撑的方向。'
    : v2 && !includedSections.length ? '请至少纳入一处改写或新增。'
    : !v2 && (!includedSections.length || includedSections.some(section => !section.heading.trim())) ? '大纲至少保留一节，且保留的章节都要有标题。'
    : !v2 && prep.outline.some((section, i) => outline[i].include && !supportedSection(section)) ? '请为保留的章节选用对应素材，或取消保留无证据、无工程确认的章节。'
    : !engineer ? (conservative ? '确认卡缺少保守选项，请重做备料。' : '请填写工程师姓名和完整的实际回复，或改用保守写法。')
    : '';

  async function saveChoices() {
    if (!unsavedChoices) return choiceRevision;
    const result = await run<{ choice_revision: number }>('POST', pitchPath(pitch.id) + '/choices', {
      version: pitch.version, choice_revision: choiceRevision, ...choices,
    }, { revalidate: false, success: '方向、大纲和补充要求已保存。尚未生成正文。' });
    if (!result) return null;
    setChoiceRevision(result.choice_revision);
    setSavedChoices(JSON.stringify(choices));
    return result.choice_revision;
  }

  async function confirm() {
    if (busy || blocker || !engineer) return;
    setSubmitting(true);
    try {
      const revision = await saveChoices();
      if (revision === null) return;
      const result = await run<{ id: string; status: 'confirmed'; task_id: string | null; reused?: boolean }>('POST', pitchPath(pitch.id) + '/confirm', {
        version: pitch.version, choice_revision: revision, article_ids: selected, selected_title: title, output_type: output,
        outline: choices.outline, engineer,
      }, { revalidate: false });
      if (!result) return;
      const generated = result.reused ? null : await run<{ queued: boolean }>('POST', pitchPath(pitch.id) + '/generate', {});
      onConfirmed(result.task_id, generated?.queued === true);
    } finally { setSubmitting(false); }
  }

  return <div className="space-y-4">
    <Card title="这篇回答什么" right={<Badge tone="accent">待选方向</Badge>}>
      <p className="text-sm font-medium leading-6">{prep.question}</p>
      {prep.scope && <div className="mt-3 rounded-control bg-bg-sunk p-3 text-sm leading-6">
        <p>你已选择的回答范围：{prep.scope.question}</p>
        {!!prep.scope.omitted_questions.length && <><p className="mt-2 font-medium">本次暂不回答</p><ul className="list-disc pl-4">{prep.scope.omitted_questions.map((question, i) => <li key={i}>{question}</li>)}</ul></>}
        <details className="mt-2"><summary className={disclosure}>查看原始命题</summary><p>{prep.scope.original_question}</p></details>
      </div>}
      <p className="mt-2 text-sm leading-6 text-ink-3">系统已准备方向与大纲。选中适合的写法，确认后才生成英文全文。</p>
      <p className="mt-2 text-xs leading-6 text-ink-3">补充对照表或核对清单，只改变表达方式；未核实的库存、交期与客户案例不会成为事实。</p>
    </Card>
    <Card title="选择方向与大纲" right={<Badge tone="accent">{statusLabels.ready}</Badge>}>
      <nav aria-label="备料检查" className="mb-4 grid grid-cols-3 gap-1 rounded-control bg-bg-sunk p-1">
        {tabs.map(({ id, label }) => <Button key={id} size="sm" tone={panel === id ? 'primary' : 'ghost'} aria-pressed={panel === id}
          className="min-w-0 px-1 sm:px-2" onClick={() => setPanel(id)}>{label}</Button>)}
      </nav>
      <div className="flex flex-col gap-4">

      {panel === 0 && <div className="space-y-3">
        {v2 && <Coverage pitch={pitch} v2={v2} run={run} busy={busy} editable />}
        <p className={muted}>{v2 ? '下方是候选素材。编辑计划会列出每处改动所用的依据。' : '检查命中句和出处，只保留成稿会用到的素材。'}</p>
        <CandidateMaterials prep={prep} selected={selected} busy={busy}
          toggle={id => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])} />
      </div>}

      {panel === 2 && <div className="order-2">{v2 ? <EditPlan v2={v2} inclusion={{ included: outline.map(section => section.include), busy,
        toggle: index => setOutline(items => items.map((item, i) => i === index ? { ...item, include: !item.include } : item)) }} /> : <div className="space-y-3">
        <h3 className="text-sm font-semibold">将生成的大纲</h3>
        <p className={muted}>系统已准备章节。可选择保留范围，章节名可选编辑。</p>
        {prep.outline.map((section, i) => {
          const current = outline[i];
          return <div key={section.id} className="space-y-2 rounded-control bg-bg-sunk p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={current.include} disabled={busy} onChange={e => setOutline(items => items.map(item => item.id === section.id ? { ...item, include: e.target.checked } : item))} />
              保留第 {i + 1} 节
            </label>
            <Input aria-label={'第 ' + (i + 1) + ' 节标题'} maxLength={200} disabled={busy || !current.include} value={current.heading}
              onChange={e => setOutline(items => items.map(item => item.id === section.id ? { ...item, heading: e.target.value } : item))} />
            {section.evidence.map(({ article_id, quote }, j) => {
              const material = prep.materials.find(item => item.id === article_id);
              return <blockquote key={j} className="break-words border-l-2 border-line-strong pl-2 text-sm">
                <div>{material ? <SourceLink url={material.url} title={material.title} /> : '素材未返回'}</div>
                {!selected.includes(article_id) && <Badge tone="warn">未选用此素材</Badge>}
                <p>{quote}</p>
              </blockquote>;
            })}
            {(section.gap || !section.evidence.some(evidence => selected.includes(evidence.article_id))) &&
              <p className={warning}>缺证据：{section.gap || '这节没有已选的证据。'}</p>}
            {section.action && <p className={muted}>建议：{section.action}</p>}
          </div>;
        })}
      </div>}</div>}

      {panel === 2 && <div className="order-1 space-y-4">
        {v2 ? <p className={muted}>产出类型：{outputLabels[output]}</p> : <Field label="确认产出类型">
          <Select aria-label="确认产出类型" value={output} disabled={busy} onChange={e => {
            if (isFinalOutput(e.target.value)) { setOutput(e.target.value); setTitle(''); }
          }}>{outputChoices.map(choice => <option key={choice} value={choice} disabled={choice === 'update' && !prep.existing_url}>{outputLabels[choice]}</option>)}</Select>
        </Field>}
        <fieldset disabled={busy} className="min-w-0 space-y-2">
          <legend className="mb-2 text-sm font-medium">推荐方向（选一个）</legend>
          {candidates.length ? candidates.map((candidate, i) => <label key={i} className="flex items-start gap-2 rounded-control bg-bg-sunk p-3 text-sm">
            <input type="radio" name="pitch-title" className="mt-1" disabled={!titleSupported(candidate)} checked={title === candidate.title} onChange={() => setTitle(candidate.title)} />
            <span className="min-w-0 break-words">{i === 0 && <strong className="mb-1 block text-xs text-accent">系统推荐</strong>}{candidate.anchor || candidate.title}
              <small className="mt-1 block text-ink-3">英文标题：{candidate.title}</small>
              {!titleSupported(candidate) && <small className="mt-1 block text-ink-3">先选用对应素材</small>}
            </span>
          </label>) : <p className={warning}>暂未取得有依据的方向，可返回继续自动查找。</p>}
        </fieldset>
        {prep.output_type !== 'auto' && (output === 'short') !== (prep.output_type === 'short') &&
          <p className={muted}>当前标题仍按上一次的产出类型准备。需要新的标题候选时，请按新类型重新备料。</p>}
        {output !== 'short' && prep.hooks.length > 0 && <details>
          <summary className="cursor-pointer text-sm text-accent">查看社媒钩子参考</summary>
          <ul className="mt-2 space-y-2">{prep.hooks.map((hook, i) => <li key={i} className="break-words text-sm">
            {hook.title}<p className="text-xs text-ink-3">事实锚点：{hook.anchor || '未提供'}</p>
          </li>)}</ul>
        </details>}
      </div>}

      {panel === 3 && <EngineerReview prep={prep} conservative={conservative} setConservative={setConservative}
        name={name} setName={setName} reply={reply} setReply={setReply} busy={busy} />}
      </div>
      <fieldset disabled={busy} className="mt-5 min-w-0 space-y-3 border-t border-line pt-4">
        <legend className="text-sm font-semibold">补充要求（可多选，也可全留空）</legend>
        <p className={muted}>用已有证据把内容组织得更好。勾选后不会开始生成正文。</p>
        <div className="flex flex-wrap gap-3">{(Object.keys(additionLabels) as Addition[]).map(key => <label key={key} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={additions.includes(key)} onChange={e => setAdditions(items => e.target.checked ? [...items, key] : items.filter(item => item !== key))} />{additionLabels[key]}
        </label>)}</div>
        <Field label="补充逻辑（选填）" hint="有特别的表达要求再写。不填也能完成采编；此处内容不作为事实来源。">
          <Textarea aria-label="补充逻辑（选填）" maxLength={2000} rows={2} value={note} onChange={e => setNote(e.target.value)} />
        </Field>
      </fieldset>
    </Card>

    <Card title="确认将要生成的内容">
      <p className={muted}>已选 {selected.length} 条素材{selectedExistingPage ? '，含已有页面正文' : ''} · {v2 ? '纳入改写或新增 ' + includedSections.length + ' 处' : '保留 ' + includedSections.length + ' 节'} · {outputLabels[output]} · {conservative ? '保守写法' : '工程师回复'}</p>
      <ol className="my-3 list-decimal space-y-1 pl-5 text-sm">{includedSections.map(section => <li key={section.id}>{section.heading}</li>)}</ol>
      {additions.length > 0 && <p className={muted}>呈现要求：{additions.map(key => additionLabels[key]).join('；')}。只使用上述章节的已核依据。</p>}
      <p className="mt-1 break-words text-sm">{blocker || '确认此大纲后，系统才会调用写作模型。不会自动发布。'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button tone="primary" disabled={busy || !!blocker} onClick={() => void confirm()}>确认大纲并生成全文</Button>
        <Button disabled={busy || !!blocker || !unsavedChoices} onClick={() => void saveChoices()}>保存选择，稍后生成</Button>
      </div>
      <p className={muted}>{unsavedChoices ? '本次选择尚未保存。确认时会一起保存。' : '选择已保存，刷新后可继续。'}</p>
    </Card>
    <Reprepare pitch={pitch} prep={prep} run={run} busy={busy} />
  </div>;
}

function ReviewText({ children }: { children: string }) {
  return <p className="whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">{children}</p>;
}

function ResearchChoices({ pitch, prep, run, busy }: { pitch: PitchRow; prep: Prep; run: Run; busy: boolean }) {
  const research = prep.research;
  return <div className="space-y-4">
    <p className="text-sm leading-6">系统会继续查找原文。也可以先选择一个有依据、能解决具体问题的范围。</p>
    {research && <p className={muted}>本轮已取得 {research.imported} 份原文。{research.state === 'unavailable' ? '本轮公开检索未取得可用结果。' : research.state === 'partial' ? '部分资料未能读取，已保留成功结果。' : '原文已进入核对；取得资料不代表每个结论已获支持。'}</p>}
    <Button tone="primary" disabled={busy} onClick={() => void run('POST', pitchPath(pitch.id) + '/evidence', { version: pitch.version }, { success: '已安排继续自动查找，完成后会更新可选范围。' })}>继续自动查找资料</Button>
    {(prep.scope_options ?? []).map(option => <section key={option.id} className={inset}>
      <h3 className="text-sm font-semibold">可继续的范围：{option.question}</h3>
      <p className={muted}>选择后会按以下范围重做大纲，仍需你确认后才成稿。</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><h4 className="text-sm font-medium">这篇会回答</h4><ul className="mt-1 list-disc space-y-1 pl-4 text-sm">{option.includes.map((text, i) => <li key={i}>{text}</li>)}</ul></div>
        <div><h4 className="text-sm font-medium">本次暂不回答</h4><ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-ink-3">{option.omits.map((text, i) => <li key={i}>{text}</li>)}</ul></div>
      </div>
      <Button disabled={busy} onClick={() => void run('POST', pitchPath(pitch.id) + '/scope', { version: pitch.version, scope_id: option.id }, { success: '已选定范围，正在准备对应大纲。原问题与暂未回答项会保留。' })}>选择此范围，准备大纲</Button>
    </section>)}
    <p className={muted}>题目和已取得资料已保存。也可先返回工作台，稍后继续，无需补填任何内容。</p>
    <ButtonLink to="/admin/studio">先保留，返回工作台</ButtonLink>
    {!!research?.failures.length && <details>
      <summary className={disclosure}>查看未完成的检索（{research.failures.length}）</summary>
      <ul className="mt-2 space-y-2 text-xs leading-6 text-ink-3">{research.failures.map((failure, i) => <li key={i} className="break-words">{failure.url} · {failure.reason}</li>)}</ul>
    </details>}
  </div>;
}

function FragmentReview({ pitch, v2, run, busy, awaitingRetry, onRetryQueued }: {
  pitch: PitchRow; v2: V2; run: Run; busy: boolean; awaitingRetry?: number; onRetryQueued: (fragment: Fragment) => void;
}) {
  const [retryIndex, setRetryIndex] = useState<number | null>(null);
  const changes = changeEntries(v2);
  const done = v2.fragments.filter(fragment => fragment.status === 'done').length;
  const review = v2.assembled;
  async function retry(fragment: Fragment) {
    const index = fragment.op_index;
    if (busy || retryIndex !== index || awaitingRetry !== undefined) return;
    const result = await run('POST', pitchPath(pitch.id) + '/fragments/' + index + '/retry', {
      version: pitch.version, confirm_unknown: true,
    });
    if (result) {
      setRetryIndex(null);
      onRetryQueued(fragment);
    }
  }

  if (!changes.length && !review) return null;
  return <Card title="片段进度与审稿" right={<Badge tone={review ? 'ok' : 'muted'}>{done} / {changes.length} 已完成</Badge>}>
    <div className="space-y-3">
      {changes.map(({ edit, index }, i) => {
        const fragment = v2.fragments.find(item => item.op_index === index);
        const status = fragment?.status ?? 'pending';
        const retryable = fragment && (status === 'unknown' || status === 'failed') && awaitingRetry !== index;
        return <article key={index} className={inset}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="min-w-0 text-sm font-medium">{i + 1}. {opLabels[edit.op]} · {changeHeading(v2, edit)}</h3>
            <Badge tone={status === 'done' ? 'ok' : retryable ? 'warn' : status === 'running' ? 'accent' : 'muted'}>{awaitingRetry === index ? '重试已提交' : fragmentLabels[status]}</Badge>
          </div>
          {fragment?.error && <p className={muted}>{fragment.error}</p>}
          {fragment?.receipt_id != null && <p className={muted}>调用回执：{fragment.receipt_id}</p>}
          {status === 'done' && fragment?.zh_review && <details>
            <summary className={disclosure}>查看中文片段审稿</summary>
            <ReviewText>{fragment.zh_review}</ReviewText>
          </details>}
          {status === 'done' && fragment?.html_en && !review && <details>
            <summary className={disclosure}>查看英文片段 HTML 原文</summary>
            <ReviewText>{fragment.html_en}</ReviewText>
          </details>}
          {retryable && <>
            {status === 'unknown' && <p className={warning}>上一次调用结果未知，可能已经计费。重试会再次调用模型，可能产生新费用。</p>}
            {retryIndex === index ? <div className="space-y-2">
              <p className={muted}>确认重新生成这一段？已经完成的其他片段会保留。</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" tone="primary" disabled={busy || awaitingRetry !== undefined} onClick={() => void retry(fragment)}>确认重试此片段</Button>
                <Button size="sm" disabled={busy} onClick={() => setRetryIndex(null)}>取消</Button>
              </div>
            </div> : <Button size="sm" disabled={busy || awaitingRetry !== undefined} onClick={() => setRetryIndex(index)}>只重试此片段</Button>}
          </>}
        </article>;
      })}
      {review && <div className="space-y-3 border-t border-line pt-3">
        <h3 className="text-sm font-semibold">新旧对比</h3>
        <p className={muted}>这里只列出改动。展开后可查看新旧 HTML 原文。</p>
        {review.diff.map(({ op, paragraph, before, after }, index) => <details key={index} className={inset}>
          <summary className={disclosure}>{opLabels[op]}{paragraph ? ' · ' + paragraph : ' · 新章节'}</summary>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="min-w-0"><h4 className="text-sm font-semibold">修改前</h4><ReviewText>{before || '无原文'}</ReviewText></div>
            <div className="min-w-0"><h4 className="text-sm font-semibold">修改后</h4><ReviewText>{after || '无内容'}</ReviewText></div>
          </div>
        </details>)}
        {review.draft_id && <ButtonLink tone="primary" to={'/admin/studio/drafts/' + encodeURIComponent(review.draft_id)}>打开稿件审阅 →</ButtonLink>}
      </div>}
    </div>
  </Card>;
}

function PitchWork({ pitch }: { pitch: Pitch }) {
  const { run, busy } = useAdminAction();
  const { revalidate, state } = useRevalidator();
  const [confirmation, setConfirmation] = useState<{ taskId: string | null } | null>(null);
  const [generation, setGeneration] = useState<{ task_id: string; queued: boolean } | null>(null);
  const [retryReceipt, setRetryReceipt] = useState<{ fragment: Fragment; submittedAt: number } | null>(null);
  const prep = pitch.prep;
  const v2 = prep?.v2;
  const status = confirmation ? 'confirmed' : pitch.status;
  const taskId = generation?.task_id ?? pitch.task_id ?? confirmation?.taskId;
  const fragmentStarted = v2?.fragments.some(fragment => fragment.status !== 'pending');
  const retrySnapshot = retryReceipt?.fragment;
  const awaitingRetry = retryReceipt && retrySnapshot && Date.now() - retryReceipt.submittedAt < 20_000 && v2?.fragments.some(fragment =>
    fragment.op_index === retrySnapshot.op_index && fragment.status === retrySnapshot.status
    && fragment.receipt_id === retrySnapshot.receipt_id && fragment.error === retrySnapshot.error) ? retrySnapshot.op_index : undefined;
  const canGenerate = status === 'confirmed' && !generation && !v2?.assembled && !fragmentStarted && v2?.conclusion !== 'no_change'
    && (pitch.task_state === 'waiting' || !pitch.task_state && (!taskId || !!confirmation));
  const preparing = status === 'preparing' && !taskId;
  const fragmentActive = v2?.fragments.some(fragment => fragment.status === 'running'
    || fragment.status === 'pending' && fragmentStarted && !['received', 'blocked', 'failed'].includes(pitch.task_state ?? ''));
  const writing = !v2?.assembled && (pitch.task_state === 'writing' || pitch.task_state === 'queued' || !!fragmentActive || awaitingRetry !== undefined
    || !!generation?.queued && !fragmentStarted && !['received', 'blocked', 'unknown', 'failed'].includes(pitch.task_state ?? ''));

  useEffect(() => {
    if (!(preparing || writing) || state !== 'idle') return;
    const timer = window.setTimeout(() => void revalidate(), 3500);
    return () => window.clearTimeout(timer);
  }, [preparing, writing, state, revalidate]);

  async function generate() {
    if (!canGenerate) return;
    const result = await run<{ id: string; task_id: string; queued: boolean }>('POST', pitchPath(pitch.id) + '/generate', {});
    if (result) setGeneration(result);
  }

  async function upgrade() {
    if (busy || v2 || pitch.status !== 'confirmed') return;
    if (await run('POST', pitchPath(pitch.id) + '/upgrade', { version: pitch.version }, { success: '已开始新版备料。原任务仍保留。' })) {
      setConfirmation(null);
      setGeneration(null);
    }
  }

  if (taskId || status === 'confirmed') return <div className="space-y-4">
    <Card title="生成与继续任务" right={<Badge tone={pitch.task_state === 'unknown' ? 'warn' : 'ok'}>{writing ? '正在成稿'
      : v2?.assembled ? '已拼装' : pitch.task_state === 'unknown' ? '结果待核对' : taskId && !canGenerate ? '已有任务' : '已确认'}</Badge>}>
      <div className="space-y-3">
        <p role="status" className={muted}>{v2?.assembled ? v2.assembled.draft_id
          ? '改动已拼装。请核对中文片段和新旧对比，再打开稿件审阅。' : '改动已拼装。稿件尚未入库，可以先查看中文片段和新旧对比。'
          : v2 && (writing || fragmentStarted) ? '下方可查看每个片段的进度。已完成的片段会保留。'
          : pitch.task_state === 'unknown' ? '模型调用没有返回确定结果，可能已经计费。已保留任务和回执，请维护人核对后再决定是否重试。'
          : writing ? '英文稿正在后台处理，可以离开本页，稍后继续原任务查看结果。'
          : canGenerate ? '备料已确认。点击生成后，后台会排队写英文稿。'
          : '已有采编任务，请在工作台继续原任务并查看进度。'}</p>
        <div className="flex flex-wrap gap-2">
          {canGenerate && <Button tone="primary" disabled={busy} onClick={() => void generate()}>生成英文稿</Button>}
          {v2 && !canGenerate && !v2.assembled && <Button disabled={busy} onClick={() => void revalidate()}>刷新状态</Button>}
          {taskId && <ButtonLink tone={canGenerate ? 'secondary' : 'primary'} to={taskLink(taskId)}>继续原采编任务 →</ButtonLink>}
        </div>
        {!v2 && pitch.status === 'confirmed' && <div className="space-y-2 border-t border-line pt-3">
          <p className={muted}>新版会调用模型重新备料，再按片段成稿。原任务和回执会保留；结果未知的调用不会重试。</p>
          <Button disabled={busy} onClick={() => void upgrade()}>改用片段采编（新备料）</Button>
        </div>}
      </div>
    </Card>
    {v2 && <FragmentReview pitch={pitch} v2={v2} run={run} busy={busy} awaitingRetry={awaitingRetry}
      onRetryQueued={fragment => setRetryReceipt({ fragment, submittedAt: Date.now() })} />}
  </div>;

  if (preparing) return <Card title="后台正在备料" right={<Badge tone="accent">备料中</Badge>}>
    <p role="status" className={muted}>系统正在查找素材、对照已有页面并拟定大纲。可以离开，回来后从已保存的命题继续。</p>
    {prep?.started_at && <p className="mt-2 text-xs text-ink-3">开始时间：<Time at={prep.started_at} /></p>}
    <Button className="mt-3" disabled={state !== 'idle'} onClick={() => void revalidate()}>刷新状态</Button>
  </Card>;

  if (v2?.conclusion === 'no_change') return <div className="space-y-4">
    <Card title="无需升级" right={<Badge tone="ok">可保留原文</Badge>}><EditPlan v2={v2} /></Card>
    <Card title="核对判断依据"><Coverage pitch={pitch} v2={v2} run={run} busy={busy} editable={false} /></Card>
    {prep && <Reprepare key={pitch.version} pitch={pitch} prep={prep} run={run} busy={busy} />}
  </div>;

  if (status === 'ready' && prep) return <Confirmation key={pitch.version} pitch={pitch} prep={prep}
    onConfirmed={(taskId, queued) => { setConfirmation({ taskId }); if (taskId && queued) setGeneration({ task_id: taskId, queued }); }} />;

  return <div className="space-y-4">
    <Card title={prep?.model_outcome==='unknown'?'结果待核对':statusLabels[status]} right={<Badge tone="warn">{prep?.model_outcome==='unknown'?'未重试':statusLabels[status]}</Badge>}>
      <p role="status" className={warning}>{status === 'insufficient' ? '部分问题还缺可核对的依据。你可以继续自动查找，或明确选择有依据的回答范围。'
        : prep?.model_outcome==='unknown'?'模型没有返回确定结果，可能已经计费。已保存的拆题与检索仍可查看，等待核对后决定下一步。'
        : status === 'failed' ? '这次备料没有完成。已保留取得的资料，可选择继续自动查找。' : '还没有可确认的备料内容。'}</p>
      {prep?.error && <p className="mt-2 break-words text-sm text-ink-3">{prep.error}</p>}
      {prep && prep.model_outcome !== 'unknown' && <div className="mt-4"><ResearchChoices pitch={pitch} prep={prep} run={run} busy={busy} /></div>}
      {(status === 'insufficient'||prep?.model_outcome==='unknown') && prep && v2 ? <div className="mt-3 space-y-4">
        <Coverage pitch={pitch} v2={v2} run={run} busy={busy} editable={status==='insufficient'} pendingPlan={prep.model_outcome==='unknown'&&!v2.edit_plan.length} />
        {!!prep.materials.length && <CandidateMaterials prep={prep} selected={[]} busy={busy} />}
      </div> : status === 'insufficient' && !!prep?.materials.length && <div className="mt-3 space-y-2">
        <p className={muted}>已找到 {prep.materials.length} 条候选：</p>
        {prep.materials.map(material => <div key={material.id}><SourceLink url={material.url} title={material.title || material.url} /></div>)}
      </div>}
      {!prep && <Button className="mt-3" disabled={state !== 'idle'} onClick={() => void revalidate()}>刷新状态</Button>}
    </Card>
    {prep && prep.model_outcome!=='unknown' && <Reprepare key={pitch.version} pitch={pitch} prep={prep} run={run} busy={busy} />}
  </div>;
}

export default function StudioPitch({ loaderData }: Route.ComponentProps) {
  const { history, pitch, question, questionId } = loaderData;
  const step = !pitch ? 0 : pitch.task_id || pitch.status === 'confirmed' ? 3 : pitch.status === 'ready' || pitch.prep?.v2?.conclusion === 'no_change' ? 2 : 1;
  return <AdminPage title="命题采编" subtitle="输入一次题目，系统找资料。你选方向与大纲，确认后生成全文。"
    actions={<><ButtonLink to={desk} tone={pitch ? 'primary' : 'ghost'}>+ 新命题</ButtonLink><ButtonLink to="/admin/studio">返回采编工作台</ButtonLink></>}>
    <Progress current={step} />
    {pitch ? <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] lg:items-start">
      <aside className="contents lg:block lg:space-y-4">
        <div className="order-1 min-w-0"><BriefSummary pitch={pitch} /></div>
        <PitchContext pitch={pitch} />
        <div className="order-4 min-w-0"><History rows={history} activeId={pitch.id} /></div>
      </aside>
      <div className="order-2 min-w-0 lg:order-none"><PitchWork key={pitch.id} pitch={pitch} /></div>
    </div> : <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] lg:items-start">
      <div className="min-w-0 lg:col-start-2 lg:row-start-1"><NewPitch key={questionId ?? ''} question={question} missing={!!questionId && !question} /></div>
      <div className="min-w-0 lg:col-start-1 lg:row-start-1"><History rows={history} /></div>
    </div>}
  </AdminPage>;
}

function BriefSummary({ pitch }: { pitch: Pitch }) {
  const prep = pitch.prep;
  return <Card title="题目与搜索方向">
      <p className="whitespace-pre-wrap break-words text-sm font-medium">{prep?.question || pitch.title}</p>
      {prep && <div className="mt-3 space-y-2 text-sm">
        <p className={muted}>产出类型：{outputLabels[prep.output_type]}</p>
        {prep.question_en && <p className="break-words" lang="en">{prep.question_en}</p>}
        {prep.keywords.length > 0 && <ul aria-label="关键词" className="flex flex-wrap gap-1.5">
          {prep.keywords.map((word, i) => <li key={i} className="max-w-full break-words rounded-control bg-bg-sunk px-2 py-1 text-xs">{word}</li>)}
        </ul>}
        {pitch.status !== 'preparing' && prep.blacklist?.configured === false &&
          <p className={warning}>公司事实黑名单未配置。请核对涉及公司的说法。</p>}
      </div>}
  </Card>;
}

function PitchContext({ pitch }: { pitch: Pitch }) {
  const prep = pitch.prep;
  if (!prep || (!prep.existing_url && !prep.related_pages.length && (pitch.status === 'preparing' || prep.blacklist?.configured === false))) return null;
  return <Card title="已有页面与公司事实" className="order-3 min-w-0">
      <div className="space-y-3">
        {prep.existing_url && <div><p className={muted}>{prep.materials.some(material => material.existing_page) ? '已有页面正文已找到' : '已提供页面 URL，尚无正文素材'}</p><SourceLink url={prep.existing_url} title={prep.existing_url} /></div>}
        {!!prep.related_pages.length && <div>
          <p className={muted}>相近页面 · 可考虑升级或加内链</p>
          <ul className="space-y-1">{prep.related_pages.map(page => <li key={page.url}><SourceLink url={page.url} title={page.title || page.url} /></li>)}</ul>
        </div>}
        {pitch.status !== 'preparing' && (prep.blacklist
          ? prep.blacklist.configured && <p className={muted}>黑名单：禁止项 {prep.blacklist.blocked} 处 · 待确认 {prep.blacklist.pending} 处</p>
          : <p className={muted}>本次没有返回公司事实黑名单检查结果。</p>)}
      </div>
  </Card>;
}

function Reprepare({ pitch, prep, run, busy }: { pitch: PitchRow; prep: Prep; run: Run; busy: boolean }) {
  const [output, setOutput] = useState<OutputType>(prep.output_type);
  const [url, setUrl] = useState(prep.existing_url);
  const [links, setLinks] = useState(prep.links.join('\n'));
  const parsed = parseLinks(links);
  const error = briefError(output, url.trim(), parsed);
  return <Card title="自选补充（不影响继续）">
    <details>
      <summary className="cursor-pointer text-sm font-medium text-accent">补参考链接或调整设置（选填）</summary>
      <div className="mt-4 space-y-3">
        {!!prep.link_errors?.length && <ul aria-label="未能读取的链接" className="space-y-2">
          {prep.link_errors.map(({ url, reason }) => <li key={url} className={warning}><span className="break-all">{url}</span> · {reason}</li>)}
        </ul>}
        <BriefFields output={output} setOutput={setOutput} url={url} setUrl={setUrl} links={links} setLinks={setLinks} disabled={busy} />
        {prep.related_pages.length > 0 && <div className="space-y-2">
          <p className={muted}>也可以把相近页面用作升级目标：</p>
          {prep.related_pages.filter(page => httpUrl(page.url)).map(page => <div key={page.url} className="flex flex-wrap items-center gap-2">
            <SourceLink url={page.url} title={page.title || page.url} />
            <Button size="sm" disabled={busy} onClick={() => { setUrl(page.url); setOutput('update'); }}>用作已有页面</Button>
          </div>)}
        </div>}
        {error && <p className={muted}>{error}</p>}
        <p className={muted}>重新备料会由后台再次调用模型，并更新当前的素材、大纲和标题候选。</p>
        <Button disabled={busy || !!error} onClick={() => void run('PATCH', pitchPath(pitch.id), {
          version: pitch.version, links: parsed, output_type: output, existing_url: url.trim(),
        }, { success: '已请求重新备料。' })}>重新备料（调用模型）</Button>
      </div>
    </details>
  </Card>;
}

function parseEngineerReply(questions: EngineerQuestion[], reply: string): Answer[] | null {
  const input = reply.trim();
  const tokens = [...input.matchAll(/(?:^|[\s,;，；])(\d+)\s*([A-D])(?=$|[\s,;，；])/gi)];
  if (tokens.length !== questions.length || tokens[0]?.index !== 0) return null;
  const seen = new Set<number>();
  const answers: Answer[] = [];
  for (const [i, token] of tokens.entries()) {
    const n = Number(token[1]) - 1;
    const question = questions[n];
    const option = question?.options.find(item => item.id === token[2].toUpperCase());
    const tail = input.slice(token.index + token[0].length, tokens[i + 1]?.index).replace(/[\s,;，；]+$/u, '').trim();
    if (!question || !option || seen.has(n)) return null;
    const note = tail.replace(/^[:：]\s*/u, '');
    if ((!option.conservative && !note) || note.length > 1000) return null;
    seen.add(n);
    answers.push({ question_id: question.id, choice: option.id, note });
  }
  return answers;
}

function EngineerReview({ prep, conservative, setConservative, name, setName, reply, setReply, busy }: {
  prep: Prep; conservative: boolean; setConservative: (value: boolean) => void; name: string; setName: (value: string) => void;
  reply: string; setReply: (value: string) => void; busy: boolean;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const questions = prep.engineer_questions;
  if (!questions.length) return <p className={muted}>这次没有工程确认题。成稿不会标为工程已审。</p>;
  const cardText = ['工程确认卡', prep.question, ...questions.flatMap((q, i) => [
    (i + 1) + '. ' + q.question,
    ...q.options.map(o => o.id + '：' + o.label + (o.instruction ? ' — ' + o.instruction : '')),
  ]), '请回复题号和选项。选择非保守项时，请在选项后空一格写明依据，例如：1A；2B 依据是……'].join('\n');

  async function copyCard() {
    try {
      await copyText(cardText);
      setCopyStatus('已复制，可以发给工程师。');
    } catch { setCopyStatus('未能复制，请展开下方卡片并手动复制。'); }
  }

  return <div className="space-y-4">
    <p className={muted}>请把确认卡发给工程师。保守写法会略去待确认的数字，不标为工程已审。</p>
    <ol className="space-y-3">
      {questions.map((question, i) => <li key={question.id} className="break-words rounded-control bg-bg-sunk p-3 text-sm">
        <h3 className="font-medium">{i + 1}. {question.question}</h3>
        <ul className="mt-2 space-y-1">
          {question.options.map(option => <li key={option.id}>{option.id}. {option.label}{option.conservative && '（保守写法）'}{option.instruction && <span className="text-ink-3"> · {option.instruction}</span>}</li>)}
        </ul>
        {!!question.section_ids.length && <p className="mt-2 text-xs text-ink-3">涉及：{question.section_ids.map(id => prep.outline.find(section => section.id === id)?.heading ?? id).join('、')}</p>}
        {!!question.withheld_numbers.length && <p className="mt-1 text-xs text-ink-3">保守写法省略：{question.withheld_numbers.join('、')}</p>}
      </li>)}
    </ol>
    <div className="flex flex-wrap items-center gap-2"><Button disabled={busy} onClick={() => void copyCard()}>复制工程确认卡</Button><p role="status" className={muted}>{copyStatus}</p></div>
    <details>
      <summary className="cursor-pointer text-sm text-accent">查看可复制的文字</summary>
      <pre className="mt-2 whitespace-pre-wrap break-words rounded-control bg-bg-sunk p-3 text-xs">{cardText}</pre>
    </details>
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      <legend className="mb-2 text-sm font-medium">怎么处理工程确认？</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2"><input type="radio" name="engineering-mode" checked={conservative} onChange={() => setConservative(true)} />用保守写法</label>
        <label className="flex items-center gap-2"><input type="radio" name="engineering-mode" checked={!conservative} onChange={() => setConservative(false)} />录入工程师回复</label>
      </div>
      {!conservative && <>
        <Field label="工程师姓名" hint="姓名仅供内部追溯，不对外公开。"><Input aria-label="工程师姓名" maxLength={100} value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label="工程师原回复" hint="粘贴实际收到的回复。非保守选项须附依据，例如：1A；2B 依据是……">
          <Textarea aria-label="工程师原回复" maxLength={2000} rows={2} value={reply} onChange={e => setReply(e.target.value)} />
        </Field>
      </>}
    </fieldset>
  </div>;
}
