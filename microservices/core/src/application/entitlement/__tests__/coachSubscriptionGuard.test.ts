import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import Elysia from "elysia";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@persistence/db/schema";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));
vi.mock("@persistence/api-utils/auth/supabaseAuth", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@persistence/api-utils/auth/supabaseAuth")
    >();
  return {
    ...actual,
    // "Bearer <uuid>" is a valid JWT for that user; anything else is refused.
    getAuthUser: vi.fn(async (authHeader: string | undefined) =>
      authHeader?.startsWith("Bearer 0000")
        ? { sub: authHeader.slice(7) }
        : null,
    ),
  };
});

import { getDb } from "@persistence/db/client";
import {
  getAuthUser,
  getUser,
  requireAuth,
} from "@persistence/api-utils/auth/supabaseAuth";
import {
  COACH_SUBSCRIPTION_REQUIRED,
  coachSubscriptionGuard,
  coachWorkspaceGuard,
  hasActiveCoachSubscription,
  isCoachWorkspaceRoute,
} from "../coachSubscriptionGuard";

const COACH = "00000000-0000-4000-8000-000000000001"; // active `coach`
const LAPSED = "00000000-0000-4000-8000-000000000002"; // expired `coach`
const ATHLETE = "00000000-0000-4000-8000-000000000003"; // active `premium`
const NO_SUB = "00000000-0000-4000-8000-000000000004"; // no row at all
const FOUNDING = "00000000-0000-4000-8000-000000000005"; // granted, cancelled, paid through
const CANCELLED = "00000000-0000-4000-8000-000000000006"; // cancelled, period over
// Period-end tier changes whose renewal webhook hasn't landed yet: the row
// still names the outgoing tier and its `expires_at` has passed.
const COACH_TO_PREMIUM = "00000000-0000-4000-8000-000000000007";
const PREMIUM_TO_COACH = "00000000-0000-4000-8000-000000000008";
const COACH_TO_PREMIUM_LATER = "00000000-0000-4000-8000-000000000009"; // not yet effective
const COACH_TO_GHOST = "00000000-0000-4000-8000-00000000000a"; // scheduled tier off-catalog

const scheduled = (tier: string, when: "past" | "future") =>
  JSON.stringify({
    scheduled_change: {
      next_tier_name: tier,
      effective_at: new Date(
        Date.now() + (when === "past" ? -1 : 1) * 3_600_000,
      ).toISOString(),
    },
  });

let pg: PGlite;

beforeAll(async () => {
  pg = await PGlite.create();
});
afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  vi.mocked(getDb).mockReturnValue(drizzle(pg, { schema }) as never);
  // Only the columns the entitlement resolver reads.
  await pg.exec(`
    CREATE TABLE subscription_tiers (
      tier_name text PRIMARY KEY,
      workout_limit integer,
      ai_access boolean,
      price_monthly numeric,
      trainer_client_limit integer,
      is_trainer_tier boolean
    );
    CREATE TABLE user_subscriptions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      tier_name text NOT NULL,
      payment_status text NOT NULL,
      expires_at timestamptz,
      cancelled_at timestamptz,
      metadata jsonb,
      created_at timestamptz DEFAULT now()
    );
    INSERT INTO subscription_tiers VALUES
      ('free', 3, false, 0, NULL, false),
      ('premium', NULL, true, 7.99, NULL, false),
      ('individual_trainer', NULL, true, 18.99, 5, true),
      ('coach', NULL, true, 49.99, 15, true);
    INSERT INTO user_subscriptions
      (user_id, tier_name, payment_status, expires_at, cancelled_at) VALUES
      ('${COACH}', 'coach', 'active', now() + interval '20 days', NULL),
      ('${LAPSED}', 'coach', 'active', now() - interval '1 day', NULL),
      ('${ATHLETE}', 'premium', 'active', now() + interval '20 days', NULL),
      ('${FOUNDING}', 'individual_trainer', 'cancelled', now() + interval '300 days', now()),
      ('${CANCELLED}', 'coach', 'cancelled', now() - interval '1 day', now() - interval '30 days');
    INSERT INTO user_subscriptions
      (user_id, tier_name, payment_status, expires_at, metadata) VALUES
      ('${COACH_TO_PREMIUM}', 'coach', 'active', now() - interval '1 hour', '${scheduled("premium", "past")}'),
      ('${PREMIUM_TO_COACH}', 'premium', 'active', now() - interval '1 hour', '${scheduled("coach", "past")}'),
      ('${COACH_TO_PREMIUM_LATER}', 'coach', 'active', now() + interval '1 day', '${scheduled("premium", "future")}'),
      ('${COACH_TO_GHOST}', 'coach', 'active', now() - interval '1 hour', '${scheduled("retired_tier", "past")}');
  `);
});

