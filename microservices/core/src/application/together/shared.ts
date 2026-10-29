import { createHash } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getDb, type Db } from "@persistence/db";
import {
  profiles,
  togetherActors,
  togetherRateLimits,
  togetherReceipts,
} from "@persistence/db/schema";
import { evaluateTogetherEligibility } from "../entitlement/togetherEligibility";

export type TogetherTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export class TogetherError extends Error {
  readonly code: string;
  readonly status: number;
  readonly currentRevision?: number;
  constructor(
    code: string,
    status: number,
    message = "Request cannot be completed",
    currentRevision?: number,
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.currentRevision = currentRevision;
  }
}
export function requireTogether(
  condition: unknown,
  code: string,
  status = 403,
): asserts condition {
  if (!condition) throw new TogetherError(code, status);
}
export function togetherEnabled() {
  return process.env.TOGETHER_ENABLED === "true";
}
export function discoveryEnabled() {
  return process.env.TOGETHER_DISCOVERY_ENABLED === "true";
}

export async function lockActors(tx: TogetherTx, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  requireTogether(sorted.length > 0, "INVALID_SCHEMA", 400);
  // Insert and lock in identical order, including actors first encountered concurrently.
  for (const userId of sorted) {
    const [profile] = await tx
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, userId));
    requireTogether(profile, "NOT_FOUND", 404);
    await tx.insert(togetherActors).values({ userId }).onConflictDoNothing();
  }
  await tx
    .select()
    .from(togetherActors)
    .where(inArray(togetherActors.userId, sorted))
    .orderBy(asc(togetherActors.userId))
    .for("update");
}
export async function withActors<T>(
  ids: string[],
  action: (tx: TogetherTx) => Promise<T>,
): Promise<T> {
  return getDb().transaction(async (tx) => {
    await lockActors(tx, ids);
    return action(tx);
  });
}
export async function assertTogetherPaid(tx: TogetherTx, userId: string) {
  requireTogether(
    await evaluateTogetherEligibility(tx, userId),
    "PAID_REQUIRED",
  );
}
/** Peers may be deleted while an owner recovers; only the acting account must be active. */
export async function assertActorActive(tx: TogetherTx, actor: string) {
  const [profile] = await tx
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.id, actor), isNull(profiles.deletedAt)));
  requireTogether(profile, "NOT_FOUND", 404);
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function requestHash(body: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(body)))
    .digest("hex");
}
/** Caller must hold actor locks and reauthorize BEFORE checking a prior receipt. */
export async function replayMutation<T>(
  tx: TogetherTx,
  actor: string,
  route: string,
  key: string,
  body: unknown,
  action: () => Promise<T>,
): Promise<T> {
  requireTogether(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      key,
    ),
    "INVALID_SCHEMA",
    400,
  );
  const hash = requestHash(body);
  const predicate = and(
    eq(togetherReceipts.actorId, actor),
    eq(togetherReceipts.route, route),
    eq(togetherReceipts.key, key),
  );
  const [receipt] = await tx.select().from(togetherReceipts).where(predicate);
  if (receipt) {
    requireTogether(receipt.requestHash === hash, "IDEMPOTENCY_MISMATCH", 409);
    // Schema validated on first execution; JSONB stores the identical response contract.
    return receipt.result as T;
  }
  const result = await action();
  await tx
    .insert(togetherReceipts)
    .values({ actorId: actor, route, key, requestHash: hash, result });
  return result;
}
/** Call under the actor guard; accepted actions count, failures roll back with their transaction. */
export async function enforceRateLimit(
  tx: TogetherTx,
  actor: string,
  bucket: string,
  limit = 30,
) {
  await assertActorActive(tx, actor);
  const now = new Date();
  const predicate = and(
    eq(togetherRateLimits.actorId, actor),
    eq(togetherRateLimits.bucket, bucket),
  );
  const [row] = await tx.select().from(togetherRateLimits).where(predicate);
  const active = row && now.getTime() - row.windowStart.getTime() < 60_000;
  requireTogether(!active || row.attempts < limit, "RATE_LIMITED", 429);
  await tx
    .insert(togetherRateLimits)
    .values({ actorId: actor, bucket, windowStart: now, attempts: 1 })
    .onConflictDoUpdate({
      target: [togetherRateLimits.actorId, togetherRateLimits.bucket],
      set: {
        windowStart: active ? row.windowStart : now,
        attempts: active ? row.attempts + 1 : 1,
      },
    });
}
