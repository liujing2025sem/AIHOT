import { Link } from 'react-router';
import { BookOpenText, Files, Rss, Layers3, ArrowUpRight, ChevronDown } from 'lucide-react';
import type { Route } from './+types/workbench';
import { adminGet } from '../../lib/admin.server';
import { AdminPage, Badge, ButtonLink, Time } from '../../features/admin/ui';

type Draft = { id: string; title_zh: string; title_en: string; status: string; version: number; updated_at: string };
type Pitch = { id: string; title: string; status: string; version: number; task_id: string | null };
type Overview = {
  drafts: Draft[];
  tasks: { id: string; state: string; articles: { title: string }[]; drafts: number }[];
  generation: { ready: boolean; reason: string };
  stats: Record<string, number>;
};
const draftLabels: Record<string, string> = { draft: '待编辑', in_review: '待审稿', approved: '正文已通过' };
const draftNextSteps: Record<string, string> = { draft: '完善正文', in_review: '核对正文与依据', approved: '核对成品与交付文件' };
const pitchLabels: Record<string, string> = { unprepared: '待查资料', preparing: '查找资料中', ready: '待确认', insufficient: '待补依据', failed: '资料准备未完成', confirmed: '方向已确认' };

export async function loader({ request }: Route.LoaderArgs) {
  const [overview, pitches] = await Promise.all([
    adminGet<Overview>(request, '/api/admin/studio?tab=drafts'),
    adminGet<{ rows: Pitch[] }>(request, '/api/admin/studio/pitches'),
  ]);
  return { ...overview, pitches: pitches.rows };
}
export const meta = () => [{ title: '工作台 · AIHOT' }];

