import { useState, useEffect } from 'react';
import { Link, useBeforeUnload, useBlocker } from 'react-router';
import { ExternalLink, FileCheck2, FileText, History, Link2, LocateFixed, MessageSquareText, Save, ShieldAlert } from 'lucide-react';
import { CATEGORIES } from '@aihot/industry/taxonomy';
import type { Route } from './+types/studio-draft';
import { adminGet } from '../../lib/admin.server';
import { useAdminAction } from '../../features/admin/action';
import { AdminPage, Card, Button, Badge, Field, Input, Select, Textarea, Time } from '../../features/admin/ui';
import { DirectPublish } from '../../features/admin/publishing';
import { Checkbox } from '../../components/ui/primitives/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/primitives/tabs';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../../components/ui/primitives/accordion';

type Document = {
  news_status?: 'reported' | 'unconfirmed' | 'confirmed' | 'denied' | 'corrected';
  camos?: { status: string; ruleIds: string[]; suppliedRuleIds?: string[] };
  title_zh: string; title_en: string; review_zh: string; body_en: string;
  keyword_hypothesis: string; meta_description_en: string; questions_zh: string[];
  evidence: { claim: string; quote: string }[];
  source: { url: string; revision: number; published_at: string | null };
};
type Finding = { ruleId: string; severity: 'BLOCK' | 'WARN'; field: string; start: number; end: number; quote: string; reason: string };
type Issue = { id: string; fingerprint: string; ruleId: string; severity: 'BLOCK' | 'WARN'; title: string; group: 'required' | 'recommended'; confirmable: boolean; count: number; occurrences: Finding[] };
type WordPressReceipt = { version: number; kind: string; section: string; editUrl: string | null; recoveryKey: string | null } & (
  { state: 'pushed'; media: 'set' | 'not_configured' | 'not_applied'; metaDescription: string } |
  { state: 'unknown'; httpStatus?: number } | { state: 'pending' | 'blocked' }
);
type Detail = {
  source_snapshot: { body_text: string | null; title: string };
  issues: { items: Issue[]; summary: { findingCount: number; issueCount: number; requiredCount: number; recommendedCount: number } };
  confirmed_issues: { issueId: string; fingerprint: string }[];
  gate: { blocked: boolean; findings: Finding[]; mandatoryReview: string[] };
  id: string; document: Document; status: string; version: number; updated_at: string;
  material: { title: string; body_text: string; revision: number };
  history: { created_at: string; actor: string; action: string; reason: string | null }[];
  wordpress: { ready: boolean; message: string | null; receipt: WordPressReceipt | null };
};
export async function loader({ request, params }: Route.LoaderArgs) {
  return adminGet<Detail>(request, '/api/admin/studio/drafts/' + params.id);
}
const label: Record<string, string> = { draft: '待编辑', in_review: '待审稿', approved: '审核通过' };
export default function DraftPage({ loaderData: row }: Route.ComponentProps) {
  return <Editor key={row.id + ':' + row.version} row={row} />;
}

