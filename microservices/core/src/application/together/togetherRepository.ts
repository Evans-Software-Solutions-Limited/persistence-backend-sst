import { createHmac } from "node:crypto";
import { and, eq, inArray, gt, asc, isNull, sql } from "drizzle-orm";
import { getDb } from "@persistence/db/client";
import {
  togetherSessions as sessions,
  togetherParticipants as participants,
  togetherInvites as invites,
  togetherJoinRequests as requests,
  togetherCommands as commands,
  togetherEvents as events,
  togetherJobs as jobs,
  togetherTickets as tickets,
  togetherConnections as connections,
  exercises,
  profiles,
  workoutSessions,
  type TogetherPlan,
  type TogetherExecution,
  type TogetherExerciseDefinition,
} from "@persistence/db";
import {
  withActors,
  requireTogether,
  assertTogetherPaid,
  assertActorActive,
  replayMutation,
  enforceRateLimit,
  requestHash,
  type TogetherTx,
  TogetherError,
} from "./shared";
import { canInteract, areFriends } from "../social/socialRepository";
import type { TogetherCommand } from "./types";
import { evaluateTogetherEligibility } from "../entitlement/togetherEligibility";
import { pagePosition, nextPage } from "../social/pagination";
import { ExerciseRepository } from "../repositories/exerciseRepository";
import { placesRepository } from "../places/placesRepository";
export const hashTogether = requestHash;
function secretToken(actor: string, route: string, key: string) {
  const secret = process.env.TOGETHER_TOKEN_SECRET;
  requireTogether(secret && secret.length >= 32, "UNAVAILABLE", 503);
  return createHmac("sha256", secret)
    .update(JSON.stringify([actor, route, key]))
    .digest("base64url");
}
type Session = typeof sessions.$inferSelect;
type Participant = typeof participants.$inferSelect;
const memberWhere = (id: string, uid: string) =>
  and(eq(participants.sessionId, id), eq(participants.userId, uid));
