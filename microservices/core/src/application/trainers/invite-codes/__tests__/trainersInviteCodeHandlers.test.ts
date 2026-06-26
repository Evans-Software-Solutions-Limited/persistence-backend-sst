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
      sub: "user-id",
      email: "u@example.com",
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
  getUser: vi.fn((ctx) => ctx.user || { sub: "user-id" }),
}));

// Spy on the trainer-facing notification emitted after a successful join.
const notificationCreate = vi.fn(async () => ({}));
vi.mock("../../../repositories/notificationRepository", () => ({
  NotificationRepository: vi.fn(() => ({ create: notificationCreate })),
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

/**
 * A query-builder mock that is thenable at every chain step and pulls the next
 * queued result when awaited. Every chain method (select/from/where/insert/…)
 * returns the same builder; awaiting it (at `.limit()`, `.returning()`, or a
 * bare `.where()`) resolves to the next entry in `queue`. One entry == one
 * awaited query, in execution order.
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
    "groupBy",
    "limit",
    "offset",
    "insert",
    "update",
    "set",
    "values",
    "onConflictDoUpdate",
    "returning",
  ]) {
    builder[m] = vi.fn(passthrough);
  }
  builder.then = (
    resolve: (v: unknown[]) => unknown,
    reject: (e: unknown) => unknown,
  ) => {
    const next = queue[i++] ?? [];
    // An Error entry simulates the query throwing (e.g. a unique violation).
    if (next instanceof Error) return reject(next);
    return resolve(next as unknown[]);
  };
  return builder;
}

/** Build a Postgres-style unique-violation error (SQLSTATE 23505). */
function uniqueViolation(constraint: string): Error {
  const err = new Error(`duplicate key value violates unique constraint`);
  (err as any).code = "23505";
  (err as any).constraint_name = constraint;
  return err;
}

describe("trainersInviteCodeCreateHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  function post(headers = auth) {
    return new Request("http://localhost/trainers/me/invite-codes", {
      method: "POST",
      headers,
    });
  }

  it("requires auth", async () => {
    const { trainersInviteCodeCreateHandler } =
      await import("../trainersInviteCodeCreateHandler");
    const res = await trainersInviteCodeCreateHandler.handle(
      new Request("http://localhost/trainers/me/invite-codes", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("403 for non-trainers", async () => {
    (getDb as any).mockReturnValue(executor([[{ role: "user" }]]));
    const { trainersInviteCodeCreateHandler } =
      await import("../trainersInviteCodeCreateHandler");
    const res = await trainersInviteCodeCreateHandler.handle(post());
    expect(res.status).toBe(403);
  });

  it("returns the existing active code when one is live", async () => {
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    (getDb as any).mockReturnValue(
      executor([
        [{ role: "personal_trainer" }], // role check
        [], // expire-stale update
        [{ id: "code-1", code: "ABC123", expiresAt }], // existing active
      ]),
    );
    const { trainersInviteCodeCreateHandler } =
      await import("../trainersInviteCodeCreateHandler");
    const res = await trainersInviteCodeCreateHandler.handle(post());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.code).toBe("ABC123");
    expect(body.data.isExisting).toBe(true);
  });

  it("creates a new code when none is active (201)", async () => {
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    (getDb as any).mockReturnValue(
      executor([
        [{ role: "admin" }], // role check (admin allowed)
        [], // expire-stale update
        [], // no existing active code
        [{ id: "code-new", code: "XYZ789", expiresAt }], // insert returning
      ]),
    );
    const { trainersInviteCodeCreateHandler } =
      await import("../trainersInviteCodeCreateHandler");
    const res = await trainersInviteCodeCreateHandler.handle(post());
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.code).toBe("XYZ789");
    expect(body.data.isExisting).toBe(false);
  });

  it("returns the concurrent code on a trainer-active unique collision", async () => {
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    (getDb as any).mockReturnValue(
      executor([
        [{ role: "personal_trainer" }], // role check
        [], // expire-stale update
        [], // no existing active code
        uniqueViolation("trainer_invite_codes_trainer_active_uq"), // insert throws
        [{ id: "code-conc", code: "CONC11", expiresAt }], // re-fetch concurrent
      ]),
    );
    const { trainersInviteCodeCreateHandler } =
      await import("../trainersInviteCodeCreateHandler");
    const res = await trainersInviteCodeCreateHandler.handle(post());
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.code).toBe("CONC11");
    expect(body.data.isExisting).toBe(true);
  });

  it("regenerates after a code-value collision then succeeds", async () => {
    const expiresAt = new Date("2030-01-01T00:00:00.000Z");
    (getDb as any).mockReturnValue(
      executor([
        [{ role: "personal_trainer" }], // role check
        [], // expire-stale update
        [], // no existing active code
        uniqueViolation("trainer_invite_codes_code_active_uq"), // 1st insert collides
        [{ id: "code-2", code: "RETRY1", expiresAt }], // 2nd insert succeeds
      ]),
    );
    const { trainersInviteCodeCreateHandler } =
      await import("../trainersInviteCodeCreateHandler");
    const res = await trainersInviteCodeCreateHandler.handle(post());
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.code).toBe("RETRY1");
  });

  it("rethrows a non-unique DB error", async () => {
    const boom = new Error("connection reset");
    (getDb as any).mockReturnValue(
      executor([
        [{ role: "personal_trainer" }],
        [],
        [],
        boom, // insert throws a non-23505 error
      ]),
    );
    const { trainersInviteCodeCreateHandler } =
      await import("../trainersInviteCodeCreateHandler");
    const res = await trainersInviteCodeCreateHandler.handle(post());
    expect(res.status).toBe(500);
  });

  it("500 after exhausting code-collision retries", async () => {
    (getDb as any).mockReturnValue(
      executor([
        [{ role: "personal_trainer" }], // role check
        [], // expire-stale update
        [], // no existing active code
        // 5 consecutive code-value collisions exhaust the retry loop
        uniqueViolation("trainer_invite_codes_code_active_uq"),
        uniqueViolation("trainer_invite_codes_code_active_uq"),
        uniqueViolation("trainer_invite_codes_code_active_uq"),
        uniqueViolation("trainer_invite_codes_code_active_uq"),
        uniqueViolation("trainer_invite_codes_code_active_uq"),
      ]),
    );
    const { trainersInviteCodeCreateHandler } =
      await import("../trainersInviteCodeCreateHandler");
    const res = await trainersInviteCodeCreateHandler.handle(post());
    expect(res.status).toBe(500);
  });
});

describe("trainersAcceptInviteCodeHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  function post(body: unknown, headers = auth) {
    return new Request("http://localhost/trainers/accept-invite-code", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  /** db whose transaction(fn) runs fn against a queued executor. */
  function txDb(queue: unknown[]) {
    const tx = executor(queue);
    return { transaction: vi.fn(async (fn: any) => fn(tx)) };
  }

  it("requires auth", async () => {
    const { trainersAcceptInviteCodeHandler } =
      await import("../trainersAcceptInviteCodeHandler");
    const res = await trainersAcceptInviteCodeHandler.handle(
      new Request("http://localhost/trainers/accept-invite-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "ABC123" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("404 for an invalid / expired code", async () => {
    (getDb as any).mockReturnValue(txDb([[]])); // no code found
    const { trainersAcceptInviteCodeHandler } =
      await import("../trainersAcceptInviteCodeHandler");
    const res = await trainersAcceptInviteCodeHandler.handle(
      post({ code: "NOPE12" }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("invalid_code");
  });

  it("400 when the trainer tries to redeem their own code", async () => {
    (getDb as any).mockReturnValue(
      txDb([[{ id: "code-1", trainerId: "user-id" }]]), // trainer == caller
    );
    const { trainersAcceptInviteCodeHandler } =
      await import("../trainersAcceptInviteCodeHandler");
    const res = await trainersAcceptInviteCodeHandler.handle(
      post({ code: "ABC123" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.code).toBe("self_invite");
  });

  it("409 when a live relationship already exists", async () => {
    (getDb as any).mockReturnValue(
      txDb([
        [{ id: "code-1", trainerId: "trainer-1" }], // code
        [{ id: "rel-1", status: "active" }], // existing active rel
      ]),
    );
    const { trainersAcceptInviteCodeHandler } =
      await import("../trainersAcceptInviteCodeHandler");
    const res = await trainersAcceptInviteCodeHandler.handle(
      post({ code: "ABC123" }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.code).toBe("exists");
  });

  it("409 when the code was claimed concurrently (claim returns 0 rows)", async () => {
    (getDb as any).mockReturnValue(
      txDb([
        [{ id: "code-1", trainerId: "trainer-1" }], // code
        [], // no existing rel
        [{ fullName: "Coach" }], // trainer name
        [], // claim update returns 0 rows → lost the race
      ]),
    );
    const { trainersAcceptInviteCodeHandler } =
      await import("../trainersAcceptInviteCodeHandler");
    const res = await trainersAcceptInviteCodeHandler.handle(
      post({ code: "ABC123" }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.code).toBe("code_already_used");
  });

  it("201 creates a pending relationship on success", async () => {
    (getDb as any).mockReturnValue(
      txDb([
        [{ id: "code-1", trainerId: "trainer-1" }], // code
        [], // no existing rel
        [{ fullName: "Coach Carter" }], // trainer name + role
        [{ id: "code-1" }], // claim succeeds (1 row)
        [{ id: "rel-new" }], // relationship insert returning
        [{ fullName: "Jordan" }], // client name (notification copy)
      ]),
    );
    const { trainersAcceptInviteCodeHandler } =
      await import("../trainersAcceptInviteCodeHandler");
    const res = await trainersAcceptInviteCodeHandler.handle(
      post({ code: "ABC123" }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.success).toBe(true);
    expect(body.data.relationshipId).toBe("rel-new");
    expect(body.data.trainerName).toBe("Coach Carter");
  });

  it("notifies the trainer of the new request on success", async () => {
    (getDb as any).mockReturnValue(
      txDb([
        [{ id: "code-1", trainerId: "trainer-1" }], // code
        [], // no existing rel
        [{ fullName: "Coach Carter", role: "personal_trainer" }], // trainer
        [{ id: "code-1" }], // claim succeeds
        [{ id: "rel-new" }], // relationship insert returning
        [{ fullName: "Jordan" }], // client name
      ]),
    );
    const { trainersAcceptInviteCodeHandler } =
      await import("../trainersAcceptInviteCodeHandler");
    await trainersAcceptInviteCodeHandler.handle(post({ code: "ABC123" }));

    expect(notificationCreate).toHaveBeenCalledTimes(1);
    expect(notificationCreate).toHaveBeenCalledWith(
      "trainer-1",
      expect.objectContaining({
        type: "pt_request",
        relatedEntityType: "pt_relationship",
        relatedEntityId: "rel-new",
      }),
    );
  });

  it("emits a physio_request when the trainer is a physiotherapist", async () => {
    (getDb as any).mockReturnValue(
      txDb([
        [{ id: "code-1", trainerId: "trainer-1" }],
        [],
        [{ fullName: "Dr. Lee", role: "physiotherapist" }],
        [{ id: "code-1" }],
        [{ id: "rel-new" }],
        [{ fullName: "Jordan" }],
      ]),
    );
    const { trainersAcceptInviteCodeHandler } =
      await import("../trainersAcceptInviteCodeHandler");
    await trainersAcceptInviteCodeHandler.handle(post({ code: "ABC123" }));

    expect(notificationCreate).toHaveBeenCalledWith(
      "trainer-1",
      expect.objectContaining({ type: "physio_request" }),
    );
  });

  it("still returns 201 when the notification emit fails", async () => {
    notificationCreate.mockRejectedValueOnce(new Error("notify boom"));
    (getDb as any).mockReturnValue(
      txDb([
        [{ id: "code-1", trainerId: "trainer-1" }],
        [],
        [{ fullName: "Coach Carter" }],
        [{ id: "code-1" }],
        [{ id: "rel-new" }],
        [{ fullName: "Jordan" }],
      ]),
    );
    const { trainersAcceptInviteCodeHandler } =
      await import("../trainersAcceptInviteCodeHandler");
    const res = await trainersAcceptInviteCodeHandler.handle(
      post({ code: "ABC123" }),
    );
    expect(res.status).toBe(201);
  });

  it("201 revives a dormant relationship on success", async () => {
    (getDb as any).mockReturnValue(
      txDb([
        [{ id: "code-1", trainerId: "trainer-1" }], // code
        [{ id: "rel-old", status: "terminated" }], // dormant rel
        [{ fullName: "Coach" }], // trainer name + role
        [{ id: "code-1" }], // claim succeeds
        // revive uses update (awaited at .where → next queue entry)
        [],
        [{ fullName: "Jordan" }], // client name (notification copy)
      ]),
    );
    const { trainersAcceptInviteCodeHandler } =
      await import("../trainersAcceptInviteCodeHandler");
    const res = await trainersAcceptInviteCodeHandler.handle(
      post({ code: "ABC123" }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.relationshipId).toBe("rel-old");
  });
});
