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
      sub: "client-1",
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
  getUser: vi.fn((ctx) => ctx.user || { sub: "client-1" }),
}));

const endCoachClientRelationship = vi.fn();
vi.mock("../../../relationships/endCoachClientRelationship", () => ({
  endCoachClientRelationship: (...args: unknown[]) =>
    endCoachClientRelationship(...(args as [])),
}));

const notifyRelationshipEnded = vi.fn(async () => {});
vi.mock("../../../relationships/notifyRelationshipEnded", () => ({
  notifyRelationshipEnded: (...args: unknown[]) =>
    notifyRelationshipEnded(...(args as [])),
}));

/** Thenable select builder — one queued row-set per awaited query. */
function selectDb(rows: unknown[]) {
  const chain: any = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.from = vi.fn(self);
  chain.where = vi.fn(self);
  chain.limit = vi.fn(self);
  chain.then = (
    resolve: (v: unknown[]) => unknown,
    reject: (e: unknown) => unknown,
  ) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function del(relationshipId: string, headers = auth) {
  return new Request(
    `http://localhost/clients/me/relationships/${relationshipId}`,
    { method: "DELETE", headers },
  );
}

describe("clientLeaveCoachHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires auth", async () => {
    const { clientLeaveCoachHandler } =
      await import("../clientLeaveCoachHandler");
    const res = await clientLeaveCoachHandler.handle(
      del("rel-1", { "Content-Type": "application/json" } as any),
    );
    expect(res.status).toBe(401);
    expect(endCoachClientRelationship).not.toHaveBeenCalled();
  });

  it("resolves the trainer from the caller-scoped lookup, ends the relationship, and notifies the coach (initiatedBy 'client')", async () => {
    (getDb as any).mockReturnValue(selectDb([{ trainerId: "trainer-1" }]));
    endCoachClientRelationship.mockResolvedValueOnce({
      ok: true,
      relationshipId: "rel-1",
      programmesRemoved: 0,
      workoutAssignmentsRemoved: 1,
    });
    const { clientLeaveCoachHandler } =
      await import("../clientLeaveCoachHandler");
    const res = await clientLeaveCoachHandler.handle(del("rel-1"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.ended).toBe(true);

    expect(endCoachClientRelationship).toHaveBeenCalledWith({
      trainerId: "trainer-1",
      clientId: "client-1",
      initiatedBy: "client",
    });
    expect(notifyRelationshipEnded).toHaveBeenCalledWith({
      recipientId: "trainer-1",
      otherPartyId: "client-1",
      initiatedBy: "client",
      relationshipId: "rel-1",
    });
  });

  it("404s when the caller-scoped lookup misses (not-yours / already-ended / AI-trainer) — the core is never called", async () => {
    (getDb as any).mockReturnValue(selectDb([]));
    const { clientLeaveCoachHandler } =
      await import("../clientLeaveCoachHandler");
    const res = await clientLeaveCoachHandler.handle(del("rel-1"));

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("not_found");
    expect(endCoachClientRelationship).not.toHaveBeenCalled();
    expect(notifyRelationshipEnded).not.toHaveBeenCalled();
  });

  it("404s when the core loses a race to a concurrent end after the lookup succeeded", async () => {
    (getDb as any).mockReturnValue(selectDb([{ trainerId: "trainer-1" }]));
    endCoachClientRelationship.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    const { clientLeaveCoachHandler } =
      await import("../clientLeaveCoachHandler");
    const res = await clientLeaveCoachHandler.handle(del("rel-1"));

    expect(res.status).toBe(404);
    expect(notifyRelationshipEnded).not.toHaveBeenCalled();
  });
});
