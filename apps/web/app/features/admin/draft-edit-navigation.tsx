import { useCallback, useEffect, useRef, useState } from 'react';
import { useBeforeUnload, useBlocker, type BlockerFunction } from 'react-router';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '../../components/ui/primitives/dialog';
import { toast } from './toast';
import { Button } from './ui';

const cleanCover = { dirty: false, busy: false };

export function useDraftEditNavigation({ dirty, canSave, discardDocument, discardCover, saveDocument }: {
  dirty: boolean;
  canSave: boolean;
  discardDocument: () => void;
  discardCover: () => void;
  saveDocument: () => Promise<boolean>;
}) {
  const [coverBusy, setCoverBusy] = useState(false);
  const protection = useRef({ dirty: false, cover: cleanCover });
  const reportDocumentDirty = (value: boolean) => { protection.current.dirty = value; };
  const reportCoverEdit = useCallback((state: typeof cleanCover) => {
    protection.current.cover = state;
    setCoverBusy(state.busy);
  }, []);

  // Read synchronous input state before navigation and effects can race an edit.
  useBeforeUnload(useCallback((event: BeforeUnloadEvent) => {
    const current = protection.current;
    if (current.dirty || current.cover.dirty || current.cover.busy) { event.preventDefault(); event.returnValue = ''; }
  }, []));
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    const current = protection.current;
    return (current.dirty || current.cover.dirty || current.cover.busy) &&
      (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search);
  }, []);
  const blocker = useBlocker(shouldBlock);
  const handled = useRef<typeof blocker | null>(null);
  useEffect(() => {
    if (blocker.state !== 'blocked') { handled.current = null; return; }
    if (handled.current === blocker) return;
    handled.current = blocker;
    const current = protection.current;
    if (current.cover.busy) {
      blocker.reset();
      toast('封面操作尚未完成，请稍候再切换。', 'info');
    } else if (!current.dirty && current.cover.dirty) {
      if (window.confirm('封面还有未上传的图片或说明。确定放弃这些输入并继续？')) {
        reportCoverEdit(cleanCover);
        discardCover();
        blocker.proceed();
      } else blocker.reset();
    }
  }, [blocker, discardCover, reportCoverEdit]);

  function discardAndLeave() {
    if (blocker.state !== 'blocked') return;
    reportDocumentDirty(false);
    discardDocument();
    if (protection.current.cover.dirty) {
      reportCoverEdit(cleanCover);
      discardCover();
    }
    blocker.proceed();
  }

  async function saveAndLeave() {
    if (blocker.state !== 'blocked' || !(await saveDocument())) return false;
    reportDocumentDirty(false);
    blocker.proceed();
    return true;
  }

  const prompt = blocker.state === 'blocked' && dirty && !coverBusy
    ? <DraftLeaveDialog canSave={canSave && !protection.current.cover.dirty} coverDirty={protection.current.cover.dirty}
        onStay={blocker.reset} onDiscard={discardAndLeave} onSave={saveAndLeave} />
    : null;
  return { coverBusy, reportCoverEdit, reportDocumentDirty, prompt };
}

function DraftLeaveDialog({ canSave, coverDirty, onStay, onDiscard, onSave }: {
  canSave: boolean;
  coverDirty: boolean;
  onStay: () => void;
  onDiscard: () => void;
  onSave: () => Promise<boolean>;
}) {
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(true);

  return <Dialog open onOpenChange={open => { if (!open && !saving) onStay(); }}>
    <DialogContent showClose={false} aria-busy={saving || undefined}
      onOpenAutoFocus={() => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={event => { event.preventDefault(); if (restoreFocus.current) returnFocus.current?.focus(); }}>
      <DialogTitle>稿件还有未保存的修改</DialogTitle>
      <DialogDescription>{coverDirty ? '正文和封面都有未完成的编辑。继续编辑可以保留这些输入。' : '可以保存当前修改后离开，也可以留在这里继续编辑。'}</DialogDescription>
      {saveFailed && <p role="alert" className="mt-3 text-sm text-hot">保存未完成。修改还在，可以继续编辑或重试保存。</p>}
      <DialogFooter>
        <Button disabled={saving} onClick={onStay}>继续编辑</Button>
        <Button disabled={saving} onClick={() => { restoreFocus.current = false; onDiscard(); }}>放弃修改</Button>
        <Button tone="primary" disabled={saving || !canSave} onClick={async () => {
          setSaving(true);
          setSaveFailed(false);
          restoreFocus.current = false;
          if (await onSave()) return;
          restoreFocus.current = true;
          setSaving(false);
          setSaveFailed(true);
        }}>{saving ? '正在保存…' : '保存并离开'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
