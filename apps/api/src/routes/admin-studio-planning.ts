import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { actorOf } from '@aihot/backend/admin/auth';
import { studioQuestions, saveStudioQuestion, importStudioQuestions } from '@aihot/backend/admin/studio-questions';
import { importDemandCsv, listStudioImports, withdrawStudioImport, demandProfiles, DemandCsvError } from '@aihot/backend/studio/studio-demand';
import { demandCsvTemplate, demandCsvOptions } from '@aihot/backend/studio/studio-demand-csv';
import { z } from 'zod';
import { recommendationOverview, setRecommendationCapacity, refreshRecommendations, decideRecommendation, bindRecommendationEvidence, createManualRecommendation } from '@aihot/backend/admin/studio-recommendations';
import { studioSearchSignals, importSearchSignals, searchTemplates } from '@aihot/backend/admin/studio-search-signals';
import { listStudioSocial, deriveStudioSocial, saveStudioSocial, reviewStudioSocial, exportStudioSocial } from '@aihot/backend/admin/studio-social';
import { adminHandler } from './admin-auth.ts';
import { body, param, orNotFound } from './admin.ts';
import { previewPitch,createPitch,listPitches,getPitch,revisePitch,confirmPitch,queuePitchDraft } from '@aihot/backend/studio/studio-pitch';
import {upgradePitch,supplementPitchEvidence,queueFragmentRetry} from '@aihot/backend/studio/studio-pitch-v2';

/** Planning is internal; a page view never generates cards or calls a model. */
export function registerAdminStudioPlanning(app: FastifyInstance) {
  app.post('/api/admin/studio/pitch/redact',adminHandler(async(req)=>previewPitch(body(req))));
  app.get('/api/admin/studio/pitches',adminHandler(async()=>listPitches()));
  app.post('/api/admin/studio/pitches',adminHandler(async(req,_reply,admin)=>createPitch(body(req),actorOf(admin))));
  app.get('/api/admin/studio/pitches/:id',adminHandler(async(req,reply)=>orNotFound(req,reply,await getPitch(param(req,'id')))));
  app.patch('/api/admin/studio/pitches/:id',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await revisePitch(param(req,'id'),body(req),actorOf(admin)))));
  app.post('/api/admin/studio/pitches/:id/confirm',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await confirmPitch(param(req,'id'),body(req),actorOf(admin)))));
  app.post('/api/admin/studio/pitches/:id/generate',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await queuePitchDraft(param(req,'id'),actorOf(admin)))));
  app.post('/api/admin/studio/pitches/:id/upgrade',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await upgradePitch(param(req,'id'),body(req),actorOf(admin)))));
  app.post('/api/admin/studio/pitches/:id/evidence',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await supplementPitchEvidence(param(req,'id'),body(req),actorOf(admin)))));
  app.post('/api/admin/studio/pitches/:id/fragments/:index/retry',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await queueFragmentRetry(param(req,'id'),z.coerce.number().int().nonnegative().parse(param(req,'index')),body(req),actorOf(admin)))));
  app.get('/api/admin/studio/social',adminHandler(async req=>({rows:await listStudioSocial((req.query as Record<string,string>).draft_id)})));
  app.post('/api/admin/studio/social/derive',adminHandler(async(req,_reply,admin)=>deriveStudioSocial(body(req),actorOf(admin))));
  app.patch('/api/admin/studio/social/:id',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await saveStudioSocial(param(req,'id'),body(req),actorOf(admin)))));
  app.post('/api/admin/studio/social/:id/review',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await reviewStudioSocial(param(req,'id'),body(req),actorOf(admin)))));
  app.get('/api/admin/studio/social/:id/export',adminHandler(async(req,reply)=>{
    const value=await exportStudioSocial(param(req,'id'),(req.query as Record<string,string>).format??'md');
    if(!value)return orNotFound(req,reply,null);
    return reply.header('Content-Disposition',`attachment; filename="social-${param(req,'id')}.${value.extension}"`).type(value.type).send(value.body);
  }));
  app.get('/api/admin/studio/recommendations',adminHandler(async()=>recommendationOverview()));
  app.post('/api/admin/studio/recommendations/manual',adminHandler(async(req,_reply,admin)=>createManualRecommendation(body(req),actorOf(admin))));
  app.post('/api/admin/studio/recommendations/capacity',adminHandler(async(req,_reply,admin)=>setRecommendationCapacity(body(req),actorOf(admin))));
  app.post('/api/admin/studio/recommendations/refresh',adminHandler(async(_req,_reply,admin)=>refreshRecommendations(actorOf(admin))));
  app.post('/api/admin/studio/recommendations/:id/decision',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await decideRecommendation(param(req,'id'),body(req),actorOf(admin)))));
  app.post('/api/admin/studio/recommendations/:id/materials',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await bindRecommendationEvidence(param(req,'id'),body(req),actorOf(admin)))));
  app.get('/api/admin/studio/search-signals',adminHandler(async()=>studioSearchSignals()));
  app.post('/api/admin/studio/search-signals/import',adminHandler(async(req,_reply,admin)=>importSearchSignals(body(req),actorOf(admin))));
  app.delete('/api/admin/studio/search-signals/batches/:id',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await withdrawStudioImport(param(req,'id'),actorOf(admin)))));
  app.get('/api/admin/studio/search-signals/template/:kind',adminHandler(async(req,reply)=>{
    const kind=z.enum(['gsc','semrush']).parse(param(req,'kind'));
    return reply.header('Content-Disposition',`attachment; filename="${kind}.example.csv"`).type('text/csv; charset=utf-8').send(searchTemplates[kind]);
  }));
  app.get('/api/admin/studio/demand/profiles',adminHandler(async()=>demandProfiles()));
  app.get('/api/admin/studio/demand/batches',adminHandler(async()=>({rows:await listStudioImports('inquiry')})));
  app.get('/api/admin/studio/demand/template',adminHandler(async(_req,reply)=>reply.header('Content-Disposition','attachment; filename="anonymized-demand.example.csv"').type('text/csv; charset=utf-8').send(demandCsvTemplate)));
  app.get('/api/admin/studio/demand/options',adminHandler(async()=>demandCsvOptions));
  app.post('/api/admin/studio/demand/import',adminHandler(async(req,reply,admin)=>{
    const input=z.object({csv:z.string().max(2*1024*1024),filename:z.string().max(200).optional()}).strict().parse(body(req));
    try{return await importDemandCsv(input,actorOf(admin));}
    catch(error){if(error instanceof DemandCsvError)return reply.code(400).send({code:error.code,detail:error.message+' '+error.errors.slice(0,8).map(e=>`第${e.row}行 ${e.field}：${e.code}`).join('；'),errors:error.errors});throw error;}
  }));
  app.delete('/api/admin/studio/demand/batches/:id',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await withdrawStudioImport(param(req,'id'),actorOf(admin)))));
  app.get('/api/admin/studio/questions',adminHandler(async()=>studioQuestions()));
  app.post('/api/admin/studio/questions',adminHandler(async(req,_reply,admin)=>saveStudioQuestion(body(req),actorOf(admin))));
  app.post('/api/admin/studio/questions/import',adminHandler(async(req,_reply,admin)=>importStudioQuestions(body(req),actorOf(admin))));
  app.get('/api/admin/studio/questions/example',adminHandler(async(_req,reply)=>reply.header('Content-Disposition','attachment; filename="question-map.example.json"').type('application/json').send(readFileSync(new URL('../../../../industry/question-map.example.json',import.meta.url),'utf8'))));
}
