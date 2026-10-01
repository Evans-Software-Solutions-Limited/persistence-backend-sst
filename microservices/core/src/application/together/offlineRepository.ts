import {
  offlineUuidValidator,
  registrationValidator,
  recoveryValidator,
} from "./offlineTypes";
import { and, eq, desc, lte } from "drizzle-orm";
import {
  togetherOfflineDevices as devices,
  togetherOfflineExecutions as executions,
  togetherOfflineCommands as commands,
  togetherSessions,
  togetherReviewedResults as results,
  userSubscriptions,
} from "@persistence/db";
import {
  withActors,
  assertActorActive,
  assertTogetherPaid,
  requireTogether,
  replayMutation,
  requestHash,
  enforceRateLimit,
  togetherEnabled,
} from "./shared";
import { areFriends } from "../social/socialRepository";
import {
  offlineAuthority,
  signPayload,
  verifySignature,
  OFFLINE_CREDENTIAL_TTL_MS,
  type Credential,
  type FriendshipEvidence,
  type Registration,
  type Signed,
} from "./offlineIdentity";
import { reconstructOwn, type RecoveryCommand } from "./offlineRecovery";
import type { TogetherPlan } from "@persistence/db";

export interface RecoveryUpload {
  credential: Signed<Credential>;
  sessionId: string;
  executionId: string;
  startedAt: number;
  plan: TogetherPlan;
  commands: Signed<RecoveryCommand>[];
}
export class TogetherOfflineRepository {
  private enabled() {
    requireTogether(togetherEnabled(), "NOT_FOUND", 404);
  }
  async trust(actor: string) {
    this.enabled();
    return withActors([actor], async (tx) => {
      await assertActorActive(tx, actor);
      return {
        publicKeys: offlineAuthority().publicKeys,
        maxCredentialAgeMs: OFFLINE_CREDENTIAL_TTL_MS,
      };
    });
  }
  async register(actor: string, key: string, proof: Signed<Registration>) {
    this.enabled();
    requireTogether(registrationValidator.Check(proof), "INVALID_SCHEMA", 400);
    return withActors([actor], async (tx) => {
      await assertActorActive(tx, actor);
      await assertTogetherPaid(tx, actor);
      const body = verifySignature(proof, proof.payload.publicKey);
      requireTogether(
        body.kind === "together-register-v1" &&
          body.userId === actor &&
          body.requestId === key &&
          Number.isSafeInteger(body.timestamp) &&
          Math.abs(Date.now() - body.timestamp) <= 300000,
        "INVALID_PROOF",
        403,
      );
      const predicate = and(
        eq(devices.userId, actor),
        eq(devices.deviceId, body.deviceId),
      );
      const [old] = await tx.select().from(devices).where(predicate);
      requireTogether(!old?.revokedAt, "DEVICE_REVOKED", 403);
      requireTogether(
        !old || old.publicKey === body.publicKey,
        "IDEMPOTENCY_MISMATCH",
        409,
      );
      return replayMutation(
        tx,
        actor,
        "offline:register",
        key,
        proof,
        async () => {
          await enforceRateLimit(tx, actor, "offline-register", 10);
          const authority = offlineAuthority(),
            now = Date.now();
          const [subscription] = await tx
            .select({ expiresAt: userSubscriptions.expiresAt })
            .from(userSubscriptions)
            .where(
              and(
                eq(userSubscriptions.userId, actor),
                lte(userSubscriptions.startsAt, new Date(now)),
              ),
            )
            .orderBy(
              desc(userSubscriptions.createdAt),
              desc(userSubscriptions.id),
            )
            .limit(1);
          const expiresAt = Math.min(
            now + OFFLINE_CREDENTIAL_TTL_MS,
            subscription?.expiresAt?.getTime() ?? Infinity,
          );
          requireTogether(expiresAt > now, "PAID_REQUIRED", 403);
          await tx
            .insert(devices)
            .values({
              userId: actor,
              deviceId: body.deviceId,
              publicKey: body.publicKey,
            })
            .onConflictDoNothing();
          return signPayload<Credential>(
            {
              kind: "together-device-v1",
              keyId: authority.keyId,
              userId: actor,
              deviceId: body.deviceId,
              publicKey: body.publicKey,
              issuedAt: now,
              expiresAt,
            },
            authority.privateKey,
          );
        },
      );
    });
  }
  async revoke(actor: string, deviceId: string, key: string) {
    this.enabled();
    return withActors([actor], async (tx) => {
      await assertActorActive(tx, actor);
      return replayMutation(
        tx,
        actor,
        `offline:revoke:${deviceId}`,
        key,
        {},
        async () => {
          await tx
            .update(devices)
            .set({ revokedAt: new Date() })
            .where(
              and(eq(devices.userId, actor), eq(devices.deviceId, deviceId)),
            );
          return { revoked: true };
        },
      );
    });
  }
  async friendship(actor: string, friendId: string, key: string) {
    this.enabled();
    requireTogether(
      offlineUuidValidator.Check(friendId) && actor !== friendId,
      "INVALID_SCHEMA",
      400,
    );
    return withActors([actor, friendId], async (tx) => {
      await assertActorActive(tx, actor);
      await assertActorActive(tx, friendId);
      await assertTogetherPaid(tx, actor);
      requireTogether(await areFriends(tx, actor, friendId), "FORBIDDEN", 403);
      return replayMutation(
        tx,
        actor,
        "offline:friendship",
        key,
        { friendId },
        async () => {
          await enforceRateLimit(tx, actor, "offline-friendship", 60);
          const authority = offlineAuthority(),
            now = Date.now();
          return signPayload<FriendshipEvidence>(
            {
              kind: "together-friendship-v1",
              keyId: authority.keyId,
              users: [actor, friendId].sort() as [string, string],
              issuedAt: now,
              expiresAt: now + OFFLINE_CREDENTIAL_TTL_MS,
            },
            authority.privateKey,
          );
        },
      );
    });
  }
  async recover(actor: string, key: string, body: RecoveryUpload) {
    this.enabled();
    requireTogether(
      recoveryValidator.Check(body) && body.startedAt <= Date.now(),
      "INVALID_SCHEMA",
      400,
    );
    return withActors([actor], async (tx) => {
      await assertActorActive(tx, actor);
      const credential = body.credential.payload,
        authority = offlineAuthority();
      requireTogether(
        credential.kind === "together-device-v1" &&
          credential.userId === actor &&
          Object.hasOwn(authority.publicKeys, credential.keyId),
        "INVALID_PROOF",
        403,
      );
      verifySignature(body.credential, authority.publicKeys[credential.keyId]);
      // Expired/revoked sharing credentials cannot activate collaboration, but an
      // authenticated owner can recover their genuinely signed device journal.
      const [device] = await tx
        .select()
        .from(devices)
        .where(
          and(
            eq(devices.userId, actor),
            eq(devices.deviceId, credential.deviceId),
          ),
        );
      requireTogether(
        device && device.publicKey === credential.publicKey,
        "INVALID_PROOF",
        403,
      );
      return replayMutation(
        tx,
        actor,
        "offline:recovery",
        key,
        body,
        async () => {
          requireTogether(
            body.commands.length >= 1 &&
              body.commands.length <= 100 &&
              new Set(body.plan.exercises.map((e) => e.planExerciseId)).size ===
                body.plan.exercises.length,
            "INVALID_SCHEMA",
            400,
          );
          const [cloud] = await tx
            .select({ id: togetherSessions.id })
            .from(togetherSessions)
            .where(eq(togetherSessions.id, body.sessionId));
          requireTogether(!cloud, "CLOUD_SESSION_CONFLICT", 409);
          const predicate = and(
            eq(executions.userId, actor),
            eq(executions.executionId, body.executionId),
          );
          let [execution] = await tx.select().from(executions).where(predicate);
          const [sameSession] = await tx
            .select()
            .from(executions)
            .where(
              and(
                eq(executions.userId, actor),
                eq(executions.sessionId, body.sessionId),
              ),
            );
          requireTogether(
            !sameSession || sameSession.executionId === body.executionId,
            "IDEMPOTENCY_MISMATCH",
            409,
          );
          const planHash = requestHash(body.plan);
          requireTogether(
            !execution ||
              (execution.sessionId === body.sessionId &&
                execution.planHash === planHash &&
                execution.startedAt.getTime() === body.startedAt),
            "IDEMPOTENCY_MISMATCH",
            409,
          );
          await enforceRateLimit(tx, actor, "offline-recovery", 120);
          if (!execution)
            [execution] = await tx
              .insert(executions)
              .values({
                userId: actor,
                executionId: body.executionId,
                sessionId: body.sessionId,
                startedAt: new Date(body.startedAt),
                plan: body.plan,
                planHash,
                execution: { exercises: [] },
              })
              .returning();
          const receipts = [];
          for (const signed of body.commands) {
            const command = verifySignature(signed, credential.publicKey);
            requireTogether(
              command.kind === "together-recovery-v1" &&
                command.userId === actor &&
                command.sessionId === body.sessionId &&
                command.executionId === body.executionId &&
                command.planHash === planHash &&
                command.startedAt === body.startedAt,
              "INVALID_PROOF",
              403,
            );
            const hash = requestHash(command);
            const [old] = await tx
              .select()
              .from(commands)
              .where(
                and(
                  eq(commands.userId, actor),
                  eq(commands.commandId, command.commandId),
                ),
              );
            if (old)
              requireTogether(
                old.requestHash === hash &&
                  old.executionId === body.executionId,
                "IDEMPOTENCY_MISMATCH",
                409,
              );
            else {
              requireTogether(
                command.expectedVersion === execution.revision,
                "VERSION_GAP",
                409,
              );
              execution.execution = reconstructOwn(
                body.plan,
                execution.execution,
                command,
              );
              execution.revision++;
              await tx.insert(commands).values({
                userId: actor,
                commandId: command.commandId,
                executionId: body.executionId,
                requestHash: hash,
                revision: execution.revision,
                command,
              });
            }
            receipts.push({
              commandId: command.commandId,
              commandHash: hash,
              revision: old?.revision ?? execution.revision,
              status: "stored_for_review" as const,
            });
          }
          await tx
            .update(executions)
            .set({
              execution: execution.execution,
              revision: execution.revision,
            })
            .where(predicate);
          return { ...this.review(execution), receipts };
        },
      );
    });
  }
  private review(execution: typeof executions.$inferSelect) {
    return {
      status: "stored_for_review" as const,
      sharingActive: false as const,
      historySaved: false as const,
      sessionId: execution.sessionId,
      executionId: execution.executionId,
      revision: execution.revision,
      startedAt: execution.startedAt.getTime(),
      plan: execution.plan,
      execution: execution.execution,
    };
  }
  async getRecovery(actor: string, executionId: string) {
    this.enabled();
    return withActors([actor], async (tx) => {
      await assertActorActive(tx, actor);
      const [execution] = await tx
        .select()
        .from(executions)
        .where(
          and(
            eq(executions.userId, actor),
            eq(executions.executionId, executionId),
          ),
        );
      requireTogether(execution, "NOT_FOUND", 404);
      const [result] = await tx
        .select()
        .from(results)
        .where(
          and(
            eq(results.userId, actor),
            eq(results.sessionId, execution.sessionId),
          ),
        );
      const reviewed = result?.reviewedRevision === execution.revision;
      const hasWork = execution.execution.exercises.some((e) =>
        e.sets.some((s) => s.completed),
      );
      return {
        ...this.review(execution),
        status: reviewed
          ? hasWork
            ? ("saved" as const)
            : ("finished_empty" as const)
          : ("stored_for_review" as const),
        historySaved: !!(reviewed && hasWork && result.historyId),
        historyId: result?.historyId ?? null,
        reviewedRevision: result?.reviewedRevision ?? null,
        effectsPending:
          !!result && result.effectsDoneVersion < result.effectsVersion,
      };
    });
  }
}
