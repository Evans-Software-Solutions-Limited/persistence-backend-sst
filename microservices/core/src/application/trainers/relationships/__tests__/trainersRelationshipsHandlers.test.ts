/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "@persistence/db/client";

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "client-id",
      email: "c@example.com",
      email_verified: true,
      iat: 0,
      exp: 9999999999,
    };
  }),
  requireAuth: vi.fn((ctx: any) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  }),
  getUser: vi.fn((ctx) => ctx.user || { sub: "client-id" }),
}));

// Seat gates are unit-tested against the DB mock in trainerSeats.test.ts; here
// they're mocked so the accept-handler tests focus on wiring: allow → activate,
// deny → 409 + trainer notification.
const evaluateActiveSeat = vi.fn(async () => ({ allowed: true }) as any);
const notifyLimitReached = vi.fn(async () => {});
vi.mock("../../seats/trainerSeats", () => ({
  evaluateTrainerClientsActiveSeat: (...args: unknown[]) =>
    evaluateActiveSeat(...(args as [])),
  notifyTrainerClientLimitReached: (...args: unknown[]) =>
    notifyLimitReached(...(args as [])),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

/**
 * Thenable query-builder mock: every chain method returns the builder, and
 * awaiting it resolves to the next queued result (one entry == one awaited
 * query, in execution order). Mirrors the invite-code handler test executor.
 */
function executor(queue: unknown[]) {
  let i = 0;
  const builder: any = {};
  const passthrough = () => builder;
  for (const m of [
    "select",
    "from",
    "where",
    "innerJoin",
    "leftJoin",
    "orderBy",
    "limit",
    "update",
    "set",
    "returning",
    "for", // SELECT ... FOR UPDATE row lock
  ]) {
    builder[m] = vi.fn(passthrough);
  }
  builder.then = (
    resolve: (v: unknown[]) => unknown,
    reject: (e: unknown) => unknown,
  ) => {
    const next = queue[i++] ?? [];
    if (next instanceof Error) return reject(next);
    return resolve(next as unknown[]);
  };
  return builder;
}

/**
 * A db mock whose `.transaction(fn)` runs `fn` against the SAME queued
 * executor (so the accept path's tx reads pop from one queue), while still
 * exposing the direct builder methods the decline path uses. One queue entry
 * == one awaited query, in execution order.
 */
function txDb(queue: unknown[]) {
  const ex = executor(queue);
  (ex as any).transaction = vi.fn(async (fn: any) => fn(ex));
  return ex;
}

describe("trainersRespondToRequestHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  function post(relationshipId: string, body: unknown, headers = auth) {
    return new Request(
      `http://localhost/clients/me/relationships/${relationshipId}/respond`,
      { method: "POST", headers, body: JSON.stringify(body) },
    );
  }

  it("requires auth", async () => {
    const { trainersRespondToRequestHandler } =
      await import("../trainersRespondToRequestHandler");
    const res = await trainersRespondToRequestHandler.handle(
      new Request("http://localhost/clients/me/relationships/rel-1/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("accepts a pending request → status active (under cap)", async () => {
    evaluateActiveSeat.mockResolvedValueOnce({ allowed: true } as any);
    (getDb as any).mockReturnValue(
      txDb([
        [{ id: "rel-1", trainerId: "trainer-1" }], // select pending rel
        [{ id: "trainer-1" }], // FOR UPDATE lock
        [{ id: "rel-1", trainerId: "trainer-1", status: "active" }], // update
      ]),
    );
    const { trainersRespondToRequestHandler } =
      await import("../trainersRespondToRequestHandler");
    const res = await trainersRespondToRequestHandler.handle(
      post("rel-1", { action: "accept" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.success).toBe(true);
    expect(body.data.status).toBe("active");
    expect(body.data.trainerId).toBe("trainer-1");
    expect(notifyLimitReached).not.toHaveBeenCalled();
  });

  it("409 when the trainer is at their client-slot cap (client actor → NOT a 402 upsell) + notifies the trainer", async () => {
    const denyVerdict = {
      allowed: false,
      reason: "limit",
      currentTier: "individual_trainer",
      upgradeTo: "small_business",
      upgradePriceMonthly: 49.99,
    };
    evaluateActiveSeat.mockResolvedValueOnce(denyVerdict as any);
    (getDb as any).mockReturnValue(
      txDb([
        [{ id: "rel-1", trainerId: "trainer-1" }], // select pending rel
        [{ id: "trainer-1" }], // FOR UPDATE lock
        // NO update row consumed — cap rejected before the activate UPDATE.
      ]),
    );
    const { trainersRespondToRequestHandler } =
      await import("../trainersRespondToRequestHandler");
    const res = await trainersRespondToRequestHandler.handle(
      post("rel-1", { action: "accept" }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.code).toBe("coach_client_limit_reached");
    // The response must NOT leak the internal trainer/verdict fields.
    expect(body.trainerId).toBeUndefined();
    expect(body.verdict).toBeUndefined();
    // Trainer is notified post-commit with the verdict's upgrade pointer.
    expect(notifyLimitReached).toHaveBeenCalledWith("trainer-1", denyVerdict);
  });

  it("declines a pending request → status terminated (no cap check)", async () => {
    (getDb as any).mockReturnValue(
      txDb([[{ id: "rel-1", trainerId: "trainer-1", status: "terminated" }]]),
    );
    const { trainersRespondToRequestHandler } =
      await import("../trainersRespondToRequestHandler");
    const res = await trainersRespondToRequestHandler.handle(
      post("rel-1", { action: "decline" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.status).toBe("terminated");
    expect(evaluateActiveSeat).not.toHaveBeenCalled();
    expect(notifyLimitReached).not.toHaveBeenCalled();
  });

  it("404 on accept when no pending row matches (not owned / already moved)", async () => {
    (getDb as any).mockReturnValue(txDb([[]])); // select pending returns 0 rows
    const { trainersRespondToRequestHandler } =
      await import("../trainersRespondToRequestHandler");
    const res = await trainersRespondToRequestHandler.handle(
      post("rel-1", { action: "accept" }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("not_found");
    expect(evaluateActiveSeat).not.toHaveBeenCalled();
  });

  it("404 on decline when no pending row matches", async () => {
    (getDb as any).mockReturnValue(txDb([[]])); // update returns 0 rows
    const { trainersRespondToRequestHandler } =
      await import("../trainersRespondToRequestHandler");
    const res = await trainersRespondToRequestHandler.handle(
      post("rel-1", { action: "decline" }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("not_found");
  });

  it("422 for an invalid action", async () => {
    (getDb as any).mockReturnValue(txDb([[]]));
    const { trainersRespondToRequestHandler } =
      await import("../trainersRespondToRequestHandler");
    const res = await trainersRespondToRequestHandler.handle(
      post("rel-1", { action: "maybe" }),
    );
    expect(res.status).toBe(422);
  });
});

describe("trainersClientRelationshipsListHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  function get(query = "", headers = auth) {
    return new Request(`http://localhost/clients/me/relationships${query}`, {
      headers,
    });
  }

  it("requires auth", async () => {
    const { trainersClientRelationshipsListHandler } =
      await import("../trainersClientRelationshipsListHandler");
    const res = await trainersClientRelationshipsListHandler.handle(
      new Request("http://localhost/clients/me/relationships"),
    );
    expect(res.status).toBe(401);
  });

  it("returns pending + active when no status filter is given", async () => {
    (getDb as any).mockReturnValue(
      executor([
        [
          {
            relationshipId: "rel-1",
            trainerId: "trainer-1",
            status: "pending",
            relationshipReason: "Joined via invite code",
            createdAt: new Date("2026-06-01T00:00:00.000Z"),
            trainerName: "Coach Carter",
            trainerRole: "personal_trainer",
            trainerAvatarUrl: null,
          },
          {
            relationshipId: "rel-2",
            trainerId: "trainer-2",
            status: "terminated",
            relationshipReason: null,
            createdAt: new Date("2026-05-01T00:00:00.000Z"),
            trainerName: "Old Coach",
            trainerRole: "personal_trainer",
            trainerAvatarUrl: null,
          },
        ],
      ]),
    );
    const { trainersClientRelationshipsListHandler } =
      await import("../trainersClientRelationshipsListHandler");
    const res = await trainersClientRelationshipsListHandler.handle(get());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    // terminated row filtered out when no status filter
    expect(body.data).toHaveLength(1);
    expect(body.data[0].relationshipId).toBe("rel-1");
    expect(body.data[0].trainerName).toBe("Coach Carter");
    expect(body.data[0].since).toBe("2026-06-01T00:00:00.000Z");
  });

  it("passes through rows for an explicit status filter", async () => {
    (getDb as any).mockReturnValue(
      executor([
        [
          {
            relationshipId: "rel-1",
            trainerId: "trainer-1",
            status: "active",
            relationshipReason: null,
            createdAt: new Date("2026-06-01T00:00:00.000Z"),
            trainerName: "Coach Carter",
            trainerRole: "personal_trainer",
            trainerAvatarUrl: null,
          },
        ],
      ]),
    );
    const { trainersClientRelationshipsListHandler } =
      await import("../trainersClientRelationshipsListHandler");
    const res = await trainersClientRelationshipsListHandler.handle(
      get("?status=active"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].status).toBe("active");
  });
});
