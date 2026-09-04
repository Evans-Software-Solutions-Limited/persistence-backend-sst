import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderPage } from "@/test-utils";

const api = vi.hoisted(() => ({
  grants: vi.fn(),
  revokeGrant: vi.fn(),
  resendInvite: vi.fn(),
}));
vi.mock("../adminApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../adminApi")>();
  return { ...actual, adminApi: { ...actual.adminApi, ...api } };
});
vi.mock("../pages/NewGrantForm", () => ({
  NewGrantForm: () => <div>new grant form</div>,
}));

import { AdminGrants } from "../pages/AdminGrants";

const baseGrant = {
  id: "g1",
  userId: "u1",
  email: "buyer@example.com",
  tierName: "premium",
  tierLabel: "Premium",
  months: 6,
  amountMinor: 3000,
  currency: "GBP",
  paymentMethod: "bank_transfer",
  paymentReference: "BANK-1",
  paidAt: "2026-09-01T00:00:00Z",
  referralCode: null,
  referralLabel: null,
  subscriptionExpiresAt: "2027-03-01T00:00:00Z",
  invitedAt: null,
  appliedAt: "2026-09-01T00:00:00Z",
  revokedAt: null,
  revokeReason: null,
  notes: null,
  createdAt: "2026-09-01T00:00:00Z",
  status: "active" as const,
};

describe("AdminGrants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.revokeGrant.mockResolvedValue({ ok: true });
    api.resendInvite.mockResolvedValue({ ok: true });
  });

  it("renders account-deleted grants as muted and non-actionable", async () => {
    api.grants.mockResolvedValue([
      {
        ...baseGrant,
        userId: null,
        status: "account_deleted",
        subscriptionExpiresAt: null,
      },
    ]);
    renderPage(<AdminGrants />);

    expect(await screen.findAllByText("account deleted")).toHaveLength(2);
    expect(screen.getByText("no actions")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resend email" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
    expect(
      screen.getByText("buyer@example.com").closest("tr")?.className,
    ).toContain("text-muted-foreground");
  });

  it("shows pending and revoked states and toggles the new-grant form", async () => {
    api.grants.mockResolvedValue([
      {
        ...baseGrant,
        id: "pending",
        status: "pending",
        userId: null,
        appliedAt: null,
        subscriptionExpiresAt: null,
      },
      {
        ...baseGrant,
        id: "revoked",
        email: "revoked@example.com",
        status: "revoked",
        revokedAt: "2026-09-03T00:00:00Z",
        revokeReason: "refund BANK-2",
      },
    ]);
    renderPage(<AdminGrants />);

    expect(await screen.findByText("on sign-up")).toBeTruthy();
    expect(screen.getByTitle("refund BANK-2").textContent).toContain(
      "revoked 3 Sept 2026",
    );
    fireEvent.click(screen.getByRole("button", { name: "New grant" }));
    expect(await screen.findByText("new grant form")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close form" }));
    expect(screen.queryByText("new grant form")).toBeNull();
  });

  it("resends and revokes active grants after a meaningful prompt reason", async () => {
    api.grants.mockResolvedValue([{ ...baseGrant, invitedAt: "2026-09-02" }]);
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("  refunded  ");
    renderPage(<AdminGrants />);
    await screen.findByText("buyer@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Resend email" }));
    await waitFor(() => expect(api.resendInvite).toHaveBeenCalledWith("g1"));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(api.revokeGrant).toHaveBeenCalledWith("g1", "refunded"),
    );
    prompt.mockRestore();
  });

  it("renders empty and failed queries", async () => {
    api.grants.mockResolvedValueOnce([]);
    const first = renderPage(<AdminGrants />);
    expect(await screen.findByText("No grants recorded yet.")).toBeTruthy();
    first.unmount();

    api.grants.mockRejectedValueOnce(new Error("grants unavailable"));
    renderPage(<AdminGrants />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "grants unavailable",
    );
  });
});
