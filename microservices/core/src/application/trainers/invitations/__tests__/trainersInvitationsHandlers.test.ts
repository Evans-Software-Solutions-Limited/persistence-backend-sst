/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Elysia from "elysia";

const mocks = {
  isTrainer: vi.fn(),
  listPendingInvitations: vi.fn(),
  inviteClientByEmail: vi.fn(),
  cancelInvitation: vi.fn(),
};

// The client-slot invite gate is unit-tested in trainerSeats.test.ts; here it's
// mocked so the send-handler tests focus on wiring. Default: allow (no throw).
const assertCanInvite = vi.fn(async () => {});
vi.mock("../../seats/trainerSeats", () => ({
  assertTrainerCanInvite: (...args: unknown[]) =>
    assertCanInvite(...(args as [])),
}));

// Real InviteError so `instanceof` checks in the create handler fire.
class InviteError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

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
  TrainerRepository: vi.fn().mockImplementation(() => mocks),
  InviteError,
}));

const auth = {
  authorization: "Bearer token",
  "Content-Type": "application/json",
};

describe("trainersInvitationsListHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTrainer.mockResolvedValue(true);
    mocks.listPendingInvitations.mockResolvedValue([{ id: "i1" }]);
  });

  it("requires auth", async () => {
    const { trainersInvitationsListHandler } =
      await import("../trainersInvitationsListHandler");
    const res = await trainersInvitationsListHandler.handle(
      new Request("http://localhost/trainers/me/invitations"),
    );
    expect(res.status).toBe(401);
  });

  it("403 for non-trainers", async () => {
    mocks.isTrainer.mockResolvedValue(false);
    const { trainersInvitationsListHandler } =
      await import("../trainersInvitationsListHandler");
    const res = await trainersInvitationsListHandler.handle(
      new Request("http://localhost/trainers/me/invitations", {
        headers: auth,
      }),
    );
    expect(res.status).toBe(403);
  });

  it("returns pending invitations", async () => {
    const { trainersInvitationsListHandler } =
      await import("../trainersInvitationsListHandler");
    const res = await trainersInvitationsListHandler.handle(
      new Request("http://localhost/trainers/me/invitations", {
        headers: auth,
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual([{ id: "i1" }]);
  });
});

describe("trainersInvitationsCreateHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTrainer.mockResolvedValue(true);
  });

  function post(body: unknown, headers = auth) {
    return new Request("http://localhost/trainers/me/invitations", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  it("requires auth", async () => {
    const { trainersInvitationsCreateHandler } =
      await import("../trainersInvitationsCreateHandler");
    const res = await trainersInvitationsCreateHandler.handle(
      new Request("http://localhost/trainers/me/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientEmail: "a@b.io" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("403 for non-trainers", async () => {
    mocks.isTrainer.mockResolvedValue(false);
    const { trainersInvitationsCreateHandler } =
      await import("../trainersInvitationsCreateHandler");
    const res = await trainersInvitationsCreateHandler.handle(
      post({ clientEmail: "a@b.io" }),
    );
    expect(res.status).toBe(403);
    expect(mocks.inviteClientByEmail).not.toHaveBeenCalled();
  });

  it("201 with the invite result (relationship_created)", async () => {
    mocks.inviteClientByEmail.mockResolvedValue({
      success: true,
      action: "relationship_created",
      relationshipId: "rel-1",
    });
    const { trainersInvitationsCreateHandler } =
      await import("../trainersInvitationsCreateHandler");
    const res = await trainersInvitationsCreateHandler.handle(
      post({ clientEmail: "a@b.io", relationshipReason: "strength" }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.action).toBe("relationship_created");
    expect(mocks.inviteClientByEmail).toHaveBeenCalledWith(
      "trainer-id",
      "a@b.io",
      "strength",
    );
  });

  it("defaults relationshipReason to null", async () => {
    mocks.inviteClientByEmail.mockResolvedValue({
      success: true,
      action: "invitation_created",
    });
    const { trainersInvitationsCreateHandler } =
      await import("../trainersInvitationsCreateHandler");
    await trainersInvitationsCreateHandler.handle(
      post({ clientEmail: "a@b.io" }),
    );
    expect(mocks.inviteClientByEmail).toHaveBeenCalledWith(
      "trainer-id",
      "a@b.io",
      null,
    );
  });

  it.each([
    [400, "self_invite", "You cannot invite yourself"],
    [403, "no_slots", "Trainer has no available client slots"],
    [409, "exists", "Relationship already exists with this client"],
  ])(
    "maps InviteError %i/%s to a coded error body",
    async (status, code, msg) => {
      mocks.inviteClientByEmail.mockRejectedValue(
        new InviteError(status, code, msg),
      );
      const { trainersInvitationsCreateHandler } =
        await import("../trainersInvitationsCreateHandler");
      const res = await trainersInvitationsCreateHandler.handle(
        post({ clientEmail: "a@b.io" }),
      );
      expect(res.status).toBe(status);
      const body = (await res.json()) as any;
      expect(body.code).toBe(code);
      expect(body.message).toBe(msg);
    },
  );

  it("rethrows non-InviteError failures (→ 500)", async () => {
    mocks.inviteClientByEmail.mockRejectedValue(new Error("db exploded"));
    const { trainersInvitationsCreateHandler } =
      await import("../trainersInvitationsCreateHandler");
    const res = await trainersInvitationsCreateHandler.handle(
      post({ clientEmail: "a@b.io" }),
    );
    expect(res.status).toBe(500);
  });

  it("402 with the upgrade verdict when the trainer is at their client cap (invite NOT sent)", async () => {
    const { EntitlementError } =
      await import("../../../entitlement/assertEntitlement");
    const { coreErrorHandler } =
      await import("../../../../shared/errorHandler");
    assertCanInvite.mockRejectedValueOnce(
      new EntitlementError(
        {
          allowed: false,
          reason: "limit",
          currentTier: "small_business",
          upgradeTo: "medium_enterprise",
          upgradePriceMonthly: 199.99,
        },
        "trainer_clients",
      ),
    );
    const { trainersInvitationsCreateHandler } =
      await import("../trainersInvitationsCreateHandler");
    const app = new Elysia()
      .use(coreErrorHandler)
      .use(trainersInvitationsCreateHandler);
    const res = await app.handle(post({ clientEmail: "a@b.io" }));
    expect(res.status).toBe(402);
    const body = (await res.json()) as any;
    expect(body.code).toBe("ENTITLEMENT_DENIED");
    expect(body.feature).toBe("trainer_clients");
    expect(body.upgrade_to).toBe("medium_enterprise");
    // The gate ran before the repository → no invite was created.
    expect(mocks.inviteClientByEmail).not.toHaveBeenCalled();
  });
});

describe("trainersInvitationsDeleteHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTrainer.mockResolvedValue(true);
  });

  function del(id: string, headers = auth) {
    return new Request(`http://localhost/trainers/me/invitations/${id}`, {
      method: "DELETE",
      headers,
    });
  }

  it("requires auth", async () => {
    const { trainersInvitationsDeleteHandler } =
      await import("../trainersInvitationsDeleteHandler");
    const res = await trainersInvitationsDeleteHandler.handle(
      new Request("http://localhost/trainers/me/invitations/i1", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("403 for non-trainers", async () => {
    mocks.isTrainer.mockResolvedValue(false);
    const { trainersInvitationsDeleteHandler } =
      await import("../trainersInvitationsDeleteHandler");
    const res = await trainersInvitationsDeleteHandler.handle(del("i1"));
    expect(res.status).toBe(403);
    expect(mocks.cancelInvitation).not.toHaveBeenCalled();
  });

  it("200 on successful cancel", async () => {
    mocks.cancelInvitation.mockResolvedValue(true);
    const { trainersInvitationsDeleteHandler } =
      await import("../trainersInvitationsDeleteHandler");
    const res = await trainersInvitationsDeleteHandler.handle(del("i1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data.success).toBe(true);
    expect(mocks.cancelInvitation).toHaveBeenCalledWith("trainer-id", "i1");
  });

  it("404 when not found / not owned", async () => {
    mocks.cancelInvitation.mockResolvedValue(false);
    const { trainersInvitationsDeleteHandler } =
      await import("../trainersInvitationsDeleteHandler");
    const res = await trainersInvitationsDeleteHandler.handle(del("missing"));
    expect(res.status).toBe(404);
  });
});
