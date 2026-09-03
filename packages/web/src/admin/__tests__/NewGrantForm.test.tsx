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

    // First click arms the confirmation, second submits.
    fireEvent.click(screen.getByRole("button", { name: "Grant" }));
    expect(api.createGrant).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Confirm: Premium\+ for New@X.co — £50.00/,
      }),
    );

    await screen.findByText(/applies when they sign up/);
    expect(api.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "new@x.co",
        tierName: "premium_plus",
        amountMinor: 5000,
        paymentMethod: "card_in_person",
        paymentReference: "SUMUP-1",
        referralCode: "UONFRESHERS",
        sendInvite: true,
        allowRoleChange: false,
      }),
    );
    expect(screen.getByText("197 of 200")).toBeTruthy();
    expect(screen.getByText(/UoN \(UONFRESHERS\)/)).toBeTruthy();
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
});
