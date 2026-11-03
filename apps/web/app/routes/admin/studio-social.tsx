import { useEffect, useRef, useState } from 'react';
import { Link, useBeforeUnload, useBlocker, useLoaderData, useRevalidator, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { adminGet } from '../../lib/admin.server';
import { useAdminAction } from '../../features/admin/action';
import { AdminPage, Badge, Button, Card, Time } from '../../features/admin/ui';

type Blog = { id: string; title_zh: string; title_en: string; status: string; version: number };
type Confirmation = { issueId: string; fingerprint: string };
type Finding = { field: string; start: number; end: number; quote: string; reason: string };
type Issue = { id: string; fingerprint: string; ruleId: string; severity: 'BLOCK' | 'WARN'; title: string;
  confirmable: boolean; count: number; wordByWord?: boolean; occurrences: Finding[] };
type SocialDocument = { platform: 'facebook' | 'linkedin'; language: 'en' | 'zh'; title: string; body: string; blog_url: string;
  source: { url: string; revision: number; published_at: string | null };
  news_status: 'reported' | 'unconfirmed' | 'confirmed' | 'denied' | 'corrected' };
type Social = { id: string; draft_id: string; parent_version: number; document: SocialDocument; status: 'draft' | 'approved'; version: number;
  confirmations: Confirmation[]; stale: boolean; gate: { blocked: boolean }; issues: { items: Issue[] };
  counts: { wordCount: number; characterCount: number }; updated_at: string; reviewed_at: string | null; reviewed_by: string | null };
type Data = { rows: Social[]; blogs: Blog[] };
const control = 'mt-2 w-full min-w-0 rounded-control border border-line bg-surface p-3 text-sm leading-6';
const platformName = (value: string) => value === 'facebook' ? 'Facebook' : 'LinkedIn';
const languageName = (value: string) => value === 'zh' ? '中文' : '英文';
const parentPath = (id: string) => `/admin/studio/drafts/${encodeURIComponent(id)}`;

function validBlogUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password && !url.port
      && ['chipshow.com', 'chipshowledusa.com', 'chipshow.eu'].includes(url.hostname.replace(/^www\./, ''))
      && !!url.pathname.replaceAll('/', '').trim();
  } catch { return false; }
}

function postPreview(document: SocialDocument) {
  const zh = document.language === 'zh';
  const status = { reported: zh ? '原厂报道' : 'Source report', unconfirmed: zh ? '尚未证实的报道' : 'Unconfirmed report',
    confirmed: zh ? '确认消息' : 'Confirmation', denied: zh ? '否认／更新' : 'Denial / update', corrected: zh ? '更正' : 'Correction' }[document.news_status];
  const footer = zh
    ? `阅读全文：${document.blog_url}\n原厂来源：${document.source.url}\n原日期：${document.source.published_at ?? '未知'}\n消息状态：${status}`
    : `Read the Blog: ${document.blog_url}\nOriginal source: ${document.source.url}\nOriginal source date: ${document.source.published_at ?? 'not provided'}\nNews status: ${status}`;
  return `${document.title}\n\n${document.body}\n\n${footer}`;
}

export async function loader({ request }: LoaderFunctionArgs): Promise<Data> {
  const draftId = new URL(request.url).searchParams.get('draft_id');
  const [social, overview] = await Promise.all([
    adminGet<{ rows: Social[] }>(request, `/api/admin/studio/social${draftId ? `?draft_id=${encodeURIComponent(draftId)}` : ''}`),
    adminGet<{ drafts: Blog[] }>(request, '/api/admin/studio'),
  ]);
  return { rows: social.rows, blogs: overview.drafts };
}

export const meta = () => [{ title: '社媒稿件 · Chipshow Studio' }];