/** A coach route built like the real handlers: own JWT derive + requireAuth. */
function coachRoutes(prefix = "") {
  return new Elysia()
    .derive(async ({ headers }) => ({
      user: await getAuthUser(headers.authorization),
    }))
    .onBeforeHandle(requireAuth)
    .get(`${prefix}/trainers/me/clients`, (ctx) => ({
      data: { coach: getUser(ctx).sub },
    }))
    .post(`${prefix}/trainers/me/programs/:id/assign`, () => ({ ok: true }))
    .get("/clients/:clientId/body-trend", () => ({ ok: true }))
    .get("/clients/me/relationships", () => ({ ok: true }))
    .post("/trainers/accept-invite-code", () => ({ ok: true }));
}

/** The real wiring: guard on the root, routes nested two sub-apps deep. */
function app() {
  return new Elysia()
    .use(coachWorkspaceGuard)
    .get("/health", () => ({ status: "ok" }))
    .use(new Elysia().use(coachRoutes()));
}

function call(
  path: string,
  userId: string | null,
  method: "GET" | "POST" = "GET",
  target: { handle: (request: Request) => Promise<Response> } = app(),
) {
  return target.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: userId ? { authorization: `Bearer ${userId}` } : {},
    }),
  );
}

describe("isCoachWorkspaceRoute", () => {
  it("covers /trainers/me and everything under it", () => {
    expect(isCoachWorkspaceRoute("/trainers/me")).toBe(true);
    expect(isCoachWorkspaceRoute("/trainers/me/overview")).toBe(true);
    expect(
      isCoachWorkspaceRoute("/trainers/me/clients/:clientId/notes/:noteId"),
    ).toBe(true);
    // A route PER-122 adds later is covered without any change here.
    expect(isCoachWorkspaceRoute("/trainers/me/resources/:id")).toBe(true);
  });

  it("covers the two legacy coach routes outside the prefix", () => {
    expect(isCoachWorkspaceRoute("/clients/:clientId/measurements")).toBe(true);
    expect(isCoachWorkspaceRoute("/clients/:clientId/body-trend")).toBe(true);
  });

  it("leaves athlete-side and unrelated routes alone", () => {
    expect(isCoachWorkspaceRoute(undefined)).toBe(false);
    expect(isCoachWorkspaceRoute("")).toBe(false);
    expect(isCoachWorkspaceRoute("/trainers/meals")).toBe(false);
    expect(isCoachWorkspaceRoute("/trainers/accept-invite-code")).toBe(false);
    expect(isCoachWorkspaceRoute("/clients/me/relationships")).toBe(false);
    expect(
      isCoachWorkspaceRoute(
        "/clients/me/relationships/:relationshipId/respond",
      ),
    ).toBe(false);
    expect(isCoachWorkspaceRoute("/programs/:id")).toBe(false);
    expect(isCoachWorkspaceRoute("/profile")).toBe(false);
  });
});

describe("hasActiveCoachSubscription (reuses the catalog's is_trainer_tier)", () => {
  it("is true for an active coach tier", async () => {
    expect(await hasActiveCoachSubscription(COACH)).toBe(true);
  });
  it("is true for a cancelled grant that is still paid through", async () => {
    expect(await hasActiveCoachSubscription(FOUNDING)).toBe(true);
  });
  it("is false once the coach row has lapsed", async () => {
    expect(await hasActiveCoachSubscription(LAPSED)).toBe(false);
    expect(await hasActiveCoachSubscription(CANCELLED)).toBe(false);
  });
  it("follows a period-end tier change once it has taken effect, even before the webhook", async () => {
    // Coach → Premium past effective_at: no longer a coach.
    expect(await hasActiveCoachSubscription(COACH_TO_PREMIUM)).toBe(false);
    // Premium → coach past effective_at: a coach now.
    expect(await hasActiveCoachSubscription(PREMIUM_TO_COACH)).toBe(true);
    // Not yet effective: the original tier still decides.
    expect(await hasActiveCoachSubscription(COACH_TO_PREMIUM_LATER)).toBe(true);
    // A scheduled tier with no catalog row is free rules, so not a coach.
    expect(await hasActiveCoachSubscription(COACH_TO_GHOST)).toBe(false);
  });

  it("is false for an athlete tier or no subscription", async () => {
    expect(await hasActiveCoachSubscription(ATHLETE)).toBe(false);
    expect(await hasActiveCoachSubscription(NO_SUB)).toBe(false);
  });
});

