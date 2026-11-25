import { and, asc, eq, isNull } from "drizzle-orm";
import {
  coachResourceAssignments,
  coachResources,
  ptClientRelationships,
} from "@persistence/db";
import type { SetupSectionHandler } from "../setupSections";
import { assignInTx, getOwnLive } from "./resourceRepository";

/**
 * Set-up section `resource` (PER-108's hook, design A D3; PER-122). A coach
 * prepares an invited client's profile with some of their own library
 * resources. On accept, each item becomes a live assignment on the new
 * relationship, exactly once per set-up item (the accept flow records the
 * assignment id on the item).
 *
 * Item shape: `{ refId: <coach's coach_resources.id>, config: {} }`.
 */
export const RESOURCE_SETUP_MAX_ITEMS = 20;

export const resourceSetupHandler: SetupSectionHandler = {
  maxItems: RESOURCE_SETUP_MAX_ITEMS,
  async validate(db, trainerId, item) {
    if (!item.refId) {
      return { ok: false, message: "A resource needs refId (one of yours)" };
    }
    const resource = await getOwnLive(db, trainerId, item.refId);
    if (!resource) {
      return { ok: false, message: "refId must be one of your resources" };
    }
    return {
      ok: true,
      item: { refId: resource.id, config: {}, sortOrder: item.sortOrder },
    };
  },
  async materialise(ctx, item) {
    if (!item.refId) return { refId: null };
    const resource = await getOwnLive(ctx.tx, ctx.trainerId, item.refId);
    // Removed from the library after set-up: nothing to give.
    if (!resource) return { refId: null };
    const { assignments } = await assignInTx(
      ctx.tx,
      ctx.trainerId,
      [resource],
      [{ clientId: ctx.clientId, relationshipId: ctx.relationshipId }],
      null,
    );
    return { refId: assignments[0]?.assignmentId ?? null };
  },
  async copyFromClient(db, trainerId, clientId) {
    const rows = await db
      .select({ resourceId: coachResourceAssignments.resourceId })
      .from(coachResourceAssignments)
      .innerJoin(
        ptClientRelationships,
        eq(ptClientRelationships.id, coachResourceAssignments.relationshipId),
      )
      .innerJoin(
        coachResources,
        eq(coachResources.id, coachResourceAssignments.resourceId),
      )
      .where(
        and(
          eq(coachResourceAssignments.trainerId, trainerId),
          eq(coachResourceAssignments.clientId, clientId),
          isNull(coachResourceAssignments.removedAt),
          eq(ptClientRelationships.status, "active"),
          eq(ptClientRelationships.trainerId, trainerId),
          eq(coachResources.trainerId, trainerId),
          isNull(coachResources.archivedAt),
        ),
      )
      .orderBy(
        asc(coachResourceAssignments.assignedAt),
        asc(coachResourceAssignments.id),
      )
      .limit(RESOURCE_SETUP_MAX_ITEMS);
    return rows.map((r, i) => ({
      refId: r.resourceId,
      config: {},
      sortOrder: i,
    }));
  },
};
