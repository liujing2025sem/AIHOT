import type { PgBoss } from 'pg-boss';
import { QUEUES, work } from '@aihot/backend/jobs/queue';
import { runPitchJob } from '@aihot/backend/studio/studio-pitch';
export async function registerStudioJobs(boss:PgBoss){
  await work(boss,QUEUES.studioPrep,{localConcurrency:1},runPitchJob);
}