function WordPressDraft({ row, dirty, busy, run }: { row: Detail; dirty: boolean; busy: boolean; run: ReturnType<typeof useAdminAction>['run'] }) {
  const { ready, message, receipt } = row.wordpress;
  const [kind, setKind] = useState(receipt?.kind ?? ''), [section, setSection] = useState(receipt?.section ?? '');
  const hold = message ?? (dirty ? '请先保存修改，再审核当前版本。'
    : row.status !== 'approved' ? '审核通过后可以推送英文稿。'
    : row.material?.revision !== row.document.source.revision ? '原文已变化，请重新建立采编任务并审核。'
    : row.gate.blocked ? '当前稿件有否决项，请修改并重新审核。' : null);
  return <Card title="上线与 WordPress 草稿">
    <DirectPublish draft={{ id: row.id, version: row.version, title: row.document.title_en }} disabled={dirty || busy} />
    {dirty && <p className="mt-3 text-xs leading-5 text-amber-ink">修改尚未保存，上线按钮暂不可用。请先保存当前版本。</p>}
    <div className="mt-5 border-t border-line pt-5">
      <h3 className="mb-2 text-sm font-semibold text-ink">先送入草稿箱</h3>
      <p className="mb-3 text-xs leading-6 text-ink-3">人审后上线：已审核的英文稿进入 WordPress 草稿箱，由你发布。升级稿单独建草稿，不覆盖原公开页面。</p>
      {hold && <p className="mb-3 rounded-control bg-bg-sunk p-3 text-xs leading-5 text-ink-3">{hold}</p>}
      {ready && <div className="mb-4 space-y-3">
        <Field label="稿件类型"><Select value={kind} onChange={e => setKind(e.target.value)} disabled={busy || !!hold}>
          <option value="">请选择类型</option><option value="brief">短讯或短文章 → Industry News</option><option value="guide">长文或升级稿 → Choose Guides</option>
        </Select></Field>
        <Field label="文章或头条分节"><Select value={section} onChange={e => setSection(e.target.value)} disabled={busy || !!hold}>
          <option value="">请选择分节</option>{CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.section}</option>)}
        </Select></Field>
      </div>}
      <Button className="w-full" disabled={busy || !!hold || !kind || !section} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/wordpress', { version: row.version, kind, section })}>推送WordPress草稿</Button>
    </div>
    {receipt && <div className="mt-4 space-y-2 text-sm leading-6" aria-live="polite">
      {receipt.state === 'pushed' && <>
        <p>已推送版本 {receipt.version}。{(receipt.version !== row.version || row.status !== 'approved' || dirty) && '这是此前的推送记录。'}</p>
        <p className="text-xs text-ink-3">{receipt.media === 'set' ? '已应用分节特色图。' : receipt.media === 'not_applied' ? 'WordPress 未确认应用特色图，请在草稿中核对。' : '本分节未配置特色图，本次未设置。'}</p>
        <Field label="SEO 描述未写入，请复制到 WordPress"><Input readOnly value={receipt.metaDescription} onFocus={e => e.currentTarget.select()} /></Field>
      </>}
      {receipt.state === 'blocked' && <p>WordPress 文章已不是草稿，或已找不到。已停止改写，请在 WordPress 中核对。</p>}
      {(receipt.state === 'unknown' || receipt.state === 'pending') && <p>尚未确认推送结果{receipt.state === 'unknown' && receipt.httpStatus ? '（HTTP ' + receipt.httpStatus + '）' : ''}。{receipt.editUrl ? '再次推送只会检查并更新原草稿。' : '再次点击只会查找原草稿。若找不到，请让维护人在 WordPress 核对。'}</p>}
      {receipt.recoveryKey && <details><summary className="cursor-pointer text-xs text-ink-3">查看查找编号</summary><p className="mt-2 break-all text-xs text-ink-3">{receipt.recoveryKey}</p></details>}
      {receipt.editUrl && <a className="inline-flex items-center gap-1 text-accent" href={receipt.editUrl} target="_blank" rel="noreferrer">打开 WordPress 文章 <ExternalLink className="size-3.5" aria-hidden="true" /></a>}
    </div>}
  </Card>;
}

