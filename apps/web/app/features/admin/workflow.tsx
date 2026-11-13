import type { Ref } from 'react';
import { Link } from 'react-router';
import { BookOpenText, FileCheck2, Image, Download } from 'lucide-react';

export type DraftStage = 'review' | 'cover' | 'delivery';
const steps = [
  { key: 'direction', label: '定方向', icon: BookOpenText },
  { key: 'review', label: '审正文', icon: FileCheck2 },
  { key: 'cover', label: '配封面', icon: Image },
  { key: 'delivery', label: '手工交付', icon: Download },
] as const;

/** Navigation only. Saving, generation, review and export retain their original API gates. */
export function ArticleWorkflow({ current, draftId, directionTo, onStage, stageHeadingRef }: {
  current: 'direction' | DraftStage;
  draftId?: string;
  directionTo?: string;
  onStage?: (stage: DraftStage) => void;
  stageHeadingRef?: Ref<HTMLHeadingElement>;
}) {
  return <><nav aria-label="当前稿件流程" className="article-workflow"><ol>
    {steps.map(({ key, label, icon: Icon }) => <li key={key}>
      {key === 'direction' ? <Link to={directionTo || '/admin/studio/pitch'} aria-current={current === key ? 'step' : undefined}><Icon aria-hidden="true" /><span>{label}</span></Link>
        : onStage ? <button type="button" onClick={() => onStage(key)} aria-current={current === key ? 'step' : undefined}><Icon aria-hidden="true" /><span>{label}</span></button>
        : draftId ? <Link to={`/admin/studio/drafts/${draftId}?stage=${key}`} aria-current={current === key ? 'step' : undefined}><Icon aria-hidden="true" /><span>{label}</span></Link>
        : <span aria-disabled="true"><Icon aria-hidden="true" /><span>{label}</span></span>}
    </li>)}
  </ol></nav>{stageHeadingRef && <h2 ref={stageHeadingRef} tabIndex={-1} className="draft-stage-heading">{steps.find(step => step.key === current)?.label}</h2>}</>;
}
