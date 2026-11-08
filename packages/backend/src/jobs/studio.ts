import type { PgBoss } from 'pg-boss';
import { QUEUES, work } from './queue.ts';
import { runPitchJob } from '../admin/studio-pitch.ts';
export async function registerStudioJobs(boss:PgBoss){
  await work(boss,QUEUES.studioPrep,{localConcurrency:1},runPitchJob);
}