export default function Workbench({ loaderData: data }: Route.ComponentProps) {
  const drafts = [...data.drafts].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  const resume = drafts.find(draft => draft.status !== 'approved') ?? drafts[0];
  const savedPitch = data.pitches[0];
  const activeTasks = data.tasks.filter(task => ['waiting', 'queued', 'generating', 'running', 'unknown'].includes(task.state));
  const approved = resume?.status === 'approved';
  const next = resume
    ? { title: approved ? '准备交付' : '核对内容', hint: approved ? '检查配图和交付文件。' : '核对待确认原句，需要修改时采纳建议或编辑正文。', button: approved ? '检查交付文件' : '继续审稿', to: `/admin/studio/drafts/${encodeURIComponent(resume.id)}${approved ? '?stage=delivery' : ''}` }
    : savedPitch
      ? { title: '继续已保存的选题', hint: '打开原选题，查看已备好的资料和处理进度。', button: '继续选题', to: `/admin/studio/pitch?id=${encodeURIComponent(savedPitch.id)}` }
      : { title: '写下买家问题', hint: '写下问题，确认方向后生成英文稿。', button: '写下买家问题', to: '/admin/studio/pitch' };
  return <AdminPage title="工作台">
    {activeTasks.length > 0 && <p className="mb-4 text-sm"><Link to="/admin/studio?tab=tasks" className="inline-flex min-h-12 items-center gap-2 rounded-control font-medium text-accent focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">查看 {activeTasks.length} 项未完成任务<ArrowUpRight className="size-4" aria-hidden="true" /></Link></p>}
    <section className="workbench-resume" aria-labelledby="resume-title">
      <div className="workbench-resume-document">
        <p className="workbench-resume-state">{resume ? <><Badge tone={approved ? 'ok' : 'warn'}>{draftLabels[resume.status] || resume.status}</Badge><span>版本 {resume.version}</span><Time at={resume.updated_at} /></> : savedPitch ? <Badge tone="muted">{pitchLabels[savedPitch.status] || savedPitch.status}</Badge> : '从一个具体问题开始'}</p>
        <h2 id="resume-title" lang={resume && !resume.title_zh && resume.title_en ? 'en' : undefined}>{resume ? resume.title_zh || resume.title_en || '未命名稿件' : savedPitch?.title || '下一篇，帮买家做什么决定？'}</h2>
        {resume?.title_zh && resume.title_en && <p className="workbench-english-title" lang="en">{resume.title_en}</p>}
      </div>
      <div className="workbench-resume-next">
        <h3 id="resume-next-title">{next.title}</h3>
        <p className="workbench-resume-hint">{next.hint}</p>
        <ButtonLink tone="primary" to={next.to}>{next.button}</ButtonLink>
      </div>
    </section>

    <div className="workbench-worklists">
      <section aria-labelledby="recent-drafts-title">
        <header><h2 id="recent-drafts-title">最近的稿件</h2><Link to="/admin/studio?tab=drafts">全部稿件</Link></header>
        {drafts.length ? <ul className="workbench-document-list" role="list">{drafts.slice(0, 6).map(draft => <li key={draft.id}><Link to={`/admin/studio/drafts/${draft.id}${draft.status === 'approved' ? '?stage=delivery' : ''}`}><Files aria-hidden="true" /><span><strong>{draft.title_zh || draft.title_en}</strong><span>版本 {draft.version}<Time at={draft.updated_at} /></span><span className="workbench-document-next">下一步：{draftNextSteps[draft.status] || '查看稿件状态'}</span></span><Badge tone={draft.status === 'approved' ? 'ok' : 'muted'}>{draftLabels[draft.status] || draft.status}</Badge></Link></li>)}</ul> : <p className="workbench-empty">还没有稿件。写下买家问题，或从新闻材料开始。</p>}
      </section>
      <section aria-labelledby="recent-pitches-title">
        <header><h2 id="recent-pitches-title">已保存的选题</h2><Link to="/admin/studio/pitch">全部选题</Link></header>
        {data.pitches.length ? <ul className="workbench-document-list" role="list">{data.pitches.slice(0, 6).map(pitch => <li key={pitch.id}><Link to={`/admin/studio/pitch?id=${encodeURIComponent(pitch.id)}`}><BookOpenText aria-hidden="true" /><span><strong>{pitch.title}</strong><span>{pitchLabels[pitch.status] || pitch.status}</span></span><ArrowUpRight aria-hidden="true" /></Link></li>)}</ul> : <p className="workbench-empty">保存的选题会显示在这里。</p>}
      </section>
    </div>

    <details className="workbench-tools">
      <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-control px-1 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent">更多工具<ChevronDown className="size-4" aria-hidden="true" /></summary>
      <div className="workbench-tool-grid mt-4">
        <Link to="/admin/studio?tab=materials"><Rss aria-hidden="true" /><span><strong>新闻材料</strong><span>选用原文、批量成稿或合成短讯</span></span></Link>
        <Link to="/admin/studio/planning"><BookOpenText aria-hidden="true" /><span><strong>选题与旧页升级</strong><span>需求线索、买家问题与已有页面机会</span></span></Link>
        <Link to="/admin/studio?tab=tasks"><Layers3 aria-hidden="true" /><span><strong>处理进度</strong><span>{activeTasks.length ? `${activeTasks.length} 项任务可查看进度` : '查进度、取回结果、继续任务'}</span></span></Link>
        <Link to="/admin/studio/social"><Files aria-hidden="true" /><span><strong>改写社媒稿</strong><span>使用已有文章准备社媒内容</span></span></Link>
      </div>
      <div className="workbench-secondary-links"><Link to="/admin/studio?tab=sources">信源与采集</Link><Link to="/admin/studio?tab=review">审稿设置</Link><Link to="/admin/content">内容诊断</Link><Link to="/admin/studio/published">发布记录</Link><Link to="/admin/channels">模型连接</Link><Link to="/admin/runs">运行记录</Link></div>
    </details>
    {!data.generation.ready && <p role="status" className="workbench-service-note">生成暂未就绪：{data.generation.reason || '请检查模型连接。'} <Link to="/admin/channels">查看连接</Link></p>}
  </AdminPage>;
}
