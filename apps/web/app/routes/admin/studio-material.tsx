import { useRef, useState } from 'react';
import { Link, useRevalidator } from 'react-router';
import type { Route } from './+types/studio-material';
import { adminGet } from '../../lib/admin.server';
import { useAdminAction } from '../../features/admin/action';
import { AdminPage, Card, Button, Badge, Time } from '../../features/admin/ui';

type ExtractionState = 'ok' | 'partial' | 'unconfirmed' | 'skipped' | 'conflict' | 'unsupported' | 'failed';
type MaterialData = { id: string; title: string; url: string; source_name: string; body_text: string | null; body_status: string; published_at: string | null; publication_time: string | null; revision: number; last_extraction: { state: ExtractionState; notice: string; at: string } | null };
type Extraction = { state: ExtractionState; notice: string; changes: { body: boolean; date: boolean }; material: MaterialData };
const extractionLabels: Record<ExtractionState, string> = { ok: '补齐完成', partial: '部分补齐', unconfirmed: '仍待核实', skipped: '已齐', conflict: '版本冲突', unsupported: '暂不支持', failed: '补齐失败' };

export async function loader({ request, params }: Route.LoaderArgs) {
  return adminGet<MaterialData>(request, `/api/admin/studio/materials/${params.id}`);
}

export default function Material({ loaderData: a }: Route.ComponentProps) {
  const { run, busy } = useAdminAction();
  const revalidator = useRevalidator();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [attempt, setAttempt] = useState<{ id: string; result: Extraction | null } | null>(null);
  const currentAttempt = attempt?.id === a.id ? attempt : null;
  const date = a.published_at ? a.publication_time || a.published_at : null;
  const bodyReady = a.body_status === 'ok' && !!a.body_text?.trim();
  const extract = async () => {
    if (busy || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    const id = a.id;
    try {
      const result = await run<Extraction>('POST', `/api/admin/studio/materials/${id}/extract`, {}, { revalidate: false });
      setAttempt({ id, result });
    } finally {
      pendingRef.current = false;
      setPending(false);
      void revalidator.revalidate();
    }
  };
  const last = a.last_extraction;
  const result = currentAttempt?.result;
  const state = currentAttempt ? result?.state ?? 'failed' : last?.state;
  return <AdminPage title={a.title} subtitle={<span>{a.source_name} · {date ? /^\d{4}-\d{2}-\d{2}$/.test(date) ? <time dateTime={date}>{date}（原文仅日期）</time> : <><Time at={date} />{!a.publication_time && '（原始精度未知）'}</> : '发布日期待核实'} · 原文版本 {a.revision}</span>} actions={<Link to="/admin/studio" className="text-sm text-accent">返回素材池</Link>}>
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <a href={a.url} target="_blank" rel="noreferrer" className="rounded-control border border-line px-3 py-2 text-sm text-accent">打开原文 ↗</a>
      <Button disabled={busy || pending} onClick={() => void extract()}>{pending ? '正在补齐…' : '补齐正文 / 日期'}</Button>
      <Badge tone={bodyReady ? 'ok' : 'warn'}>{bodyReady ? '正文可读' : '正文待补'}</Badge>
      {!date && <Badge tone="warn">日期待核</Badge>}
    </div>
    {(currentAttempt || last) && <Card className="mb-4" title="最近补齐结果">
      <div role="status" aria-live="polite">
        <div className="flex flex-wrap items-center gap-2">
          {state && <Badge tone={state === 'ok' || state === 'skipped' ? 'ok' : state === 'failed' || state === 'conflict' ? 'bad' : 'warn'}>{extractionLabels[state]}</Badge>}
          {result && <><Badge tone={result.changes.body ? 'ok' : 'muted'}>{result.changes.body ? '已补正文' : result.material?.body_status === 'ok' ? '正文已齐' : '待补正文'}</Badge><Badge tone={result.changes.date ? 'ok' : 'muted'}>{result.changes.date ? '已补日期' : result.material?.published_at ? '日期已齐' : '日期待核'}</Badge></>}
          {last && !currentAttempt && <span className="text-xs text-ink-4"><Time at={last.at}/></span>}
        </div>
        <p className="mt-3 break-words text-sm leading-6 text-ink-3">{currentAttempt ? result?.notice || '未取得补齐结果，请查看错误提示后重试。' : last?.notice}</p>
      </div>
    </Card>}
    <Card><div className="max-w-4xl whitespace-pre-wrap break-words text-[14px] leading-7 text-ink-2">{a.body_text || '尚未取得正文。请补齐，或到信源设置检查正文提取规则。'}</div></Card>
  </AdminPage>;
}