export async function canReportTogether(
  tx: TogetherTx,
  actor: string,
  subject: string,
  id?: string,
) {
  if (!id) return false;
  const members = await tx
    .select()
    .from(participants)
    .where(eq(participants.sessionId, id));
  return (
    members.some((p) => p.userId === actor) &&
    members.some((p) => p.userId === subject)
  );
}
export async function revokePair(
  tx: TogetherTx,
  a: string,
  b: string,
  reason: "block" | "friend_removed",
) {
  {
    const hosted = await tx
      .select()
      .from(sessions)
      .where(inArray(sessions.hostId, [a, b]))
      .orderBy(asc(sessions.id))
      .for("update");
    for (const session of hosted) {
      const removed = session.hostId === a ? b : a;
      const offers = await tx
        .select()
        .from(invites)
        .where(
          and(
            eq(invites.sessionId, session.id),
            ...(reason === "friend_removed"
              ? [eq(invites.audience, "friends")]
              : []),
            eq(invites.consumed, false),
          ),
        );
      for (const offer of offers)
        if (!offer.revokedFor.includes(removed))
          await tx
            .update(invites)
            .set({ revokedFor: [...offer.revokedFor, removed] })
            .where(eq(invites.id, offer.id));
      await tx
        .update(requests)
        .set({ status: "rejected" })
        .where(
          and(
            eq(requests.sessionId, session.id),
            eq(requests.userId, removed),
            eq(requests.status, "pending"),
            ...(reason === "block" || session.audience === "friends"
              ? []
              : [
                  inArray(
                    requests.inviteId,
                    offers.map((i) => i.id),
                  ),
                ]),
          ),
        );
    }
    if (reason === "friend_removed") return;
  }
  const memberships = await tx
    .select()
    .from(participants)
    .where(inArray(participants.userId, [a, b]));
  const ids = [
    ...new Set(
      memberships
        .filter((p) =>
          memberships.some(
            (q) => q.sessionId === p.sessionId && q.userId !== p.userId,
          ),
        )
        .map((p) => p.sessionId),
    ),
  ].sort();
  for (const id of ids) {
    await tx.select().from(sessions).where(eq(sessions.id, id)).for("update");
    if (reason === "block") {
      await tx
        .update(sessions)
        .set({ collaborationRevoked: true })
        .where(eq(sessions.id, id));
      await tx
        .update(participants)
        .set({
          allowPartnerLogging: false,
          delegationGeneration: sql`${participants.delegationGeneration}+1`,
        })
        .where(eq(participants.sessionId, id));
      await tx
        .update(connections)
        .set({ revoked: true })
        .where(eq(connections.sessionId, id));
    }
    await tx
      .update(invites)
      .set({ revoked: true })
      .where(and(eq(invites.sessionId, id), eq(invites.consumed, false)));
    await tx
      .update(requests)
      .set({ status: "rejected" })
      .where(
        and(
          eq(requests.sessionId, id),
          eq(requests.status, "pending"),
          inArray(requests.userId, [a, b]),
        ),
      );
  }
}
export class TogetherRepository {
  async processJob(id: string, userId: string) {
    const { processTogetherJob } = await import("./recording");
    return processTogetherJob(id, userId);
  }
  private async transaction<T>(
    actor: string,
    id: string,
    action: (tx: TogetherTx, s: Session, ps: Participant[]) => Promise<T>,
    extra: string[] = [],
  ): Promise<T> {
    const db = getDb();
    const known = await db
      .select({ userId: participants.userId })
      .from(participants)
      .where(eq(participants.sessionId, id));
    const result = await withActors(
      [actor, ...known.map((p) => p.userId), ...extra],
      async (tx) => {
        await assertActorActive(tx, actor);
        const [s] = await tx
          .select()
          .from(sessions)
          .where(eq(sessions.id, id))
          .for("update");
        requireTogether(s, "NOT_FOUND", 404);
        const ps = await tx
          .select()
          .from(participants)
          .where(eq(participants.sessionId, id));
        // Observe loss of shared access before a mutation savepoint. A denied
        // mutation must not roll back the durable revocation it just observed.
        await this.live(tx, s, ps);
        try {
          return {
            ok: true as const,
            value: await tx.transaction((inner) => action(inner, s, ps)),
          };
        } catch (error) {
          return { ok: false as const, error };
        }
      },
    );
    if (!result.ok) throw result.error;
    return result.value;
  }
  private member(ps: Participant[], actor: string) {
    const p = ps.find((p) => p.userId === actor);
    requireTogether(p, "NOT_FOUND", 404);
    return p;
  }
  private async live(tx: TogetherTx, s: Session, ps: Participant[]) {
    if (s.collaborationRevoked) return false;
    let valid =
      !!s.hostId &&
      s.state === "active" &&
      !ps.some((p) => p.leftAt) &&
      s.expiresAt > new Date();
    if (valid)
      for (const p of ps) {
        if (!(await evaluateTogetherEligibility(tx, p.userId))) {
          valid = false;
          break;
        }
        for (const q of ps)
          if (
            p.userId !== q.userId &&
            !(await canInteract(tx, p.userId, q.userId))
          ) {
            valid = false;
            break;
          }
      }
    if (!valid) {
      s.collaborationRevoked = true;
      await tx
        .update(sessions)
        .set({ collaborationRevoked: true })
        .where(eq(sessions.id, s.id));
      await tx
        .update(participants)
        .set({
          allowPartnerLogging: false,
          delegationGeneration: sql`${participants.delegationGeneration}+1`,
        })
        .where(eq(participants.sessionId, s.id));
      await tx
        .update(connections)
        .set({ revoked: true })
        .where(eq(connections.sessionId, s.id));
      await tx
        .update(invites)
        .set({ revoked: true })
        .where(eq(invites.sessionId, s.id));
      for (const p of ps) {
        p.allowPartnerLogging = false;
        p.delegationGeneration++;
      }
    }
    return valid;
  }
  private async snapshotIn(
    tx: TogetherTx,
    s: Session,
    ps: Participant[],
    actor: string,
  ) {
    const own = this.member(ps, actor);
    const live = await this.live(tx, s, ps);
    const shared = live && !own.leftAt;
    return {
      sessionId: s.id,
      state: s.state,
      hostId: s.hostId,
      revision: s.revision,
      planVersion: s.planVersion,
      plan: shared ? s.plan : (own.frozenPlan ?? s.plan),
      participants: (shared ? ps.filter((p) => !p.leftAt) : [own]).map((p) => ({
        userId: p.userId,
        status: p.status,
        ownRevision: p.ownRevision,
        delegationGeneration: p.delegationGeneration,
        allowPartnerLogging: p.allowPartnerLogging,
        execution: p.execution,
        exerciseCatalog: Object.fromEntries(
          Object.entries(p.exerciseDefinitions).map(([id, definition]) => [
            id,
            {
              name: definition.name,
              category: definition.category,
              primaryMuscles: definition.primaryMuscles,
            },
          ]),
        ),
        ...(p.userId === actor ? { historyId: p.historyId } : {}),
      })),
      completion: { status: own.status, historyId: own.historyId },
    };
  }
  private async definitions(
    tx: TogetherTx,
    ids: string[],
    viewers: string[],
    existing: Record<string, TogetherExerciseDefinition> = {},
  ) {
    const unique = [...new Set(ids)];
    const result = { ...existing };
    for (const id of unique) {
      for (const viewer of viewers) {
        const [visible] = await tx
          .select({ id: exercises.id })
          .from(exercises)
          .where(
            and(
              eq(exercises.id, id),
              new ExerciseRepository().buildVisibilityCondition(viewer),
            ),
          );
        requireTogether(visible, "INVALID_SCHEMA", 400);
      }
      const [source] = await tx
        .select({
          name: exercises.name,
          category: exercises.category,
          primaryMuscles: exercises.primaryMuscles,
          createdBy: exercises.createdBy,
        })
        .from(exercises)
        .where(eq(exercises.id, id))
        .for("key share");
      requireTogether(source, "INVALID_SCHEMA", 400);
      result[id] ??= { ...source, primaryMuscles: source.primaryMuscles ?? [] };
    }
    return result;
  }
  private async planValid(
    tx: TogetherTx,
    plan: TogetherPlan,
    viewers: string[],
  ) {
    requireTogether(
      new Set(plan.exercises.map((e) => e.planExerciseId)).size ===
        plan.exercises.length,
      "INVALID_SCHEMA",
      400,
    );
    return this.definitions(
      tx,
      plan.exercises.map((e) => e.exerciseId),
      viewers,
    );
  }
  private executionValid(plan: TogetherPlan, execution: TogetherExecution) {
    requireTogether(
      new Set(execution.exercises.map((e) => e.planExerciseId)).size ===
        execution.exercises.length,
      "INVALID_SCHEMA",
      400,
    );
    for (const e of execution.exercises) {
      requireTogether(
        plan.exercises.some((p) => p.planExerciseId === e.planExerciseId) &&
          new Set(e.sets.map((s) => s.setId)).size === e.sets.length,
        "INVALID_SCHEMA",
        400,
      );
      e.everAcknowledged = e.sets.length > 0;
    }
  }
  private async free(tx: TogetherTx, uid: string) {
    const rows = await tx
      .select()
      .from(participants)
      .where(
        and(
          eq(participants.userId, uid),
          inArray(participants.status, ["active", "finalizing"]),
        ),
      );
    requireTogether(!rows.length, "ACTIVE_SESSION_EXISTS", 409);
  }
  private async emit(tx: TogetherTx, s: Session, event: unknown) {
    s.revision++;
    await tx
      .update(sessions)
      .set({ revision: s.revision })
      .where(eq(sessions.id, s.id));
    await tx
      .insert(events)
      .values({ sessionId: s.id, revision: s.revision, event });
  }
  async create(
    actor: string,
    key: string,
    body: {
      clientDraftId: string;
      plan: TogetherPlan;
      ownExecution: TogetherExecution;
    },
  ) {
    return withActors([actor], async (tx) => {
      await assertTogetherPaid(tx, actor);
      const result = await replayMutation(
        tx,
        actor,
        "create",
        key,
        body,
        async () => {
          const [old] = await tx
            .select()
            .from(sessions)
            .where(
              and(
                eq(sessions.hostId, actor),
                eq(sessions.clientDraftId, body.clientDraftId),
              ),
            );
          if (old) {
            requireTogether(
              old.promotionHash === hashTogether(body),
              "IDEMPOTENCY_MISMATCH",
              409,
            );
            return { sessionId: old.id };
          }

          await this.free(tx, actor);
          const solo = await tx
            .select()
            .from(workoutSessions)
            .where(
              and(
                eq(workoutSessions.userId, actor),
                eq(workoutSessions.clientSessionId, body.clientDraftId),
              ),
            );
          requireTogether(!solo.length, "INVALID_STATE", 409);
          const exerciseDefinitions = await this.planValid(tx, body.plan, [
            actor,
          ]);
          const execution = structuredClone(body.ownExecution);
          this.executionValid(body.plan, execution);
          for (const e of execution.exercises) {
            if (e.substituteExerciseId)
              Object.assign(
                exerciseDefinitions,
                await this.definitions(tx, [e.substituteExerciseId], [actor]),
              );
          }
          const [s] = await tx
            .insert(sessions)
            .values({
              hostId: actor,
              clientDraftId: body.clientDraftId,
              promotionHash: hashTogether(body),
              plan: body.plan,
              expiresAt: new Date(Date.now() + 4 * 3600000),
            })
            .returning();
          await tx
            .insert(participants)
            .values({
              sessionId: s.id,
              userId: actor,
              execution,
              exerciseDefinitions,
              consentVersion: "together-v1",
            })
            .returning();
          return { sessionId: s.id };
        },
      );
      const [session] = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.id, result.sessionId))
        .for("update");
      const members = await tx
        .select()
        .from(participants)
        .where(eq(participants.sessionId, result.sessionId));
      return {
        sessionId: session.id,
        revision: session.revision,
        snapshot: await this.snapshotIn(tx, session, members, actor),
      };
    });
  }
  async active(actor: string) {
    return {
      data: await getDb()
        .select({
          sessionId: participants.sessionId,
          status: participants.status,
        })
        .from(participants)
        .where(
          and(
            eq(participants.userId, actor),
            inArray(participants.status, ["active", "finalizing"]),
          ),
        ),
    };
  }
  async snapshot(actor: string, id: string) {
    return this.transaction(actor, id, (tx, s, ps) =>
      this.snapshotIn(tx, s, ps, actor),
    );
  }
  async invite(
    actor: string,
    id: string,
    key: string,
    body: { expiresInMinutes: 15 },
  ) {
    return this.transaction(actor, id, async (tx, s, ps) => {
      requireTogether(
        s.hostId === actor &&
          this.member(ps, actor).status === "active" &&
          (await this.live(tx, s, ps)),
        "FORBIDDEN",
        403,
      );
      await assertTogetherPaid(tx, actor);
      const token = secretToken(actor, `invite:${id}`, key);
      const receipt = await replayMutation(
        tx,
        actor,
        `invite:${id}`,
        key,
        body,
        async () => {
          await enforceRateLimit(tx, actor, "invite");
          await tx
            .update(invites)
            .set({ revoked: true })
            .where(eq(invites.sessionId, id));
          const expiresAt = new Date(
            Math.min(s.expiresAt.getTime(), Date.now() + 15 * 60000),
          );
          const [row] = await tx
            .insert(invites)
            .values({
              sessionId: id,
              tokenHash: hashTogether(token),
              audience: s.audience,
              expiresAt,
            })
            .returning();
          return { tokenId: row.id, expiresAt: expiresAt.toISOString() };
        },
      );
      return { ...receipt, token };
    });
  }
  async revokeInvite(actor: string, id: string, tokenId: string, key: string) {
    return this.transaction(actor, id, async (tx, s) => {
      requireTogether(s.hostId === actor, "FORBIDDEN", 403);
      return replayMutation(
        tx,
        actor,
        `revokeInvite:${id}:${tokenId}`,
        key,
        {},
        async () => {
          await tx
            .update(invites)
            .set({ revoked: true })
            .where(and(eq(invites.id, tokenId), eq(invites.sessionId, id)));
          return { revoked: true };
        },
      );
    });
  }
  async requestJoin(
    actor: string,
    key: string,
    body: {
      inviteToken?: string;
      sessionId?: string;
      consentVersion: "together-v1";
      consentAccepted: true;
    },
  ) {
    const [invite] = body.inviteToken
      ? await getDb()
          .select()
          .from(invites)
          .where(eq(invites.tokenHash, hashTogether(body.inviteToken)))
      : [];
    const id = invite?.sessionId ?? body.sessionId;
    requireTogether(id, "NOT_FOUND", 404);
    return this.transaction(actor, id, async (tx, s, ps) => {
      requireTogether(
        s.hostId &&
          s.hostId !== actor &&
          (await this.live(tx, s, ps)) &&
          (await canInteract(tx, actor, s.hostId)),
        "FORBIDDEN",
        403,
      );
      await assertTogetherPaid(tx, actor);
      requireTogether(s.hostId, "FORBIDDEN", 403);
      await assertTogetherPaid(tx, s.hostId);
      if (body.inviteToken) {
        const [current] = await tx
          .select()
          .from(invites)
          .where(eq(invites.tokenHash, hashTogether(body.inviteToken)));
        requireTogether(
          current &&
            !current.revoked &&
            !current.revokedFor.includes(actor) &&
            (current.audience !== "friends" ||
              (await areFriends(tx, actor, s.hostId))) &&
            ((!current.consumed && current.expiresAt > new Date()) ||
              ps.some((p) => p.userId === actor && !p.leftAt)),
          "INVITE_EXPIRED",
          410,
        );
      } else {
        requireTogether(
          s.audience !== "private" &&
            (s.audience !== "friends" ||
              (await areFriends(tx, actor, s.hostId))),
          "FORBIDDEN",
          403,
        );
      }
      return replayMutation(tx, actor, "join", key, body, async () => {
        await enforceRateLimit(tx, actor, "join");
        await this.free(tx, actor);
        requireTogether(ps.length < 2, "SESSION_FULL", 409);
        const [existing] = await tx
          .select()
          .from(requests)
          .where(
            and(
              eq(requests.sessionId, id),
              eq(requests.userId, actor),
              eq(requests.status, "pending"),
            ),
          );
        if (existing) return { requestId: existing.id, status: "pending" };
        const [r] = await tx
          .insert(requests)
          .values({
            sessionId: id,
            userId: actor,
            inviteId: invite?.id,
            consentVersion: body.consentVersion,
          })
          .returning();
        await this.emit(tx, s, { type: "join_requested" });
        return { requestId: r.id, status: "pending" };
      });
    });
  }
  async listRequests(
    actor: string,
    id: string,
    query: { limit?: number; cursor?: string } = {},
  ) {
    return this.transaction(actor, id, async (tx, s, ps) => {
      requireTogether(
        s.hostId === actor && (await this.live(tx, s, ps)),
        "FORBIDDEN",
        403,
      );
      const scope = `join-requests:${id}`;
      const after = pagePosition(actor, scope, query.cursor);
      const rows = await tx
        .select({
          requestId: requests.id,
          userId: profiles.id,
          displayName: profiles.fullName,
          avatarUrl: profiles.avatarUrl,
        })
        .from(requests)
        .innerJoin(profiles, eq(profiles.id, requests.userId))
        .where(
          and(
            eq(requests.sessionId, id),
            eq(requests.status, "pending"),
            gt(requests.id, after),
          ),
        )
        .orderBy(asc(requests.id))
        .limit(query.limit ?? 20);
      const data = [];
      for (const row of rows)
        if (await canInteract(tx, actor, row.userId)) data.push(row);
      return {
        data,
        nextCursor:
          rows.length === (query.limit ?? 20)
            ? nextPage(actor, scope, rows[rows.length - 1].requestId)
            : null,
      };
    });
  }
  async decide(
    actor: string,
    id: string,
    requestId: string,
    key: string,
    body: { decision: "approve" | "reject"; expectedRevision: number },
  ) {
    const [r] = await getDb()
      .select()
      .from(requests)
      .where(and(eq(requests.id, requestId), eq(requests.sessionId, id)));
    requireTogether(r, "NOT_FOUND", 404);
    return this.transaction(
      actor,
      id,
      async (tx, s, ps) => {
        requireTogether(
          s.hostId === actor &&
            this.member(ps, actor).status === "active" &&
            (await this.live(tx, s, ps)) &&
            (await canInteract(tx, actor, r.userId)),
          "FORBIDDEN",
          403,
        );
        await assertTogetherPaid(tx, actor);
        await assertTogetherPaid(tx, r.userId);
        await replayMutation(
          tx,
          actor,
          `decision:${requestId}`,
          key,
          body,
          async () => {
            const [current] = await tx
              .select()
              .from(requests)
              .where(eq(requests.id, requestId));
            requireTogether(current.status === "pending", "INVALID_STATE", 409);
            if (s.revision !== body.expectedRevision)
              throw new TogetherError(
                "VERSION_CONFLICT",
                409,
                "Session changed",
                s.revision,
              );
            if (body.decision === "approve") {
              requireTogether(ps.length < 2, "SESSION_FULL", 409);
              await this.free(tx, r.userId);
              if (r.inviteId) {
                const [invite] = await tx
                  .select()
                  .from(invites)
                  .where(eq(invites.id, r.inviteId));
                requireTogether(
                  invite &&
                    !invite.revoked &&
                    !invite.revokedFor.includes(r.userId) &&
                    (invite.audience !== "friends" ||
                      (await areFriends(tx, actor, r.userId))) &&
                    !invite.consumed &&
                    invite.expiresAt > new Date(),
                  "INVITE_EXPIRED",
                  410,
                );
                await tx
                  .update(invites)
                  .set({ consumed: true })
                  .where(eq(invites.id, r.inviteId));
              } else
                requireTogether(
                  s.audience !== "private" &&
                    (s.audience !== "friends" ||
                      (await areFriends(tx, actor, r.userId))),
                  "FORBIDDEN",
                  403,
                );
              const exerciseDefinitions = await this.planValid(tx, s.plan, [
                actor,
                r.userId,
              ]);
              for (const member of ps)
                for (const e of member.execution.exercises)
                  if (e.substituteExerciseId)
                    await this.definitions(
                      tx,
                      [e.substituteExerciseId],
                      [r.userId],
                    );
              const [p] = await tx
                .insert(participants)
                .values({
                  sessionId: id,
                  userId: r.userId,
                  execution: { exercises: [] },
                  exerciseDefinitions,
                  consentVersion: r.consentVersion,
                })
                .returning();
              ps.push(p);
            }
            await tx
              .update(requests)
              .set({
                status: body.decision === "approve" ? "approved" : "rejected",
              })
              .where(eq(requests.id, requestId));
            await this.emit(tx, s, { type: "membership_changed" });
            return { decided: true };
          },
        );
        const currentMembers = await tx
          .select()
          .from(participants)
          .where(eq(participants.sessionId, id));
        return this.snapshotIn(tx, s, currentMembers, actor);
      },
      [r.userId],
    );
  }
  async command(actor: string, id: string, key: string, body: TogetherCommand) {
    return this.transaction(actor, id, async (tx, s, ps) => {
      const own = this.member(ps, actor);
      const isPlan = body.target.kind === "plan";
      const target = isPlan
        ? own
        : this.member(ps, body.target.athleteId ?? actor);
      const live = await this.live(tx, s, ps);
      requireTogether(!own.leftAt, "FORBIDDEN", 403);
      requireTogether(own.status === "active", "INVALID_STATE", 409);
      if (isPlan) {
        requireTogether(actor === s.hostId && live, "FORBIDDEN", 403);
        await assertTogetherPaid(tx, actor);
      } else if (target.userId !== actor) {
        requireTogether(live && !target.leftAt, "FORBIDDEN", 403);
        requireTogether(
          target.allowPartnerLogging &&
            body.delegationGeneration === target.delegationGeneration,
          "DELEGATION_REVOKED",
          403,
        );
        await assertTogetherPaid(tx, actor);
        await assertTogetherPaid(tx, target.userId);
      } else if (live) {
        /* Own recovery never requires a paid subscription. */
      }
      requireTogether(target.status === "active", "INVALID_STATE", 409);
      const result = await replayMutation(
        tx,
        actor,
        `command:${id}`,
        key,
        body,
        async () => {
          const [old] = await tx
            .select()
            .from(commands)
            .where(
              and(
                eq(commands.sessionId, id),
                eq(commands.commandId, body.commandId),
              ),
            );
          if (old) {
            requireTogether(
              old.actorId === actor && old.requestHash === hashTogether(body),
              "IDEMPOTENCY_MISMATCH",
              409,
            );
            return old.result;
          }
          const version = isPlan ? s.planVersion : target.ownRevision;
          if (version !== body.expectedVersion)
            throw new TogetherError(
              "VERSION_CONFLICT",
              409,
              "Target changed",
              version,
            );
          const op = body.operation;
          if (isPlan) {
            requireTogether(op.type === "replacePlan", "INVALID_SCHEMA", 400);
            const definitions = await this.planValid(
              tx,
              op.plan,
              ps.filter((p) => !p.leftAt).map((p) => p.userId),
            );
            for (const p of ps)
              for (const e of p.execution.exercises)
                if (e.everAcknowledged) {
                  const old = s.plan.exercises.find(
                    (x) => x.planExerciseId === e.planExerciseId,
                  );
                  const next = op.plan.exercises.find(
                    (x) => x.planExerciseId === e.planExerciseId,
                  );
                  requireTogether(
                    old && next && old.exerciseId === next.exerciseId,
                    "INVALID_STATE",
                    409,
                  );
                }
            for (const p of ps) {
              p.exerciseDefinitions = {
                ...p.exerciseDefinitions,
                ...definitions,
              };
              await tx
                .update(participants)
                .set({ exerciseDefinitions: p.exerciseDefinitions })
                .where(memberWhere(id, p.userId));
            }
            s.plan = op.plan;
            s.planVersion++;
            await tx
              .update(sessions)
              .set({ plan: s.plan, planVersion: s.planVersion })
              .where(eq(sessions.id, id));
          } else {
            requireTogether(op.type !== "replacePlan", "INVALID_SCHEMA", 400);
            const execution = structuredClone(target.execution);
            if (op.type === "rest") execution.restEndsAt = op.endsAt;
            else {
              requireTogether(
                s.plan.exercises.some(
                  (e) => e.planExerciseId === op.planExerciseId,
                ),
                "INVALID_SCHEMA",
                400,
              );
              let e = execution.exercises.find(
                (e) => e.planExerciseId === op.planExerciseId,
              );
              if (!e) {
                e = {
                  planExerciseId: op.planExerciseId,
                  skipped: false,
                  sets: [],
                  everAcknowledged: false,
                };
                execution.exercises.push(e);
              }
              if (op.type === "upsertSet") {
                const index = e.sets.findIndex((x) => x.setId === op.set.setId);
                requireTogether(
                  index >= 0 || e.sets.length < 100,
                  "INVALID_SCHEMA",
                  400,
                );
                if (index >= 0) e.sets[index] = op.set;
                else e.sets.push(op.set);
                e.everAcknowledged = true;
              } else if (op.type === "removeSet")
                e.sets = e.sets.filter((x) => x.setId !== op.setId);
              else if (op.type === "skip") e.skipped = op.skipped;
              else {
                requireTogether(
                  !e.everAcknowledged ||
                    (e.substituteExerciseId ?? null) === op.exerciseId,
                  "INVALID_STATE",
                  409,
                );
                if (op.exerciseId)
                  target.exerciseDefinitions = await this.definitions(
                    tx,
                    [op.exerciseId],
                    live
                      ? ps.filter((p) => !p.leftAt).map((p) => p.userId)
                      : [actor],
                    target.exerciseDefinitions,
                  );
                e.substituteExerciseId = op.exerciseId;
              }
            }
            target.ownRevision++;
            target.execution = execution;
            await tx
              .update(participants)
              .set({
                execution,
                ownRevision: target.ownRevision,
                exerciseDefinitions: target.exerciseDefinitions,
              })
              .where(memberWhere(id, target.userId));
          }
          const event = {
            revision: s.revision + 1,
            commandId: body.commandId,
            target: isPlan
              ? { kind: "plan" as const }
              : { kind: "execution" as const, athleteId: target.userId },
            actorId: actor,
            newVersion: version + 1,
            operation: op,
          };
          await this.emit(tx, s, event);
          const result = {
            commandId: body.commandId,
            revision: s.revision,
            event,
          };
          await tx.insert(commands).values({
            sessionId: id,
            commandId: body.commandId,
            actorId: actor,
            requestHash: hashTogether(body),
            result,
          });
          return result;
        },
      );
      return result;
    });
  }
  async delegation(
    actor: string,
    id: string,
    key: string,
    body: { allowPartnerLogging: boolean },
  ) {
    return this.transaction(actor, id, async (tx, s, ps) => {
      const p = this.member(ps, actor);
      requireTogether(p.status === "active" && !p.leftAt, "FORBIDDEN", 403);
      if (body.allowPartnerLogging) {
        requireTogether(await this.live(tx, s, ps), "FORBIDDEN", 403);
        await assertTogetherPaid(tx, actor);
      }
      return replayMutation(
        tx,
        actor,
        `delegation:${id}`,
        key,
        body,
        async () => {
          p.delegationGeneration++;
          await tx
            .update(participants)
            .set({
              allowPartnerLogging: body.allowPartnerLogging,
              delegationGeneration: p.delegationGeneration,
            })
            .where(memberWhere(id, actor));
          await this.emit(tx, s, {
            type: "delegation_changed",
            userId: actor,
            generation: p.delegationGeneration,
          });
          return {
            generation: p.delegationGeneration,
            allowed: body.allowPartnerLogging,
          };
        },
      );
    });
  }
  async visibility(
    actor: string,
    id: string,
    key: string,
    body: {
      audience: "private" | "friends" | "nearby";
      placeId?: string;
      expiresAt: string;
    },
  ) {
    return this.transaction(actor, id, async (tx, s, ps) => {
      requireTogether(
        actor === s.hostId &&
          this.member(ps, actor).status === "active" &&
          (await this.live(tx, s, ps)),
        "FORBIDDEN",
        403,
      );
      await assertTogetherPaid(tx, actor);
      const expiresAt = new Date(body.expiresAt);
      requireTogether(
        expiresAt > new Date() &&
          expiresAt.getTime() <= Date.now() + 4 * 3600000,
        "INVALID_SCHEMA",
        400,
      );
      requireTogether(
        body.audience !== "nearby" || !!body.placeId,
        "INVALID_SCHEMA",
        400,
      );
      requireTogether(
        body.audience === "private" ||
          process.env.TOGETHER_DISCOVERY_ENABLED === "true",
        "FORBIDDEN",
        403,
      );
      return replayMutation(
        tx,
        actor,
        `visibility:${id}`,
        key,
        body,
        async () => {
          const selected = body.placeId
            ? await placesRepository.resolve(body.placeId)
            : null;
          await tx
            .update(sessions)
            .set({
              placeLabel: selected?.label ?? null,
              audience: body.audience,
              placeId: body.placeId ?? null,
              expiresAt,
            })
            .where(eq(sessions.id, id));
          await this.emit(tx, s, { type: "visibility_changed" });
          return { revision: s.revision };
        },
      );
    });
  }
  async discovery(
    actor: string,
    query: {
      audience: "friends" | "nearby";
      placeId?: string;
      limit?: number;
      cursor?: string;
    },
  ) {
    requireTogether(
      process.env.TOGETHER_DISCOVERY_ENABLED === "true",
      "FORBIDDEN",
      403,
    );
    requireTogether(
      query.audience !== "nearby" || !!query.placeId,
      "INVALID_SCHEMA",
      400,
    );
    const scope = JSON.stringify([query.audience, query.placeId ?? null]);
    const after = pagePosition(actor, scope, query.cursor);
    return withActors([actor], async (tx) => {
      await enforceRateLimit(tx, actor, "discovery");
      const rows = await tx
        .select({
          session: sessions,
          profile: {
            id: profiles.id,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
          },
        })
        .from(sessions)
        .innerJoin(profiles, eq(profiles.id, sessions.hostId))
        .where(
          and(
            gt(sessions.id, after),
            eq(sessions.audience, query.audience),
            eq(sessions.state, "active"),
            eq(sessions.collaborationRevoked, false),
            gt(sessions.expiresAt, new Date()),
            ...(query.placeId ? [eq(sessions.placeId, query.placeId)] : []),
          ),
        )
        .orderBy(asc(sessions.id))
        .limit(200);
      const data = [];
      let last: string | undefined;
      for (const { session: s, profile: p } of rows) {
        last = s.id;
        if (
          !s.hostId ||
          s.hostId === actor ||
          !(await canInteract(tx, actor, s.hostId)) ||
          (query.audience === "friends" &&
            !(await areFriends(tx, actor, s.hostId)))
        )
          continue;
        const ps = await tx
          .select()
          .from(participants)
          .where(eq(participants.sessionId, s.id));
        if (
          !(await this.live(tx, s, ps)) ||
          ps.length >= 2 ||
          ps.find((p) => p.userId === s.hostId)?.status !== "active"
        )
          continue;
        data.push({
          sessionId: s.id,
          host: {
            userId: p.id,
            displayName: p.fullName,
            avatarUrl: p.avatarUrl,
          },
          placeId: s.placeId,
          placeLabel: s.placeLabel,
          expiresAt: s.expiresAt,
          occupancy: ps.length,
        });
        if (data.length >= (query.limit ?? 20)) break;
      }
      return {
        data,
        nextCursor:
          last && (rows.length === 200 || data.length === (query.limit ?? 20))
            ? nextPage(actor, scope, last)
            : null,
      };
    });
  }
  async events(actor: string, id: string, after: number) {
    return this.transaction(actor, id, async (tx, s, ps) => {
      const p = this.member(ps, actor);
      requireTogether(
        !p.leftAt && (await this.live(tx, s, ps)),
        "FORBIDDEN",
        403,
      );
      const rows = await tx
        .select()
        .from(events)
        .where(and(eq(events.sessionId, id), gt(events.revision, after)))
        .orderBy(asc(events.revision))
        .limit(500);
      requireTogether(
        !rows.length || rows[0].createdAt.getTime() > Date.now() - 86400000,
        "CURSOR_EXPIRED",
        410,
      );
      return {
        data: rows.map((r) => ({ revision: r.revision, event: r.event })),
        revision: s.revision,
      };
    });
  }
  async authorizeDelivery(tx: TogetherTx, id: string, actor: string) {
    const [s] = await tx.select().from(sessions).where(eq(sessions.id, id));
    if (!s) return false;
    const ps = await tx
      .select()
      .from(participants)
      .where(eq(participants.sessionId, id));
    const p = ps.find((p) => p.userId === actor);
    return !!p && !p.leftAt && (await this.live(tx, s, ps));
  }
  async ticket(actor: string, id: string, key: string) {
    return this.transaction(actor, id, async (tx, s, ps) => {
      const p = this.member(ps, actor);
      requireTogether(
        !p.leftAt && (await this.live(tx, s, ps)),
        "FORBIDDEN",
        403,
      );
      requireTogether(process.env.TOGETHER_WEBSOCKET_URL, "UNAVAILABLE", 503);
      const ticket = secretToken(actor, `ticket:${id}`, key);
      const receipt = await replayMutation(
        tx,
        actor,
        `ticket:${id}`,
        key,
        {},
        async () => {
          const expiresAt = new Date(Date.now() + 60000);
          await tx.insert(tickets).values({
            tokenHash: hashTogether(ticket),
            sessionId: id,
            userId: actor,
            expiresAt,
          });
          return {
            expiresAt: expiresAt.toISOString(),
            endpoint: process.env.TOGETHER_WEBSOCKET_URL,
          };
        },
      );
      return { ...receipt, ticket };
    });
  }
  async consumeTicket(token: string, connectionId: string) {
    const [t] = await getDb()
      .select()
      .from(tickets)
      .where(eq(tickets.tokenHash, hashTogether(token)));
    requireTogether(t, "FORBIDDEN", 403);
    return this.transaction(t.userId, t.sessionId, async (tx, s, ps) => {
      const [current] = await tx
        .select()
        .from(tickets)
        .where(eq(tickets.tokenHash, hashTogether(token)))
        .for("update");
      requireTogether(
        current &&
          !current.used &&
          current.expiresAt > new Date() &&
          !this.member(ps, t.userId).leftAt &&
          (await this.live(tx, s, ps)),
        "FORBIDDEN",
        403,
      );
      const activeConnections = await tx
        .select({ id: connections.connectionId })
        .from(connections)
        .where(
          and(
            eq(connections.sessionId, s.id),
            eq(connections.userId, t.userId),
            eq(connections.revoked, false),
            gt(connections.expiresAt, new Date()),
          ),
        );
      requireTogether(activeConnections.length < 5, "CONNECTION_LIMIT", 409);
      await tx
        .update(tickets)
        .set({ used: true })
        .where(eq(tickets.tokenHash, current.tokenHash));
      await tx.insert(connections).values({
        connectionId,
        sessionId: s.id,
        userId: t.userId,
        expiresAt: new Date(Date.now() + 2 * 3600000),
      });
      return { sessionId: s.id, userId: t.userId };
    });
  }
  async disconnect(connectionId: string) {
    await getDb()
      .delete(connections)
      .where(eq(connections.connectionId, connectionId));
  }
  async finish(
    actor: string,
    id: string,
    key: string,
    body: { expectedOwnRevision: number },
    leave = false,
  ) {
    return this.transaction(actor, id, async (tx, s, ps) => {
      const p = this.member(ps, actor);
      await replayMutation(
        tx,
        actor,
        `${leave ? "leave" : "finish"}:${id}`,
        key,
        body,
        async () => {
          if (p.status === "active") {
            if (p.ownRevision !== body.expectedOwnRevision)
              throw new TogetherError(
                "VERSION_CONFLICT",
                409,
                "Personal execution changed",
                p.ownRevision,
              );
            const hasWork = p.execution.exercises.some((e) =>
              e.sets.some((s) => s.completed),
            );
            p.status = hasWork ? "finalizing" : "finished_empty";
            p.frozenPlan = s.plan;
            await tx
              .update(participants)
              .set({
                status: p.status,
                frozenPlan: s.plan,
                allowPartnerLogging: false,
                delegationGeneration: p.delegationGeneration + 1,
                ...(leave ? { leftAt: new Date() } : {}),
              })
              .where(memberWhere(id, actor));
            if (hasWork)
              await tx.insert(jobs).values({ sessionId: id, userId: actor });
            await this.emit(tx, s, {
              type: "participant_finished",
              userId: actor,
              status: p.status,
            });
          }
          if (leave) {
            await tx
              .update(participants)
              .set({ leftAt: new Date() })
              .where(memberWhere(id, actor));
            await tx
              .update(connections)
              .set({ revoked: true })
              .where(
                and(
                  eq(connections.sessionId, id),
                  eq(connections.userId, actor),
                ),
              );
          }
          if (actor === s.hostId) {
            await tx
              .update(invites)
              .set({ revoked: true })
              .where(eq(invites.sessionId, id));
            await tx
              .update(sessions)
              .set({ audience: "private" })
              .where(eq(sessions.id, id));
          }
          if (ps.every((p) => p.status !== "active"))
            await tx
              .update(sessions)
              .set({ state: "closed" })
              .where(eq(sessions.id, id));
          return { status: p.status };
        },
      );
      const [current] = await tx
        .select()
        .from(participants)
        .where(memberWhere(id, actor));
      return {
        status: current.status === "finalizing" ? "pending" : current.status,
        historyId: current.historyId,
      };
    });
  }
  async listPendingEvents(limit = 100) {
    return getDb()
      .select()
      .from(events)
      .where(isNull(events.dispatchedAt))
      .orderBy(asc(events.createdAt))
      .limit(limit);
  }
  async acknowledgeEvent(id: string, revision: number) {
    await getDb()
      .update(events)
      .set({ dispatchedAt: new Date() })
      .where(and(eq(events.sessionId, id), eq(events.revision, revision)));
  }
}