export default function StudioSocial() {
  const data = useLoaderData<typeof loader>();
  const [search, setSearch] = useSearchParams();
  const deriving = search.get('tab') === 'derive';
  const selected = data.rows.find(row => row.id === search.get('post')) ?? data.rows[0];
  const approved = data.blogs.filter(blog => blog.status === 'approved');
  const navigate = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(changes)) value === null ? next.delete(key) : next.set(key, value);
    setSearch(next);
  };
  return <AdminPage title="社媒稿件" subtitle="从已批准的 Blog 派生，单独编辑、审核和导出。中英文各审各的，导出后由运营自行发布。"
    actions={<Link to="/admin/studio?tab=drafts" className="text-sm text-accent">返回 Blog 稿件 →</Link>}>
    <div className="mb-5 flex flex-wrap items-center gap-2">
      <Button tone={deriving ? undefined : 'primary'} onClick={() => navigate({ tab: null })}>社媒稿件 · {data.rows.length}</Button>
      <Button tone={deriving ? 'primary' : undefined} onClick={() => navigate({ tab: 'derive' })}>从已批准 Blog 派生</Button>
    </div>
    {deriving ? <DeriveForm blogs={approved} initialDraft={search.get('draft_id') ?? ''}
      onCreated={row => navigate({ tab: null, post: row.id, draft_id: null })}/>
      : <>
        <Card className="mb-5"><label className="block text-sm font-medium">按父 Blog 查看
          <select className={control} value={search.get('draft_id') ?? ''} onChange={event => navigate({ draft_id: event.target.value || null, post: null })}>
            <option value="">全部社媒稿件</option>
            {data.blogs.map(blog => <option key={blog.id} value={blog.id}>{blog.title_zh || blog.title_en} {blog.status === 'approved' ? '' : '（Blog待审）'}</option>)}
            {search.get('draft_id') && !data.blogs.some(blog => blog.id === search.get('draft_id')) && <option value={search.get('draft_id')!}>当前选定的父 Blog</option>}
          </select>
        </label></Card>
        {!data.rows.length ? <Card title="暂无社媒稿件"><p className="text-sm leading-7 text-ink-3">选择一篇已批准的 Blog，再指定平台、语言和实际发布链接，生成待审社媒稿。</p>
          <Button className="mt-4" onClick={() => navigate({ tab: 'derive' })}>选择 Blog 并派生</Button>
        </Card> : <div className="grid min-w-0 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Card title="选择社媒稿件" className="min-w-0 self-start"><ul className="max-h-64 space-y-2 overflow-y-auto lg:max-h-[70vh]">
            {data.rows.map(row => <li key={row.id}><button type="button" aria-pressed={selected?.id === row.id}
              onClick={() => navigate({ post: row.id })}
              className={`w-full rounded-control border p-3 text-left focus-visible:outline-2 focus-visible:outline-accent ${selected?.id === row.id ? 'border-accent bg-accent-soft' : 'border-line'}`}>
              <span className="block break-words text-sm font-medium">{row.document.title}</span>
              <span className="mt-2 block text-xs text-ink-3">{platformName(row.document.platform)} · {languageName(row.document.language)}</span>
              <span className="mt-2 flex flex-wrap gap-2"><Badge tone={row.stale ? 'warn' : row.status === 'approved' ? 'ok' : 'muted'}>
                {row.stale ? '版本已过期' : row.status === 'approved' ? '审核通过' : '待编辑／审核'}</Badge></span>
            </button></li>)}
          </ul></Card>
          {selected && <SocialEditor key={selected.id} row={selected} parent={data.blogs.find(blog => blog.id === selected.draft_id)}
            onDerive={() => navigate({ tab: 'derive', draft_id: selected.draft_id })}/>}
        </div>}
      </>}
  </AdminPage>;
}

