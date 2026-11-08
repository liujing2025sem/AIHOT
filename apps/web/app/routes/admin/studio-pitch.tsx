import { useEffect, useState } from 'react';
import { Link, useNavigate, useRevalidator } from 'react-router';
import type { Route } from './+types/studio-pitch';
import { adminGet } from '../../lib/admin.server';
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
type Prep = Brief & {
  question: string; question_en: string; keywords: string[]; materials: Material[]; related_pages: { url: string; title: string }[];
  outline: Section[]; titles: Title[]; hooks: Title[]; engineer_questions: EngineerQuestion[];
  blacklist?: { configured: boolean; blocked: number; pending: number }; error?: string | null;
  link_errors?: { url: string; reason: string }[]; started_at?: string | null;
};
type PitchRow = { id: string; title: string; status: Status; version: number; task_id: string | null; task_state?: string | null };
type Pitch = PitchRow & { prep: Prep | null };
type PrepResults = 'question_en' | 'keywords' | 'materials' | 'related_pages' | 'outline' | 'titles' | 'hooks' | 'engineer_questions';
type PitchResponse = PitchRow & { prep: (Omit<Prep, PrepResults> & Partial<Omit<Pick<Prep, PrepResults>, 'materials'>> &
  { materials?: (Material & { body_text?: string | null })[] }) | null };
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
  return {
    ...raw, question_en: raw.question_en ?? '', keywords: raw.keywords ?? [], related_pages: raw.related_pages ?? [],
    outline: raw.outline ?? [], titles: raw.titles ?? [], hooks: raw.hooks ?? [], engineer_questions: raw.engineer_questions ?? [],
    materials: (raw.materials ?? []).map(({ id, title, url, revision, published_at, publication_time, snippet, hit_count, first_party, existing_page, body_status }) =>
      ({ id, title, url, revision, published_at, publication_time, snippet, hit_count, first_party, existing_page, body_status })),
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

const panels = ['素材', '大纲', '标题', '工程确认'];
const readable = (material: Material) => !material.body_status || material.body_status === 'ok';

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

function Confirmation({ pitch, prep, onConfirmed }: { pitch: PitchRow; prep: Prep; onConfirmed: (taskId: string | null) => void }) {
  const [panel, setPanel] = useState(0);
  const [selected, setSelected] = useState(() => {
    const cited = new Set([...prep.outline.flatMap(s => s.evidence.map(e => e.article_id)), ...prep.titles.map(t => t.article_id)]);
    return prep.materials.filter(m => readable(m) && (m.existing_page || cited.has(m.id))).map(m => m.id);
  });
  const [outline, setOutline] = useState(() => prep.outline.map(({ id, heading }) => ({ id, heading, include: true })));
  const [output, setOutput] = useState<FinalOutput>(prep.output_type === 'auto' ? (prep.existing_url ? 'update' : 'guide') : prep.output_type);
  const [title, setTitle] = useState('');
  const [conservative, setConservative] = useState(true);
  const [name, setName] = useState('');
  const [reply, setReply] = useState('');
  const { run, busy } = useAdminAction();

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
  const blocker = !enoughEvidence ? '请选至少 2 条素材，或选用已有页面正文。'
    : output === 'update' && !prep.existing_url ? '升级已有页需要先补充已有页面 URL 并重新备料。'
    : output === 'update' && !selectedExistingPage ? '升级稿需要选中已有页面正文。'
    : !validTitle ? '请在“标题”中选择一个有已选素材支撑的标题。'
    : !includedSections.length || includedSections.some(section => !section.heading.trim()) ? '大纲至少保留一节，且保留的章节都要有标题。'
    : prep.outline.some((section, i) => outline[i].include && !supportedSection(section)) ? '请为保留的章节选用对应素材，或取消保留无证据、无工程确认的章节。'
    : !engineer ? (conservative ? '确认卡缺少保守选项，请重做备料。' : '请填写工程师姓名和完整的实际回复，或改用保守写法。')
    : '';

  async function confirm() {
    if (blocker || !engineer) return;
    const result = await run<{ id: string; status: 'confirmed'; task_id: string | null; reused?: boolean }>('POST', pitchPath(pitch.id) + '/confirm', {
      version: pitch.version, article_ids: selected, selected_title: title, output_type: output,
      outline: outline.map((section, i) => ({ ...section, heading: section.heading.trim() || prep.outline[i].heading })), engineer,
    });
    if (result && !result.reused) onConfirmed(result.task_id);
  }

  return <div className="space-y-4">
    <Card title="检查备料" right={<Badge tone="accent">{statusLabels.ready}</Badge>}>
      <nav aria-label="备料检查" className="mb-4 grid grid-cols-4 gap-1 rounded-control bg-bg-sunk p-1">
        {panels.map((label, i) => <Button key={label} size="sm" tone={panel === i ? 'primary' : 'ghost'} aria-pressed={panel === i}
          className="min-w-0 px-1 sm:px-2" onClick={() => setPanel(i)}>{label}</Button>)}
      </nav>

      {panel === 0 && <div className="space-y-3">
        <p className={muted}>检查命中句和出处，只保留成稿会用到的素材。</p>
        {prep.materials.length ? <MaterialList materials={prep.materials} selected={selected} busy={busy}
          toggle={id => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])} />
          : <p className={warning}>没有找到可用素材。请先补充线索。</p>}
      </div>}

      {panel === 1 && <div className="space-y-3">
        <p className={muted}>核对每一节的证据。可以改章节名，或取消保留。</p>
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
      </div>}

      {panel === 2 && <div className="space-y-4">
        <Field label="确认产出类型">
          <Select aria-label="确认产出类型" value={output} disabled={busy} onChange={e => {
            if (isFinalOutput(e.target.value)) { setOutput(e.target.value); setTitle(''); }
          }}>{outputChoices.map(choice => <option key={choice} value={choice}>{outputLabels[choice]}</option>)}</Select>
        </Field>
        <fieldset disabled={busy} className="min-w-0 space-y-2">
          <legend className="mb-2 text-sm font-medium">{output === 'short' ? '短文章标题（选一个）' : '页面标题（选一个）'}</legend>
          {candidates.length ? candidates.map((candidate, i) => <label key={i} className="flex items-start gap-2 rounded-control bg-bg-sunk p-3 text-sm">
            <input type="radio" name="pitch-title" className="mt-1" disabled={!titleSupported(candidate)} checked={title === candidate.title} onChange={() => setTitle(candidate.title)} />
            <span className="min-w-0 break-words">{candidate.title}
              <small className="mt-1 block text-ink-3">事实锚点：{candidate.anchor || '未提供'}</small>
              {candidate.quote && <small className="mt-1 block text-ink-3">原文：{candidate.quote}</small>}
              {!titleSupported(candidate) && <small className="mt-1 block text-ink-3">先选用对应素材</small>}
            </span>
          </label>) : <p className={warning}>没有标题候选。请补线索或更改产出类型后重新备料。</p>}
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

      <div className="mt-4 flex flex-wrap justify-between gap-2 border-t border-line pt-3">
        {panel > 0 && <Button onClick={() => setPanel(panel - 1)}>上一步</Button>}
        {panel < panels.length - 1 && <Button className="ml-auto" onClick={() => setPanel(panel + 1)}>下一步：{panels[panel + 1]}</Button>}
      </div>
    </Card>

    <Card title="确认备料">
      <p className={muted}>已选 {selected.length} 条素材{selectedExistingPage ? '，含已有页面正文' : ''} · 保留 {includedSections.length} 节 · {outputLabels[output]} · {conservative ? '保守写法' : '工程师回复'}</p>
      <p className="mt-1 break-words text-sm">{blocker || '确认后，可单独点击“生成英文稿”。'}</p>
      <Button tone="primary" className="mt-3" disabled={busy || !!blocker} onClick={() => void confirm()}>确认备料</Button>
    </Card>
    <Reprepare pitch={pitch} prep={prep} run={run} busy={busy} />
  </div>;
}

