import type { FastifyInstance } from 'fastify';
import { actorOf } from '@aihot/backend/admin/auth';
import {
  getStudioPublishingSettings, setStudioPublishingSettings, publishStudioDraft,
  enqueueStudioMaterialPublication, listStudioPublishingReviews, actOnStudioPublishingReview,
} from '@aihot/backend/studio/studio-publishing';
import { studioDeliveryCapabilities } from '@aihot/backend/studio/studio-delivery';
import { adminHandler } from './admin-auth.ts';
import { body, orNotFound, param } from './admin.ts';

export function registerAdminStudioPublishing(app: FastifyInstance) {
  const root = '/api/admin/studio';
  app.get(`${root}/publishing/settings`, adminHandler(async () => ({
    ...await getStudioPublishingSettings(), delivery: studioDeliveryCapabilities(),
  })));
  app.put(`${root}/publishing/settings`, adminHandler(async (req, _reply, admin) =>
    setStudioPublishingSettings(body(req), actorOf(admin))));
  app.post(`${root}/drafts/:id/publish`, adminHandler(async (req, reply, admin) =>
    orNotFound(req, reply, await publishStudioDraft(param(req, 'id'), body(req), actorOf(admin)))));
  app.post(`${root}/materials/publish`, adminHandler(async (req, reply, admin) =>
    reply.code(202).send(await enqueueStudioMaterialPublication(body(req), actorOf(admin)))));
  app.get(`${root}/publishing/reviews`, adminHandler(async () => listStudioPublishingReviews()));
  app.post(`${root}/publishing/reviews/:id/action`, adminHandler(async (req, reply, admin) =>
    orNotFound(req, reply, await actOnStudioPublishingReview(param(req, 'id'), body(req), actorOf(admin)))));
}
