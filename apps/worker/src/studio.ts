import type { PgBoss } from 'pg-boss';
import { QUEUES, work } from '@aihot/backend/jobs/queue';
import { runPitchJob } from '@aihot/backend/studio/studio-pitch';
import { runStudioMaterialPublication } from '@aihot/backend/studio/studio-publishing';
export async function registerStudioJobs(boss:PgBoss){
  await work(boss,QUEUES.studioPrep,{localConcurrency:1},runPitchJob);
  await work(boss,QUEUES.studioPublish,{localConcurrency:1},runStudioMaterialPublication);
}
