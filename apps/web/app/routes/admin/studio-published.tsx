import { useState } from 'react';
import { Link } from 'react-router';
import type { Route } from './+types/studio-published';
import { adminGet } from '../../lib/admin.server';
import { useAdminAction } from '../../features/admin/action';
import { AdminPage, Badge, Button, Card, Time } from '../../features/admin/ui';

type Review = { id: string; title: string; content: string; kind: string; status: string; postId?: number; url?: string; editUrl?: string; created_at: string; issues: { code: string; message: string }[]; canRollback: boolean; reviewed?: boolean; figures?: {mediaId:number;alt_en:string;caption_en:string;score:{total:number;data:number;render:number;text:number;file:number}|null}[] };
type Reviews = { rows: Review[]; weekly: { reasons: { reason: string; count: number }[] } };
export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<Reviews>(request, '/api/admin/studio/publishing/reviews');
}
const reasons = [['', '不选原因'], ['number', '数字错'], ['attribution', '归属错'], ['outdated', '过时'], ['tone', '语气'], ['other', '其他']];
const stateLabels: Record<string, string> = { published: '已上线', publish: '已上线', private: '私密验收', draft: '已转草稿', unpublished: '已下线', queued: '处理中', pending: '处理中', unknown: '正在核对结果', failed: '未上线', rolled_back: '已回滚', skipped: '已跳过' };
function PublishedItem({ row }: { row: Review }) {
  const { run, busy } = useAdminAction();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [title, setTitle] = useState(row.title);
  const [original, setOriginal] = useState('');
  const [replacement, setReplacement] = useState('');
  const [editError, setEditError] = useState('');
  const action = async (name: string) => {
    let content = row.content;
    if (name === 'correct' && original) {
      const document = new DOMParser().parseFromString(row.content, 'text/html');
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null, replaced = false;
      while ((node = walker.nextNode())) { if (node.textContent?.includes(original)) { node.textContent = node.textContent.replace(original, replacement); replaced = true; break; } }
      if (!replaced) { setEditError('没有找到这句原文。请从文章中复制一段连续文字。'); return; }
      content = document.body.innerHTML;
    }
    setEditError('');
    const result = await run('POST', `/api/admin/studio/publishing/reviews/${row.id}/action`, { action: name, ...(reason ? { reason } : {}), ...(name === 'correct' ? { title, content } : {}) }, { success: name === 'unpublish' ? '已下线，文章留在 WordPress 草稿箱。' : name === 'rollback' ? '已恢复到本次改写前的版本。' : name === 'correct' ? '修改已保存并读回。' : '已记录：没问题。' });
    if (result) setEditing(false);
  };
  return <Card>
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><h2 className="break-words text-lg font-semibold">{row.title}</h2><p className="mt-1 text-xs text-ink-3"><Time at={row.created_at} /> · {({ brief: '短讯', article: '短文章', guide: '长文', update: '升级页' } as Record<string, string>)[row.kind] || row.kind}</p></div><Badge tone={row.reviewed ? 'ok' : row.status === 'failed' ? 'warn' : 'muted'}>{row.reviewed ? '已抽查' : stateLabels[row.status] || '待核对'}</Badge></div>
    {!!row.issues?.length && <details className="mt-3 text-sm"><summary className="cursor-pointer text-accent">处理记录 · {row.issues.length} 项</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-ink-3">{row.issues.map((issue, i) => <li key={i}>{issue.message}</li>)}</ul></details>}
    {!!row.figures?.length && <details className="mt-3 text-sm"><summary className="cursor-pointer text-accent">配图与质检分 · {row.figures.length} 张</summary>{row.figures.map(f=><div key={f.mediaId} className="mt-3 border-l-2 border-line pl-3"><p>{f.alt_en}</p><p className="mt-1 text-xs leading-5 text-ink-3">{f.caption_en}</p>{f.score&&<p className="mt-2 text-xs">总分 {f.score.total} · 数据 {f.score.data}/30 · 排版 {f.score.render}/25 · 文案 {f.score.text}/25 · 文件 {f.score.file}/20</p>}</div>)}</details>}
    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">{row.url && <a href={row.url} target="_blank" rel="noreferrer" className="text-accent">查看文章 ↗</a>}{row.editUrl && <a href={row.editUrl} target="_blank" rel="noreferrer" className="text-accent">WordPress ↗</a>}<select aria-label={`纠错原因：${row.title}`} value={reason} onChange={e => setReason(e.target.value)} className="rounded-control border border-line bg-surface p-2">{reasons.map(([value, name]) => <option value={value} key={value}>{name}</option>)}</select></div>
    <div className="mt-3 flex flex-wrap gap-2"><Button disabled={busy} onClick={() => void action('ok')}>没问题</Button><Button disabled={busy || !row.postId} onClick={() => setEditing(v => !v)}>改一处</Button><Button tone="danger" disabled={busy || !row.postId} onClick={() => void action('unpublish')}>下线</Button>{row.canRollback && <Button disabled={busy} onClick={() => void action('rollback')}>回滚到上一版</Button>}</div>
    {editing && <div className="mt-4 space-y-3 border-t border-line pt-4"><label className="block text-sm">英文标题<input value={title} onChange={e => setTitle(e.target.value)} className="mt-1 w-full rounded-control border border-line bg-surface p-2" /></label><label className="block text-sm">要改的原句（只改标题时留空）<textarea value={original} onChange={e => setOriginal(e.target.value)} className="mt-1 min-h-20 w-full rounded-control border border-line bg-surface p-3 text-sm leading-6" /></label><label className="block text-sm">改成<textarea value={replacement} onChange={e => setReplacement(e.target.value)} className="mt-1 min-h-20 w-full rounded-control border border-line bg-surface p-3 text-sm leading-6" /></label>{editError && <p role="alert" className="text-sm text-hot">{editError}</p>}<div className="flex gap-2"><Button tone="primary" disabled={busy} onClick={() => void action('correct')}>保存这一处修改</Button><Button disabled={busy} onClick={() => setEditing(false)}>取消</Button></div></div>}
  </Card>;
}
export default function Published({ loaderData: data }: Route.ComponentProps) {
  const [tab, setTab] = useState<'pending' | 'all' | 'weekly'>('pending');
  const rows = data.rows.filter(row => tab !== 'pending' || !row.reviewed);
  return <AdminPage title="上线后抽查" subtitle="看一眼内容。有问题就改一处或下线；升级页可恢复上一版。" actions={<Link to="/admin/studio" className="text-sm text-accent">返回采编工作台 →</Link>}>
    <div role="tablist" aria-label="抽查内容" className="mb-5 flex gap-2">{([['pending', '待抽查'], ['all', '全部'], ['weekly', '本周纠错']] as const).map(([value, name]) => <button role="tab" aria-selected={tab === value} key={value} className={`rounded-full px-4 py-2 text-sm ${tab === value ? 'bg-accent text-white' : 'bg-surface text-ink-3 ring-1 ring-line'}`} onClick={() => setTab(value)}>{name}</button>)}</div>
    {tab === 'weekly' ? <Card title="本周纠错原因">{data.weekly.reasons.length ? <ul className="space-y-3 text-sm">{data.weekly.reasons.map(r => <li key={r.reason}>{reasons.find(([key]) => key === r.reason)?.[1] || r.reason} · {r.count} 次{r.count >= 3 && <span className="ml-2 text-ink-3">下次调整提示词或词典时优先处理。</span>}</li>)}</ul> : <p className="text-sm text-ink-3">本周还没有纠错记录。</p>}</Card> : <div className="space-y-4">{rows.map(row => <PublishedItem key={row.id + row.status + row.content} row={row} />)}{!rows.length && <Card><p className="text-sm text-ink-3">{tab === 'pending' ? '目前没有待抽查内容。' : '直接上线后的文章会出现在这里。'}</p></Card>}</div>}
  </AdminPage>;
}
