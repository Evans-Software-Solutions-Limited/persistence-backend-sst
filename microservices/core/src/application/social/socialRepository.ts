import { and, eq, gt, ilike, isNull, ne, or, sql } from "drizzle-orm";
import {
  getDb,
  friendships,
  profiles,
  ptClientRelationships,
} from "@persistence/db";
import {
  socialBlocks,
  socialRequestDecisions,
  togetherReceipts,
  socialProfiles,
  socialReports,
  togetherTemplateShares,
} from "@persistence/db";
import {
  withActors,
  replayMutation,
  requireTogether,
  type TogetherTx,
} from "../together/shared";
import { nextPage, pagePosition } from "./pagination";

const pair = (a: string, b: string) =>
  or(
    and(eq(friendships.userId, a), eq(friendships.friendId, b)),
    and(eq(friendships.userId, b), eq(friendships.friendId, a)),
  );
export async function canInteract(tx: TogetherTx, a: string, b: string) {
  if (
    (
      await tx
        .select({ id: friendships.id })
        .from(friendships)
        .where(and(pair(a, b), eq(friendships.status, "blocked")))
        .limit(1)
    ).length
  )
    return false;
  return !(
    await tx
      .select()
      .from(socialBlocks)
      .where(
        or(
          and(eq(socialBlocks.actorId, a), eq(socialBlocks.subjectId, b)),
          and(eq(socialBlocks.actorId, b), eq(socialBlocks.subjectId, a)),
        ),
      )
      .limit(1)
  ).length;
}
export async function areFriends(tx: TogetherTx, a: string, b: string) {
  return (
    (await canInteract(tx, a, b)) &&
    !!(
      await tx
        .select()
        .from(friendships)
        .where(and(pair(a, b), eq(friendships.status, "accepted")))
        .limit(1)
    ).length
  );
}
async function targetExists(tx: TogetherTx, actor: string, target: string) {
  requireTogether(actor !== target, "FORBIDDEN", 403);
  requireTogether(
    !!(
      await tx
        .select({ id: profiles.id })
        .from(profiles)
        .where(and(eq(profiles.id, target), isNull(profiles.deletedAt)))
        .limit(1)
    ).length,
    "NOT_FOUND",
    404,
  );
}
async function invalidate(
  tx: TogetherTx,
  actor: string,
  target: string,
  reason: "block" | "friend_removed",
) {
  // Preserve historical safety decisions when normalizing old friendship rows.
  const legacy = await tx
    .select()
    .from(friendships)
    .where(and(pair(actor, target), eq(friendships.status, "blocked")));
  for (const row of legacy)
    await tx
      .insert(socialBlocks)
      .values({
        actorId: row.initiatedBy,
        subjectId: row.initiatedBy === row.userId ? row.friendId : row.userId,
      })
      .onConflictDoNothing();
  await tx.delete(friendships).where(pair(actor, target));
  await tx
    .update(togetherTemplateShares)
    .set({ revoked: true })
    .where(
      or(
        and(
          eq(togetherTemplateShares.senderId, actor),
          eq(togetherTemplateShares.recipientId, target),
        ),
        and(
          eq(togetherTemplateShares.senderId, target),
          eq(togetherTemplateShares.recipientId, actor),
        ),
      ),
    );
  // Lazy import keeps common social policy usable by session authorization.
  const { revokePair } = await import("../together/togetherRepository");
  await revokePair(tx, actor, target, reason);
}
export const socialRepository = {
  profile(actor: string, key: string, discoverable: boolean) {
    return withActors([actor], (tx) =>
      replayMutation(tx, actor, "profile", key, { discoverable }, async () => {
        await tx
          .insert(socialProfiles)
          .values({ userId: actor, discoverable })
          .onConflictDoUpdate({
            target: socialProfiles.userId,
            set: { discoverable },
          });
        return { discoverable };
      }),
    );
  },
  people(actor: string, q: string, limit = 20, cursor?: string) {
    return withActors([actor], async (tx) => {
      q = q.trim();
      requireTogether(q.length >= 2 && q.length <= 100, "INVALID_QUERY", 400);

      const scope = `people:${q}`;
      const after = pagePosition(actor, scope, cursor);
      const data = await tx
        .select({
          userId: profiles.id,
          displayName: profiles.fullName,
          avatarUrl: profiles.avatarUrl,
        })
        .from(profiles)
        .innerJoin(socialProfiles, eq(socialProfiles.userId, profiles.id))
        .where(
          and(
            eq(socialProfiles.discoverable, true),
            isNull(profiles.deletedAt),
            ne(profiles.id, actor),
            gt(profiles.id, after),
            ilike(profiles.fullName, `%${q.replace(/[\\%_]/g, "\\$&")}%`),
            sql`not exists (select 1 from social_blocks b where (b.actor_id = ${actor} and b.subject_id = ${profiles.id}) or (b.subject_id = ${actor} and b.actor_id = ${profiles.id}))`,
            sql`not exists (select 1 from friendships f where f.status = 'blocked' and ((f.user_id = ${actor} and f.friend_id = ${profiles.id}) or (f.friend_id = ${actor} and f.user_id = ${profiles.id})))`,
          ),
        )
        .orderBy(profiles.id)
        .limit(limit + 1);
      return {
        data: data.slice(0, limit),
        nextCursor:
          data.length > limit
            ? nextPage(actor, scope, data[limit - 1].userId)
            : null,
      };
    });
  },
  list(
    actor: string,
    status: "pending" | "accepted",
    limit = 20,
    cursor?: string,
  ) {
    return withActors([actor], async (tx) => {
      const scope = `relationships:${status}`;
      const data = await tx
        .select()
        .from(friendships)
        .where(
          and(
            or(eq(friendships.userId, actor), eq(friendships.friendId, actor)),
            eq(friendships.status, status),
            gt(friendships.id, pagePosition(actor, scope, cursor)),
          ),
        )
        .orderBy(friendships.id)
        .limit(limit + 1);
      const visible = [];
      for (const row of data.slice(0, limit))
        if (await canInteract(tx, row.userId, row.friendId)) visible.push(row);
      return {
        data: visible,
        nextCursor:
          data.length > limit
            ? nextPage(actor, scope, data[limit - 1].id)
            : null,
      };
    });
  },
  request(actor: string, target: string, key: string) {
    return withActors([actor, target], async (tx) => {
      await targetExists(tx, actor, target);
      requireTogether(await canInteract(tx, actor, target), "FORBIDDEN", 403);
      const [visible] = await tx
        .select()
        .from(socialProfiles)
        .where(eq(socialProfiles.userId, target));
      requireTogether(visible?.discoverable, "NOT_FOUND", 404);
      return replayMutation(
        tx,
        actor,
        "request",
        key,
        { userId: target },
        async () => {
          const [existing] = await tx
            .select()
            .from(friendships)
            .where(pair(actor, target))
            .limit(1);
          if (existing)
            return { requestId: existing.id, status: existing.status };
          const [row] = await tx
            .insert(friendships)
            .values({
              userId: [actor, target].sort()[0],
              friendId: [actor, target].sort()[1],
              initiatedBy: actor,
              status: "pending",
            })
            .returning();
          return { requestId: row.id, status: row.status };
        },
      );
    });
  },
  async decision(
    actor: string,
    id: string,
    key: string,
    decision: "accept" | "reject",
  ) {
    let [initial] = await getDb()
      .select()
      .from(friendships)
      .where(eq(friendships.id, id));
    if (!initial) {
      const [deleted] = await getDb()
        .select()
        .from(socialRequestDecisions)
        .where(eq(socialRequestDecisions.id, id));
      if (deleted)
        initial = {
          ...deleted,
          status: "pending",
          createdAt: null,
          updatedAt: null,
        };
    }
    requireTogether(
      initial &&
        initial.initiatedBy !== actor &&
        [initial.userId, initial.friendId].includes(actor),
      "NOT_FOUND",
      404,
    );
    return withActors([initial.userId, initial.friendId], async (tx) => {
      requireTogether(
        await canInteract(tx, initial.userId, initial.friendId),
        "FORBIDDEN",
        403,
      );
      const [current] = await tx
        .select()
        .from(friendships)
        .where(eq(friendships.id, id));

      return replayMutation(
        tx,
        actor,
        `decision:${id}`,
        key,
        { decision },
        async () => {
          requireTogether(current?.status === "pending", "INVALID_STATE", 409);
          if (decision === "accept")
            await tx
              .update(friendships)
              .set({ status: "accepted", updatedAt: new Date() })
              .where(eq(friendships.id, id));
          else {
            await tx
              .insert(socialRequestDecisions)
              .values({
                id: current.id,
                userId: current.userId,
                friendId: current.friendId,
                initiatedBy: current.initiatedBy,
              })
              .onConflictDoNothing();
            await tx.delete(friendships).where(eq(friendships.id, id));
          }
          return {
            requestId: id,
            status: decision === "accept" ? "accepted" : "rejected",
          };
        },
      );
    });
  },
  remove(actor: string, target: string, key: string) {
    return withActors([actor, target], async (tx) => {
      await targetExists(tx, actor, target);
      const [relationship] = await tx
        .select({ id: friendships.id })
        .from(friendships)
        .where(
          and(
            pair(actor, target),
            or(
              eq(friendships.status, "accepted"),
              eq(friendships.status, "pending"),
            ),
          ),
        )
        .limit(1);
      const [receipt] = await tx
        .select({ key: togetherReceipts.key })
        .from(togetherReceipts)
        .where(
          and(
            eq(togetherReceipts.actorId, actor),
            eq(togetherReceipts.route, `remove:${target}`),
            eq(togetherReceipts.key, key),
          ),
        )
        .limit(1);
      requireTogether(relationship || receipt, "NOT_FOUND", 404);
      return replayMutation(
        tx,
        actor,
        `remove:${target}`,
        key,
        {},
        async () => {
          await invalidate(tx, actor, target, "friend_removed");
          return { removed: true };
        },
      );
    });
  },
  block(actor: string, target: string, key: string, blocked: boolean) {
    return withActors([actor, target], async (tx) => {
      await targetExists(tx, actor, target);
      return replayMutation(
        tx,
        actor,
        `block:${target}:${blocked}`,
        key,
        {},
        async () => {
          if (blocked) {
            await tx
              .insert(socialBlocks)
              .values({ actorId: actor, subjectId: target })
              .onConflictDoNothing();
            await invalidate(tx, actor, target, "block");
          } else {
            await tx
              .delete(friendships)
              .where(
                and(
                  pair(actor, target),
                  eq(friendships.status, "blocked"),
                  eq(friendships.initiatedBy, actor),
                ),
              );
            await tx
              .delete(socialBlocks)
              .where(
                and(
                  eq(socialBlocks.actorId, actor),
                  eq(socialBlocks.subjectId, target),
                ),
              );
          }
          return { blocked };
        },
      );
    });
  },
  report(
    actor: string,
    key: string,
    body: {
      subjectUserId: string;
      context: "together" | "coach";
      resourceId?: string;
      reason: string;
      details?: string;
    },
  ) {
    return withActors([actor, body.subjectUserId], async (tx) => {
      await targetExists(tx, actor, body.subjectUserId);
      const { canReportTogether } =
        await import("../together/togetherRepository");
      const authorized =
        body.context === "together"
          ? await canReportTogether(
              tx,
              actor,
              body.subjectUserId,
              body.resourceId,
            )
          : !!(
              await tx
                .select()
                .from(ptClientRelationships)
                .where(
                  and(
                    or(
                      and(
                        eq(ptClientRelationships.trainerId, actor),
                        eq(ptClientRelationships.clientId, body.subjectUserId),
                      ),
                      and(
                        eq(ptClientRelationships.clientId, actor),
                        eq(ptClientRelationships.trainerId, body.subjectUserId),
                      ),
                    ),
                    body.resourceId
                      ? eq(ptClientRelationships.id, body.resourceId)
                      : undefined,
                  ),
                )
                .limit(1)
            ).length;
      requireTogether(authorized, "NOT_FOUND", 404);
      return replayMutation(tx, actor, "report", key, body, async () => {
        const [row] = await tx
          .insert(socialReports)
          .values({
            actorId: actor,
            subjectId: body.subjectUserId,
            context: body.context,
            resourceId: body.resourceId,
            reason: body.reason,
            details: body.details,
          })
          .returning({ id: socialReports.id });
        return { reportId: row.id };
      });
    });
  },
  moderation(actor: string, limit = 20, cursor?: string) {
    return withActors([actor], async (tx) => {
      const scope = "moderation";
      const data = await tx
        .select()
        .from(socialReports)
        .where(gt(socialReports.id, pagePosition(actor, scope, cursor)))
        .orderBy(socialReports.id)
        .limit(limit + 1);
      return {
        data: data.slice(0, limit),
        nextCursor:
          data.length > limit
            ? nextPage(actor, scope, data[limit - 1].id)
            : null,
      };
    });
  },
};
