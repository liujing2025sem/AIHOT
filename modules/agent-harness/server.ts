// Composition boundary only. The original API owner supplies its session+CSRF guard and existing task authority.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Harness, type Project, type Submit } from "./backend/core.ts";
import type { ServerModule } from "../../packages/backend/src/modules.ts";

type Guard = (handler: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) => (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
export function registerHarnessRoutes(app: FastifyInstance, harness: Harness, guard: Guard, acceptOriginal: (task: Submit) => Promise<Submit>) {
  const root = "/api/admin/agent-harness";
  const identify = (req: FastifyRequest) => {
    const { project, task_id } = req.params as { project: Project; task_id: string };
    if (!["aihot", "csm"].includes(project)) throw new Error("unknown project");
    return { project, task_id };
  };
  app.post(`${root}/tasks`, guard(async req => {
    // Original Owner establishes/restores the bound task atomically BEFORE this adapter accepts it.
    const bound = await acceptOriginal(req.body as Submit);
    const task = harness.submit(bound);
    return { project: task.project, task_id: task.task_id, state: task.state };
  }));
  app.get(`${root}/:project/:task_id/status`, guard(async req => {
    const { project, task_id } = identify(req);
    const task = harness.status(project, task_id);
    return { project, task_id, state: task.state, cancellation: task.cancellation, attempt: task.attempt,
      error: task.error && { code: task.error.code, stage: task.error.stage, certainty: task.error.certainty, upstream_http_status: task.error.upstream_http_status } };
  }));
  app.post(`${root}/:project/:task_id/cancel`, guard(async req => {
    const { project, task_id } = identify(req);
    const task = await harness.cancel(project, task_id);
    return { project, task_id, state: task.state, cancellation: task.cancellation };
  }));
  app.post(`${root}/:project/:task_id/result`, guard(async req => {
    const { project, task_id } = identify(req);
    return harness.result(project, task_id, req.body as Parameters<Harness["result"]>[2]);
  }));
}

export function createHarnessModule(harness: Harness, originalAdminGuard: Guard, originalAccepted: Parameters<typeof registerHarnessRoutes>[3]): ServerModule {
  return { name: "agent-harness", http: app => registerHarnessRoutes(app, harness, originalAdminGuard, originalAccepted) };
}
