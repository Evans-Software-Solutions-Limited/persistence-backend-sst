import { and, eq, gt, inArray, or } from "drizzle-orm";
import { getDb, exercises, workouts, workoutExercises } from "@persistence/db";
import {
  togetherTemplateShares as shares,
  togetherTemplateCopies as copies,
  type SharedTemplatePlan,
} from "@persistence/db";
import {
  assertTogetherPaid,
  requireTogether,
  replayMutation,
  withActors,
  type TogetherTx,
} from "./shared";
import { materializeTogetherExercise } from "./exerciseRecording";
import { areFriends } from "../social/socialRepository";
import { nextPage, pagePosition } from "../social/pagination";
import { ExerciseRepository } from "../repositories/exerciseRepository";
import { resolveEstimatedDurationMinutes } from "../workouts/estimateDuration";
/** Sharing grants no access to another coach's custom catalogue. Both parties must already see every exercise. */
async function validateSharedExercises(
  tx: TogetherTx,
  sender: string,
  recipient: string,
  plan: SharedTemplatePlan,
) {
  const ids = [...new Set(plan.exercises.map((e) => e.exerciseId))];
  const repo = new ExerciseRepository();
  const found = ids.length
    ? await tx
        .select({
          id: exercises.id,
          createdBy: exercises.createdBy,
          name: exercises.name,
          category: exercises.category,
          primaryMuscles: exercises.primaryMuscles,
        })
        .from(exercises)
        .where(
          and(
            inArray(exercises.id, ids),
            repo.buildVisibilityCondition(sender),
            repo.buildVisibilityCondition(recipient),
          ),
        )
        .for("key share")
    : [];
  requireTogether(found.length === ids.length, "INVALID_EXERCISE", 400);
  return found;
}
async function permitted(tx: TogetherTx, a: string, b: string) {
  requireTogether(await areFriends(tx, a, b), "FORBIDDEN", 403);
  await assertTogetherPaid(tx, a);
  await assertTogetherPaid(tx, b);
}
async function load(id: string) {
  const [row] = await getDb().select().from(shares).where(eq(shares.id, id));
  requireTogether(row, "NOT_FOUND", 404);
  return row;
}
async function access(tx: TogetherTx, actor: string, id: string) {
  const [row] = await tx.select().from(shares).where(eq(shares.id, id));
  requireTogether(
    row && [row.senderId, row.recipientId].includes(actor),
    "NOT_FOUND",
    404,
  );
  requireTogether(!row.revoked, "FORBIDDEN", 403);
  requireTogether(
    await areFriends(tx, row.senderId, row.recipientId),
    "FORBIDDEN",
    403,
  );
  return row;
}
export const templatesRepository = {
  create(
    actor: string,
    key: string,
    recipientUserId: string,
    plan: SharedTemplatePlan,
  ) {
    return withActors([actor, recipientUserId], async (tx) => {
      await permitted(tx, actor, recipientUserId);
      return replayMutation(
        tx,
        actor,
        "template:create",
        key,
        { recipientUserId, plan },
        async () => {
          await validateSharedExercises(tx, actor, recipientUserId, plan);
          requireTogether(
            new Set(plan.exercises.map((e) => e.planExerciseId)).size ===
              plan.exercises.length,
            "INVALID_PLAN",
            400,
          );
          const sanitized = {
            name: plan.name,
            exercises: plan.exercises.map((e) => ({
              planExerciseId: e.planExerciseId,
              exerciseId: e.exerciseId,
              order: e.order,
              targetSets: e.targetSets,
              ...(e.targetReps === undefined
                ? {}
                : { targetReps: e.targetReps }),
            })),
          };
          const [row] = await tx
            .insert(shares)
            .values({
              senderId: actor,
              recipientId: recipientUserId,
              plan: sanitized,
            })
            .returning();
          return { shareId: row.id };
        },
      );
    });
  },
  list(actor: string, limit = 20, cursor?: string) {
    return withActors([actor], async (tx) => {
      const scope = "templates";
      const rows = await tx
        .select()
        .from(shares)
        .where(
          and(
            or(eq(shares.senderId, actor), eq(shares.recipientId, actor)),
            eq(shares.revoked, false),
            gt(shares.id, pagePosition(actor, scope, cursor)),
          ),
        )
        .orderBy(shares.id)
        .limit(limit + 1);
      const data = [];
      for (const row of rows.slice(0, limit))
        if (await areFriends(tx, row.senderId, row.recipientId)) data.push(row);
      return {
        data,
        nextCursor:
          rows.length > limit
            ? nextPage(actor, scope, rows[limit - 1].id)
            : null,
      };
    });
  },
  async get(actor: string, id: string) {
    const initial = await load(id);
    return withActors([initial.senderId, initial.recipientId], (tx) =>
      access(tx, actor, id),
    );
  },
  async copy(actor: string, id: string, key: string) {
    const initial = await load(id);
    return withActors([initial.senderId, initial.recipientId], async (tx) => {
      const row = await access(tx, actor, id);
      requireTogether(actor === row.recipientId, "FORBIDDEN", 403);
      await permitted(tx, row.senderId, row.recipientId);
      return replayMutation(
        tx,
        actor,
        `template:copy:${id}`,
        key,
        {},
        async () => {
          const [existing] = await tx
            .select()
            .from(copies)
            .where(and(eq(copies.shareId, id), eq(copies.recipientId, actor)));
          if (existing) return { workoutId: existing.workoutId };
          const sources = await validateSharedExercises(
            tx,
            row.senderId,
            row.recipientId,
            row.plan,
          );
          const ownedIds = new Map<string, string>();
          // Share the history adapter's stable recipient-owned identity, so
          // deleting a foreign source cannot cascade an independent copied plan.
          for (const source of sources)
            ownedIds.set(
              source.id,
              await materializeTogetherExercise(tx, actor, source.id, {
                name: source.name,
                category: source.category ?? "strength",
                primaryMuscles: source.primaryMuscles ?? [],
                createdBy: source.createdBy,
              }),
            );
          const input = row.plan.exercises.map((e) => ({
            exerciseId: ownedIds.get(e.exerciseId)!,
            sortOrder: e.order,
            targetSets: e.targetSets,
            targetRepsMin: e.targetReps ?? 1,
            targetRepsMax: e.targetReps ?? 1,
          }));
          const [workout] = await tx
            .insert(workouts)
            .values({
              createdBy: actor,
              name: row.plan.name,
              visibility: "private",
              estimatedDurationMinutes: resolveEstimatedDurationMinutes(
                undefined,
                input,
              ),
            })
            .returning();
          if (input.length)
            await tx
              .insert(workoutExercises)
              .values(input.map((e) => ({ ...e, workoutId: workout.id })));
          await tx
            .insert(copies)
            .values({ shareId: id, recipientId: actor, workoutId: workout.id });
          return { workoutId: workout.id };
        },
      );
    });
  },
  async revoke(actor: string, id: string, key: string) {
    const initial = await load(id);
    return withActors([initial.senderId, initial.recipientId], async (tx) => {
      requireTogether(initial.senderId === actor, "FORBIDDEN", 403);
      return replayMutation(
        tx,
        actor,
        `template:revoke:${id}`,
        key,
        {},
        async () => {
          await tx
            .update(shares)
            .set({ revoked: true })
            .where(eq(shares.id, id));
          return { revoked: true };
        },
      );
    });
  },
};
