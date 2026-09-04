import { fireEvent, screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";

const api = vi.hoisted(() => ({
  summary: vi.fn(),
  lookupUser: vi.fn(),
  setAttribution: vi.fn(),
}));
vi.mock("../adminApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../adminApi")>();
  return { ...actual, adminApi: { ...actual.adminApi, ...api } };
});

import { AdminDashboard } from "../pages/AdminDashboard";
import { AdminLookup } from "../pages/AdminLookup";

const grant = {
  id: "g1",
  userId: "u1",
  email: "friend@example.com",
  tierName: "premium_plus",
  tierLabel: "Premium+",
  months: 12,
  grantKind: "complimentary" as const,
  contributionAmountMinor: 0,
  contributionCurrency: "GBP",
  contributionMethod: null,
  contributionReference: null,
  contributedAt: null,
  referralCode: null,
  referralLabel: null,
  subscriptionExpiresAt: "2027-09-04T00:00:00Z",
  invitedAt: null,
  appliedAt: "2026-09-04T00:00:00Z",
  revokedAt: null,
  revokeReason: null,
  notes: null,
  createdAt: "2026-09-04T00:00:00Z",
  status: "active" as const,
};

describe("administrative grant views", () => {
  beforeEach(() => vi.clearAllMocks());

  it("labels dashboard money as optional contributions and shows grant kind", async () => {
    api.summary.mockResolvedValue({
      founding: {
        pools: { consumer: { used: 1, cap: 200 }, coach: { used: 0, cap: 20 } },
        byTier: [{ tierName: "premium_plus", count: 1, contributionMinor: 0 }],
        contributionMinor: 0,
        pending: 0,
      },
      referrals: { codes: 0, claims: 0, lockedClaims: 0 },
      recentGrants: [grant],
    });
    renderPage(<AdminDashboard />);

    expect(await screen.findByText("Recorded contributions")).toBeDefined();
    expect(screen.getByText("Complimentary")).toBeDefined();
    expect(screen.getAllByText("None").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: "New access grant" }),
    ).toBeDefined();
  });

  it("shows an account's grant separately from its store subscription", async () => {
    api.lookupUser.mockResolvedValue({
      account: {
        id: "u1",
        email: "friend@example.com",
        role: "user",
        subscription: null,
        attribution: { code: "FRIEND", label: "Friends", lockedAt: null },
        foundingGrants: [grant],
      },
      pendingGrants: [],
    });
    renderPage(<AdminLookup />);
    fireEvent.change(screen.getByLabelText("Email to look up"), {
      target: { value: "FRIEND@EXAMPLE.COM" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Look up" }));

    expect(await screen.findByText("Access grants")).toBeDefined();
    expect(screen.getByText("Complimentary")).toBeDefined();
    expect(screen.getByText("None")).toBeDefined();
    expect(api.lookupUser).toHaveBeenCalledWith("friend@example.com");
  });
});
