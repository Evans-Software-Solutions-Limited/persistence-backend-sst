/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = { isTrainer: vi.fn(), getClients: vi.fn() };

vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (authHeader: string | undefined) => {
    if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
    return {
      sub: "trainer-id",
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
  getUser: vi.fn((ctx) => ctx.user || { sub: "trainer-id" }),
}));

vi.mock("../../../repositories/trainerRepository", () => ({
  TrainerRepository: vi.fn().mockImplementation(function () {
    return mocks;
  }),
  InviteError: class InviteError extends Error {},
}));

const invitedSummaries = vi.fn(async () => [
  { profileId: "p1", displayName: "Lena", inviteStatus: "active" },
]);
vi.mock("../../../coaching/clientProfileRepository", () => ({
  ClientProfileRepository: vi.fn().mockImplementation(function () {
    return {
      invitedSummaries,
    };
  }),
}));

// PER-114: per-area adherence comes from the shared calculation (covered by
// adherence/__tests__); pinned here to prove it is merged by client id.
const rosterAdherenceByArea = vi.fn<
  (trainerId: string, clientIds: string[]) => Promise<Map<string, unknown>>
>(
  async () =>
    new Map([
      [
        "c1",
        {
          training: {
            done: 1,
            target: 3,
            label: "1 of 3 in the last 7 days",
            state: "behind",
          },
        },
      ],
    ]),
);
vi.mock("../../../adherence/coachAdherence", () => ({
  rosterAdherenceByArea: (trainerId: string, clientIds: string[]) =>
    rosterAdherenceByArea(trainerId, clientIds),
}));

describe("trainersClientsListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTrainer.mockResolvedValue(true);
    mocks.getClients.mockResolvedValue([
      {
        id: "c1",
        name: "Al Pha",
        adherence: 40,
        band: "atRisk",
        status: "active",
      },
      {
        id: "c2",
        name: "Be Ta",
        adherence: null,
        band: null,
        status: "pending",
      },
    ]);
  });

  it("requires authentication", async () => {
    const { trainersClientsListHandler } =
      await import("../trainersClientsListHandler");
    const res = await trainersClientsListHandler.handle(
      new Request("http://localhost/trainers/me/clients"),
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-trainers", async () => {
    mocks.isTrainer.mockResolvedValue(false);
    const { trainersClientsListHandler } =
      await import("../trainersClientsListHandler");
    const res = await trainersClientsListHandler.handle(
      new Request("http://localhost/trainers/me/clients", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.message).toBe("Forbidden");
    expect(mocks.getClients).not.toHaveBeenCalled();
  });

  it("returns the roster for a trainer", async () => {
    const { trainersClientsListHandler } =
      await import("../trainersClientsListHandler");
    const res = await trainersClientsListHandler.handle(
      new Request("http://localhost/trainers/me/clients", {
        headers: { authorization: "Bearer token" },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe("c1");
    expect(mocks.getClients).toHaveBeenCalledWith("trainer-id");
    // PER-114: legacy fields untouched; adherenceByArea added per client, only
    // active clients are asked for, and a pending client gets null.
    expect(body.data[0]).toEqual({
      id: "c1",
      name: "Al Pha",
      adherence: 40,
      band: "atRisk",
      status: "active",
      adherenceByArea: {
        training: {
          done: 1,
          target: 3,
          label: "1 of 3 in the last 7 days",
          state: "behind",
        },
      },
    });
    expect(body.data[1].adherenceByArea).toBeNull();
    expect(rosterAdherenceByArea).toHaveBeenCalledWith("trainer-id", ["c1"]);
    // PER-108: invited profiles ride alongside as a sibling field.
    expect(body.invited).toEqual([
      { profileId: "p1", displayName: "Lena", inviteStatus: "active" },
    ]);
    expect(invitedSummaries).toHaveBeenCalledWith("trainer-id");
  });
});
