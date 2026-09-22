import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
import { getDb } from "@persistence/db/client";
import * as schema from "@persistence/db/schema";
import { assertEntitlement } from "../../entitlement/assertEntitlement";
import { evaluateTogetherEligibility } from "../../entitlement/togetherEligibility";
import {
  assertActorActive,
  assertTogetherPaid,
  discoveryEnabled,
  enforceRateLimit,
  lockActors,
  replayMutation,
  requestHash,
  togetherEnabled,
  TogetherError,
  withActors,
} from "../shared";

const user = randomUUID(),
  other = randomUUID();
let pg: PGlite;
beforeEach(async () => {
  pg = await PGlite.create();
  await pg.exec(`CREATE TABLE profiles(id uuid PRIMARY KEY, deleted_at timestamptz);
  CREATE TABLE subscription_tiers(tier_name text PRIMARY KEY);
  CREATE TABLE user_subscriptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, tier_name text, payment_status text, starts_at timestamptz DEFAULT now(), expires_at timestamptz, cancelled_at timestamptz, metadata jsonb, created_at timestamptz DEFAULT now());
  CREATE TABLE together_actors(user_id uuid PRIMARY KEY REFERENCES profiles(id));
  CREATE TABLE together_receipts(actor_id uuid, route text, key uuid, request_hash text, result jsonb, created_at timestamptz DEFAULT now(), PRIMARY KEY(actor_id,route,key));
  CREATE TABLE together_rate_limits(actor_id uuid,bucket text,window_start timestamptz,attempts integer,PRIMARY KEY(actor_id,bucket));
  INSERT INTO profiles(id) VALUES ('${user}'),('${other}');
  INSERT INTO subscription_tiers VALUES ('free'),('premium'),('premium_plus'),('coach'),('enterprise');`);
  vi.mocked(getDb).mockReturnValue(drizzle(pg, { schema }) as never);
});
afterEach(async () => {
  await pg.close();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function subscription(
  tier = "premium",
  status = "active",
  expires: string | null = null,
  cancelled: string | null = null,
  metadata: unknown = null,
) {
  await pg.query("DELETE FROM user_subscriptions WHERE user_id=$1", [user]);
  await pg.query(
    "INSERT INTO user_subscriptions(user_id,tier_name,payment_status,expires_at,cancelled_at,metadata) VALUES ($1,$2,$3,$4,$5,$6)",
    [user, tier, status, expires, cancelled, metadata],
  );
}
describe("Together shared transactional contracts", () => {
  it("locks known actors in stable order and rejects deleted/unknown actors", async () => {
    await withActors([other, user, user], async (tx) => {
      await lockActors(tx, [user]);
    });
    expect((await pg.query("select * from together_actors")).rows).toHaveLength(
      2,
    );
    await expect(withActors([], async () => 1)).rejects.toMatchObject({
      code: "INVALID_SCHEMA",
      status: 400,
    });
    await expect(
      withActors([randomUUID()], async () => 1),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    await pg.query("UPDATE profiles SET deleted_at=now() WHERE id=$1", [user]);
    await expect(
      withActors([user], (tx) => assertActorActive(tx, user)),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(withActors([other, user], async () => 1)).resolves.toBe(1);
  });
  it("persists canonical actor/route receipts with their effects and rejects changed-body retries", async () => {
    const key = randomUUID();
    let effects = 0;
    const run = (body: unknown) =>
      withActors([user], (tx) =>
        replayMutation(tx, user, "/test", key, body, async () => ({
          effect: ++effects,
        })),
      );
    expect(await run({ a: 1, nested: { y: [2, 3], z: 4 } })).toEqual({
      effect: 1,
    });
    expect(await run({ nested: { z: 4, y: [2, 3] }, a: 1 })).toEqual({
      effect: 1,
    });
    await expect(run({ a: 2 })).rejects.toMatchObject({
      code: "IDEMPOTENCY_MISMATCH",
      status: 409,
    });
    expect(effects).toBe(1);
    await expect(
      withActors([user], (tx) =>
        replayMutation(tx, user, "/test", "bad", {}, async () => 1),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      withActors([user], async (tx) => {
        await replayMutation(tx, user, "/fail", key, {}, async () => 1);
        throw new Error("crash");
      }),
    ).rejects.toThrow("crash");
    expect(
      (await pg.query("select * from together_receipts")).rows,
    ).toHaveLength(1);
    expect(requestHash(null)).not.toEqual(requestHash([]));
  });
  it("rate limits atomically per actor and bucket and resets after a minute", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
    const consume = () =>
      withActors([user], (tx) => enforceRateLimit(tx, user, "invites", 2));
    await Promise.all([consume(), consume()]);
    await expect(consume()).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });
    await withActors([other], (tx) => enforceRateLimit(tx, other, "invites"));
    vi.setSystemTime(new Date("2026-09-21T12:01:00Z"));
    await consume();
    expect(
      (
        await pg.query<{ attempts: number }>(
          "select attempts from together_rate_limits where actor_id=$1",
          [user],
        )
      ).rows[0].attempts,
    ).toBe(1);
  });
  it("fails closed by default and carries typed public errors", () => {
    vi.stubEnv("TOGETHER_ENABLED", "");
    vi.stubEnv("TOGETHER_DISCOVERY_ENABLED", "");
    expect(togetherEnabled()).toBe(false);
    expect(discoveryEnabled()).toBe(false);
    vi.stubEnv("TOGETHER_ENABLED", "true");
    vi.stubEnv("TOGETHER_DISCOVERY_ENABLED", "true");
    expect(togetherEnabled()).toBe(true);
    expect(discoveryEnabled()).toBe(true);
    expect(
      new TogetherError("VERSION_CONFLICT", 409, "Conflict", 7),
    ).toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
      message: "Conflict",
      currentRevision: 7,
    });
  });
});
describe("effective Together paid eligibility", () => {
  it("rejects missing/deleted accounts, free, unknown, future and unpaid subscriptions", async () => {
    expect(await evaluateTogetherEligibility(getDb(), randomUUID())).toBe(
      false,
    );
    expect(await evaluateTogetherEligibility(getDb(), user)).toBe(false);
    for (const [tier, status] of [
      ["free", "active"],
      ["unknown", "active"],
      ["enterprise", "active"],
      ["premium", "pending"],
      ["premium", "past_due"],
    ]) {
      await subscription(tier, status);
      expect(await evaluateTogetherEligibility(getDb(), user)).toBe(false);
    }
    await subscription();
    await pg.exec(
      "UPDATE user_subscriptions SET starts_at=now()+interval '1 day'",
    );
    expect(await evaluateTogetherEligibility(getDb(), user)).toBe(false);
    await subscription();
    await pg.query("UPDATE profiles SET deleted_at=now() WHERE id=$1", [user]);
    expect(await evaluateTogetherEligibility(getDb(), user)).toBe(false);
  });
  it("accepts effective consumer/coach grants and paid-through cancellation but denies lapsed periods", async () => {
    for (const tier of ["premium", "premium_plus", "coach"]) {
      await subscription(tier);
      expect(await evaluateTogetherEligibility(getDb(), user)).toBe(true);
    }
    await subscription(
      "premium",
      "cancelled",
      "2099-01-01T00:00:00Z",
      "2026-01-01T00:00:00Z",
    );
    expect(await evaluateTogetherEligibility(getDb(), user)).toBe(true);
    await subscription("premium", "active", "2000-01-01T00:00:00Z");
    expect(await evaluateTogetherEligibility(getDb(), user)).toBe(false);
    await subscription("premium", "trialing");
    expect(await evaluateTogetherEligibility(getDb(), user)).toBe(true);
  });
  it("resolves scheduled downgrades and requires a real catalog row", async () => {
    await subscription("premium", "active", null, null, {
      scheduled_change: {
        next_tier_name: "free",
        effective_at: "2000-01-01T00:00:00Z",
      },
    });
    expect(await evaluateTogetherEligibility(getDb(), user)).toBe(false);
    await subscription("premium", "active", "2000-01-01T00:00:00Z", null, {
      scheduled_change: {
        next_tier_name: "premium_plus",
        effective_at: "2000-01-01T00:00:00Z",
      },
    });
    expect(await evaluateTogetherEligibility(getDb(), user)).toBe(true);
    await pg.exec(
      "DELETE FROM subscription_tiers WHERE tier_name='premium_plus'",
    );
    expect(await evaluateTogetherEligibility(getDb(), user)).toBe(false);
  });
  it("enforces the shared gate and removes the gym_buddy accept-all bypass", async () => {
    await expect(
      withActors([user], (tx) => assertTogetherPaid(tx, user)),
    ).rejects.toMatchObject({ code: "PAID_REQUIRED", status: 403 });
    expect(await assertEntitlement(user, "gym_buddy")).toMatchObject({
      allowed: false,
    });
    await subscription();
    await expect(
      withActors([user], (tx) => assertTogetherPaid(tx, user)),
    ).resolves.toBeUndefined();
    expect(await assertEntitlement(user, "gym_buddy")).toEqual({
      allowed: true,
    });
  });
});
