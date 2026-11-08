import type { FastifyInstance } from 'fastify';
import { actorOf } from '@aihot/backend/admin/auth';
import { adminHandler } from './admin-auth.ts';
import { param, body, q, orNotFound } from './admin.ts';
import { studioOverview, studioMaterial, createStudioTask, bindStudioTaskMaterials, exportStudioTask, receiveStudioTask, generateStudioTask, studioDraft, saveStudioDraft, reviewStudioDraft, exportStudioDraft, collectStudioSource, extractStudioMaterial } from '@aihot/backend/admin/studio';
import { studioReviewMetrics, recordStudioReview, setStudioReviewPolicy } from '@aihot/backend/admin/studio-review';
import { pushStudioWordPressDraft, studioWordPressDetail } from '@aihot/backend/admin/studio-wordpress';
import { registerAdminStudioPlanning } from './admin-studio-planning.ts';
export function registerAdminStudio(app: FastifyInstance) {
  registerAdminStudioPlanning(app);
  app.get('/api/admin/studio/review-metrics',adminHandler(async()=>studioReviewMetrics()));
  app.post('/api/admin/studio/review-policy',adminHandler(async(req,_reply,admin)=>setStudioReviewPolicy(body(req),actorOf(admin))));
  app.post('/api/admin/studio/drafts/:id/intervention',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await recordStudioReview(param(req,'id'),body(req),actorOf(admin)))));
  app.get('/api/admin/studio', adminHandler(async req => studioOverview(q(req))));
  app.get('/api/admin/studio/materials/:id', adminHandler(async (req,reply) => orNotFound(req,reply,await studioMaterial(param(req,'id')))));
  app.post('/api/admin/studio/materials/:id/extract', adminHandler(async (req,reply,admin) => orNotFound(req,reply,await extractStudioMaterial(param(req,'id'),actorOf(admin)))));
  app.post('/api/admin/studio/sources/:id/collect', adminHandler(async (req,reply,admin) => orNotFound(req,reply,await collectStudioSource(param(req,'id'),actorOf(admin)))));
  app.post('/api/admin/studio/tasks', adminHandler(async (req,_reply,admin) => createStudioTask(body(req),actorOf(admin))));
  app.post('/api/admin/studio/tasks/:id/materials',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await bindStudioTaskMaterials(param(req,'id'),body(req),actorOf(admin)))));
  app.get('/api/admin/studio/tasks/:id/export', adminHandler(async (req,reply) => {
    const value=await exportStudioTask(param(req,'id'));
    if(!value)return orNotFound(req,reply,null);
    return reply.header('Content-Disposition',`attachment; filename="${value.request.task_id}.json"`).send(value);
  }));
  app.post('/api/admin/studio/tasks/:id/receive', adminHandler(async (req,reply,admin) => orNotFound(req,reply,await receiveStudioTask(param(req,'id'),body(req),actorOf(admin)))));
  app.post('/api/admin/studio/tasks/:id/generate', adminHandler(async (req,reply,admin) => orNotFound(req,reply,await generateStudioTask(param(req,'id'),actorOf(admin)))));
  app.get('/api/admin/studio/drafts/:id', adminHandler(async (req,reply) => {
    const id=param(req,'id');
    const draft=await studioDraft(id);
    return orNotFound(req,reply,draft ? { ...draft, wordpress: await studioWordPressDetail(id) } : null);
  }));
  app.patch('/api/admin/studio/drafts/:id', adminHandler(async (req,reply,admin) => orNotFound(req,reply,await saveStudioDraft(param(req,'id'),body(req),actorOf(admin)))));
  app.post('/api/admin/studio/drafts/:id/review', adminHandler(async (req,reply,admin) => orNotFound(req,reply,await reviewStudioDraft(param(req,'id'),body(req),actorOf(admin)))));
  app.post('/api/admin/studio/drafts/:id/wordpress', adminHandler(async (req,reply,admin) => orNotFound(req,reply,await pushStudioWordPressDraft(param(req,'id'),body(req),actorOf(admin)))));
  app.get('/api/admin/studio/drafts/:id/export', adminHandler(async (req,reply) => {
    const value=await exportStudioDraft(param(req,'id'),q(req).format ?? 'md');
    if(!value)return orNotFound(req,reply,null);
    return reply.header('Content-Disposition',`attachment; filename="studio-${param(req,'id')}.${value.extension}"`).type(value.type).send(value.body);
  }));
}