function Editor({ row }: { row: Detail }) {
  const [confirmed, setConfirmed] = useState<string[]>(row.confirmed_issues.map(c => c.issueId));
  const confirmations = row.issues.items.filter(i => i.confirmable && confirmed.includes(i.id)).map(i => ({ issueId: i.id, fingerprint: i.fingerprint }));
  const allConfirmed = row.issues.items.every(i => i.confirmable && confirmed.includes(i.id));
  const remaining = row.issues.items.filter(i => !i.confirmable || !confirmed.includes(i.id)).length;
  const [substantive, setSubstantive] = useState(false), [categories, setCategories] = useState<string[]>([]), [minutes, setMinutes] = useState(''), [fullReview, setFullReview] = useState(false);
  const [d, setD] = useState(row.document), [tab, setTab] = useState('zh'), [note, setNote] = useState('');
  const [metadataOpen, setMetadataOpen] = useState('');
  const { run, busy } = useAdminAction();
  const dirty = JSON.stringify(d) !== JSON.stringify(row.document);
  useBeforeUnload(event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('稿件还有未保存的修改，确认离开？')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  const locate = (f: Finding) => {
    setTab(f.field === 'source.body_text' ? 'source' : f.field.endsWith('_zh') ? 'zh' : 'en');
    if (f.field === 'meta_description_en' || f.field === 'keyword_hypothesis') setMetadataOpen('metadata');
    setTimeout(() => {
      const el = document.querySelector('[data-field="' + f.field + '"]');
      if (!el) return;
      const details = el.closest('details');
      if (details) details.open = true;
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
        el.focus(); el.setSelectionRange(f.start, f.end);
      } else if (el.firstChild) {
        const range = document.createRange();
        range.setStart(el.firstChild, Math.min(f.start, el.firstChild.textContent?.length ?? 0));
        range.setEnd(el.firstChild, Math.min(f.end, el.firstChild.textContent?.length ?? 0));
        const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
      }
    }, 50);
  };
  const issueList = (group: 'required' | 'recommended') => <ul className="space-y-3">
    {row.issues.items.filter(i => i.group === group).map(i => {
      const checked = i.confirmable && confirmed.includes(i.id);
      return <li key={i.id} className="rounded-card border border-line p-3.5">
        <div className="flex items-start gap-3">
          {i.confirmable ? <Checkbox id={'confirm-' + i.id} aria-label={'确认 ' + i.title} disabled={busy || dirty} checked={checked} onCheckedChange={value => setConfirmed(v => value === true ? [...v, i.id] : v.filter(id => id !== i.id))} className="mt-0.5" /> : <ShieldAlert className="mt-0.5 size-5 shrink-0 text-hot" aria-hidden="true" />}
          <div className="min-w-0 flex-1">
            <Badge tone={checked ? 'ok' : i.confirmable ? 'warn' : 'bad'}>{checked ? '已核对' : i.confirmable ? '待确认' : '需要修改'}</Badge>
            {i.confirmable ? <label htmlFor={'confirm-' + i.id} className="mt-2 block cursor-pointer break-words text-sm font-medium leading-6 text-ink">{i.title}</label> : <p className="mt-2 break-words text-sm font-medium leading-6 text-ink">{i.title}</p>}
            <p className="mt-1 text-xs leading-5 text-ink-3">{i.confirmable ? '核对原文后勾选，确认仅对当前版本有效。' : '人审模式下需要修改内容，不能勾选放行。'}</p>
          </div>
        </div>
        <Accordion type="single" collapsible className="mt-1">
          <AccordionItem value="evidence" className="border-0">
            <AccordionTrigger className="py-2 text-xs text-accent">查看原因与 {i.count} 处原文</AccordionTrigger>
            <AccordionContent className="pb-0">
              {i.occurrences.map((f, index) => <div key={index} className="mt-3 border-l-2 border-line pl-3">
                <p className="text-xs leading-6 text-ink-2">{f.reason}</p>
                <blockquote className="mt-2 whitespace-pre-wrap break-words rounded-control bg-bg-sunk p-2.5 text-xs leading-6 text-ink-3">{f.quote}</blockquote>
                <Button size="sm" tone="ghost" className="mt-1" onClick={() => locate(f)}><LocateFixed aria-hidden="true" />定位到稿件</Button>
                <p className="mt-1 break-all text-[11px] text-ink-4">规则 {f.ruleId} · {f.severity} · {f.field} · {f.start}–{f.end}</p>
              </div>)}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </li>;
    })}
  </ul>;
  const change = (key: keyof Document, value: string) => setD(x => ({ ...x, [key]: key === 'questions_zh' ? value.split('\n').filter(Boolean) : value }));
  const field = (key: keyof Document, title: string, large = false) => <div className="mb-5"><Field label={title}>
    {large ? <Textarea data-field={key} value={String(d[key])} onChange={e => change(key, e.target.value)} className="min-h-[440px] text-[15px] leading-8" /> : <Input data-field={key} value={String(d[key])} onChange={e => change(key, e.target.value)} />}
  </Field></div>;
  const history = <div className="divide-y divide-line">
    {row.history.map((h, i) => <div className="py-3 text-xs leading-6" key={i}>
      <p>{({ 'studio.draft.confirm': '逐项确认风险', 'studio.draft.save': '保存稿件', 'studio.draft.submit': '提交审稿', 'studio.draft.approve': '审核通过', 'studio.draft.return': '退回修改' } as Record<string, string>)[h.action] || h.action} · {h.actor} · <Time at={h.created_at} /></p>
      {h.reason && <p className="mt-1 text-ink-3">{h.reason}</p>}
    </div>)}
    {!row.history.length && <p className="py-3 text-xs text-ink-3">由 Agent 结果导入，尚无人工修改。</p>}
  </div>;

  return <AdminPage title={row.document.title_zh} subtitle={<span><Badge tone={row.status === 'approved' ? 'ok' : 'warn'}>{label[row.status]}</Badge><span className="ml-2">版本 {row.version} · <Time at={row.updated_at} /></span></span>} actions={<Link to="/admin/studio?tab=drafts" className="text-sm font-medium text-accent">返回稿件</Link>}>
    <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-card border border-line bg-surface px-4 py-3 text-xs text-ink-3">
      <span className="inline-flex items-center gap-2"><FileText className="size-4 text-accent" aria-hidden="true" />中文核对，英文交付</span>
      <span>原信源日期：{d.source.published_at ?? '尚待核实'}</span>
      <a href={d.source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-medium text-accent"><Link2 className="size-3.5" aria-hidden="true" />打开原始来源</a>
      {row.material?.revision !== d.source.revision && <span className="text-hot">原文版本已变化，请重新建立采编任务核对。</span>}
    </div>

    <div className="grid min-w-0 grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-5">
        <Card title="审阅与编辑" right={<span>{dirty ? '有修改未保存' : '当前版本已保存'}</span>}>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList aria-label="稿件阅读方式" className="w-full justify-start">
              <TabsTrigger value="zh">中文审稿</TabsTrigger>
              <TabsTrigger value="en">英文交付</TabsTrigger>
              <TabsTrigger value="source">原文与证据</TabsTrigger>
            </TabsList>
            <TabsContent value="zh">
              {field('title_zh', '中文标题')}
              {field('review_zh', '中文正文', true)}
              <Field label="待核实问题（每行一项）"><Textarea value={d.questions_zh.join('\n')} onChange={e => change('questions_zh', e.target.value)} className="min-h-28 leading-6" /></Field>
            </TabsContent>
            <TabsContent value="en">
              <p className="mb-4 text-xs leading-6 text-ink-3">公开交付为英文，位置为 Chipshow Blog；中文仅内部审稿。具体网站路径待 CMS 映射。限定语、原日期和出处会进入英文导出。</p>
              {field('title_en', 'English title')}
              {field('body_en', 'English body · Markdown', true)}
              <Accordion type="single" collapsible value={metadataOpen} onValueChange={setMetadataOpen}>
                <AccordionItem value="metadata">
                  <AccordionTrigger>搜索摘要与消息状态</AccordionTrigger>
                  <AccordionContent>
                    {field('meta_description_en', 'Meta description')}
                    {field('keyword_hypothesis', '关键词假设')}
                    <Field label="消息状态"><Select aria-label="消息状态" value={d.news_status ?? 'reported'} onChange={e => change('news_status', e.target.value)}>
                      {[['reported', '原信源报道'], ['unconfirmed', '尚未证实 / 据传'], ['confirmed', '后续确认'], ['denied', '否认 / 更新'], ['corrected', '更正']].map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                    </Select></Field>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </TabsContent>
            <TabsContent value="source">
              <a className="inline-flex items-center gap-2 text-sm font-medium text-accent" href={d.source.url} target="_blank" rel="noreferrer">打开原始来源 <ExternalLink className="size-3.5" aria-hidden="true" /></a>
              <p className="mt-2 text-xs leading-6 text-ink-3">下方列出稿件说法与原文摘录。点右侧“定位到稿件”，可以回到需要核对的句子。</p>
              <div className="my-5 space-y-4">
                {d.evidence.map((e, i) => <div key={i} className="rounded-card border border-line p-4">
                  <p className="text-sm font-medium leading-6 text-ink">{e.claim}</p>
                  <blockquote className="mt-3 whitespace-pre-wrap border-l-2 border-accent pl-3 text-sm leading-7 text-ink-3">{e.quote}</blockquote>
                </div>)}
                {!d.evidence.length && <p className="rounded-control bg-bg-sunk p-4 text-sm leading-6 text-ink-3">本稿没有单独列出的证据摘录，请展开绑定原文核对。</p>}
              </div>
              <details className="rounded-control border border-line p-4">
                <summary className="cursor-pointer text-sm font-medium text-accent">展开稿件绑定版本的原文正文</summary>
                <pre data-field="source.body_text" className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-7">{row.source_snapshot.body_text}</pre>
              </details>
              {d.camos && <details className="mt-4 rounded-control border border-line p-4 text-xs leading-6">
                <summary className="cursor-pointer font-medium text-ink-3">CAMOS 方法引用</summary>
                <p className="mt-2">接入状态：{d.camos.status === 'connected' ? '已接入' : '未接入'}。</p>
                <p>写作者声明采用的规则：{d.camos.ruleIds.join('、') || '未记录'}。</p>
                <p>条目 ID 证明引用可追踪，不证明方法已正确应用或事实已批准。</p>
              </details>}
            </TabsContent>
          </Tabs>
        </Card>

        <Card>
          <Accordion type="multiple">
            <AccordionItem value="history"><AccordionTrigger><span className="inline-flex items-center gap-2"><History className="size-4" aria-hidden="true" />修改记录 · {row.history.length}</span></AccordionTrigger><AccordionContent>{history}</AccordionContent></AccordionItem>
            <AccordionItem value="review-help">
              <AccordionTrigger>人工全审参考</AccordionTrigger>
              <AccordionContent>
                <p className="text-xs leading-6 text-ink-3">先判断变化是否值得写、是否与已有内容重复。再核对型号、数字、条件、日期、归属和消息状态；认证、商务承诺、客户案例和新领域首篇逐字确认。人审档的所有 WARN 仍须逐项确认，数量不会改变放行规则。</p>
                <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" onClick={() => setTab('source')}>看原文与证据</Button><Button size="sm" onClick={() => setTab('zh')}>审中文</Button><Button size="sm" onClick={() => setTab('en')}>核对英文出口</Button></div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
      </div>

      <aside className="min-w-0 space-y-5" aria-label="审稿确认与交付">
        <Card title={<span className="inline-flex items-center gap-2">{row.gate.blocked ? <ShieldAlert className="size-4 text-hot" aria-hidden="true" /> : <FileCheck2 className="size-4 text-accent" aria-hidden="true" />}{row.gate.blocked ? '需要修改' : '待你确认'}</span>} right={<Badge tone={row.gate.blocked ? 'bad' : remaining ? 'warn' : 'ok'}>{row.gate.blocked ? '人审待修改' : remaining ? '剩余 ' + remaining + ' 项' : '逐项核对完成'}</Badge>}>
          <p className="mb-4 text-xs leading-6 text-ink-3">系统把 {row.issues.summary.findingCount} 处提示整理为 {row.issues.summary.issueCount} 个问题。查看对应原文，再勾选确认。</p>
          {row.gate.blocked && <p className="mb-4 rounded-control bg-hot-soft p-3 text-xs leading-6 text-hot">人审档当前有否决项，请修改后再审核。下方“一键上线”仍按已设置的独立上线方式处理内容。</p>}
          {issueList('required')}
          {row.issues.summary.recommendedCount > 0 && <Accordion type="single" collapsible className="mt-2">
            <AccordionItem value="recommended">
              <AccordionTrigger className="text-xs">其他待确认 · {row.issues.summary.recommendedCount} 项</AccordionTrigger>
              <AccordionContent>{issueList('recommended')}</AccordionContent>
            </AccordionItem>
          </Accordion>}
          {row.issues.items.length === 0 && <div className={'flex items-start gap-2 rounded-control p-3 text-sm leading-6 ' + (row.gate.blocked ? 'bg-hot-soft text-hot' : 'bg-bg-sunk text-ink-3')}>{row.gate.blocked ? <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /> : <FileCheck2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />}<p>{row.gate.blocked ? '当前未提供可勾选的放行项。请查看稿件与原文，处理否决项后再审核。' : '当前未列出可勾选的问题，请继续核对事实与原文。没有提示不代表事实已获批准。'}</p></div>}
          {dirty && <p className="mt-3 text-xs leading-6 text-amber-ink">先保存修改，系统会按新版本重新核对。</p>}
          <Button className="mt-4 w-full" disabled={busy || dirty || row.gate.blocked} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/review', { version: row.version, action: 'confirm', confirmations, note }, { success: '逐项确认已保存，同版本继续审稿时可复用。' })}>保存逐项确认</Button>
          <p className="mt-2 text-[11px] leading-5 text-ink-4">确认绑定当前稿件、原文版本与条件；内容修改后重新核对。</p>
        </Card>

        <Card title="当前动作">
          <Button tone={dirty ? 'primary' : 'secondary'} className="w-full" disabled={busy || !dirty} onClick={() => void run('PATCH', '/api/admin/studio/drafts/' + row.id, { version: row.version, title_zh: d.title_zh, title_en: d.title_en, review_zh: d.review_zh, body_en: d.body_en, keyword_hypothesis: d.keyword_hypothesis, meta_description_en: d.meta_description_en, questions_zh: d.questions_zh, news_status: d.news_status }, { success: '已保存为待编辑稿。' })}><Save aria-hidden="true" />保存修改</Button>
          <p className="my-2 text-xs leading-5 text-ink-3">{dirty ? '有修改尚未保存。保存后将按新版本重新审核。' : '当前版本已保存。'}</p>
          <div className="my-4"><Field label="审稿意见"><Textarea aria-label="审稿意见" value={note} onChange={e => setNote(e.target.value)} placeholder="有需要修改的地方，写在这里" className="min-h-20" /></Field></div>
          <div className="flex flex-wrap gap-2">
            {row.status === 'draft' && <Button tone="primary" className="w-full" disabled={busy || dirty} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/review', { version: row.version, action: 'submit', note }, { success: '已提交审稿。' })}>提交审稿</Button>}
            {row.status === 'in_review' && <Button tone="primary" className="w-full" disabled={busy || dirty || row.gate.blocked || !allConfirmed} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/review', { version: row.version, action: 'approve', note, confirmations }, { success: '审核通过，可以导出。' })}>确认审核通过</Button>}
            {row.status !== 'draft' && <Button className="w-full" disabled={busy || dirty || !note.trim()} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/review', { version: row.version, action: 'return', note }, { success: '已退回修改。' })}>退回修改</Button>}
          </div>
          {row.status === 'in_review' && <p className="mt-3 text-xs leading-6 text-ink-3">{dirty ? '保存修改后再核对并审核。' : row.gate.blocked ? '先处理上方需要修改的问题。' : !allConfirmed ? '还有待确认的问题，全部核对后可审核。' : '确认审核只记录审稿结果，不会自动公开。'}</p>}
          {row.status !== 'draft' && !note.trim() && <p className="mt-2 text-[11px] text-ink-4">退回修改时请填写审稿意见。</p>}
        </Card>

        <WordPressDraft row={row} dirty={dirty} busy={busy} run={run} />

        <Card title="交付成稿">
          {row.status === 'approved' && !dirty ? <div className="flex flex-wrap gap-2">
            {['md', 'html', 'json'].map(format => <a key={format} href={'/api/admin/studio/drafts/' + row.id + '/export?format=' + format} className="rounded-control border border-accent/30 px-3 py-2 text-xs font-medium text-accent">{'英文 ' + format.toUpperCase()}</a>)}
            <a href={'/api/admin/studio/drafts/' + row.id + '/export?format=review'} className="rounded-control border border-line px-3 py-2 text-xs text-ink-3">内部中英审稿包</a>
          </div> : <p className="text-xs leading-6 text-ink-3">人工审核通过后，可下载 Markdown、HTML 和结构化稿件。导出不会自动发布到公司网站。</p>}
        </Card>

        <Card>
          <Accordion type="single" collapsible>
            <AccordionItem value="intervention" className="border-0">
              <AccordionTrigger className="py-1 text-sm"><span className="inline-flex items-center gap-2"><MessageSquareText className="size-4" aria-hidden="true" />记录人工介入</span></AccordionTrigger>
              <AccordionContent className="pb-0 pt-4">
                <p className="mb-4 text-xs leading-6 text-ink-3">没有记录的稿件不会被当作零修改；分母按稿件数计算。</p>
                <label className="flex items-start gap-2.5 text-sm leading-6"><Checkbox checked={substantive} onCheckedChange={value => setSubstantive(value === true)} className="mt-0.5" />本稿需要实质修改才能发布</label>
                <div className="my-4 flex flex-wrap gap-3">{[['fact', '事实'], ['attribution', '归属'], ['conclusion', '结论'], ['title', '标题'], ['format', '格式']].map(([key, name]) => <label key={key} className="flex items-center gap-2 text-xs"><Checkbox checked={categories.includes(key)} onCheckedChange={value => setCategories(v => value === true ? [...v, key] : v.filter(x => x !== key))} />{name}</label>)}</div>
                <Field label="人工耗时（分钟，可留空）"><Input type="number" min="0" max="1440" value={minutes} onChange={e => setMinutes(e.target.value)} /></Field>
                <label className="my-4 flex items-start gap-2.5 text-sm leading-6"><Checkbox checked={fullReview} onCheckedChange={value => setFullReview(value === true)} className="mt-0.5" />本次完成了逐篇全审</label>
                <Button className="w-full" disabled={busy || dirty || !note.trim()} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/intervention', { version: row.version, substantive, categories, minutes: minutes === '' ? null : Number(minutes), full_review: fullReview, missed_block: false, major_fact_error: false, note }, { success: '人工介入记录已保存。' })}>保存审稿观察</Button>
                <Button className="mt-3 w-full" disabled={busy || dirty || !note.trim()} onClick={() => void run('POST', '/api/admin/studio/drafts/' + row.id + '/intervention', { version: row.version, substantive: true, categories: ['fact'], minutes: minutes === '' ? null : Number(minutes), full_review: fullReview, missed_block: true, major_fact_error: true, note }, { success: '已记录重大事实错误，审稿策略退回上一档。' })}>记录重大事实错误并退档</Button>
                <p className="mt-3 text-xs leading-5 text-ink-3">以上使用“审稿意见”作为说明。记录严重错误时写清原文位置。</p>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </Card>
      </aside>
    </div>
  </AdminPage>;
}
