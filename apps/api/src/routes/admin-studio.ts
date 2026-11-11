import type { FastifyInstance } from 'fastify';
import { actorOf } from '@aihot/backend/admin/auth';
import { adminHandler } from './admin-auth.ts';
import { param, body, q, orNotFound } from './admin.ts';
import { studioOverview, studioMaterial, createStudioTask, bindStudioTaskMaterials, exportStudioTask, receiveStudioTask, generateStudioTask, studioDraft, studioDraftFigures, applyStudioReviewEdit, saveStudioDraft, reviewStudioDraft, exportStudioDraft, collectStudioSource, extractStudioMaterial } from '@aihot/backend/studio/studio';
import { studioReviewMetrics, recordStudioReview, setStudioReviewPolicy } from '@aihot/backend/studio/studio-review';
import { pushStudioWordPressDraft, studioWordPressDetail } from '@aihot/backend/studio/studio-wordpress';
import { registerAdminStudioPlanning } from './admin-studio-planning.ts';
import { registerAdminStudioPublishing } from './admin-studio-publishing.ts';
import { registerAdminStudioBrief } from './admin-studio-brief.ts';
import { studioDeliveryCapabilities } from '@aihot/backend/studio/studio-delivery';
import { studioCovers, studioCoverAsset, uploadStudioCover, selectStudioCover, removeStudioCover, confirmStudioDelivery } from '@aihot/backend/studio/studio-covers';
import { exportStudioManualPackage } from '@aihot/backend/studio/studio-manual-package';
export function registerAdminStudio(app: FastifyInstance) {
  registerAdminStudioPlanning(app);
  registerAdminStudioPublishing(app);
  registerAdminStudioBrief(app);
  app.get('/api/admin/studio/capabilities',adminHandler(async()=>({delivery:studioDeliveryCapabilities()})));
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
    return orNotFound(req,reply,draft ? { ...draft, wordpress: await studioWordPressDetail(id), delivery: studioDeliveryCapabilities() } : null);
  }));
  app.patch('/api/admin/studio/drafts/:id', adminHandler(async (req,reply,admin) => orNotFound(req,reply,await saveStudioDraft(param(req,'id'),body(req),actorOf(admin)))));
  app.get('/api/admin/studio/drafts/:id/figures',adminHandler(async(req,reply)=>orNotFound(req,reply,await studioDraftFigures(param(req,'id')))));
  app.get('/api/admin/studio/drafts/:id/covers',adminHandler(async(req,reply)=>orNotFound(req,reply,await studioCovers(param(req,'id')))));
  app.get('/api/admin/studio/drafts/:id/covers/:hash',adminHandler(async(req,reply)=>{
    const image=await studioCoverAsset(param(req,'id'),param(req,'hash'));
    if(!image)return orNotFound(req,reply,null);
    return reply.header('Cache-Control','private, no-store').type('image/png').send(image);
  }));
  app.post('/api/admin/studio/drafts/:id/covers', {bodyLimit:6*1024*1024},adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await uploadStudioCover(param(req,'id'),body(req),actorOf(admin)))));
  app.post('/api/admin/studio/drafts/:id/cover-selection',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await selectStudioCover(param(req,'id'),body(req),actorOf(admin)))));
  app.delete('/api/admin/studio/drafts/:id/covers/:hash',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await removeStudioCover(param(req,'id'),param(req,'hash'),body(req),actorOf(admin)))));
  app.post('/api/admin/studio/drafts/:id/delivery-confirmation',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await confirmStudioDelivery(param(req,'id'),body(req),actorOf(admin)))));
  app.post('/api/admin/studio/drafts/:id/apply-edit',adminHandler(async(req,reply,admin)=>orNotFound(req,reply,await applyStudioReviewEdit(param(req,'id'),body(req),actorOf(admin)))));
  app.post('/api/admin/studio/drafts/:id/review', adminHandler(async (req,reply,admin) => orNotFound(req,reply,await reviewStudioDraft(param(req,'id'),body(req),actorOf(admin)))));
  app.post('/api/admin/studio/drafts/:id/wordpress', adminHandler(async (req,reply,admin) => orNotFound(req,reply,await pushStudioWordPressDraft(param(req,'id'),body(req),actorOf(admin)))));
  app.get('/api/admin/studio/drafts/:id/export', adminHandler(async (req,reply) => {
    const query=q(req);
    const value=query.format==='bundle' ? await exportStudioManualPackage(param(req,'id'),query) : await exportStudioDraft(param(req,'id'),query.format ?? 'md',query.version===undefined?undefined:Number(query.version));
    if(!value)return orNotFound(req,reply,null);
    return reply.header('Content-Disposition',`attachment; filename="studio-${param(req,'id')}.${value.extension}"`).type(value.type).send(value.body);
  }));
}
