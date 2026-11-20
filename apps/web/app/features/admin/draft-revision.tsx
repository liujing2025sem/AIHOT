import { useEffect, useState } from 'react';
import { useRevalidator } from 'react-router';
import type { useAdminAction } from './action';
import { Button } from './ui';

type RevisionStatus = 'queued' | 'running' | 'done' | 'failed' | 'unknown' | 'cancelled';
export type DraftRevisionRequest = { status: RevisionStatus; version: number; goals: string[]; note: string; error?: string; receipt_id?: number };

const revisionMessages: Record<RevisionStatus, string> = {
  queued: '已安排按所选目标修订。当前仍展示原版本，完成后需重新审稿。',
  running: '正在修改，完成后请核对新版本。',
  done: '修订已返回，请核对当前版本。',
  cancelled: '已保留原稿，结束本次修订等待。可以继续审阅。',
  unknown: '修订调用结果未知，可能已计费。已保留回执，不会自动重试。',
  failed: '修订未完成，原稿仍保留。',
};

type ReviewCommand = ReturnType<typeof useAdminAction>['run'];

export function useDraftRevision(endpoint: string, version: number, revision: DraftRevisionRequest | null | undefined, run: ReviewCommand) {
  const { revalidate, state } = useRevalidator();
  const [wait, setWait] = useState<{ until: number; request: string } | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const snapshot = JSON.stringify(revision ?? null);
  const status = revision?.status;
  const writing = status === 'queued' || status === 'running';

  useEffect(() => {
    if (!wait) return;
    if (status === 'done' || status === 'cancelled' || ((status === 'failed' || status === 'unknown') && snapshot !== wait.request)) {
      setWait(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setWait(null);
      setTimedOut(true);
    }, Math.max(0, wait.until - Date.now()));
    return () => window.clearTimeout(timer);
  }, [status, snapshot, wait]);

  useEffect(() => {
    if ((!wait && !writing) || state !== 'idle') return;
    const timer = window.setTimeout(() => void revalidate(), 3500);
    return () => window.clearTimeout(timer);
  }, [writing, wait, state, revalidate]);

  async function recover() {
    setTimedOut(false);
    const result = await run('POST', endpoint, { version, action: 'recover_revision' }, { label: 'recover_revision', success: '已安排核对现有修订回执，未重新调用模型。', revalidate: false });
    if (!result) return;
    setWait({ until: Date.now() + 20_000, request: snapshot });
    void revalidate();
  }

  function keepOriginal() {
    return run('POST', endpoint, { version, action: 'keep_revision_original' }, { label: 'keep_revision_original', success: '已保留原稿并退出本次修订等待。' });
  }

  return { active: writing || status === 'unknown' || wait !== null, waiting: wait !== null, timedOut, recover, keepOriginal };
}

export function DraftRevisionStatus({ revision, control, disabled }: {
  revision: DraftRevisionRequest | null | undefined;
  control: ReturnType<typeof useDraftRevision>;
  disabled: boolean;
}) {
  if (!revision) return null;
  const { status, error } = revision;
  const canRecover = status === 'queued' || status === 'running' || status === 'unknown' || status === 'failed';
  return <>
    <p role="status" className="mt-3 text-sm leading-6">{revisionMessages[status]}{error ? ' ' + error : ''}</p>
    {control.waiting && <p role="status" className="mt-2 text-sm leading-6">正在核对已有修订结果，最多等待 20 秒；可随时保留原稿继续。</p>}
    {control.timedOut && canRecover && <p role="status" className="mt-2 text-sm leading-6 text-amber-ink">本次核对尚未返回新结果，可稍后再查或保留原稿继续。未重新调用付费模型。</p>}
    {canRecover && <div className="mt-3 space-y-2">
      <p className="text-xs leading-6 text-ink-3">核对已有回执可取回已返回的结果；保留原稿可结束本次等待。这两个操作均不重新调用付费模型，原审核要求保留。</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={disabled || control.waiting} onClick={() => void control.recover()}>核对修订结果</Button>
        <Button disabled={disabled} onClick={() => void control.keepOriginal()}>保留原稿继续</Button>
      </div>
    </div>}
  </>;
}
