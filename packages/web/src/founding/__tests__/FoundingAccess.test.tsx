import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import FoundingAccess from "../FoundingAccess";
import * as auth from "../auth";
import { foundingApi } from "../api";
import { FOUNDING_COPY } from "@/marketing/foundingOffer";
vi.mock("../auth", () => ({
  currentAccount: vi.fn(),
  completeCallback: vi.fn(),
  callbackCampaign: vi.fn(() => null),
  callbackPlan: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  oauthUrl: vi.fn(),
  sendSignInLink: vi.fn(),
  accountSession: vi.fn(),
}));
vi.mock("../api", () => ({
  foundingApi: { request: vi.fn(), verify: vi.fn() },
}));
const account = { id: "apple-user", email: "private@privaterelay.appleid.com" };
const assign = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/founding/access");
  vi.mocked(auth.currentAccount).mockResolvedValue(account);
  vi.mocked(auth.accountSession).mockResolvedValue({
    accessToken: "verified",
    refreshToken: "r",
    expiresAt: 9999999999,
  });
  vi.mocked(foundingApi.request).mockResolvedValue({
    challengeId: "challenge",
  });
  vi.mocked(foundingApi.verify).mockResolvedValue({
    claimed: true,
    tierName: "premium_plus",
    expiresAt: "2027-03-20",
  });
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function confirm() {
  fireEvent.click(
    await screen.findByRole("checkbox", { name: /This is the Persistence/ }),
  );
}
async function purchaseEmail() {
  fireEvent.change(
    await screen.findByLabelText(/Email used for your purchase|Receipt email/),
    { target: { value: "receipt@example.com" } },
  );
}
it("requires destination confirmation then claims a different purchase email", async () => {
  render(<FoundingAccess />);
  await purchaseEmail();
  const send = screen.getByRole("button", { name: "Send verification code" });
  expect(send).toHaveProperty("disabled", true);
  await confirm();
  fireEvent.click(send);
  await screen.findByLabelText("Verification code");
  expect(foundingApi.request).toHaveBeenCalledWith(
    "receipt@example.com",
    "apple-user",
  );
  expect(screen.getByText(account.email)).toBeDefined();
  fireEvent.change(screen.getByLabelText("Verification code"), {
    target: { value: "123456" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Verify and activate access" }),
  );
  expect(await screen.findByText("Your access is ready")).toBeDefined();
  expect(foundingApi.verify).toHaveBeenCalledWith(
    "challenge",
    "123456",
    "apple-user",
  );
  expect(screen.queryByLabelText("Verification code")).toBeNull();
});
it("clears the old proof and destination on account switch", async () => {
  render(<FoundingAccess />);
  await confirm();
  await purchaseEmail();
  fireEvent.click(
    screen.getByRole("button", { name: "Send verification code" }),
  );
  await screen.findByLabelText("Verification code");
  fireEvent.click(screen.getByRole("button", { name: "Change account" }));
  expect(auth.signOut).toHaveBeenCalled();
  expect(screen.queryByLabelText("Verification code")).toBeNull();
  expect(screen.queryByText(account.email)).toBeNull();
  expect(
    screen.getByRole("button", { name: "Continue with Apple" }),
  ).toBeDefined();
});
it("keeps the same challenge after a failed code so retry is possible", async () => {
  vi.mocked(foundingApi.verify).mockRejectedValueOnce(
    new Error("Incorrect code"),
  );
  render(<FoundingAccess />);
  await confirm();
  await purchaseEmail();
  fireEvent.click(
    screen.getByRole("button", { name: "Send verification code" }),
  );
  fireEvent.change(await screen.findByLabelText("Verification code"), {
    target: { value: "123456" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Verify and activate access" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Incorrect code",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Verify and activate access" }),
  );
  expect(await screen.findByText("Your access is ready")).toBeDefined();
  expect(foundingApi.verify).toHaveBeenCalledTimes(2);
});
it("allows requesting a replacement code and stops accidental double requests", async () => {
  render(<FoundingAccess />);
  await confirm();
  await purchaseEmail();
  const button = screen.getByRole("button", { name: "Send verification code" });
  fireEvent.click(button);
  fireEvent.click(button);
  await screen.findByLabelText("Verification code");
  expect(foundingApi.request).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Change purchase email or request a new code",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Send verification code" }),
  );
  await screen.findByLabelText("Verification code");
  expect(foundingApi.request).toHaveBeenCalledTimes(2);
});
it("purchases the selected plan for the confirmed account and starts term at payment", async () => {
  window.history.replaceState(
    null,
    "",
    "/founding/access?tier=premium_plus&months=12",
  );
  vi.stubGlobal("location", { ...window.location, assign });
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ ok: true, url: "https://checkout.stripe.com/pay" }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<FoundingAccess />);
  await confirm();
  await purchaseEmail();
  expect(
    screen.getByText(/Your term starts once payment is confirmed/),
  ).toBeDefined();
  expect(
    screen.getByText(FOUNDING_COPY.termsNote, { exact: false }),
  ).toBeDefined();
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to secure payment" }),
  );
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
  expect(JSON.parse(init.body as string)).toMatchObject({
    tier: "premium_plus",
    months: 12,
    email: "receipt@example.com",
  });
  expect(init.headers).toMatchObject({ Authorization: "Bearer verified" });
  expect(foundingApi.request).not.toHaveBeenCalled();
});
it("keeps credentials off the page URL before exchanging callback and only exchanges once in StrictMode", async () => {
  window.history.replaceState(
    null,
    "",
    "/founding/access/callback?flow=nonce&code=secret#ignored",
  );
  vi.mocked(auth.callbackPlan).mockReturnValue("premium:6");
  vi.mocked(auth.completeCallback).mockImplementation(async () => {
    expect(window.location.search).not.toContain("secret");
    expect(window.location.hash).toBe("");
    return account;
  });
  render(
    <StrictMode>
      <FoundingAccess />
    </StrictMode>,
  );
  await screen.findByText("Confirm your membership");
  expect(auth.completeCallback).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Premium · Six months/)).toBeDefined();
});
it("shows friendly OAuth cancellation and lets the user restart", async () => {
  window.history.replaceState(
    null,
    "",
    "/founding/access/callback?error=access_denied",
  );
  vi.mocked(auth.callbackPlan).mockReturnValue(null);
  vi.mocked(auth.completeCallback).mockRejectedValue(
    new Error("Sign-in was cancelled"),
  );
  render(<FoundingAccess />);
  expect((await screen.findByRole("alert")).textContent).toContain("cancelled");
  expect(
    screen.getByRole("button", { name: "Continue with Apple" }),
  ).toHaveProperty("disabled", false);
});
it("signs into an existing account and asks for explicit confirmation", async () => {
  vi.mocked(auth.currentAccount).mockResolvedValue(null);
  vi.mocked(auth.signIn).mockResolvedValue(account);
  render(<FoundingAccess />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText("Account email"), {
    target: { value: "user@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText(account.email)).toBeDefined();
  expect(screen.getByRole("checkbox")).toHaveProperty("checked", false);
});
it("starts Apple and Google authentication without using the purchase email", async () => {
  vi.mocked(auth.currentAccount).mockResolvedValue(null);
  vi.mocked(auth.oauthUrl).mockResolvedValue(
    "https://auth.example.com/authorize",
  );
  vi.stubGlobal("location", { ...window.location, assign });
  render(<FoundingAccess />);
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Continue with Apple" }),
    ).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue with Apple" }));
  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith("https://auth.example.com/authorize"),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));
  await waitFor(() => expect(auth.oauthUrl).toHaveBeenCalledWith("google"));
  expect(auth.oauthUrl).toHaveBeenCalledWith("apple");
});
it("offers email-link recovery without creating a second account", async () => {
  vi.mocked(auth.currentAccount).mockResolvedValue(null);
  vi.mocked(auth.sendSignInLink).mockResolvedValue();
  render(<FoundingAccess />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText("Account email"), {
    target: { value: "member@example.com" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Email me a sign-in link" }),
  );
  expect((await screen.findByRole("status")).textContent).toContain(
    "If this email has an account",
  );
  expect(auth.sendSignInLink).toHaveBeenCalledWith("member@example.com");
  expect(auth.signUp).not.toHaveBeenCalled();
});
it("requires signup consent and guides confirmation without promising access", async () => {
  vi.mocked(auth.currentAccount).mockResolvedValue(null);
  vi.mocked(auth.signUp).mockResolvedValue(null);
  render(<FoundingAccess />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "New to Persistence? Create an email account",
    }),
  );
  fireEvent.change(screen.getByLabelText("Account email"), {
    target: { value: "new@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Create a password"), {
    target: { value: "password123" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Create account" }).closest("form")!,
  );
  expect(auth.signUp).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Create account" }),
    ).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: /I agree/ }));
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect((await screen.findByRole("status")).textContent).toContain(
    "Check your email",
  );
  expect(auth.signUp).toHaveBeenCalledWith("new@example.com", "password123");
  expect(screen.queryByText("Your access is ready")).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Already have an account? Sign in" }),
  );
  expect(screen.getByLabelText("Password")).toHaveProperty("value", "");
});
it("requires the security check and keeps the honeypot outside keyboard and accessibility navigation", async () => {
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "site-key");
  window.history.replaceState(
    null,
    "",
    "/founding/access?tier=premium&months=6",
  );
  const { container } = render(<FoundingAccess />);
  await confirm();
  await purchaseEmail();
  expect(
    screen.getByRole("button", { name: "Continue to secure payment" }),
  ).toHaveProperty("disabled", true);
  const hp = container.querySelector<HTMLInputElement>(
    'input[name="lead_hp"]',
  )!;
  expect(hp.tabIndex).toBe(-1);
  expect(hp.closest('[aria-hidden="true"]')).not.toBeNull();
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Continue to secure payment" })
      .closest("form")!,
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "security check",
  );
});
it("preserves refusal and does not activate access when checkout fails", async () => {
  window.history.replaceState(
    null,
    "",
    "/founding/access?tier=premium&months=6",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "active_subscription" }), {
          status: 409,
        }),
    ),
  );
  render(<FoundingAccess />);
  await confirm();
  await purchaseEmail();
  fireEvent.click(
    screen.getByRole("button", { name: "Continue to secure payment" }),
  );
  expect((await screen.findByRole("alert")).textContent).toContain(
    "already has paid",
  );
  expect(foundingApi.verify).not.toHaveBeenCalled();
});
it("restores a validated campaign alongside the chosen plan after authentication", async () => {
  window.history.replaceState(
    null,
    "",
    "/founding/access/callback?flow=nonce&code=secret",
  );
  vi.mocked(auth.callbackPlan).mockReturnValue("premium:6");
  vi.mocked(auth.callbackCampaign).mockReturnValue("meta");
  vi.mocked(auth.completeCallback).mockResolvedValue(account);
  render(<FoundingAccess />);
  await screen.findByText("Confirm your membership");
  expect(window.location.search).toContain("campaign=meta");
  expect(sessionStorage.getItem("persistence.founding.campaign")).toBe("meta");
});
it("never sends a claim when a form is submitted before account confirmation", async () => {
  render(<FoundingAccess />);
  await purchaseEmail();
  fireEvent.submit(
    screen
      .getByRole("button", { name: "Send verification code" })
      .closest("form")!,
  );
  await waitFor(() =>
    expect(screen.getByRole("checkbox")).toHaveProperty("disabled", false),
  );
  expect(foundingApi.request).not.toHaveBeenCalled();
});
it("shows safe fallback messages for unknown errors", async () => {
  vi.mocked(auth.currentAccount).mockRejectedValueOnce("unknown");
  const first = render(<FoundingAccess />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Sign-in failed",
  );
  first.unmount();
  vi.mocked(auth.currentAccount).mockResolvedValue(account);
  vi.mocked(foundingApi.request).mockRejectedValueOnce("unknown");
  render(<FoundingAccess />);
  await confirm();
  await purchaseEmail();
  fireEvent.click(
    screen.getByRole("button", { name: "Send verification code" }),
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Please try again.",
  );
});
