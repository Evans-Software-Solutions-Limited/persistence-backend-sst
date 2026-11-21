import { and, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  nutritionEntries,
  nutritionPlanAssignments,
  nutritionPlans,
  nutritionTargets,
  profiles,
  type NutritionPlan,
  type NutritionPlanAssignment,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { DbOrTx } from "../../repositories/personalRecordsRepository";
import {
  NutritionPlanRepository,
  assignmentDto,
  loadPlanDtos,
  type AssignmentDTO,
  type PlanDTO,
} from "../../repositories/nutritionPlanRepository";
import { isUuid } from "../../repositories/userMealRepository";
import {
  NotificationRepository,
  type AppNotification,
} from "../../repositories/notificationRepository";
import { NotificationDispatcher } from "../../notifications/push/notificationDispatcher";
import {
  auditTrainerAction,
  type DbTransaction,
} from "../../relationships/auditTrainerAction";
import type { CoachScope } from "../../relationships/resolveCoachScope";
import { stripNul } from "../../shared/stripNul";

/**
 * Design D (PER-118): a coach's plan sent to a client. The coach keeps owning
 * the plan, so every edit reaches the client live; the client sees
 * `updatedSinceSeen` until they mark the new revision seen. Logged food is a
 * snapshot and never changes.
 *
 * Every coach function takes a `CoachScope` from `resolveCoachScope` and
 * filters by the caller's `trainer_id` AND the relationship, so coach A never
 * sees or changes coach B's assignments for the same athlete.
 */

export const MAX_NOTE_LENGTH = 500;
/** Where the app lands for a plan push (mobile LEGACY_REDIRECTS: Fuel tab). */
export const MEAL_PLAN_DEEP_LINK = "/nutrition";

export function cleanNote(note: string | null | undefined): string | null {
  if (note === undefined || note === null) return null;
  const text = stripNul(note).trim();
  return text.length === 0 ? null : text.slice(0, MAX_NOTE_LENGTH);
}

async function coachName(
  db: DbOrTx,
  trainerId: string,
): Promise<string | null> {
  const rows = await db
    .select({ fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.id, trainerId))
    .limit(1);
  return rows[0]?.fullName ?? null;
}

/** The in-app row for "your coach sent you a plan", written in the caller's transaction. */
export async function createAssignedNotification(
  tx: DbOrTx,
  args: {
    trainerId: string;
    clientId: string;
    plan: Pick<NutritionPlan, "id" | "name">;
    assignmentId: string;
    note: string | null;
  },
): Promise<AppNotification> {
  const name = await coachName(tx, args.trainerId);
  return new NotificationRepository().create(
    args.clientId,
    {
      type: "meal_plan_assigned",
      title: name
        ? `${name} sent you a meal plan`
        : "Your coach sent you a meal plan",
      message: args.note ?? args.plan.name,
      data: {
        deepLink: MEAL_PLAN_DEEP_LINK,
        planId: args.plan.id,
        assignmentId: args.assignmentId,
        trainerId: args.trainerId,
      },
      relatedEntityType: "nutrition_plan",
      relatedEntityId: args.plan.id,
    },
    tx,
  );
}

export type AssignResult =
  | {
      ok: true;
      assignment: AssignmentDTO;
      /** True when this call created or re-sent the assignment. */
      created: boolean;
      afterCommit?: () => Promise<void>;
    }
  | { ok: false; error: "plan_not_found" };

/**
 * Send (or re-send) one of the coach's plans to a client, inside `tx`.
 * - A replayed `Idempotency-Key` returns the first assignment.
 * - A plan already `sent`/`added` on this relationship returns that one.
 * - A `dismissed` one is re-sent: back to `sent`, new note, push again.
 * - Otherwise a new `sent` assignment, an audit row and a push.
 */
export async function assignPlanInTx(
  tx: DbTransaction,
  scope: Pick<CoachScope, "trainerId" | "clientId" | "relationshipId">,
  planId: string,
  note: string | null,
  clientRequestId: string | null,
): Promise<AssignResult> {
  if (clientRequestId) {
    const replay = await tx
      .select()
      .from(nutritionPlanAssignments)
      .where(
        and(
          eq(nutritionPlanAssignments.trainerId, scope.trainerId),
          eq(nutritionPlanAssignments.clientRequestId, clientRequestId),
        ),
      )
      .limit(1);
    if (replay[0])
      return { ok: true, assignment: assignmentDto(replay[0]), created: false };
  }

  const plan = await new NutritionPlanRepository().getOwned(
    scope.trainerId,
    planId,
    tx,
  );
  if (!plan) return { ok: false, error: "plan_not_found" };

  const live = await tx
    .select()
    .from(nutritionPlanAssignments)
    .where(
      and(
        eq(nutritionPlanAssignments.planId, plan.id),
        eq(nutritionPlanAssignments.relationshipId, scope.relationshipId),
        ne(nutritionPlanAssignments.status, "removed"),
      ),
    )
    .for("update")
    .limit(1);

  let row: NutritionPlanAssignment;
  if (live[0] && live[0].status !== "dismissed") {
    return { ok: true, assignment: assignmentDto(live[0]), created: false };
  } else if (live[0]) {
    const now = new Date();
    [row] = await tx
      .update(nutritionPlanAssignments)
      .set({
        status: "sent",
        note,
        sentAt: now,
        seenRevision: plan.revision,
        updatedAt: now,
      })
      .where(eq(nutritionPlanAssignments.id, live[0].id))
      .returning();
  } else {
    const inserted = await tx
      .insert(nutritionPlanAssignments)
      .values({
        planId: plan.id,
        trainerId: scope.trainerId,
        clientId: scope.clientId,
        relationshipId: scope.relationshipId,
        note,
        status: "sent",
        seenRevision: plan.revision,
        clientRequestId,
      })
      // Target-less: matches the partial live index and the key index.
      .onConflictDoNothing()
      .returning();
    if (!inserted[0]) {
      // A concurrent send won; answer with it.
      const winner = await tx
        .select()
        .from(nutritionPlanAssignments)
        .where(
          and(
            eq(nutritionPlanAssignments.planId, plan.id),
            eq(nutritionPlanAssignments.relationshipId, scope.relationshipId),
            ne(nutritionPlanAssignments.status, "removed"),
          ),
        )
        .orderBy(desc(nutritionPlanAssignments.sentAt))
        .limit(1);
      return {
        ok: true,
        assignment: assignmentDto(winner[0]!),
        created: false,
      };
    }
    row = inserted[0];
  }

  await auditTrainerAction({
    trainerId: scope.trainerId,
    clientId: scope.clientId,
    actionType: "meal_plan_assigned",
    targetTable: "nutrition_plan_assignments",
    targetRowId: row.id,
    payload: { planId: plan.id, note },
    tx,
  });
  const notification = await createAssignedNotification(tx, {
    trainerId: scope.trainerId,
    clientId: scope.clientId,
    plan,
    assignmentId: row.id,
    note,
  });
  return {
    ok: true,
    assignment: assignmentDto(row),
    created: true,
    afterCommit: () =>
      new NotificationDispatcher().dispatchExisting(
        scope.clientId,
        notification,
      ),
  };
}

export async function assignPlan(
  scope: CoachScope,
  planId: string,
  note: string | null,
  clientRequestId: string | null,
): Promise<AssignResult> {
  if (!isUuid(planId)) return { ok: false, error: "plan_not_found" };
  const result = await getDb().transaction((tx) =>
    assignPlanInTx(tx, scope, planId, note, clientRequestId),
  );
  if (result.ok && result.afterCommit) await result.afterCommit();
  return result;
}

export type ClientAssignmentView = AssignmentDTO & {
  plan: PlanDTO;
  updatedSinceSeen: boolean;
  /** Distinct days with food logged from this plan (UTC days). */
  usedDays: number;
  /** Entries logged from this plan in the last 7 days. */
  loggedThisWeek: number;
};

export type Target = {
  dailyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  setByUserId: string | null;
} | null;

/**
 * `GET /trainers/me/clients/:clientId/meal-plans`: this coach's live
 * assignments for this client, with usage, and the client's current target
 * for Target · Planned · To plan.
 */
export async function listClientAssignments(
  scope: CoachScope,
  now: Date = new Date(),
): Promise<{
  assignments: ClientAssignmentView[];
  target: Target;
  asOf: string;
}> {
  const db = getDb();
  const rows = await db
    .select({ a: nutritionPlanAssignments, plan: nutritionPlans })
    .from(nutritionPlanAssignments)
    .innerJoin(
      nutritionPlans,
      eq(nutritionPlans.id, nutritionPlanAssignments.planId),
    )
    .where(
      and(
        eq(nutritionPlanAssignments.trainerId, scope.trainerId),
        eq(nutritionPlanAssignments.relationshipId, scope.relationshipId),
        eq(nutritionPlanAssignments.clientId, scope.clientId),
        ne(nutritionPlanAssignments.status, "removed"),
        isNull(nutritionPlans.archivedAt),
      ),
    )
    .orderBy(desc(nutritionPlanAssignments.sentAt));

  const planIds = rows.map((r) => r.plan.id);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const usage =
    planIds.length > 0
      ? await db
          .select({
            planId: nutritionEntries.sourcePlanId,
            usedDays: sql<number>`count(distinct (${nutritionEntries.loggedAt} at time zone 'UTC')::date)`,
            loggedThisWeek: sql<number>`count(*) filter (where ${nutritionEntries.loggedAt} >= ${weekAgo.toISOString()})`,
          })
          .from(nutritionEntries)
          .where(
            and(
              eq(nutritionEntries.userId, scope.clientId),
              inArray(nutritionEntries.sourcePlanId, planIds),
            ),
          )
          .groupBy(nutritionEntries.sourcePlanId)
      : [];
  const usageByPlan = new Map(usage.map((u) => [u.planId, u]));
  const dtos = await loadPlanDtos(
    db,
    rows.map((r) => r.plan),
    scope.trainerId,
  );
  const dtoById = new Map(dtos.map((d) => [d.id, d]));

  const targetRows = await db
    .select()
    .from(nutritionTargets)
    .where(eq(nutritionTargets.userId, scope.clientId))
    .limit(1);
  const t = targetRows[0];

  return {
    assignments: rows.map((r) => ({
      ...assignmentDto(r.a),
      plan: dtoById.get(r.plan.id)!,
      updatedSinceSeen: r.plan.revision > r.a.seenRevision,
      usedDays: Number(usageByPlan.get(r.plan.id)?.usedDays ?? 0),
      loggedThisWeek: Number(usageByPlan.get(r.plan.id)?.loggedThisWeek ?? 0),
    })),
    target: t
      ? {
          dailyKcal: Number(t.dailyKcal),
          proteinG: Number(t.proteinG),
          carbsG: Number(t.carbsG),
          fatG: Number(t.fatG),
          setByUserId: t.setByUserId,
        }
      : null,
    asOf: now.toISOString(),
  };
}

const scopedAssignment = (scope: CoachScope, assignmentId: string) =>
  and(
    eq(nutritionPlanAssignments.id, assignmentId),
    eq(nutritionPlanAssignments.trainerId, scope.trainerId),
    eq(nutritionPlanAssignments.relationshipId, scope.relationshipId),
    eq(nutritionPlanAssignments.clientId, scope.clientId),
  );

/** Change the note on a live assignment. Null when it isn't this coach's live assignment. */
export async function patchAssignmentNote(
  scope: CoachScope,
  assignmentId: string,
  note: string | null,
): Promise<AssignmentDTO | null> {
  if (!isUuid(assignmentId)) return null;
  const [row] = await getDb()
    .update(nutritionPlanAssignments)
    .set({ note, updatedAt: new Date() })
    .where(
      and(
        scopedAssignment(scope, assignmentId),
        ne(nutritionPlanAssignments.status, "removed"),
      ),
    )
    .returning();
  return row ? assignmentDto(row) : null;
}

/**
 * Remove: the client stops seeing the plan; it stays in the coach's library.
 * Idempotent: an already-removed assignment is fine. False when it isn't this
 * coach's assignment for this client.
 */
export async function removeAssignment(
  scope: CoachScope,
  assignmentId: string,
): Promise<boolean> {
  if (!isUuid(assignmentId)) return false;
  const db = getDb();
  const rows = await db
    .select({ status: nutritionPlanAssignments.status })
    .from(nutritionPlanAssignments)
    .where(scopedAssignment(scope, assignmentId))
    .limit(1);
  if (!rows[0]) return false;
  if (rows[0].status !== "removed") {
    const now = new Date();
    await db
      .update(nutritionPlanAssignments)
      .set({ status: "removed", removedAt: now, updatedAt: now })
      .where(scopedAssignment(scope, assignmentId));
  }
  return true;
}

/**
 * The client's own answer: "Add to my plans" (`added`), "Not now"
 * (`dismissed`), and/or "I've seen revision N". `seenRevision` only moves
 * forward and never past the plan's revision. Null when the client has no
 * live assignment of this plan on an active relationship.
 */
export async function clientUpdateAssignment(
  clientId: string,
  planId: string,
  update: { status?: "added" | "dismissed"; seenRevision?: number },
): Promise<{ assignment: AssignmentDTO; updatedSinceSeen: boolean } | null> {
  if (!isUuid(planId)) return null;
  const repo = new NutritionPlanRepository();
  const db = getDb();
  const assignment = await repo.findClientAssignment(clientId, planId, [
    "sent",
    "added",
    "dismissed",
  ]);
  if (!assignment) return null;
  const planRows = await db
    .select({ revision: nutritionPlans.revision })
    .from(nutritionPlans)
    .where(
      and(eq(nutritionPlans.id, planId), isNull(nutritionPlans.archivedAt)),
    )
    .limit(1);
  if (!planRows[0]) return null;
  const revision = planRows[0].revision;

  const now = new Date();
  const patch: Partial<NutritionPlanAssignment> = { updatedAt: now };
  if (update.status) {
    patch.status = update.status;
    if (update.status === "added" && !assignment.addedAt) patch.addedAt = now;
  }
  if (update.seenRevision !== undefined) {
    patch.seenRevision = Math.max(
      assignment.seenRevision,
      Math.min(update.seenRevision, revision),
    );
  }
  const [row] = await db
    .update(nutritionPlanAssignments)
    .set(patch)
    .where(
      and(
        eq(nutritionPlanAssignments.id, assignment.id),
        eq(nutritionPlanAssignments.clientId, clientId),
        ne(nutritionPlanAssignments.status, "removed"),
      ),
    )
    .returning();
  if (!row) return null;
  return {
    assignment: assignmentDto(row),
    updatedSinceSeen: revision > row.seenRevision,
  };
}

/** Entries logged from `planId` by `userId` since `since` — used by tests and the coach view. */
export async function countPlanEntries(
  userId: string,
  planId: string,
  since: Date,
): Promise<number> {
  const rows = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(nutritionEntries)
    .where(
      and(
        eq(nutritionEntries.userId, userId),
        eq(nutritionEntries.sourcePlanId, planId),
        gte(nutritionEntries.loggedAt, since),
      ),
    );
  return Number(rows[0]?.n ?? 0);
}
