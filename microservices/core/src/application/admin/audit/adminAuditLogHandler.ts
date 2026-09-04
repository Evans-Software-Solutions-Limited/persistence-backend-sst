import Elysia, { t } from "elysia";
import { adminGuard } from "../_adminGuard";
import { AdminAuditRepository } from "../../repositories/adminAuditRepository";

/** GET /admin/audit-log — newest first, filterable by entity. */
export const adminAuditLogHandler = new Elysia().use(adminGuard).get(
  "/admin/audit-log",
  async ({ query }) => ({
    data: await new AdminAuditRepository().list({
      entityType: query.entityType,
      entityId: query.entityId,
      limit: query.limit,
    }),
  }),
  {
    query: t.Object({
      entityType: t.Optional(t.String({ maxLength: 64 })),
      entityId: t.Optional(t.String({ maxLength: 128 })),
      limit: t.Optional(t.Numeric({ minimum: 1, maximum: 500 })),
    }),
  },
);
