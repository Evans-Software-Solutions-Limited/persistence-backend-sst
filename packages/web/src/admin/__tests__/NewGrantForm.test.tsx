import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderPage } from "@/test-utils";

const api = vi.hoisted(() => ({
  catalogue: vi.fn(async () => ({
    offers: {
      premium: {
        months: 6,
        priceMinor: 3000,
        pool: "consumer",
        label: "Premium",
      },
      premium_plus: {
        months: 6,
        priceMinor: 5000,
        pool: "consumer",
        label: "Premium+",
      },
      start_up_coach_plus: {
        months: 6,
        priceMinor: 9900,
        pool: "coach",
        label: "Start Up Coach+",
      },
    },
    caps: { consumer: 200, coach: 20 },
    paymentMethods: ["bank_transfer", "stripe_link", "card_in_person", "other"],
  })),
  lookupUser: vi.fn(),
  createGrant: vi.fn(),
}));
vi.mock("../adminApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../adminApi")>();
  return { ...actual, adminApi: { ...actual.adminApi, ...api } };
});

import { NewGrantForm } from "../pages/NewGrantForm";
import { AdminApiError } from "../adminApi";

describe("NewGrantForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.lookupUser.mockResolvedValue({ account: null, pendingGrants: [] });
  });

  it("looks the email up, prefills the tier price, confirms, then submits the grant payload", async () => {
    api.createGrant.mockResolvedValue({
      grantId: "g1",
      status: "pending",
      email: "new@x.co",
      userId: null,
      tierName: "premium_plus",
      expiresAt: null,
      invited: true,
      inviteError: null,
      seats: { pool: "consumer", used: 3, cap: 200 },
      referral: { code: "UONFRESHERS", label: "UoN" },
    });
    renderPage(<NewGrantForm />);
    await screen.findByText("Premium+");

    fireEvent.change(screen.getByLabelText(/Their email/), {
      target: { value: "New@X.co" },
    });
    await screen.findByText(/No account yet/);
    expect(api.lookupUser).toHaveBeenCalledWith("new@x.co");

    fireEvent.click(screen.getByLabelText(/Premium\+/));
    await waitFor(() =>
      expect(
        (screen.getByLabelText(/Amount paid/) as HTMLInputElement).value,
      ).toBe("50.00"),
    );
    fireEvent.change(screen.getByLabelText(/Referral \/ vendor code/), {
      target: { value: "uonfreshers" },
    });
    fireEvent.change(screen.getByLabelText(/Payment reference/), {
      target: { value: "SUMUP-1" },
    });
    fireEvent.change(screen.getByLabelText(/Amount paid/), {
      target: { value: "49.50" },
    });
    fireEvent.change(screen.getByLabelText(/Paid by/), {
      target: { value: "other" },
    });
    fireEvent.change(screen.getByLabelText(/Paid on/), {
      target: { value: "2026-09-04" },
    });
    fireEvent.change(screen.getByLabelText(/Notes/), {
      target: { value: "Founders fair" },
    });
    fireEvent.click(screen.getByLabelText(/Send them/));

    // First click arms the confirmation; Back disarms it without submitting.
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    expect(api.createGrant).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Grant" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Confirm: Premium\+ for New@X.co — £49.50/,
      }),
    );

    await screen.findByText(/applies when they sign up/);
    expect(api.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@x.co",
        tierName: "premium_plus",
        amountMinor: 4950,
        paymentMethod: "other",
        paymentReference: "SUMUP-1",
        paidAt: "2026-09-04T12:00:00.000Z",
        referralCode: "UONFRESHERS",
        notes: "Founders fair",
        sendInvite: false,
        allowRoleChange: false,
        allowSupersedeStoreSubscription: false,
      }),
    );
    expect(screen.getByText("197 of 200")).toBeTruthy();
    expect(screen.getByText(/UoN \(UONFRESHERS\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next person" }));
    expect(
      (screen.getByLabelText(/Their email/) as HTMLInputElement).value,
    ).toBe("");
  });

  it("blocks a consumer tier on a coach account until the role change is acknowledged", async () => {
    api.lookupUser.mockResolvedValue({
      account: {
        id: "c1",
        email: "coach@x.co",
        role: "personal_trainer",
        subscription: null,
        attribution: null,
        foundingGrants: [],
      },
      pendingGrants: [],
    });
    renderPage(<NewGrantForm />);
    await screen.findByText("Premium");
    fireEvent.change(screen.getByLabelText(/Their email/), {
      target: { value: "coach@x.co" },
    });
    await screen.findByText(/Account exists \(personal_trainer\)/);
    const warning = await screen.findByText(/This is a coach account/);
    expect(warning).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Grant" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /This is a coach account/ }),
    );
    expect(
      (screen.getByRole("button", { name: "Grant" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("refuses a second live grant for the same email", async () => {
    api.lookupUser.mockResolvedValue({
      account: null,
      pendingGrants: [
        {
          id: "g0",
          tierName: "premium",
          paidAt: "2026-09-01",
          invitedAt: null,
        },
      ],
    });
    renderPage(<NewGrantForm />);
    await screen.findByText("Premium");
    fireEvent.change(screen.getByLabelText(/Their email/), {
      target: { value: "dup@x.co" },
    });
    await screen.findByText(/already has a live founding grant/);
    expect(
      (screen.getByRole("button", { name: "Grant" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("requires a reference only for bank transfer and Stripe", async () => {
    renderPage(<NewGrantForm />);
    await screen.findByText("Premium");
    const method = screen.getByLabelText(/Paid by/);

    expect(
      (
        screen.getByLabelText(
          /Payment reference \(optional\)/,
        ) as HTMLInputElement
      ).required,
    ).toBe(false);
    fireEvent.change(method, { target: { value: "bank_transfer" } });
    expect(
      (
        screen.getByLabelText(
          /Payment reference \(required\)/,
        ) as HTMLInputElement
      ).required,
    ).toBe(true);
    fireEvent.change(method, { target: { value: "stripe_link" } });
    expect(
      (
        screen.getByLabelText(
          /Payment reference \(required\)/,
        ) as HTMLInputElement
      ).required,
    ).toBe(true);
    fireEvent.change(method, { target: { value: "other" } });
    expect(
      (
        screen.getByLabelText(
          /Payment reference \(optional\)/,
        ) as HTMLInputElement
      ).required,
    ).toBe(false);
  });

  it("blocks a store subscriber until the override is acknowledged and sends the flag", async () => {
    api.lookupUser.mockResolvedValue({
      account: {
        id: "u1",
        email: "store@x.co",
        role: null,
        subscription: {
          tierName: "premium",
          paymentStatus: "active",
          expiresAt: "2026-10-01T00:00:00Z",
          cancelledAt: null,
          externalSubscriptionId: "rc_u1",
          fromStore: true,
        },
        attribution: {
          code: "STOREBUYER",
          label: "Store buyer",
          lockedAt: null,
        },
        foundingGrants: [],
      },
      pendingGrants: [],
    });
    api.createGrant.mockResolvedValue({
      grantId: "g1",
      status: "active",
      email: "store@x.co",
      userId: "u1",
      tierName: "premium",
      expiresAt: "2027-03-04T00:00:00Z",
      invited: false,
      inviteError: "delivery unavailable",
      seats: { pool: "consumer", used: 1, cap: 200 },
      referral: null,
    });
    renderPage(<NewGrantForm />);
    await screen.findByText("Premium");
    fireEvent.change(screen.getByLabelText(/Their email/), {
      target: { value: "store@x.co" },
    });
    const checkbox = await screen.findByRole("checkbox", {
      name: /live App Store subscription/,
    });
    expect(
      (screen.getByRole("button", { name: "Grant" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Confirm: Premium/ }),
    );
    await screen.findByText(/access is live/);
    expect(api.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({ allowSupersedeStoreSubscription: true }),
    );
  });

  it("shows readable copy for a store-subscription conflict returned by the API", async () => {
    api.lookupUser.mockResolvedValue({ account: null, pendingGrants: [] });
    api.createGrant.mockRejectedValue(
      new AdminApiError(409, {
        code: "active_store_subscription",
        message: "raw server message",
      }),
    );
    renderPage(<NewGrantForm />);
    await screen.findByText("Premium");
    fireEvent.change(screen.getByLabelText(/Their email/), {
      target: { value: "buyer@x.co" },
    });
    await screen.findByText(/No account yet/);
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Confirm: Premium/ }),
    );
    expect(
      await screen.findByText(/tick the store-subscription override/),
    ).toBeTruthy();
  });
});
