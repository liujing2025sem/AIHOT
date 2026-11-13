import type { PgBoss } from 'pg-boss';
import { QUEUES, work } from '@aihot/backend/jobs/queue';
import { runPitchJob } from '@aihot/backend/studio/studio-pitch';
import { runStudioMaterialPublication } from '@aihot/backend/studio/studio-publishing';
import { runStudioBriefJob } from '@aihot/backend/studio/studio-brief';
import { runStudioDraftRevision } from '@aihot/backend/studio/studio';
export async function registerStudioJobs(boss:PgBoss){
  await work(boss,QUEUES.studioBrief,{localConcurrency:1},runStudioBriefJob);
  await work(boss,QUEUES.studioRevision,{localConcurrency:1},runStudioDraftRevision);
  await work(boss,QUEUES.studioPrep,{localConcurrency:1},runPitchJob);
  await work(boss,QUEUES.studioPublish,{localConcurrency:1},runStudioMaterialPublication);
}
