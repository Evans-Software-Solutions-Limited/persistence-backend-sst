import { GRANTABLE_TIERS } from "@persistence/subscription-catalog";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import RedeemPage from "../RedeemPage";
import * as auth from "../auth";
import { voucherApi } from "../api";

vi.mock("../auth", () => ({
  currentAccount: vi.fn(),
  completeCallback: vi.fn(),
  completeAppleCallback: vi.fn(),
  appleOAuthUrl: vi.fn(),
  isRetryableAuthError: vi.fn().mockReturnValue(false),
  signIn: vi.fn(),
  signUp: vi.fn(),
  sendSignInLink: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../api", () => ({
  voucherApi: {
    check: vi.fn(),
    prepare: vi.fn(),
    verify: vi.fn(),
    redeem: vi.fn(),
  },
}));
const account = { id: "user-1", email: "personal@example.com" };
const challenge = {
  challengeId: "c",
  verified: false,
  eligibilityEmail: "employee@acme.com",
  accountEmail: account.email,
  businessName: "Acme",
  tierName: "premium_plus",
  months: 12,
  expiresAt: "2026-09-14T18:00:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/redeem");
  vi.mocked(auth.currentAccount).mockResolvedValue(account);
  vi.mocked(auth.signIn).mockResolvedValue(account);
  vi.mocked(auth.signUp).mockResolvedValue(null);
  vi.mocked(auth.sendSignInLink).mockResolvedValue();
  vi.mocked(voucherApi.check).mockResolvedValue({
    valid: true,
    requiresEligibilityEmail: true,
  });
  vi.mocked(voucherApi.prepare).mockResolvedValue(challenge);
  vi.mocked(voucherApi.verify).mockResolvedValue({
    ...challenge,
    verified: true,
  });
  vi.mocked(voucherApi.redeem).mockResolvedValue({
    ...challenge,
    voucherId: "v",
    expiresAt: "2027-09-14T00:00:00Z",
  });
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});
async function ready() {
  render(<RedeemPage />);
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
}
async function fill(eligibility = account.email) {
  fireEvent.change(screen.getByLabelText("Membership code"), {
    target: { value: " VOUCHER-CODE " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  if (!screen.queryByLabelText("Eligibility email")) return;
  fireEvent.change(screen.getByLabelText("Eligibility email"), {
    target: { value: eligibility },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() =>
    expect(document.querySelector('[aria-busy="true"]')).toBeNull(),
  );
  const email = screen.queryByLabelText("Membership account email");
  if (email) fireEvent.change(email, { target: { value: account.email } });
}

it("verifies the work mailbox separately and only redeems after explicit confirmation", async () => {
  await ready();
  await fill("employee@acme.com");
  await screen.findByRole("heading", { name: "Verify your eligibility email" });
  expect(voucherApi.prepare).toHaveBeenCalledWith(
    "VOUCHER-CODE",
    "employee@acme.com",
  );
  expect(voucherApi.redeem).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Email verification code"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
  await screen.findByRole("heading", { name: "Make it yours" });
  expect(voucherApi.verify).toHaveBeenCalledWith("c", "123456");
  expect(screen.getAllByText(account.email).length).toBeGreaterThan(0);
  expect(screen.getAllByText("employee@acme.com").length).toBeGreaterThan(0);
  expect(voucherApi.redeem).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Activate membership" }));
  await screen.findByRole("heading", { name: "You're ready to train" });
  expect(voucherApi.redeem).toHaveBeenCalledTimes(1);
  expect(voucherApi.redeem).toHaveBeenCalledWith("c");
  expect(sessionStorage.getItem("persistence.redemption.draft")).toBeNull();
  expect(
    screen.getByRole("link", { name: "Open app" }).getAttribute("href"),
  ).toBe("/");
});
it("reuses verified same-email proof without asking for an OTP", async () => {
  vi.mocked(voucherApi.prepare).mockResolvedValue({
    ...challenge,
    verified: true,
    eligibilityEmail: account.email,
    tierName: "premium",
  });
  await ready();
  await fill();
  await screen.findByRole("heading", { name: "Make it yours" });
  expect(screen.queryByLabelText("Email verification code")).toBeNull();
  expect(voucherApi.verify).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Change account" }));
  await screen.findByRole("heading", { name: "Redeem your membership" });
  expect(auth.signOut).toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Activate membership" }),
  ).toBeNull();
});
it("lets the user explicitly switch from an existing signed-in account", async () => {
  vi.mocked(auth.currentAccount).mockResolvedValue({
    id: "other",
    email: "other@example.com",
  });
  await ready();
  expect(screen.getByText("other@example.com")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Change account" }));
  await fill();
  await screen.findByRole("heading", { name: "Your membership account" });
  expect(voucherApi.prepare).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "my-password" },
  });
  fireEvent.submit(screen.getByLabelText("Password").closest("form")!);
  await screen.findByRole("heading", { name: "Redeem your membership" });
  expect(auth.signIn).toHaveBeenCalledWith(account.email, "my-password");
  expect(voucherApi.redeem).not.toHaveBeenCalled();
});
it("offers signup with consent and a separate email sign-in route for existing accounts", async () => {
  vi.mocked(auth.currentAccount).mockResolvedValue(null);
  await ready();
  await fill();
  await screen.findByRole("heading", { name: "Your membership account" });
  fireEvent.click(
    screen.getByRole("button", { name: "Email me a sign-in link" }),
  );
  await screen.findByRole("status");
  expect(auth.sendSignInLink).toHaveBeenCalledWith(account.email);
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  fireEvent.change(screen.getByLabelText("Create a password"), {
    target: { value: "my-new-password" },
  });
  fireEvent.submit(screen.getByLabelText("Create a password").closest("form")!);
  expect(auth.signUp).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(screen.getByLabelText("Create a password").closest("form")!);
  await screen.findByText(/Check your membership email/);
  expect(auth.signUp).toHaveBeenCalledWith(account.email, "my-new-password");
  expect(voucherApi.prepare).not.toHaveBeenCalled();
  expect(
    (screen.getByLabelText("Create a password") as HTMLInputElement).value,
  ).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByLabelText("Password")).toBeTruthy();
});
it("handles already-verified signup and preserves voucher details across email callbacks", async () => {
  vi.mocked(auth.currentAccount).mockResolvedValue(null);
  vi.mocked(auth.signUp).mockResolvedValue(account);
  await ready();
  await fill();
  await screen.findByRole("heading", { name: "Your membership account" });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  fireEvent.change(screen.getByLabelText("Create a password"), {
    target: { value: "new-password" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(screen.getByLabelText("Create a password").closest("form")!);
  await screen.findByRole("heading", { name: "Redeem your membership" });
  expect(sessionStorage.getItem("persistence.redemption.draft")).toContain(
    "VOUCHER-CODE",
  );
  cleanup();
  window.history.replaceState(
    null,
    "",
    "/redeem/callback/#access_token=secret&refresh_token=refresh",
  );
  vi.mocked(auth.completeCallback).mockResolvedValue(account);
  render(<RedeemPage />);
  await screen.findByText(/Signed in as/);
  expect(window.location.hash).toBe("");
  expect(auth.completeCallback).toHaveBeenCalledWith(
    "#access_token=secret&refresh_token=refresh",
  );
  expect(
    (screen.getByLabelText("Membership code") as HTMLInputElement).value,
  ).toBe("VOUCHER-CODE");
});
it("shows neutral sign-in failures and allows a fresh attempt", async () => {
  vi.mocked(auth.currentAccount).mockRejectedValue(new Error("expired"));
  await ready();
  expect(screen.getByRole("alert").textContent).toContain(
    "could not be verified",
  );
  expect(auth.signOut).toHaveBeenCalled();
  await fill();
  await screen.findByRole("heading", { name: "Your membership account" });
  vi.mocked(auth.signIn).mockRejectedValue("unexpected");
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "password" },
  });
  fireEvent.submit(screen.getByLabelText("Password").closest("form")!);
  await screen.findByText("Something went wrong. Please try again.");
  expect(voucherApi.redeem).not.toHaveBeenCalled();
});
it("keeps failed verification/activation retryable without losing the challenge", async () => {
  await ready();
  await fill("employee@acme.com");
  await screen.findByRole("heading", { name: "Verify your eligibility email" });
  vi.mocked(voucherApi.verify).mockRejectedValueOnce(
    new Error("Invalid verification code"),
  );
  fireEvent.change(screen.getByLabelText("Email verification code"), {
    target: { value: "000000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
  await screen.findByText("Invalid verification code");
  fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
  await screen.findByRole("heading", { name: "Make it yours" });
  vi.mocked(voucherApi.redeem).mockRejectedValueOnce(
    new Error("You already have a paid subscription"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Activate membership" }));
  await screen.findByText("You already have a paid subscription");
  expect(
    screen.queryByRole("heading", { name: "You're ready to train" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
  await screen.findByRole("heading", { name: "Redeem your membership" });
  expect(screen.queryByRole("alert")).toBeNull();
});
it("handles invalid voucher preparation without sending the user to a false success state", async () => {
  vi.mocked(voucherApi.prepare).mockRejectedValue(
    new Error("That code isn't valid"),
  );
  await ready();
  await fill();
  await screen.findByText("That code isn't valid");
  expect(
    screen.getByRole("heading", { name: "Redeem your membership" }),
  ).toBeTruthy();
  expect(voucherApi.redeem).not.toHaveBeenCalled();
});
it("withholds grant activation when a verification response is not verified", async () => {
  vi.mocked(voucherApi.verify).mockResolvedValue(challenge);
  await ready();
  await fill("employee@acme.com");
  await screen.findByRole("heading", { name: "Verify your eligibility email" });
  fireEvent.change(screen.getByLabelText("Email verification code"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Verify email" }));
  await waitFor(() => expect(voucherApi.verify).toHaveBeenCalled());
  expect(
    screen.queryByRole("button", { name: "Activate membership" }),
  ).toBeNull();
});

it.each(GRANTABLE_TIERS)(
  "confirms and redeems the exact $name plan",
  async (tier) => {
    vi.mocked(voucherApi.prepare).mockResolvedValue({
      ...challenge,
      verified: true,
      eligibilityEmail: account.email,
      tierName: tier.id,
      months: 17,
    });
    vi.mocked(voucherApi.redeem).mockResolvedValue({
      ...challenge,
      voucherId: "v",
      tierName: tier.id,
      months: 17,
      expiresAt: "2028-01-01T00:00:00Z",
    });
    await ready();
    await fill();
    await screen.findByRole("heading", { name: "Make it yours" });
    expect(screen.getByText(`${tier.name} · 17 months`)).toBeTruthy();
    if (tier.audience === "coach")
      expect(
        screen.getByText(
          /This coach membership activates coaching capabilities/,
        ),
      ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Activate membership" }),
    );
    await screen.findByRole("heading", { name: "You're ready to train" });
    expect(
      screen.getByText((content) =>
        content.startsWith(`${tier.name} is active for`),
      ),
    ).toBeTruthy();
    if (tier.audience === "coach")
      expect(
        screen.getByText(
          /Your coach membership and coaching capabilities are ready/,
        ),
      ).toBeTruthy();
  },
);

it.each([
  "This code is invalid or no longer available.",
  "This code has already been used.",
  "This email is not eligible for this code.",
  "This employee email has already redeemed a code from this batch.",
])(
  "blocks before authentication when the server reports: %s",
  async (message) => {
    vi.mocked(auth.currentAccount).mockResolvedValue(null);
    vi.mocked(voucherApi.check).mockRejectedValueOnce(new Error(message));
    await ready();
    await fill("employee@acme.com");
    await screen.findByText(message);
    expect(
      screen.getByRole("heading", { name: "Redeem your membership" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create account" })).toBeNull();
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(auth.sendSignInLink).not.toHaveBeenCalled();
    expect(voucherApi.prepare).not.toHaveBeenCalled();
    expect(voucherApi.check).toHaveBeenCalledWith("VOUCHER-CODE");
    // Correcting details rechecks the server and can proceed without reloading.
    fireEvent.change(screen.getByLabelText("Membership code"), {
      target: { value: "NEW-CODE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByLabelText("Eligibility email");
    fireEvent.change(screen.getByLabelText("Eligibility email"), {
      target: { value: "employee@acme.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Your membership account" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(voucherApi.check).toHaveBeenLastCalledWith(
      "NEW-CODE",
      "employee@acme.com",
    );
  },
);

it("waits for the code check before offering authentication", async () => {
  vi.mocked(auth.currentAccount).mockResolvedValue(null);
  let finish!: (result: {
    valid: true;
    requiresEligibilityEmail: boolean;
  }) => void;
  vi.mocked(voucherApi.check).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await ready();
  fireEvent.change(screen.getByLabelText("Membership code"), {
    target: { value: "VOUCHER-CODE" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(screen.queryByLabelText("Password")).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Please wait…" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  finish({ valid: true, requiresEligibilityEmail: false });
  await screen.findByRole("heading", { name: "Your membership account" });
});

it.each(["signin", "signup", "email"])(
  "rechecks before %s if a code was used while the account form was open",
  async (mode) => {
    vi.mocked(auth.currentAccount).mockResolvedValue(null);
    await ready();
    await fill();
    await screen.findByRole("heading", { name: "Your membership account" });
    vi.mocked(voucherApi.check).mockRejectedValueOnce(
      new Error("This code has already been used."),
    );
    if (mode === "email") {
      fireEvent.click(
        screen.getByRole("button", { name: "Email me a sign-in link" }),
      );
    } else {
      if (mode === "signup") {
        fireEvent.click(screen.getByRole("button", { name: "Create account" }));
        fireEvent.click(screen.getByRole("checkbox"));
      }
      const password = screen.getByLabelText(
        mode === "signup" ? "Create a password" : "Password",
      );
      fireEvent.change(password, { target: { value: "my-password" } });
      fireEvent.submit(password.closest("form")!);
    }
    await screen.findByRole("heading", { name: "Redeem your membership" });
    expect(screen.getByRole("alert").textContent).toBe(
      "This code has already been used.",
    );
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(auth.sendSignInLink).not.toHaveBeenCalled();
  },
);

it("redeems an unrestricted code using the verified membership account without requesting work email", async () => {
  vi.mocked(voucherApi.check).mockResolvedValue({
    valid: true,
    requiresEligibilityEmail: false,
  });
  vi.mocked(voucherApi.prepare).mockResolvedValue({
    ...challenge,
    verified: true,
    eligibilityEmail: account.email,
  });
  await ready();
  expect(screen.queryByLabelText("Eligibility email")).toBeNull();
  fireEvent.change(screen.getByLabelText("Membership code"), {
    target: { value: "OPEN-CODE" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Make it yours" });
  expect(voucherApi.prepare).toHaveBeenCalledWith("OPEN-CODE", undefined);
  expect(screen.queryByLabelText("Eligibility email")).toBeNull();
  expect(screen.queryByLabelText("Email verification code")).toBeNull();
});
it("offers signup for an unrestricted code using only a personal membership email", async () => {
  vi.mocked(auth.currentAccount).mockResolvedValue(null);
  vi.mocked(voucherApi.check).mockResolvedValue({
    valid: true,
    requiresEligibilityEmail: false,
  });
  await ready();
  fireEvent.change(screen.getByLabelText("Membership code"), {
    target: { value: "OPEN-CODE" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Your membership account" });
  expect(screen.queryByLabelText("Eligibility email")).toBeNull();
  fireEvent.change(screen.getByLabelText("Membership account email"), {
    target: { value: account.email },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(
    screen.getByText(/common or previously exposed passwords are rejected/),
  ).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Create a password"), {
    target: { value: "long-new-password" },
  });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.submit(screen.getByLabelText("Create a password").closest("form")!);
  await screen.findByText(/Check your membership email/);
  expect(auth.signUp).toHaveBeenCalledWith(account.email, "long-new-password");
});

it("does not use an old or typed email to gate Apple sign-in", async () => {
  vi.mocked(auth.currentAccount).mockResolvedValue(null);
  vi.mocked(voucherApi.check).mockResolvedValue({
    valid: true,
    requiresEligibilityEmail: false,
  });
  sessionStorage.setItem(
    "persistence.redemption.draft",
    JSON.stringify({
      code: "OPEN-CODE",
      eligibilityEmail: "",
      accountEmail: "already-redeemed@example.test",
      differentAccount: false,
      savedAt: Date.now(),
    }),
  );
  const assign = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign });
  vi.mocked(auth.appleOAuthUrl).mockResolvedValue(
    "https://auth.example.test/authorize",
  );
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("button", { name: "Continue with Apple" });
  expect(voucherApi.check).toHaveBeenLastCalledWith("OPEN-CODE", undefined);
  fireEvent.change(screen.getByLabelText("Membership account email"), {
    target: { value: "another@example.test" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue with Apple" }));
  await waitFor(() => expect(assign).toHaveBeenCalled());
  expect(voucherApi.check).toHaveBeenLastCalledWith("OPEN-CODE", undefined);
  vi.unstubAllGlobals();
});
it("returns to code details when Apple preflight fails without starting OAuth", async () => {
  vi.mocked(auth.currentAccount).mockResolvedValue(null);
  await ready();
  await fill();
  vi.mocked(voucherApi.check).mockRejectedValueOnce(
    new Error("Code already used"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue with Apple" }));
  await screen.findByText("Code already used");
  expect(auth.appleOAuthUrl).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "Continue with Apple" }),
  ).toBeNull();
});
it.each(["password", "link"])(
  "requires account email only for email authentication (%s)",
  async (method) => {
    vi.mocked(auth.currentAccount).mockResolvedValue(null);
    await ready();
    await fill();
    fireEvent.change(screen.getByLabelText("Membership account email"), {
      target: { value: "" },
    });
    if (method === "link")
      fireEvent.click(
        screen.getByRole("button", { name: "Email me a sign-in link" }),
      );
    else fireEvent.submit(screen.getByLabelText("Password").closest("form")!);
    await screen.findByText("Enter your membership account email to continue.");
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(auth.sendSignInLink).not.toHaveBeenCalled();
  },
);
it("uses the verified current account instead of a stale draft email on reload", async () => {
  sessionStorage.setItem(
    "persistence.redemption.draft",
    JSON.stringify({
      code: "OPEN-CODE",
      eligibilityEmail: "",
      accountEmail: "previous@example.test",
      differentAccount: false,
      savedAt: Date.now(),
    }),
  );
  vi.mocked(voucherApi.check).mockResolvedValue({
    valid: true,
    requiresEligibilityEmail: false,
  });
  vi.mocked(voucherApi.prepare).mockResolvedValue({
    ...challenge,
    verified: true,
    eligibilityEmail: account.email,
  });
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByRole("heading", { name: "Make it yours" });
  expect(voucherApi.check).toHaveBeenLastCalledWith("OPEN-CODE", account.email);
  expect(voucherApi.prepare).toHaveBeenCalledWith("OPEN-CODE", undefined);
});
