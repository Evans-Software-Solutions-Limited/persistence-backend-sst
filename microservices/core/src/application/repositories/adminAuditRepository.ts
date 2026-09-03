import { and, desc, eq } from "drizzle-orm";
import { adminAuditLog, type AdminAuditLogEntry } from "@persistence/db";
import { getDb } from "@persistence/db/client";

/**
 * Append-only audit trail for every `/admin/*` mutation (spec-32 § 5 admin
 * panel, § 10). Never updated or deleted from application code.
 */
export interface AuditInput {
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
}

export class AdminAuditRepository {
  async record(input: AuditInput): Promise<void> {
    const db = getDb();
    await db.insert(adminAuditLog).values({
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      reason: input.reason ?? null,
    });
  }

  async list(filter: {
    entityType?: string;
    entityId?: string;
    limit?: number;
  }): Promise<AdminAuditLogEntry[]> {
    const db = getDb();
    const conditions = [];
    if (filter.entityType)
      conditions.push(eq(adminAuditLog.entityType, filter.entityType));
    if (filter.entityId)
      conditions.push(eq(adminAuditLog.entityId, filter.entityId));
    return db
      .select()
      .from(adminAuditLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(adminAuditLog.createdAt))
      .limit(Math.min(filter.limit ?? 100, 500));
  }
}
