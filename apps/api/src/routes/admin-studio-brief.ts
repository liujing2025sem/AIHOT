import type { FastifyInstance } from 'fastify';
import { actorOf } from '@aihot/backend/admin/auth';
import { composeStudioBrief, studioBriefStatus } from '@aihot/backend/studio/studio-brief';
import { adminHandler } from './admin-auth.ts';
import { body, orNotFound, param } from './admin.ts';

export function registerAdminStudioBrief(app: FastifyInstance) {
  app.post('/api/admin/studio/briefs', adminHandler(async (request, reply, admin) =>
    reply.code(202).send(await composeStudioBrief(body(request), actorOf(admin)))));
  app.get('/api/admin/studio/briefs/:id', adminHandler(async (request, reply) =>
    orNotFound(request, reply, await studioBriefStatus(param(request, 'id')))));
}
