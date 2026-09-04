import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/api-utils/auth/supabaseAuth", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@persistence/api-utils/auth/supabaseAuth")
    >();
  return {
    ...actual,
    getAuthUser: vi.fn(async (authHeader: string | undefined) =>
      authHeader === "Bearer admin"
        ? {
            sub: "admin-1",
            email_verified: true,
            app_metadata: { admin: true },
          }
        : null,
    ),
  };
});

const grants = vi.hoisted(() => ({
  findProfileByEmail: vi.fn(),
  findPendingByEmail: vi.fn(),
  listForUser: vi.fn(),
}));
const subscriptions = vi.hoisted(() => ({ findForUser: vi.fn() }));
const referrals = vi.hoisted(() => ({ findAppliedForUser: vi.fn() }));

vi.mock("../../repositories/foundingGrantRepository", () => ({
  FoundingGrantRepository: vi.fn(() => grants),
}));
vi.mock("../../repositories/subscriptionRepository", () => ({
  SubscriptionRepository: vi.fn(() => subscriptions),
}));
vi.mock("../../repositories/referralRepository", () => ({
  ReferralRepository: vi.fn(() => referrals),
}));

import { adminUsersLookupHandler } from "../users/adminUsersLookupHandler";

function request(email = " Buyer@Example.com ") {
  return new Request(
    `http://localhost/admin/users?email=${encodeURIComponent(email)}`,
    { headers: { authorization: "Bearer admin" } },
  );
}

describe("adminUsersLookupHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grants.findPendingByEmail.mockResolvedValue([]);
    grants.listForUser.mockResolvedValue([]);
    referrals.findAppliedForUser.mockResolvedValue(null);
    subscriptions.findForUser.mockResolvedValue(null);
  });

  it("normalizes an email and returns pending grants when no account exists", async () => {
    grants.findProfileByEmail.mockResolvedValue(null);
    grants.findPendingByEmail.mockResolvedValue([
      {
        id: "g1",
        tierName: "premium",
        paidAt: new Date("2026-09-01T00:00:00Z"),
        invitedAt: null,
      },
    ]);

    const response = await adminUsersLookupHandler.handle(request());
    expect(response.status).toBe(200);
    expect(grants.findProfileByEmail).toHaveBeenCalledWith("buyer@example.com");
    expect(await response.json()).toMatchObject({
      data: { account: null, pendingGrants: [{ id: "g1" }] },
    });
  });

  it.each([
    ["rc_customer", true],
    ["sub_stripe", false],
    [null, false],
  ])("marks subscription %s fromStore=%s", async (externalId, fromStore) => {
    grants.findProfileByEmail.mockResolvedValue({
      id: "u1",
      email: "buyer@example.com",
      role: "user",
      deletedAt: null,
    });
    subscriptions.findForUser.mockResolvedValue({
      tierName: "premium",
      externalSubscriptionId: externalId,
    });

    const response = await adminUsersLookupHandler.handle(request());
    expect(await response.json()).toMatchObject({
      data: {
        account: { subscription: { fromStore } },
        pendingGrants: [],
      },
    });
    expect(grants.listForUser).toHaveBeenCalledWith("u1");
  });

  it("returns a null subscription without inventing store state", async () => {
    grants.findProfileByEmail.mockResolvedValue({
      id: "u1",
      email: "buyer@example.com",
      role: null,
      deletedAt: null,
    });
    subscriptions.findForUser.mockResolvedValue(null);

    const response = await adminUsersLookupHandler.handle(request());
    expect(await response.json()).toMatchObject({
      data: { account: { subscription: null } },
    });
  });
});