function PitchWork({ pitch }: { pitch: Pitch }) {
  const { run, busy } = useAdminAction();
  const { revalidate, state } = useRevalidator();
  const [confirmation, setConfirmation] = useState<{ taskId: string | null } | null>(null);
  const [generation, setGeneration] = useState<{ task_id: string; queued: boolean } | null>(null);
  const prep = pitch.prep;
  const status = confirmation ? 'confirmed' : pitch.status;
  const taskId = generation?.task_id ?? pitch.task_id ?? confirmation?.taskId;
  const canGenerate = status === 'confirmed' && !generation && (!taskId || !!confirmation || pitch.task_state === 'waiting');
  const preparing = status === 'preparing' && !taskId;

  useEffect(() => {
    if (!preparing || state !== 'idle') return;
    const timer = window.setTimeout(() => void revalidate(), 3500);
    return () => window.clearTimeout(timer);
  }, [preparing, state, revalidate]);

  async function generate() {
    if (!canGenerate) return;
    const result = await run<{ id: string; task_id: string; queued: boolean }>('POST', pitchPath(pitch.id) + '/generate', {});
    if (result) setGeneration(result);
  }

  if (taskId || status === 'confirmed') return <Card title="生成与继续任务" right={<Badge tone="ok">{generation?.queued ? '已排队' : taskId && !canGenerate ? '已有任务' : '已确认'}</Badge>}>
    <div className="space-y-3">
      <p role="status" className={muted}>{generation?.queued ? '英文成稿已排队。请在采编工作台查看进度和稿件。'
        : canGenerate ? '备料已确认。点击生成后，后台会排队写英文稿。'
        : '已有采编任务，请在工作台继续原任务并查看进度。'}</p>
      <div className="flex flex-wrap gap-2">
        {canGenerate && <Button tone="primary" disabled={busy} onClick={() => void generate()}>生成英文稿</Button>}
        {taskId && <ButtonLink tone={canGenerate ? 'secondary' : 'primary'} to={taskLink(taskId)}>继续原采编任务 →</ButtonLink>}
      </div>
    </div>
  </Card>;

  if (preparing) return <Card title="后台正在备料" right={<Badge tone="accent">备料中</Badge>}>
    <p role="status" className={muted}>系统正在查找素材、对照已有页面并拟定大纲。可以离开，回来后从已保存的命题继续。</p>
    {prep?.started_at && <p className="mt-2 text-xs text-ink-3">开始时间：<Time at={prep.started_at} /></p>}
    <Button className="mt-3" disabled={state !== 'idle'} onClick={() => void revalidate()}>刷新状态</Button>
  </Card>;

  if (status === 'ready' && prep) return <Confirmation key={pitch.version} pitch={pitch} prep={prep}
    onConfirmed={taskId => setConfirmation({ taskId })} />;

  return <div className="space-y-4">
    <Card title={statusLabels[status]} right={<Badge tone="warn">{statusLabels[status]}</Badge>}>
      <p role="status" className={warning}>{status === 'insufficient' ? '证据不足，暂不能确认或成稿。请补线索，或改成短文章后重新备料。成稿仍需至少 2 条素材，或包含已有页面正文。'
        : status === 'failed' ? '这次备料没有完成。可以检查线索后再试。' : '还没有可确认的备料内容。'}</p>
      {prep?.error && <p className="mt-2 break-words text-sm text-ink-3">{prep.error}</p>}
      {status === 'insufficient' && !!prep?.materials.length && <div className="mt-3 space-y-2">
        <p className={muted}>已找到 {prep.materials.length} 条候选：</p>
        {prep.materials.map(material => <div key={material.id}><SourceLink url={material.url} title={material.title || material.url} /></div>)}
      </div>}
      {!prep && <Button className="mt-3" disabled={state !== 'idle'} onClick={() => void revalidate()}>刷新状态</Button>}
    </Card>
    {prep && <Reprepare key={pitch.version} pitch={pitch} prep={prep} run={run} busy={busy} />}
  </div>;
}

export default function StudioPitch({ loaderData }: Route.ComponentProps) {
  const { history, pitch, question, questionId } = loaderData;
  const step = !pitch ? 0 : pitch.task_id || pitch.status === 'confirmed' ? 3 : pitch.status === 'ready' ? 2 : 1;
  return <AdminPage title="命题采编" subtitle="写一个问题，先备料和核对出处，再生成英文稿。"
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
  return <Card title="补线索或重做备料">
    <details open={pitch.status === 'insufficient' || pitch.status === 'failed' ? true : undefined}>
      <summary className="cursor-pointer text-sm font-medium text-accent">编辑线索、已有页面和产出类型</summary>
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
      await navigator.clipboard.writeText(cardText);
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