function DeriveForm({ blogs, initialDraft, onCreated }: { blogs: Blog[]; initialDraft: string; onCreated: (row: Social) => void }) {
  const [draftId, setDraftId] = useState(blogs.some(blog => blog.id === initialDraft) ? initialDraft : '');
  const [platform, setPlatform] = useState<SocialDocument['platform']>('facebook');
  const [language, setLanguage] = useState<SocialDocument['language']>('en');
  const [blogUrl, setBlogUrl] = useState('');
  const { run, busy } = useAdminAction();
  const available = blogs.some(blog => blog.id === draftId);
  return <Card title="从已批准 Blog 派生社媒稿" className="max-w-4xl">
    <p className="mb-4 text-sm leading-7 text-ink-3">取原稿的完整段落作为初稿，不调用模型。选择语言后分别编辑审核；不会自动发布。</p>
    {!blogs.length ? <p className="rounded-control bg-bg-sunk p-4 text-sm leading-7">最近稿件中没有已批准的 Blog。先在 <Link to="/admin/studio?tab=drafts" className="text-accent">Blog 稿件页</Link>完成审稿，再回到这里。</p>
      : <form onSubmit={async event => {
        event.preventDefault();
        if (busy || !available || !validBlogUrl(blogUrl)) return;
        const result = await run<Social>('POST', '/api/admin/studio/social/derive', { draft_id: draftId, platform, language, blog_url: blogUrl.trim() },
          { label: '派生社媒初稿', success: '社媒初稿已保存，请单独编辑并审核。' });
        if (result) onCreated(result);
      }} className="space-y-5">
        <label className="block text-sm font-medium">已批准的 Blog<select required disabled={busy} value={draftId} onChange={event => { setDraftId(event.target.value); setBlogUrl(''); }} className={control}>
          <option value="">请选择 Blog（最近100条稿件中的已批准项）</option>
          {blogs.map(blog => <option key={blog.id} value={blog.id}>{blog.title_zh || blog.title_en}</option>)}
        </select></label>
        {available && <Link to={parentPath(draftId)} className="inline-block text-sm text-accent">查看父 Blog 与原文证据 →</Link>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">平台<select value={platform} disabled={busy} onChange={event => setPlatform(event.target.value === 'facebook' ? 'facebook' : 'linkedin')} className={control}>
            <option value="facebook">Facebook</option><option value="linkedin">LinkedIn</option>
          </select></label>
          <label className="block text-sm font-medium">帖文语言<select value={language} disabled={busy} onChange={event => setLanguage(event.target.value === 'zh' ? 'zh' : 'en')} className={control}>
            <option value="en">英文</option><option value="zh">中文（单独审核与导出）</option>
          </select></label>
        </div>
        <label className="block text-sm font-medium">实际已发布的 Blog 链接<input type="url" inputMode="url" autoComplete="off" required value={blogUrl} disabled={busy}
          onChange={event => setBlogUrl(event.target.value)} placeholder="粘贴已发布的完整 Blog 地址" aria-describedby="social-blog-url-help" className={control}/></label>
        <p id="social-blog-url-help" className="text-xs leading-6 text-ink-3">请填写该 Blog 所在 Chipshow 站点的 HTTPS 文章地址，不能只填网站首页。系统不会替你编造路径；稿件审核通过不代表已经发布。</p>
        {blogUrl && !validBlogUrl(blogUrl) && <p role="alert" className="text-sm text-hot">请填写 chipshow.com、chipshowledusa.com 或 chipshow.eu 的非首页 HTTPS 链接。</p>}
        <Button type="submit" tone="primary" disabled={busy || !available || !validBlogUrl(blogUrl)}>{busy ? '正在保存初稿…' : '派生待审社媒稿'}</Button>
      </form>}
  </Card>;
}

function SocialEditor({ row, parent, onDerive }: { row: Social; parent?: Blog; onDerive: () => void }) {
  const [saved, setSaved] = useState(row);
  const [document, setDocument] = useState(row.document);
  const [checked, setChecked] = useState<Confirmation[]>(row.confirmations ?? []);
  const [note, setNote] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null), bodyRef = useRef<HTMLTextAreaElement>(null);
  const { run, busy } = useAdminAction();
  const revalidator = useRevalidator();
  const dirty = document.title !== saved.document.title || document.body !== saved.document.body || document.blog_url !== saved.document.blog_url;
  const changedRemotely = row.version !== saved.version;
  const stale = row.stale || saved.stale;
  const issues = row.version === saved.version ? row.issues.items : saved.issues.items;
  const blocked = issues.some(issue => issue.severity === 'BLOCK') || (row.version === saved.version ? row.gate.blocked : saved.gate.blocked);
  const isChecked = (issue: Issue) => checked.some(item => item.issueId === issue.id && item.fingerprint === issue.fingerprint);
  const confirmations = issues.filter(issue => issue.confirmable && issue.severity === 'WARN' && isChecked(issue)).map(issue => ({ issueId: issue.id, fingerprint: issue.fingerprint }));
  const missing = issues.filter(issue => issue.severity === 'WARN' && !isChecked(issue)).length;
  const locked = busy || dirty || stale || changedRemotely;
  const canApprove = !locked && !blocked && missing === 0;
  const canExport = saved.status === 'approved' && canApprove;
  const apply = (next: Social) => { setSaved(next); setDocument(next.document); setChecked(next.confirmations ?? []); };
  // Preserve unsaved edits when another operator or loader supplies a newer version.
  useEffect(() => { if (!dirty) apply(row); }, [row]);
  useBeforeUnload(event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty
    && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search));
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('这条社媒稿还有未保存的修改，确认离开？')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  const change = (field: 'title' | 'body' | 'blog_url', value: string) => setDocument(current => ({ ...current, [field]: value }));
  const act = async (action: 'save' | 'approve' | 'return') => {
    if (busy || changedRemotely || (action !== 'return' && stale)) return;
    const path = `/api/admin/studio/social/${encodeURIComponent(saved.id)}`;
    const result = action === 'save'
      ? await run<Social>('PATCH', path, { version: saved.version, title: document.title, body: document.body, blog_url: document.blog_url.trim() },
        { success: '修改已保存，原批准与确认已清除，请按新版本审核。' })
      : await run<Social>('POST', `${path}/review`, { version: saved.version, action, note, confirmations: action === 'approve' ? confirmations : [] },
        { success: action === 'approve' ? '这条社媒稿已独立审核通过，可以导出。' : '已退回修改。' });
    if (result) { apply(result); setNote(''); }
    else void revalidator.revalidate();
  };
  const locate = (finding: Finding) => {
    const element = finding.field === 'title' ? titleRef.current : finding.field === 'body' ? bodyRef.current : null;
    if (!element) return;
    element.focus(); element.setSelectionRange(finding.start, finding.end); element.scrollIntoView({ block: 'center' });
  };
  const preview = postPreview(document);
  const characters = dirty ? [...preview].length : saved.counts.characterCount;
  const words = dirty ? [...new Intl.Segmenter(document.language, { granularity: 'word' }).segment(preview)].filter(word => word.isWordLike).length : saved.counts.wordCount;
  return <div className="min-w-0 space-y-5">
    <Card title={`${platformName(document.platform)} · ${languageName(document.language)}`} right={<Badge tone={stale ? 'warn' : saved.status === 'approved' ? 'ok' : 'muted'}>
      {stale ? '版本已过期' : saved.status === 'approved' ? '审核通过' : '待编辑／审核'}</Badge>}>
      <Link to={parentPath(saved.draft_id)} className="break-words text-sm text-accent">父 Blog：{parent?.title_zh || parent?.title_en || '查看稿件与证据'} →</Link>
      <p className="mt-2 text-xs leading-6 text-ink-4">社媒版本 {saved.version} · 绑定 Blog 版本 {saved.parent_version} · 更新于 <Time at={saved.updated_at}/></p>
      {stale && <div role="alert" className="mt-4 rounded-control border border-amber/30 bg-amber/10 p-3 text-sm leading-7 text-ink">
        父 Blog 或原文已经变化，这条旧社媒稿不能继续批准或导出。请先完成父 Blog 审核，再派生新稿。
        <Button className="mt-3" disabled={busy} onClick={onDerive}>从父 Blog 重新派生</Button>
      </div>}
      {changedRemotely && <div role="alert" className="mt-4 rounded-control border border-amber/30 p-3 text-sm leading-7">服务器上已有更新版本。当前编辑内容保留，请先复制需要保留的文字，再加载最新版本。
        <Button className="mt-2" disabled={busy} onClick={() => apply(row)}>加载最新版本</Button></div>}
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm"><span>{characters.toLocaleString()} 字符</span><span>{words.toLocaleString()} 词</span>
        <span className="text-xs text-ink-4">{dirty ? '当前编辑预览' : '已保存版本'}，含标题、固定链接、原日期和消息状态</span></div>
    </Card>
    <Card title="编辑这条社媒稿">
      <div className="space-y-4">
        <label className="block text-sm font-medium">帖文标题<input ref={titleRef} value={document.title} onChange={event => change('title', event.target.value)}
          disabled={busy || stale} maxLength={500} className={control}/></label>
        <label className="block text-sm font-medium">帖文正文<textarea ref={bodyRef} value={document.body} onChange={event => change('body', event.target.value)}
          disabled={busy || stale} maxLength={15000} rows={10} className={`${control} min-h-56`}/></label>
        <label className="block text-sm font-medium">实际已发布的 Blog 链接<input type="url" inputMode="url" value={document.blog_url} onChange={event => change('blog_url', event.target.value)}
          disabled={busy || stale} className={control}/></label>
        {!validBlogUrl(document.blog_url) && <p role="alert" className="text-sm text-hot">请保留实际发布的 Chipshow Blog 文章链接，不能留空或使用首页。</p>}
        <p className="text-xs leading-6 text-ink-3">{document.language === 'en' ? '英文帖文的标题和正文不能包含中文。' : '中文帖文在这里单独审核，不能混入英文 Blog。'} 保存修改后会撤销这条社媒稿原有的批准与风险确认。</p>
        <div className="flex flex-wrap items-center gap-3"><Button tone="primary" disabled={busy || !dirty || stale || changedRemotely || !document.title.trim() || !document.body.trim() || !validBlogUrl(document.blog_url)}
          onClick={() => void act('save')}>保存修改</Button><span role="status" className="text-xs text-ink-3">{dirty ? '有修改尚未保存；先保存再核对提示。' : '当前编辑内容已保存。'}</span></div>
      </div>
    </Card>
    <Card title={`逐项核对 · ${issues.length} 项`} right={<span>{blocked ? '有内容须修改' : `待确认 ${missing} 项`}</span>}>
      <p className="text-xs leading-6 text-ink-3">这里只核对这条帖文。红色问题必须修改；黄色提示需看过对应位置后逐项确认。编辑后先保存，系统会重新列出当前版本的提示。</p>
      <ul className="mt-4 space-y-3">{issues.map(issue => <li key={`${issue.id}:${issue.fingerprint}`} className="rounded-control border border-line p-3">
        <div className="flex items-start gap-3">
          {issue.severity === 'WARN' && issue.confirmable && <input type="checkbox" className="mt-1 size-5 shrink-0 accent-accent"
            aria-label={`确认：${issue.title}`} disabled={locked} checked={isChecked(issue)} onChange={event => setChecked(current => event.target.checked
              ? [...current.filter(item => item.issueId !== issue.id), { issueId: issue.id, fingerprint: issue.fingerprint }]
              : current.filter(item => item.issueId !== issue.id))}/>}
          <div className="min-w-0 flex-1"><Badge tone={issue.severity === 'BLOCK' ? 'bad' : 'warn'}>{issue.severity === 'BLOCK' ? '须修改' : '待核对'} · {issue.ruleId}</Badge>
            <p className="mt-2 break-words text-sm font-medium">{issue.title}</p>
            <p className="mt-1 text-xs leading-6 text-ink-4">{issue.count} 处位置{issue.wordByWord ? ' · 请逐字核对' : ''}{issue.severity === 'BLOCK' ? ' · 不能勾选放行' : ''}</p>
            <ul className="mt-2 space-y-3">{issue.occurrences.map((finding, index) => <li key={`${finding.field}:${finding.start}:${index}`}>
              <p className="whitespace-pre-wrap break-words border-l-2 border-line pl-3 text-sm leading-6">{finding.quote}</p>
              <p className="mt-1 break-words text-xs leading-6 text-ink-3">{finding.reason}</p>
              <Button className="mt-1" disabled={busy || dirty || stale || changedRemotely} onClick={() => locate(finding)}>{finding.field === 'title' ? '定位标题' : '定位正文'} · 第 {index + 1} 处</Button>
            </li>)}</ul>
          </div>
        </div>
      </li>)}</ul>
      {!issues.length && <p className="mt-4 text-sm leading-7 text-ink-3">当前没有程序提示。仍需人工核对事实、归属、使用条件和原文。</p>}
      <label className="mt-5 block text-sm font-medium">审稿意见／退回原因<textarea value={note} maxLength={3000} onChange={event => setNote(event.target.value)} disabled={busy}
        placeholder="退回修改时请填写具体原因" rows={3} className={control}/></label>
      <div className="mt-4 flex flex-wrap gap-3"><Button tone="primary" disabled={!canApprove || saved.status === 'approved'} onClick={() => void act('approve')}>独立审核通过</Button>
        <Button disabled={busy || dirty || changedRemotely || !note.trim()} onClick={() => void act('return')}>退回修改</Button>
        <Button disabled={busy} onClick={() => void revalidator.revalidate()}>刷新当前审核结果</Button></div>
      {saved.reviewed_at && <p className="mt-3 text-xs text-ink-4">审核人：{saved.reviewed_by} · <Time at={saved.reviewed_at}/></p>}
    </Card>
    <Card title="独立导出社媒帖文">
      <p className="text-sm leading-7 text-ink-3">导出始终附带 Blog 回链、原厂来源和原日期。下载文件后由运营自行发布，不会自动发送到 Facebook 或 LinkedIn。</p>
      <div className="my-3 break-words text-xs leading-7 text-ink-3"><p>Blog 回链：<a href={saved.document.blog_url} target="_blank" rel="noreferrer" className="break-all text-accent">{saved.document.blog_url}</a></p>
        <p>原厂来源：<a href={document.source.url} target="_blank" rel="noreferrer" className="break-all text-accent">{document.source.url}</a></p>
        <p>原日期：{document.source.published_at ?? '未知，将如实导出'} · 原文版本 {document.source.revision}</p></div>
      {canExport ? <div className="flex flex-wrap gap-3">{['md', 'json'].map(format => <a key={format}
        href={`/api/admin/studio/social/${encodeURIComponent(saved.id)}/export?format=${format}`}
        className="rounded-control border border-accent/30 px-4 py-3 text-sm text-accent focus-visible:outline-2 focus-visible:outline-accent">
        下载{languageName(document.language)} {format.toUpperCase()}</a>)}</div>
        : <p className="text-sm leading-7 text-ink-3">{stale ? '版本过期，请从父 Blog 重新派生。' : dirty ? '先保存修改，再重新审核。' : blocked ? '先修改红色问题，再完成审核。' : missing ? `还有 ${missing} 项提示未确认。` : '独立审核通过后，开放 MD 和 JSON 下载。'}</p>}
      <button type="button" aria-expanded={previewOpen} onClick={() => setPreviewOpen(value => !value)} className="mt-5 text-sm text-accent">{previewOpen ? '收起' : '展开'}完整帖文预览{dirty ? '（未保存）' : ''}</button>
      {previewOpen && <pre className="mt-3 whitespace-pre-wrap break-words rounded-control bg-bg-sunk p-4 font-sans text-sm leading-7">{preview}</pre>}
    </Card>
  </div>;
}
