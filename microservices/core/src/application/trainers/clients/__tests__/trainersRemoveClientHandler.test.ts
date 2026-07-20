/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "trainer-1",
      email: "t@example.com",
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
  getUser: vi.fn((ctx) => ctx.user || { sub: "trainer-1" }),
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

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

function del(clientId: string, headers = auth) {
  return new Request(`http://localhost/trainers/me/clients/${clientId}`, {
    method: "DELETE",
    headers,
  });
}

describe("trainersRemoveClientHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires auth", async () => {
    const { trainersRemoveClientHandler } =
      await import("../trainersRemoveClientHandler");
    const res = await trainersRemoveClientHandler.handle(
      del("client-1", { "Content-Type": "application/json" } as any),
    );
    expect(res.status).toBe(401);
    expect(endCoachClientRelationship).not.toHaveBeenCalled();
  });

  it("ends the relationship, returns 200, and notifies the client (initiatedBy 'trainer')", async () => {
    endCoachClientRelationship.mockResolvedValueOnce({
      ok: true,
      relationshipId: "rel-1",
      programmesRemoved: 1,
      workoutAssignmentsRemoved: 2,
    });
    const { trainersRemoveClientHandler } =
      await import("../trainersRemoveClientHandler");
    const res = await trainersRemoveClientHandler.handle(del("client-1"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.ended).toBe(true);

    expect(endCoachClientRelationship).toHaveBeenCalledWith({
      trainerId: "trainer-1",
      clientId: "client-1",
      initiatedBy: "trainer",
    });
    expect(notifyRelationshipEnded).toHaveBeenCalledWith({
      recipientId: "client-1",
      otherPartyId: "trainer-1",
      initiatedBy: "trainer",
      relationshipId: "rel-1",
    });
  });

  it("404s when the core reports no matching active/non-AI relationship — no notification", async () => {
    endCoachClientRelationship.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });
    const { trainersRemoveClientHandler } =
      await import("../trainersRemoveClientHandler");
    const res = await trainersRemoveClientHandler.handle(del("client-1"));

    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.code).toBe("not_found");
    expect(notifyRelationshipEnded).not.toHaveBeenCalled();
  });
});
