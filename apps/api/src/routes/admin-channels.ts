import type { FastifyInstance } from "fastify";
import { actorOf } from "@aihot/backend/admin/auth";
import { channelIdSchema, listChannels, testChannel, updateChannel, setChannelCalls } from "@aihot/backend/providers/channel";
import { z } from "zod";
import { adminHandler } from "./admin-auth.ts";

/** Mounted by the API's main entry; all reads and writes keep the existing admin/session/CSRF guard. */
export function registerAdminChannels(app: FastifyInstance) {
  app.get("/api/admin/channels", adminHandler(async () => listChannels()));
  app.put("/api/admin/channels/generation", adminHandler(async (req, _reply, admin) => {
    return setChannelCalls(z.object({ enabled: z.boolean() }).parse(req.body).enabled, actorOf(admin));
  }));
  app.put("/api/admin/channels/:id", adminHandler(async (req, _reply, admin) => {
    const id = channelIdSchema.parse((req.params as { id: string }).id);
    return updateChannel(id, req.body, actorOf(admin));
  }));
  app.post("/api/admin/channels/:id/test", adminHandler(async (req, _reply, admin) => {
    const id = channelIdSchema.parse((req.params as { id: string }).id);
    const key = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"].slice(0, 200) : undefined;
    return testChannel(id, req.body, actorOf(admin), key);
  }));
}
