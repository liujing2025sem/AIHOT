import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, ImagePlus, Check } from 'lucide-react';
import { useAdminAction } from './action';
import { Badge, Button, Card, Field, Input, Textarea } from './ui';

type Cover = { hash: string; fileName: string; alt_en: string; caption_en: string; width: number; height: number; src: string };
type CoverState = { revision: number; selectedHash: string | null; candidates: Cover[]; confirmed: boolean; confirmedVersion: number | null };

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(Error('图片读取失败，请重新选择文件。'));
    reader.onerror = () => reject(Error('图片读取失败，请重新选择文件。'));
    reader.readAsDataURL(file);
  });
}

/** Uses the original draft's media state and original session; no parallel draft storage. */
export function DraftCovers({ id, version, approved, disabled, stage, onDelivery, onReview, onEditStateChange }: {
  id: string; version: number; approved: boolean; disabled: boolean;
  stage: 'cover' | 'delivery'; onDelivery: () => void; onReview: () => void;
  onEditStateChange?: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const [state, setState] = useState<CoverState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploading = useRef(false);
  const mounted = useRef(true);
  const { run, busy: actionBusy } = useAdminAction();
  const dirty = file !== null || alt.length > 0 || caption.length > 0;
  const writing = reading || actionBusy;
  const reportEditState = useRef(onEditStateChange);
  useEffect(() => {
    reportEditState.current = onEditStateChange;
    onEditStateChange?.({ dirty, busy: writing });
  }, [dirty, writing, onEditStateChange]);
  useEffect(() => () => { reportEditState.current?.({ dirty: false, busy: false }); }, []);
  const busy = disabled || loading || reading || actionBusy;
  const endpoint = `/api/admin/studio/drafts/${encodeURIComponent(id)}`;
  const load = useCallback(async (signal?: AbortSignal, savedCandidate = false) => {
    setLoading(true);
    const message = savedCandidate ? '封面候选已保存，列表暂未刷新。请重新读取封面。' : '封面状态暂时无法读取。请重新读取，已保存的正文仍在。';
    try {
      const response = await fetch(endpoint + '/covers', { credentials: 'same-origin', cache: 'no-store', signal });
      if (!response.ok) throw Error(message);
      const result: CoverState = await response.json();
      if (mounted.current && !signal?.aborted) { setState(result); setError(''); }
      return true;
    } catch (reason) {
      if (mounted.current && !signal?.aborted) setError(savedCandidate ? message : reason instanceof Error ? reason.message : message);
      return false;
    } finally { if (mounted.current && !signal?.aborted) setLoading(false); }
  }, [endpoint]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void load(controller.signal);
    return () => { mounted.current = false; controller.abort(); };
  }, [load, version]);

  async function upload() {
    if (!file || !state || busy || uploading.current) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('请选择 JPG、PNG 或 WebP 图片。'); return; }
    if (file.size > 4 * 1024 * 1024) { setError('图片超过 4 MB，请压缩后重新选择。'); return; }
    uploading.current = true;
    setReading(true); setError('');
    let saved: CoverState | null | undefined;
    try {
      const dataUrl = await readFile(file);
      if (!mounted.current) return;
      saved = await run<CoverState>('POST', endpoint + '/covers', { version, revision: state.revision, fileName: file.name, dataUrl, alt_en: alt.trim(), caption_en: caption.trim() }, { success: '已加入封面候选，请选择是否采用。', revalidate: false });
      if (!mounted.current) return;
      if (saved) { setState(saved); setFile(null); setAlt(''); setCaption(''); if (fileInput.current) fileInput.current.value = ''; }
    } catch (reason) { if (mounted.current) setError(reason instanceof Error ? reason.message : '图片上传未完成，请重试。'); }
    finally { uploading.current = false; if (mounted.current) setReading(false); }
    if (saved !== undefined && mounted.current) {
      const loaded = await load(undefined, !!saved);
      if (!saved && loaded && mounted.current) setError('本次上传尚未确认，图片和说明已保留。请核对候选后再上传；若稿件已更新，请先核对正文版本。');
    }
  }
  async function select(hash: string | null) {
    if (!state || busy) return;
    const saved = await run('POST', endpoint + '/cover-selection', { version, revision: state.revision, hash }, { success: hash ? '已采用封面，请在手工交付中确认当前成品。' : '已改为无封面交付，请确认当前成品。', revalidate: false });
    if (saved) await load();
  }
  async function remove(hash: string) {
    if (!state || busy || state.selectedHash === hash) return;
    const saved = await run('DELETE', endpoint + '/covers/' + encodeURIComponent(hash), { version, revision: state.revision }, { success: '候选已移除。', revalidate: false });
    if (saved) await load();
  }
  const selected = state?.candidates.find(cover => cover.hash === state.selectedHash);
  const confirmed = !!state?.confirmed && state.confirmedVersion === version;
  return <div className="space-y-5">
    {error && <div role="alert" className="rounded-control border border-hot/20 bg-hot-soft p-4 text-sm leading-6"><p>{error}</p><Button className="mt-3" disabled={loading} onClick={() => void load()}>重新读取封面</Button></div>}
    {loading && !state && <p role="status" className="p-4 text-sm text-ink-3">正在读取当前稿件的封面…</p>}
    {stage === 'cover' && <>
      <Card title="上传封面候选" right={<Badge tone="muted">正文版本 {version}</Badge>}>
        <p className="mb-4 text-sm leading-7 text-ink-3">上传后先进入候选区。选择“采用这张”后，才进入本次成品。</p>
        <div className="draft-cover-upload">
          <Field label="图片文件" hint="JPG、PNG 或 WebP，最大 4 MB。最多保留 8 张候选。"><Input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !state} aria-label="封面图片文件" onChange={event => { setFile(event.target.files?.[0] ?? null); setError(''); }} /></Field>
          <Field label="英文替代文字" hint="描述图片中实际呈现的内容，便于读屏和网站上传。"><Input aria-label="封面英文替代文字" value={alt} maxLength={500} disabled={busy} onChange={event => setAlt(event.target.value)} placeholder="例如：Outdoor LED display mounted on a building" /></Field>
          <Field label="英文图注（选填）"><Textarea aria-label="封面英文图注" value={caption} maxLength={1000} rows={2} disabled={busy} onChange={event => setCaption(event.target.value)} /></Field>
        </div>
        <Button className="mt-4" disabled={busy || !state || !file || !alt.trim() || state.candidates.length >= 8} onClick={() => void upload()}><ImagePlus aria-hidden="true" />{reading || actionBusy ? '正在保存候选…' : '上传为候选'}</Button>
        {!!state && state.candidates.length >= 8 && <p className="mt-3 text-sm leading-7 text-ink-3">已有 8 张候选。移除一张未采用的候选后，可以继续上传。</p>}
      </Card>
      {state && <Card title="选择本次封面" right={<Badge tone={selected ? 'ok' : 'muted'}>{selected ? '已选 1 张' : '暂不带封面'}</Badge>}>
        {state.candidates.length ? <div className="draft-cover-candidates">{state.candidates.map(cover => <article key={cover.hash} className="draft-cover-candidate" data-selected={state.selectedHash === cover.hash}>
          <img src={cover.src} alt={cover.alt_en} width={cover.width} height={cover.height} loading="lazy" />
          <div><h3>{cover.fileName}</h3><p lang="en">{cover.alt_en}</p>{cover.caption_en && <p lang="en" className="text-ink-3">{cover.caption_en}</p>}<p className="text-xs text-ink-3">{cover.width} × {cover.height} 像素</p><div className="mt-3 flex flex-wrap items-center gap-3"><Button tone={state.selectedHash === cover.hash ? 'secondary' : 'primary'} disabled={busy || state.selectedHash === cover.hash} onClick={() => void select(cover.hash)}>{state.selectedHash === cover.hash ? <><Check aria-hidden="true" />当前采用</> : '采用这张'}</Button><a className="text-sm text-accent" href={cover.src} download={cover.fileName}>下载图片</a>{state.selectedHash !== cover.hash && <Button disabled={busy} onClick={() => void remove(cover.hash)}>移除候选</Button>}</div></div>
        </article>)}</div> : <p className="text-sm leading-7 text-ink-3">还没有封面候选。可以上传图片，也可以继续交付正文，之后由运营配图。</p>}
        <div className="mt-5 flex flex-wrap gap-3">{state.selectedHash && <Button disabled={busy} onClick={() => void select(null)}>去掉本次封面</Button>}<Button disabled={busy} onClick={onDelivery}>继续手工交付</Button></div>
      </Card>}
    </>}
    {stage === 'delivery' && state && <Card title="确认当前成品" right={<Badge tone={confirmed ? 'ok' : 'warn'}>{confirmed ? '成品已确认' : '待确认成品'}</Badge>}>
      <div className="draft-delivery-summary">
        {selected && <img src={selected.src} alt={selected.alt_en} width={selected.width} height={selected.height} />}
        <div><p className="text-lg font-semibold">正文版本 {version}</p><p className="mt-2 text-sm leading-7">{approved ? '当前正文已获人工批准。' : '当前正文尚未获人工批准，请先完成审稿。'}</p><p className="mt-1 text-sm leading-7 text-ink-3">{selected ? `采用封面：${selected.fileName}` : '本次不带封面。运营可在网站上传时另行配图。'}</p>{selected && <p lang="en" className="mt-2 text-sm leading-7 text-ink-3">{selected.alt_en}</p>}</div>
      </div>
      {!approved ? <Button className="mt-5" onClick={onReview}>返回审正文</Button> : !confirmed ? <Button className="mt-5" tone="primary" disabled={busy} onClick={async () => { const saved = await run('POST', endpoint + '/delivery-confirmation', { version, revision: state.revision }, { success: '当前正文与封面已确认为同一成品，可以下载交付包。', revalidate: false }); if (saved) await load(); }}>确认当前成品</Button> : <a className={'draft-bundle-download' + (busy ? ' pointer-events-none opacity-50' : '')} aria-disabled={busy || undefined} tabIndex={busy ? -1 : undefined} href={`${endpoint}/export?format=bundle&version=${version}&coverRevision=${state.revision}`}><Download aria-hidden="true" />下载交付包</a>}
      <p className="mt-3 text-sm leading-7 text-ink-3">交付包用于运营手工上传。下载后仍保留当前审核状态，发布记录由实际发布结果确定。</p>
    </Card>}
  </div>;
}