describe("coachWorkspaceGuard on the root app", () => {
  it("lets a coach with an active subscription in", async () => {
    const res = await call("/trainers/me/clients", COACH);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { coach: COACH } });
    expect(
      (await call("/trainers/me/programs/p1/assign", COACH, "POST")).status,
    ).toBe(200);
    expect((await call("/clients/c1/body-trend", COACH)).status).toBe(200);
  });

  it("lets a founding / granted coach tier in", async () => {
    expect((await call("/trainers/me/clients", FOUNDING)).status).toBe(200);
  });

  it("follows a scheduled tier change on the route (in effect, and not yet)", async () => {
    expect((await call("/trainers/me/clients", PREMIUM_TO_COACH)).status).toBe(
      200,
    );
    expect(
      (await call("/trainers/me/clients", COACH_TO_PREMIUM_LATER)).status,
    ).toBe(200);
  });

  it.each([
    ["a coach whose subscription lapsed", LAPSED],
    ["a coach whose cancelled period ended", CANCELLED],
    ["an athlete on Premium", ATHLETE],
    ["an account with no subscription", NO_SUB],
    [
      "a coach whose scheduled move to Premium has taken effect",
      COACH_TO_PREMIUM,
    ],
  ])("refuses %s with 403 coach_subscription_required", async (_, userId) => {
    for (const [path, method] of [
      ["/trainers/me/clients", "GET"],
      ["/trainers/me/programs/p1/assign", "POST"],
      ["/clients/c1/body-trend", "GET"],
    ] as const) {
      const res = await call(path, userId, method);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        code: COACH_SUBSCRIPTION_REQUIRED,
        message: expect.stringContaining("coach plan"),
      });
    }
  });

  it("leaves signed-out requests to the route's own 401", async () => {
    const res = await call("/trainers/me/clients", null);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: "Unauthorized" });
    const bad = await app().handle(
      new Request("http://localhost/trainers/me/clients", {
        headers: { authorization: "Bearer not-a-real-token" },
      }),
    );
    expect(bad.status).toBe(401);
  });

  it("refuses a coach on the first call after the subscription lapses mid-session", async () => {
    const target = app();
    expect(
      (await call("/trainers/me/clients", COACH, "GET", target)).status,
    ).toBe(200);
    await pg.query(
      "UPDATE user_subscriptions SET expires_at = now() - interval '1 minute' WHERE user_id = $1",
      [COACH],
    );
    const res = await call("/trainers/me/clients", COACH, "GET", target);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: COACH_SUBSCRIPTION_REQUIRED,
    });
  });

  it("never gates athlete-side or unrelated routes", async () => {
    for (const userId of [ATHLETE, NO_SUB, LAPSED]) {
      expect((await call("/clients/me/relationships", userId)).status).toBe(
        200,
      );
      expect(
        (await call("/trainers/accept-invite-code", userId, "POST")).status,
      ).toBe(200);
      expect((await call("/health", userId)).status).toBe(200);
    }
  });
});

describe("coachSubscriptionGuard (one-line reuse on a route group)", () => {
  function group(path: string) {
    return new Elysia()
      .use(coachSubscriptionGuard)
      .derive(async ({ headers }) => ({
        user: await getAuthUser(headers.authorization),
      }))
      .onBeforeHandle(requireAuth)
      .get(path, () => ({ ok: true }));
  }
  // Two sibling groups, so plugin de-duplication can't drop the second.
  const target = () =>
    new Elysia()
      .use(group("/coach-tools/a"))
      .use(group("/coach-tools/b"))
      .get("/open", () => ({ ok: true }));

  it("guards every group it is used in, and nothing outside them", async () => {
    for (const path of ["/coach-tools/a", "/coach-tools/b"]) {
      expect((await call(path, COACH, "GET", target())).status).toBe(200);
      const refused = await call(path, ATHLETE, "GET", target());
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({
        code: COACH_SUBSCRIPTION_REQUIRED,
      });
      expect((await call(path, null, "GET", target())).status).toBe(401);
    }
    expect((await call("/open", ATHLETE, "GET", target())).status).toBe(200);
  });
});
