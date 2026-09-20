import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import { QueryClient } from "@tanstack/react-query";
import type { GrantRow } from "../adminApi";
import {
  ChangeGrantTierForm,
  RefundGrantForm,
} from "../pages/GrantActionForms";

const api = vi.hoisted(() => ({
  catalogue: vi.fn(),
  changeGrantTier: vi.fn(),
  grantRefund: vi.fn(),
  refundGrant: vi.fn(),
}));
vi.mock("../adminApi", async (original) => ({
  ...(await original<typeof import("../adminApi")>()),
  adminApi: api,
}));
const grant: GrantRow = {
  id: "g1",
  userId: "u1",
  email: "buyer@example.com",
  tierName: "premium",
  tierLabel: "Premium",
  months: 6,
  grantKind: "founding",
  contributionAmountMinor: 3000,
  contributionCurrency: "GBP",
  contributionMethod: "stripe_checkout",
  contributionReference: "cs_1",
  contributedAt: "2026-09-01",
  referralCode: null,
  referralLabel: null,
  subscriptionExpiresAt: "2027-03-01",
  invitedAt: null,
  appliedAt: "2026-09-01",
  revokedAt: null,
  revokeReason: null,
  notes: null,
  createdAt: "2026-09-01",
  status: "active",
};
const preview = {
  amountMinor: 3000,
  currency: "GBP",
  refundedAmountMinor: 500,
  remainingAmountMinor: 2500,
  refund: null,
};
const catalogue = {
  offers: {
    premium: { pool: "consumer", label: "Premium", months: 6 },
    premium_plus: { pool: "consumer", label: "Premium+", months: 6 },
    start_up_coach_plus: {
      pool: "coach",
      label: "Start Up Coach +",
      months: 6,
    },
  },
  grantableTiers: [
    { tierName: "premium", label: "Premium", isTrainerTier: false, months: 6 },
    {
      tierName: "premium_plus",
      label: "Premium+",
      isTrainerTier: false,
      months: 6,
    },
    { tierName: "coach", label: "Coach", isTrainerTier: true, months: 6 },
    {
      tierName: "coach_pro",
      label: "Coach Pro",
      isTrainerTier: true,
      months: 6,
    },
  ],
};
function reason(label: string, value = "  Thank you for supporting us  ") {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
async function reviewRefund() {
  await screen.findByText("£25.00");
  reason("Reason for refund");
  fireEvent.click(
    screen.getByRole("button", { name: "Review refund and cancellation" }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.values(api).forEach((mock) => mock.mockReset());
  api.catalogue.mockResolvedValue(catalogue);
  api.changeGrantTier.mockResolvedValue({
    id: "g1",
    tierName: "premium_plus",
    expiresAt: "2027-03-01",
  });
  api.grantRefund.mockResolvedValue(preview);
  api.refundGrant.mockImplementation(async () => {
    const result = {
      status: "pending",
      reason: "Thank you for supporting us",
      refundId: "re_1",
    };
    api.grantRefund.mockResolvedValue({ ...preview, refund: result });
    return result;
  });
});

describe("ChangeGrantTierForm", () => {
  it("limits founding options to its pool, reviews and posts a free audited tier change", async () => {
    renderPage(<ChangeGrantTierForm grant={grant} onClose={vi.fn()} />);
    // Allow the asynchronous catalogue query to settle under full-suite load.
    await screen.findByRole("option", { name: "Premium+" }, { timeout: 5000 });
    expect(
      screen.queryByRole("option", { name: "Start Up Coach +" }),
    ).toBeNull();
    expect(screen.queryByRole("option", { name: "Coach" })).toBeNull();
    fireEvent.change(screen.getByLabelText("New tier"), {
      target: { value: "premium_plus" },
    });
    reason("Reason for tier change");
    fireEvent.click(screen.getByRole("button", { name: "Review tier change" }));
    expect(api.changeGrantTier).not.toHaveBeenCalled();
    expect(screen.getByText(/at no charge/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm change to Premium+" }),
    );
    await waitFor(() =>
      expect(api.changeGrantTier).toHaveBeenCalledWith(
        "g1",
        "premium_plus",
        "Thank you for supporting us",
      ),
    );
    expect(
      await screen.findByText(
        /original access period and payment are unchanged/,
      ),
    ).toBeTruthy();
  });
  it("limits complimentary coach options by audience and preserves pending duration", async () => {
    renderPage(
      <ChangeGrantTierForm
        grant={{
          ...grant,
          grantKind: "complimentary",
          tierName: "coach",
          tierLabel: "Coach",
          status: "pending",
        }}
        onClose={vi.fn()}
      />,
    );
    await screen.findByRole("option", { name: "Coach Pro" });
    expect(screen.queryByRole("option", { name: "Premium+" })).toBeNull();
    expect(screen.getByText(/6 months from first sign-in/)).toBeTruthy();
  });
  it("requires a meaningful reason, prevents double submission and displays errors", async () => {
    let reject!: (value: Error) => void;
    api.changeGrantTier.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    renderPage(<ChangeGrantTierForm grant={grant} onClose={vi.fn()} />);
    await screen.findByRole("option", { name: "Premium+" });
    fireEvent.change(screen.getByLabelText("New tier"), {
      target: { value: "premium_plus" },
    });
    reason("Reason for tier change", "   ");
    expect(
      screen
        .getByRole("button", { name: "Review tier change" })
        .hasAttribute("disabled"),
    ).toBe(true);
    reason("Reason for tier change");
    fireEvent.click(screen.getByRole("button", { name: "Review tier change" }));
    fireEvent.submit(screen.getByRole("form"));
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(api.changeGrantTier).toHaveBeenCalledTimes(1));
    expect(
      screen
        .getByRole("button", { name: "Changing tier…" })
        .hasAttribute("disabled"),
    ).toBe(true);
    reject(new Error("Grant changed elsewhere"));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Grant changed elsewhere",
    );
  });
});

describe("RefundGrantForm", () => {
  it("confirms the full remaining amount and automatic cancellation without a keep-access choice", async () => {
    renderPage(<RefundGrantForm grant={grant} onClose={vi.fn()} />);
    await reviewRefund();
    expect(api.refundGrant).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirm refund £25.00 and cancel access",
      }),
    );
    await waitFor(() =>
      expect(api.refundGrant).toHaveBeenCalledWith(
        "g1",
        "Thank you for supporting us",
      ),
    );
    expect(await screen.findByText(/grant’s access is cancelled/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Confirm refund/ })).toBeNull();
  });
  it("refreshes Stripe totals automatically after success and invalidates reconciled access views", async () => {
    const invalidation = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    try {
      const result = {
        status: "succeeded",
        reason: "Thank you for supporting us",
        refundId: "re_1",
      };
      api.refundGrant.mockImplementation(async () => {
        api.grantRefund.mockResolvedValue({
          ...preview,
          refundedAmountMinor: 3000,
          remainingAmountMinor: 0,
          refund: result,
        });
        return result;
      });
      renderPage(<RefundGrantForm grant={grant} onClose={vi.fn()} />);
      await reviewRefund();
      invalidation.mockClear();
      fireEvent.click(
        screen.getByRole("button", {
          name: "Confirm refund £25.00 and cancel access",
        }),
      );
      await screen.findByText("£0.00");
      expect(
        screen.getByText("Remaining refund").nextElementSibling?.textContent,
      ).toBe("£0.00");
      expect(
        screen.getByText("Already refunded").nextElementSibling?.textContent,
      ).toBe("£30.00");
      expect(api.grantRefund).toHaveBeenCalledTimes(2);
      expect(
        screen.queryByRole("button", { name: /Review refund/ }),
      ).toBeNull();
      invalidation.mockClear();
      fireEvent.click(
        screen.getByRole("button", { name: "Refresh refund status" }),
      );
      await waitFor(() => expect(api.grantRefund).toHaveBeenCalledTimes(3));
      for (const key of ["grants", "lookup", "summary"]) {
        expect(invalidation).toHaveBeenCalledWith({ queryKey: ["admin", key] });
      }
    } finally {
      invalidation.mockRestore();
    }
  });

  it("preserves the accepted status and blocks another refund if its automatic refresh fails", async () => {
    api.refundGrant.mockImplementation(async () => {
      api.grantRefund.mockRejectedValue(
        new Error("Stripe refresh unavailable"),
      );
      return {
        status: "succeeded",
        reason: "Thank you for supporting us",
        refundId: "re_1",
      };
    });
    renderPage(<RefundGrantForm grant={grant} onClose={vi.fn()} />);
    await reviewRefund();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirm refund £25.00 and cancel access",
      }),
    );
    await screen.findByText("Stripe refresh unavailable");
    expect(screen.getByText("succeeded")).toBeTruthy();
    expect(screen.queryByText("Remaining refund")).toBeNull();
    expect(screen.queryByRole("button", { name: /Review refund/ })).toBeNull();
  });

  it("blocks duplicate POSTs while submitting", async () => {
    api.refundGrant.mockImplementation(() => new Promise(() => {}));
    renderPage(<RefundGrantForm grant={grant} onClose={vi.fn()} />);
    await reviewRefund();
    fireEvent.submit(screen.getByRole("form"));
    fireEvent.submit(screen.getByRole("form"));
    await waitFor(() => expect(api.refundGrant).toHaveBeenCalledTimes(1));
    expect(
      screen
        .getByRole("button", { name: "Submitting refund…" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Close" }).hasAttribute("disabled"),
    ).toBe(true);
  });
  it("requires status refresh after a lost response and retries only the saved reason", async () => {
    api.refundGrant.mockRejectedValueOnce(new Error("Connection lost"));
    renderPage(<RefundGrantForm grant={grant} onClose={vi.fn()} />);
    await reviewRefund();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Confirm refund £25.00 and cancel access",
      }),
    );
    await screen.findByText("Connection lost");
    expect(
      screen.getByLabelText("Reason for refund").hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: /Retry refund/ })
        .hasAttribute("disabled"),
    ).toBe(true);
    api.grantRefund.mockResolvedValue({
      ...preview,
      refund: {
        status: "requested",
        reason: "Saved audit reason",
        refundId: null,
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh refund status" }),
    );
    await screen.findByText("Reason: Saved audit reason");
    fireEvent.click(
      screen.getByRole("button", { name: "Review refund and cancellation" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Retry refund £25.00 and cancel access",
      }),
    );
    await waitFor(() =>
      expect(api.refundGrant).toHaveBeenLastCalledWith(
        "g1",
        "Saved audit reason",
      ),
    );
  });
  it.each(["pending", "requires_action", "succeeded", "failed", "canceled"])(
    "does not offer another refund for %s",
    async (status) => {
      api.grantRefund.mockResolvedValue({
        ...preview,
        refund: { status, reason: "Support refund", refundId: "re_1" },
      });
      renderPage(<RefundGrantForm grant={grant} onClose={vi.fn()} />);
      await screen.findByText(status);
      expect(
        screen.queryByRole("button", { name: /Review refund/ }),
      ).toBeNull();
      if (["failed", "canceled"].includes(status))
        expect(screen.getByText(/Review this refund in Stripe/)).toBeTruthy();
    },
  );
  it("blocks refunds if no balance remains and exposes preview errors with refresh", async () => {
    api.grantRefund.mockRejectedValueOnce(new Error("Stripe unavailable"));
    renderPage(<RefundGrantForm grant={grant} onClose={vi.fn()} />);
    await screen.findByText("Stripe unavailable");
    expect(screen.queryByRole("button", { name: /Review refund/ })).toBeNull();
    api.grantRefund.mockResolvedValue({ ...preview, remainingAmountMinor: 0 });
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh refund status" }),
    );
    await screen.findByText("This payment has no refundable amount remaining.");
    expect(screen.queryByRole("button", { name: /Review refund/ })).toBeNull();
  });
});
