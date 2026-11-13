import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CATEGORIES } from '@aihot/industry/taxonomy';
import { useAdminAction } from './action';
import { Button, Card } from './ui';
import { useDelivery } from './delivery';

export type PublishingSettings = {
  mode: 'review' | 'one_click' | 'automatic'; enabled: boolean;
  daily_limits: { brief: number; article: number; guide: number; update: number };
};
const defaults: PublishingSettings = { mode: 'review', enabled: false, daily_limits: { brief: 1, article: 2, guide: 1, update: 0 } };
const endpoint = '/api/admin/studio/publishing/settings';
function usePublishingSettings(enabled = true) {
  const [value, setValue] = useState<PublishingSettings | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetch(endpoint, { credentials: 'same-origin', signal: controller.signal }).then(async r => {
      if (!r.ok) throw Error('上线设置暂时无法读取，请刷新重试。');
      const result = await r.json(); setValue({ ...defaults, ...result });
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [enabled]);
  return { value, setValue, error };
}

export function PublishingSettingsCard() {
  const delivery = useDelivery();
  const { value, setValue, error } = usePublishingSettings(delivery.wordpressWritesAllowed);
  const { run, busy } = useAdminAction();
  if (!delivery.wordpressWritesAllowed) return <Card title="手工交付">
    <p className="text-sm leading-7">{delivery.message || '审核成稿后，下载文件，由运营上传到网站。'}</p>
    <p className="mt-2 text-sm leading-7 text-ink-3">稿件、配图、版本和发布历史都保留在原工作台。</p>
    <Link to="/admin/studio?tab=drafts" className="mt-4 inline-flex text-sm font-medium text-accent">查看稿件</Link>
  </Card>;
  if (!value) return <Card title="上线方式"><p className="text-sm text-ink-3">{error || '正在读取设置…'}</p></Card>;
  return <Card title="上线方式">
    <div className="space-y-3 text-sm">
      <fieldset className="space-y-2"><legend className="mb-2 font-medium">你希望怎样把稿件送到官网</legend>
        {([['review', '人审后上线', '审核后送入 WordPress 草稿箱，由你发布。'], ['one_click', '一键上线', '点“直接上线”，系统处理内容、配图并发布。'], ['automatic', '全自动上线', '先保存偏好；自动排期将在短讯流程完成后开放。']] as const).map(([mode, name, description]) => <label key={mode} className="flex gap-3 rounded-control border border-line p-3"><input type="radio" name="publication-mode" checked={value.mode === mode} onChange={() => setValue({ ...value, mode })} /><span><strong className="block">{name}</strong><span className="mt-1 block text-xs leading-5 text-ink-3">{description}</span></span></label>)}
      </fieldset>
      <label className="flex items-center gap-2"><input type="checkbox" checked={value.enabled} onChange={e => setValue({ ...value, enabled: e.target.checked })} />开启直接上线</label>
      <p className="text-xs leading-5 text-ink-3">关闭后不会从这里直接发布。已上线文章仍可下线和纠错。</p>
      <details><summary className="cursor-pointer text-accent">全自动上线的每日上限</summary><div className="mt-3 grid grid-cols-2 gap-3">{([['brief', '短讯（期）'], ['article', '短文章（篇）'], ['guide', '长文（篇）'], ['update', '升级页（篇）']] as const).map(([key, name]) => <label key={key}>{name}<input aria-label={name} type="number" min="0" max="100" value={value.daily_limits[key]} onChange={e => setValue({ ...value, daily_limits: { ...value.daily_limits, [key]: Number(e.target.value) } })} className="mt-1 w-full rounded-control border border-line bg-surface p-2" /></label>)}</div><p className="mt-2 text-xs text-ink-3">先保存全自动排期的偏好，填 0 表示该类型不自动上线。全自动尚未开放；手动点击一键上线不使用这些名额。</p></details>
      <Button tone="primary" disabled={busy} onClick={async () => { const saved = await run<PublishingSettings>('PUT', endpoint, value, { success: '上线方式已保存。' }); if (saved) setValue({ ...value, ...saved }); }}>保存上线方式</Button>
      <Link to="/admin/studio/published" className="ml-4 text-accent">上线后抽查 →</Link>
    </div>
  </Card>;
}

export function DirectPublish({ draft, materialIds, disabled = false, onQueued }: {
  draft?: { id: string; version: number; title: string };
  materialIds?: string[]; disabled?: boolean; onQueued?: () => void;
}) {
  const delivery = useDelivery();
  const { value, error } = usePublishingSettings(delivery.wordpressWritesAllowed);
  const { run, busy } = useAdminAction();
  const [kind, setKind] = useState(draft ? /^\[UPDATE\]/i.test(draft.title) ? 'update' : 'guide' : 'article');
  const [section, setSection] = useState('components-ics');
  const [notice, setNotice] = useState('');
  if (!delivery.wordpressWritesAllowed) return null;
  const enabled = value?.enabled && value.mode === 'one_click';
  const selected = !!draft || !!materialIds?.length;
  return <div className="mt-4 border-t border-line pt-4">
    <Button tone="primary" className="w-full" disabled={busy || disabled || !enabled || !selected || (!draft && (materialIds?.length ?? 0) > 4)} onClick={async () => {
      const path = draft ? `/api/admin/studio/drafts/${draft.id}/publish` : '/api/admin/studio/materials/publish';
      const result = await run<{ message?: string; state?: string }>('POST', path, { ...(draft ? { version: draft.version } : { article_ids: materialIds }), kind, section });
      if (result) { setNotice(result.message || (draft ? '已提交上线处理，请到抽查列表查看结果。' : '已开始成稿和上线，完成后会进入抽查列表。')); onQueued?.(); }
    }}>{busy ? '正在处理…' : draft ? '直接上线' : '一键成文并上线'}</Button>
    {!enabled && <p className="mt-2 text-xs leading-5 text-ink-3">{error || '当前保留人审流程。'} <Link to="/admin/settings" className="text-accent">去设置开启一键上线 →</Link></p>}
    {enabled && <p className="mt-2 text-xs leading-5 text-ink-3">系统会处理未确认内容并配图。上线后可改一处、下线或回滚。</p>}
    {notice && <p role="status" className="mt-2 text-sm leading-6">{notice} <Link to="/admin/studio/published" className="text-accent">查看结果 →</Link></p>}
    <details className="mt-2 text-xs"><summary className="cursor-pointer text-ink-3">调整本次内容类型和分节</summary><div className="mt-2 space-y-2"><label className="block">内容类型<select aria-label="上线内容类型" value={kind} onChange={e => setKind(e.target.value)} className="mt-1 w-full rounded-control border border-line bg-surface p-2"><option value="brief">短讯</option><option value="article">短文章</option><option value="guide">长文</option><option value="update">升级已有页面</option></select></label><label className="block">分节<select aria-label="上线分节" value={section} onChange={e => setSection(e.target.value)} className="mt-1 w-full rounded-control border border-line bg-surface p-2">{CATEGORIES.map(c => <option value={c.key} key={c.key}>{c.section}</option>)}</select></label></div></details>
  </div>;
}
