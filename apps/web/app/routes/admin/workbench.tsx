import { Link } from 'react-router';
import { BookOpenText, Files, Rss, Layers3, ArrowUpRight } from 'lucide-react';
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
const draftLabels: Record<string, string> = { draft: '待编辑', in_review: '待审稿', approved: '可交付' };
const pitchLabels: Record<string, string> = { unprepared: '未备料', preparing: '备料中', ready: '待确认', insufficient: '待补依据', failed: '备料未完成', confirmed: '方向已确认' };

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
  const activeTasks = data.tasks.filter(task => ['queued', 'generating', 'running', 'unknown'].includes(task.state));
  return <AdminPage title="今天，从这篇继续" subtitle="把买家问题变成有依据、可交付的英文内容。" actions={<ButtonLink to="/admin/studio/pitch">新建命题</ButtonLink>}>
    <section className="workbench-resume" aria-labelledby="resume-title">
      <div>
        <p className="workbench-resume-state">{resume ? <><Badge tone={resume.status === 'approved' ? 'ok' : 'warn'}>{draftLabels[resume.status] || resume.status}</Badge><span>版本 {resume.version}</span><Time at={resume.updated_at} /></> : '从一个具体问题开始'} </p>
        <h2 id="resume-title">{resume?.title_zh || '下一篇，帮买家做什么决定？'}</h2>
        {resume?.title_en && <p className="workbench-english-title" lang="en">{resume.title_en}</p>}
        <p className="workbench-resume-hint">{resume ? resume.status === 'approved' ? '当前稿件已通过人工审核。核对配图和交付文件后，由运营手工上传。' : '接续已有稿件，先看要回答的问题、待确认原句和对应依据。' : '输入题目后，沿用原采编流程找材料、选范围和标题，再生成英文稿。'}</p>
        <ButtonLink tone="primary" to={resume ? `/admin/studio/drafts/${resume.id}${resume.status === 'approved' ? '?stage=delivery' : ''}` : '/admin/studio/pitch'}>{resume ? resume.status === 'approved' ? '检查交付文件' : '继续审稿' : '写下买家问题'}</ButtonLink>
      </div>
      <aside className="workbench-resume-aside">
        <h3>这篇怎么完成</h3>
        <ol><li><strong>定方向</strong><span>选题、材料、事实与回答范围</span></li><li><strong>审正文</strong><span>中文理解，原文核对，英文交付</span></li><li><strong>配封面</strong><span>检查图片、说明和替代文字</span></li><li><strong>手工交付</strong><span>下载已批准版本，运营上传</span></li></ol>
      </aside>
    </section>

    <div className="workbench-worklists">
      <section aria-labelledby="recent-drafts-title">
        <header><h2 id="recent-drafts-title">最近的稿件</h2><Link to="/admin/studio?tab=drafts">全部稿件</Link></header>
        {drafts.length ? <ul className="workbench-document-list">{drafts.slice(0, 6).map(draft => <li key={draft.id}><Link to={`/admin/studio/drafts/${draft.id}`}><Files aria-hidden="true" /><span><strong>{draft.title_zh || draft.title_en}</strong><span>版本 {draft.version}<Time at={draft.updated_at} /></span></span><Badge tone={draft.status === 'approved' ? 'ok' : 'muted'}>{draftLabels[draft.status] || draft.status}</Badge></Link></li>)}</ul> : <p className="workbench-empty">还没有稿件。新建命题，或从今日选稿选择已有材料。</p>}
      </section>
      <section aria-labelledby="recent-pitches-title">
        <header><h2 id="recent-pitches-title">待接续的命题</h2><Link to="/admin/studio/pitch">全部命题</Link></header>
        {data.pitches.length ? <ul className="workbench-document-list">{data.pitches.slice(0, 6).map(pitch => <li key={pitch.id}><Link to={`/admin/studio/pitch?id=${encodeURIComponent(pitch.id)}`}><BookOpenText aria-hidden="true" /><span><strong>{pitch.title}</strong><span>{pitchLabels[pitch.status] || pitch.status}</span></span><ArrowUpRight aria-hidden="true" /></Link></li>)}</ul> : <p className="workbench-empty">命题会保存在这里。材料、选中的标题和回答范围会随原任务一起保留。</p>}
      </section>
    </div>

    <section className="workbench-tools" aria-labelledby="workbench-tools-title">
      <header><h2 id="workbench-tools-title">采编工具</h2><p>原有工作都在同一个工作台继续。</p></header>
      <div className="workbench-tool-grid">
        <Link to="/admin/studio?tab=materials"><Rss aria-hidden="true" /><span><strong>今日选稿</strong><span>采集材料、补齐原文、批量备稿与短讯</span></span></Link>
        <Link to="/admin/studio/planning"><BookOpenText aria-hidden="true" /><span><strong>选题与旧页升级</strong><span>需求线索、买家问题与已有页面机会</span></span></Link>
        <Link to="/admin/studio?tab=tasks"><Layers3 aria-hidden="true" /><span><strong>采编任务</strong><span>{activeTasks.length ? `${activeTasks.length} 项任务可查看进度` : '查进度、取回结果、接续已有任务'}</span></span></Link>
        <Link to="/admin/studio/social"><Files aria-hidden="true" /><span><strong>社媒派生</strong><span>从已有内容继续社媒稿件</span></span></Link>
      </div>
      <div className="workbench-secondary-links"><Link to="/admin/studio?tab=sources">信源与采集</Link><Link to="/admin/studio?tab=review">审稿策略与观察</Link><Link to="/admin/content">内容诊断</Link><Link to="/admin/studio/published">发布历史</Link><Link to="/admin/channels">模型连接</Link><Link to="/admin/runs">运行记录</Link></div>
      {!data.generation.ready && <p className="workbench-service-note">生成暂未就绪：{data.generation.reason || '请检查模型连接。'} <Link to="/admin/channels">查看连接</Link></p>}
    </section>
  </AdminPage>;
}
