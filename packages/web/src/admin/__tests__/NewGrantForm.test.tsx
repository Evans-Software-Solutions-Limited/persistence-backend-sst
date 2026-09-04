import { fireEvent, screen } from "@testing-library/react";
import { renderPage } from "@/test-utils";

const api = vi.hoisted(() => ({
  catalogue: vi.fn(async () => ({
    offers: {
      premium: { months: 6, pool: "consumer", label: "Premium" },
      premium_plus: { months: 6, pool: "consumer", label: "Premium+" },
      start_up_coach_plus: {
        months: 6,
        pool: "coach",
        label: "Start Up Coach+",
      },
    },
    caps: { consumer: 200, coach: 20 },
    contributionMethods: [
      "bank_transfer",
      "stripe_link",
      "card_in_person",
      "other",
    ],
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

  it("creates free complimentary access with a chosen duration", async () => {
    api.createGrant.mockResolvedValue({
      grantId: "g1",
      status: "pending",
      email: "friend@x.co",
      userId: null,
      tierName: "premium_plus",
      grantKind: "complimentary",
      months: 18,
      expiresAt: null,
      invited: true,
      inviteError: null,
      seats: null,
      referral: null,
    });
    renderPage(<NewGrantForm />);
    await screen.findByRole("option", { name: "Premium+" });

    fireEvent.change(screen.getByLabelText(/Recipient email/), {
      target: { value: "Friend@X.co" },
    });
    await screen.findByText(/No account yet/);
    fireEvent.click(screen.getByLabelText(/Complimentary/));
    fireEvent.change(screen.getByLabelText("Tier"), {
      target: { value: "premium_plus" },
    });
    fireEvent.change(screen.getByLabelText(/Access length/), {
      target: { value: "18" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Confirm complimentary Premium\+ for 18 months/,
      }),
    );

    await screen.findByText(/applies when they sign up/);
    expect(api.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "friend@x.co",
        tierName: "premium_plus",
        grantKind: "complimentary",
        months: 18,
      }),
    );
    expect(api.createGrant.mock.calls[0][0]).not.toHaveProperty(
      "contributionAmountMinor",
    );
    expect(screen.queryByText(/places left/)).toBeNull();
  });

  it("records an optional contribution without using it to choose access", async () => {
    api.createGrant.mockResolvedValue({
      grantId: "g2",
      status: "pending",
      email: "founder@x.co",
      userId: null,
      tierName: "premium",
      grantKind: "founding",
      months: 9,
      expiresAt: null,
      invited: false,
      inviteError: null,
      seats: { pool: "consumer", used: 1, cap: 200 },
      referral: null,
    });
    renderPage(<NewGrantForm />);
    await screen.findByRole("option", { name: "Premium" });
    fireEvent.change(screen.getByLabelText(/Recipient email/), {
      target: { value: "founder@x.co" },
    });
    await screen.findByText(/No account yet/);
    fireEvent.change(screen.getByLabelText(/Access length/), {
      target: { value: "9" },
    });
    fireEvent.click(screen.getByLabelText(/Record a separate crowdfunding/));
    expect(
      screen.getByText(/does not buy, determine, or extend access/i),
    ).toBeDefined();
    fireEvent.change(screen.getByLabelText(/Contribution \(£\)/), {
      target: { value: "42.50" },
    });
    fireEvent.change(screen.getByLabelText("Method"), {
      target: { value: "other" },
    });
    fireEvent.change(screen.getByLabelText(/Reference/), {
      target: { value: "CROWD-42" },
    });
    fireEvent.change(screen.getByLabelText(/Contribution date/), {
      target: { value: "2026-09-04" },
    });
    fireEvent.change(screen.getByLabelText(/Referral code/), {
      target: { value: "friends" },
    });
    fireEvent.change(screen.getByLabelText(/Notes/), {
      target: { value: "Separate contribution" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Grant access" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: /Confirm founding Premium for 9 months/,
      }),
    );

    await screen.findByText(/applies when they sign up/);
    expect(api.createGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        grantKind: "founding",
        months: 9,
        contributionAmountMinor: 4250,
        contributionCurrency: "GBP",
        contributionMethod: "other",
        contributionReference: "CROWD-42",
        referralCode: "FRIENDS",
        notes: "Separate contribution",
      }),
    );
    expect(screen.getByText("199 of 200")).toBeDefined();
  });

  it("blocks a coach with live store access from being displaced", async () => {
    api.lookupUser.mockResolvedValue({
      account: {
        id: "u1",
        email: "coach@x.co",
        role: "personal_trainer",
        subscription: {
          tierName: "start_up_coach_plus",
          paymentStatus: "active",
          expiresAt: "2027-01-01",
          cancelledAt: null,
          externalSubscriptionId: "rc_1",
          fromStore: true,
        },
        attribution: null,
        foundingGrants: [],
      },
      pendingGrants: [],
    });
    renderPage(<NewGrantForm />);
    await screen.findByRole("option", { name: "Premium" });
    fireEvent.change(screen.getByLabelText(/Recipient email/), {
      target: { value: "coach@x.co" },
    });
    expect(
      await screen.findByText(/Account exists.*currently start_up_coach_plus/),
    ).toBeDefined();
    expect(
      screen.getByText(/cannot be displaced by an admin grant/),
    ).toBeDefined();
    expect(
      (
        screen.getByRole("button", {
          name: "Grant access",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("directs duplicate recipients to extend the existing grant", async () => {
    api.lookupUser.mockResolvedValue({
      account: null,
      pendingGrants: [
        { id: "g0", tierName: "premium", months: 6, invitedAt: null },
      ],
    });
    renderPage(<NewGrantForm />);
    await screen.findByRole("option", { name: "Premium" });
    fireEvent.change(screen.getByLabelText(/Recipient email/), {
      target: { value: "dup@x.co" },
    });
    expect(
      await screen.findByText(/Extend it from the grants table/),
    ).toBeDefined();
    expect(
      (
        screen.getByRole("button", {
          name: "Grant access",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
