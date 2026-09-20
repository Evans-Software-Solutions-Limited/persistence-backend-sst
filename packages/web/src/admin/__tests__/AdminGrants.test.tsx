import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderPage as renderBasePage } from "@/test-utils";
import type { ReactElement } from "react";
import { AdminDialogProvider } from "../AdminDialogs";
const renderPage = (
  ui: ReactElement,
  options?: Parameters<typeof renderBasePage>[1],
) => renderBasePage(<AdminDialogProvider>{ui}</AdminDialogProvider>, options);
async function answer(value: string) {
  fireEvent.change(await screen.findByRole("textbox"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

const api = vi.hoisted(() => ({
  grants: vi.fn(),
  revokeGrant: vi.fn(),
  resendInvite: vi.fn(),
  extendGrant: vi.fn(),
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
  grantKind: "founding" as const,
  contributionAmountMinor: 3000,
  contributionCurrency: "GBP",
  contributionMethod: "bank_transfer",
  contributionReference: "BANK-1",
  contributedAt: "2026-09-01T00:00:00Z",
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
    api.extendGrant.mockResolvedValue({
      id: "g1",
      months: 8,
      expiresAt: "2027-05-01",
    });
  });

  it("offers refunds for Stripe checkout grants even when revoked or account-deleted", async () => {
    api.grants.mockResolvedValue([
      {
        ...baseGrant,
        contributionMethod: "stripe_checkout",
        status: "revoked",
        revokedAt: "2026-09-20",
      },
      {
        ...baseGrant,
        id: "deleted",
        contributionMethod: "stripe_checkout",
        status: "account_deleted",
      },
      { ...baseGrant, id: "expired", status: "expired" },
    ]);
    renderPage(<AdminGrants />);
    expect(
      await screen.findAllByRole("button", { name: "Refund" }),
    ).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Change tier" })).toBeNull();
  });

  it("labels the contribution reference column", async () => {
    api.grants.mockResolvedValue([baseGrant]);
    renderPage(<AdminGrants />);

    expect(
      await screen.findByRole("columnheader", { name: "Reference" }),
    ).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "New access grant" }));
    expect(await screen.findByText("new grant form")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close form" }));
    expect(screen.queryByText("new grant form")).toBeNull();
  });

  it("resends and revokes active grants after a meaningful prompt reason", async () => {
    api.grants.mockResolvedValue([{ ...baseGrant, invitedAt: "2026-09-02" }]);
    renderPage(<AdminGrants />);
    await screen.findByText("buyer@example.com");

    fireEvent.click(screen.getByRole("button", { name: "Resend email" }));
    await waitFor(() => expect(api.resendInvite).toHaveBeenCalledWith("g1"));
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await answer("  refunded  ");
    await waitFor(() =>
      expect(api.revokeGrant).toHaveBeenCalledWith("g1", "refunded"),
    );
  });

  it("extends a live grant with an audited reason", async () => {
    api.grants.mockResolvedValue([baseGrant]);
    renderPage(<AdminGrants />);
    await screen.findByText("buyer@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Extend" }));
    await answer("3");
    await answer("Friends and family extension");
    await waitFor(() =>
      expect(api.extendGrant).toHaveBeenCalledWith(
        "g1",
        3,
        "Friends and family extension",
      ),
    );
  });

  it("does not extend when the month or reason prompt is invalid", async () => {
    api.grants.mockResolvedValue([baseGrant]);
    const view = renderPage(<AdminGrants />);
    await screen.findByText("buyer@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Extend" }));
    await answer("0");
    expect(api.extendGrant).not.toHaveBeenCalled();

    view.unmount();
    renderPage(<AdminGrants />);
    await screen.findByText("buyer@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Extend" }));
    await answer("2");
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(api.extendGrant).not.toHaveBeenCalled();
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
  it("renders complimentary grants, missing references and the revoked filter", async () => {
    api.grants.mockResolvedValue([
      {
        ...baseGrant,
        grantKind: "complimentary",
        tierLabel: null,
        contributionAmountMinor: 0,
        contributionReference: null,
        referralCode: "TEAM",
        referralLabel: "Team",
        revokeReason: "Cancelled",
      },
    ]);
    renderPage(<AdminGrants />);
    expect(await screen.findByText("Complimentary")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(api.grants).toHaveBeenCalledWith(undefined));
  });

  it.each(["revoke", "resend", "extend"])(
    "shows audited action failure: %s",
    async (action) => {
      api.grants.mockResolvedValue([baseGrant]);
      const mutation =
        action === "revoke"
          ? api.revokeGrant
          : action === "resend"
            ? api.resendInvite
            : api.extendGrant;
      mutation.mockRejectedValueOnce(new Error("Action unavailable"));
      renderPage(<AdminGrants />);
      fireEvent.click(
        await screen.findByRole("button", {
          name:
            action === "revoke"
              ? "Revoke"
              : action === "resend"
                ? "Resend email"
                : "Extend",
        }),
      );
      if (action === "extend") await answer("1");
      if (action !== "resend") await answer("Support correction");
      expect((await screen.findByRole("alert")).textContent).toBe(
        "Action unavailable",
      );
    },
  );
});
