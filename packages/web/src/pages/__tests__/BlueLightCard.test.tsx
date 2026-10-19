import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderPage } from "@/test-utils";
import BlueLightCard from "../BlueLightCard";
import * as auth from "@/founding/auth";
import * as tradedoubler from "@/lib/tradedoubler";
import * as turnstile from "@/lib/turnstile";
import { setConsent } from "@/lib/consent";
import {
  BLC_CODE_STORAGE_KEY,
  BLC_PLAN_STORAGE_KEY,
} from "@/marketing/blc/blcOffer";

vi.mock("@/founding/auth", () => ({
  currentAccount: vi.fn(async () => null),
  completeCallback: vi.fn(async () => null),
  callbackExtra: vi.fn(() => null),
  isRetryableAuthError: vi.fn(() => false),
  signOut: vi.fn(),
  signIn: vi.fn(),
  signUp: vi.fn(),
  oauthUrl: vi.fn(),
  sendSignInLink: vi.fn(),
  accountSession: vi.fn(async () => ({
    accessToken: "verified",
    refreshToken: "r",
    expiresAt: 9999999999,
  })),
}));

const ACCOUNT = { id: "user-1", email: "member@example.com" };
const BLC_SITE = "https://www.bluelightcard.co.uk/";

type Route = { url: string; status: number; body: unknown };

/** A fetch stub that answers the code check and the checkout by path. */
function stubApi(
  routes: Partial<Record<"check" | "checkout", Partial<Route>>> = {},
) {
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("/blc/code/check")) {
      const r = routes.check ?? {};
      return new Response(JSON.stringify(r.body ?? { ok: true }), {
        status: r.status ?? 200,
      });
    }
    if (url.endsWith("/blc/checkout")) {
      const r = routes.checkout ?? {};
      return new Response(
        JSON.stringify(
          r.body ?? { ok: true, url: "https://checkout.stripe.com/pay" },
        ),
        { status: r.status ?? 200 },
      );
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

function checkCalls(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls.filter(([url]) =>
    String(url).endsWith("/blc/code/check"),
  );
}

function checkoutCalls(fetcher: ReturnType<typeof vi.fn>) {
  return fetcher.mock.calls.filter(([url]) =>
    String(url).endsWith("/blc/checkout"),
  );
}

/** Put a tduid on the real address bar — the gate reads window.location. */
function arriveViaAffiliate() {
  window.history.replaceState(null, "", "/blue-light-card?tduid=click-1");
}

function render(route = "/blue-light-card") {
  return renderPage(<BlueLightCard />, { route });
}

const CODE_LABEL = "Your Blue Light Card code";
const CODE_VALID = "Code applied. Member prices are unlocked.";
const CODE_INVALID =
  "That code can't be used. Check it in the Blue Light Card app or contact support.";
const SIGN_IN_HEADING = "Sign in to the account you'll use in the app";

/** The code field's live status slot (`role="status"`, polite). */
function codeStatus(): HTMLElement {
  return document.getElementById("blc-status")!;
}

async function applyCode(code = "BLC2026") {
  fireEvent.change(screen.getByLabelText(CODE_LABEL), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await screen.findByText(CODE_VALID);
}

/** Reveal the password form behind the design's disclosure. */
function usePassword() {
  fireEvent.click(
    screen.getByRole("button", { name: "Use a password instead" }),
  );
}

describe("BlueLightCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth.currentAccount).mockResolvedValue(null);
    vi.mocked(auth.callbackExtra).mockReturnValue(null);
    vi.mocked(auth.isRetryableAuthError).mockReturnValue(false);
    window.history.replaceState(null, "", "/blue-light-card");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  describe("the gate", () => {
    it("shows the ungated page — no code field, no price — without a referral or code", () => {
      stubApi();
      render();
      expect(
        screen.getByRole("heading", {
          name: "A thank-you for the people who show up.",
        }),
      ).toBeDefined();
      expect(
        screen.getByText(/This offer is for Blue Light Card members\./),
      ).toBeDefined();
      const partner = screen.getByRole("link", {
        name: "Open this offer on Blue Light Card",
      });
      expect(partner).toHaveProperty("href", BLC_SITE);
      expect(partner.getAttribute("rel")).toMatch(/noopener/);
      expect(
        screen
          .getByRole("link", { name: "See public plans" })
          .getAttribute("href"),
      ).toBe("/pricing");
      // The proof points stand in for the plans.
      expect(
        screen.getByRole("heading", { name: "Offline-first logging" }),
      ).toBeDefined();
      expect(
        screen.getByText("Workouts, weight and steps flow both ways."),
      ).toBeDefined();
      expect(screen.queryByLabelText(CODE_LABEL)).toBeNull();
      expect(screen.queryByTestId("blc-plan-premium")).toBeNull();
      expect(document.body.textContent).not.toMatch(/£/);
      expect(document.body.textContent).not.toMatch(/13\.59|111\.99/);
    });

    it("opens the code step for a visitor arriving with ?tduid=, before any consent", () => {
      stubApi();
      arriveViaAffiliate();
      render("/blue-light-card?tduid=click-1");
      expect(screen.getByLabelText(CODE_LABEL)).toBeDefined();
      expect(
        screen.getByRole("heading", {
          name: "A thank-you for the people who show up.",
        }),
      ).toBeDefined();
      expect(screen.getByText(/Apply your code below/)).toBeDefined();
      // The cards are there but LOCKED until the code checks out.
      expect(screen.getByTestId("blc-plan-premium").className).toMatch(
        /blc-plan-locked/,
      );
      expect(
        screen.getByRole("button", { name: "Continue with Premium" }),
      ).toHaveProperty("disabled", true);
      expect(
        screen.getByRole("button", { name: "Continue with Premium+" }),
      ).toHaveProperty("disabled", true);
      expect(
        screen.getAllByText("Apply your Blue Light Card code to continue."),
      ).toHaveLength(2);
    });

    it("opens for a visitor who already holds the SDK cookie", () => {
      stubApi();
      document.cookie = "TRADEDOUBLER=x";
      try {
        render();
        expect(screen.getByLabelText(CODE_LABEL)).toBeDefined();
      } finally {
        document.cookie =
          "TRADEDOUBLER=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/";
      }
    });

    it("mounts the landing tag: reads the click id and loads the SDK on mount, and again on consent", () => {
      stubApi();
      const capture = vi.spyOn(tradedoubler, "captureTduid");
      const init = vi.spyOn(tradedoubler, "initTradedoubler");
      render();
      expect(capture).toHaveBeenCalledTimes(1);
      expect(init).toHaveBeenCalledTimes(1);
      act(() => setConsent({ advertising: false, affiliate: true }));
      expect(capture).toHaveBeenCalledTimes(2);
      expect(init).toHaveBeenCalledTimes(2);
      // Withdrawal does not re-capture.
      act(() => setConsent({ advertising: false, affiliate: false }));
      expect(capture).toHaveBeenCalledTimes(2);
    });

    it("re-evaluates the gate when consent lands with a tduid still on the URL", () => {
      stubApi();
      vi.spyOn(tradedoubler, "hasAffiliateReferral")
        .mockReturnValueOnce(false)
        .mockReturnValue(true);
      render();
      expect(screen.queryByLabelText(CODE_LABEL)).toBeNull();
      act(() => setConsent({ advertising: false, affiliate: true }));
      expect(screen.getByLabelText(CODE_LABEL)).toBeDefined();
    });
  });

  describe("the code", () => {
    beforeEach(arriveViaAffiliate);

    it("checks the code, keeps it for a reload and reveals the member prices", async () => {
      const fetcher = stubApi();
      render();
      const input = screen.getByLabelText(CODE_LABEL);
      expect(input.getAttribute("aria-describedby")).toBe(
        "blc-help blc-status",
      );
      expect(input.getAttribute("placeholder")).toBe("BLC-XXXX-XXXX");
      expect(input.getAttribute("aria-invalid")).toBe("false");
      await applyCode(" BLC2026 ");

      const [url, init] = checkCalls(fetcher)[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toMatch(/\/blc\/code\/check$/);
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body as string)).toEqual({ code: "BLC2026" });
      expect(window.sessionStorage.getItem(BLC_CODE_STORAGE_KEY)).toBe(
        "BLC2026",
      );

      // Annual by default: public price struck through, member price shown.
      expect(screen.getByTestId("blc-public-premium").textContent).toBe(
        "£139.99/yr",
      );
      expect(screen.getByTestId("blc-member-premium").textContent).toBe(
        "£111.99/yr",
      );
      expect(screen.getByTestId("blc-public-premium_plus").textContent).toBe(
        "£249.99/yr",
      );
      expect(screen.getByTestId("blc-member-premium_plus").textContent).toBe(
        "£199.99/yr",
      );
      expect(screen.getByTestId("blc-public-premium").tagName).toBe("S");
      expect(
        screen.getAllByText("Billed once a year. Cancel any time."),
      ).toHaveLength(2);
      expect(screen.getAllByText("Save 20 %")).toHaveLength(2);
      // Unlocked: the CTAs are live and the locked note is gone.
      expect(screen.getByTestId("blc-plan-premium").className).not.toMatch(
        /blc-plan-locked/,
      );
      expect(
        screen.getByRole("button", { name: "Continue with Premium+" }),
      ).toHaveProperty("disabled", false);
      expect(
        screen.queryByText("Apply your Blue Light Card code to continue."),
      ).toBeNull();
      // Premium+ is the highlighted card.
      expect(screen.getByText("Most popular").closest("article")).toBe(
        screen.getByTestId("blc-plan-premium_plus"),
      );
      // Features from the shared catalog, not retyped.
      expect(screen.getByText("Unlimited workouts and history")).toBeDefined();
      expect(
        screen.getByText("Loadout — equipment-aware training"),
      ).toBeDefined();
      // Terms, as one paragraph.
      expect(screen.getByText("Offer terms")).toBeDefined();
      expect(
        screen.getByText(/One redemption per person\./).textContent,
      ).toMatch(/^For verified Blue Light Card members\. .*same account\.$/);
    });

    it("shows the checking state while the request is in flight", async () => {
      let resolve!: (r: Response) => void;
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise<Response>((r) => (resolve = r))),
      );
      render();
      fireEvent.change(screen.getByLabelText(CODE_LABEL), {
        target: { value: "X" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      expect(screen.getByRole("button", { name: "Apply" })).toHaveProperty(
        "disabled",
        true,
      );
      expect(screen.getByLabelText(CODE_LABEL)).toHaveProperty(
        "disabled",
        true,
      );
      expect(codeStatus().textContent).toBe("Checking your code…");
      expect(codeStatus().getAttribute("aria-live")).toBe("polite");
      await act(async () => {
        resolve(new Response(JSON.stringify({ ok: true })));
      });
      await screen.findByText(CODE_VALID);
      expect(screen.getByLabelText(CODE_LABEL)).toHaveProperty(
        "disabled",
        false,
      );
    });

    it("gives one neutral refusal for an invalid code and forgets it", async () => {
      stubApi({
        check: { status: 400, body: { ok: false, error: "invalid_code" } },
      });
      window.sessionStorage.setItem(BLC_CODE_STORAGE_KEY, "OLD");
      render();
      // The stored code is re-checked on load and refused: forgotten.
      expect((await screen.findByText(CODE_INVALID)).textContent).toBe(
        CODE_INVALID,
      );
      expect(window.sessionStorage.getItem(BLC_CODE_STORAGE_KEY)).toBeNull();
      expect(
        screen.getByLabelText(CODE_LABEL).getAttribute("aria-invalid"),
      ).toBe("true");

      fireEvent.change(screen.getByLabelText(CODE_LABEL), {
        target: { value: "NOPE" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      await screen.findByText(CODE_INVALID);
      // Still locked, and the message lives in the polite status slot — the
      // refusal is neutral, not an alert.
      expect(screen.queryByRole("alert")).toBeNull();
      expect(codeStatus().textContent).toBe(CODE_INVALID);
      expect(
        screen.getByRole("button", { name: "Continue with Premium" }),
      ).toHaveProperty("disabled", true);
    });

    it("distinguishes a failed check (429/5xx/network) from a refused code", async () => {
      stubApi({ check: { status: 429, body: {} } });
      render();
      fireEvent.change(screen.getByLabelText(CODE_LABEL), {
        target: { value: "X" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      expect(
        (await screen.findByText(/couldn't check that code just now/))
          .textContent,
      ).toMatch(/couldn't check that code just now/);
      // Not the code's fault, so the field is not marked invalid.
      expect(
        screen.getByLabelText(CODE_LABEL).getAttribute("aria-invalid"),
      ).toBe("false");

      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("offline");
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));
      await waitFor(() =>
        expect(codeStatus().textContent).toMatch(
          /couldn't check that code just now/,
        ),
      );
    });

    it("switches both cards to monthly prices on the toggle", async () => {
      stubApi();
      render();
      await applyCode();
      // One segmented control per card, both driving the same cadence.
      const groups = screen.getAllByRole("group", { name: "Billing period" });
      expect(groups).toHaveLength(2);
      const monthly = screen.getAllByRole("button", { name: "Monthly" });
      const annual = screen.getAllByRole("button", { name: "Annual" });
      expect(annual.map((b) => b.getAttribute("aria-pressed"))).toEqual([
        "true",
        "true",
      ]);
      fireEvent.click(monthly[1]);
      expect(monthly.map((b) => b.getAttribute("aria-pressed"))).toEqual([
        "true",
        "true",
      ]);
      expect(annual.map((b) => b.getAttribute("aria-pressed"))).toEqual([
        "false",
        "false",
      ]);
      expect(screen.getByTestId("blc-public-premium").textContent).toBe(
        "£16.99/mo",
      );
      expect(screen.getByTestId("blc-member-premium").textContent).toBe(
        "£13.59/mo",
      );
      expect(screen.getByTestId("blc-public-premium_plus").textContent).toBe(
        "£29.99/mo",
      );
      expect(screen.getByTestId("blc-member-premium_plus").textContent).toBe(
        "£23.99/mo",
      );
      expect(
        screen.getAllByText("Billed every month. Cancel any time."),
      ).toHaveLength(2);
    });

    it("shows the cancelled notice for ?cancelled=1 and keeps the code", async () => {
      stubApi();
      window.sessionStorage.setItem(BLC_CODE_STORAGE_KEY, "BLC2026");
      window.history.replaceState(
        null,
        "",
        "/blue-light-card?tduid=click-1&cancelled=1",
      );
      render("/blue-light-card?cancelled=1");
      expect(
        screen.getByText("Checkout cancelled — your code is still valid."),
      ).toBeDefined();
      // The stored code is re-checked, not trusted, and the prices come back.
      expect(await screen.findByTestId("blc-plan-premium")).toBeDefined();
    });
  });

  describe("edge cases around the code", () => {
    beforeEach(arriveViaAffiliate);

    it("does nothing for a blank submission", async () => {
      const fetcher = stubApi();
      render();
      // Apply is enabled (the design does not grey it out) and a blank
      // submission simply does nothing.
      expect(screen.getByRole("button", { name: "Apply" })).toHaveProperty(
        "disabled",
        false,
      );
      fireEvent.submit(screen.getByLabelText(CODE_LABEL).closest("form")!);
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(checkCalls(fetcher)).toHaveLength(0);
      expect(codeStatus().textContent).toBe("");
    });

    it("drops a stale answer when a newer check has started", async () => {
      const pending: ((r: Response) => void)[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(() => new Promise<Response>((r) => pending.push(r))),
      );
      render();
      const field = screen.getByLabelText(CODE_LABEL);
      fireEvent.change(field, { target: { value: "FIRST" } });
      fireEvent.submit(field.closest("form")!);
      fireEvent.change(field, { target: { value: "SECOND" } });
      fireEvent.submit(field.closest("form")!);
      expect(pending).toHaveLength(2);
      // The FIRST answer arrives last and says "valid" — it must be ignored.
      await act(async () => {
        pending[1](
          new Response(JSON.stringify({ ok: false }), { status: 400 }),
        );
      });
      await screen.findByText(CODE_INVALID);
      await act(async () => {
        pending[0](new Response(JSON.stringify({ ok: true })));
      });
      expect(screen.queryByText(CODE_VALID)).toBeNull();
      expect(window.sessionStorage.getItem(BLC_CODE_STORAGE_KEY)).toBeNull();
    });

    it("ignores an unparseable stored plan and survives a storage that throws", async () => {
      stubApi();
      window.sessionStorage.setItem(BLC_CODE_STORAGE_KEY, "BLC2026");
      window.sessionStorage.setItem(BLC_PLAN_STORAGE_KEY, "gold:weekly");
      render();
      expect(await screen.findByTestId("blc-plan-premium")).toBeDefined();
      expect(
        screen.queryByRole("heading", { name: SIGN_IN_HEADING }),
      ).toBeNull();
    });

    it("renders when sessionStorage is unavailable", async () => {
      stubApi();
      vi.spyOn(window.sessionStorage, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      vi.spyOn(window.sessionStorage, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      render();
      await applyCode();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with Premium" }),
      );
      expect(
        screen.getByRole("heading", { name: SIGN_IN_HEADING }),
      ).toBeDefined();
    });
  });

  describe("a reload", () => {
    it("re-checks a stored code and stays open on it alone, with no referral", async () => {
      const fetcher = stubApi();
      window.sessionStorage.setItem(BLC_CODE_STORAGE_KEY, "BLC2026");
      render();
      expect(await screen.findByTestId("blc-plan-premium")).toBeDefined();
      expect(checkCalls(fetcher)).toHaveLength(1);
    });

    it("falls back to the ungated page when the stored code no longer checks out", async () => {
      stubApi({ check: { status: 400, body: { ok: false } } });
      window.sessionStorage.setItem(BLC_CODE_STORAGE_KEY, "STALE");
      render();
      expect(
        await screen.findByRole("link", {
          name: "Open this offer on Blue Light Card",
        }),
      ).toBeDefined();
      expect(screen.queryByLabelText(CODE_LABEL)).toBeNull();
    });

    it("restores a chosen plan and goes straight to the account step", async () => {
      stubApi();
      window.sessionStorage.setItem(BLC_CODE_STORAGE_KEY, "BLC2026");
      window.sessionStorage.setItem(
        BLC_PLAN_STORAGE_KEY,
        "premium_plus:monthly",
      );
      render();
      expect(
        await screen.findByRole("heading", { name: SIGN_IN_HEADING }),
      ).toBeDefined();
      expect(screen.getByText("Premium+ · monthly · £23.99/mo")).toBeDefined();
    });
  });

  describe("choosing a plan and signing in", () => {
    beforeEach(arriveViaAffiliate);

    it("moves to the account step, remembers the plan, and can change it", async () => {
      stubApi();
      render();
      await applyCode();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with Premium+" }),
      );
      expect(
        screen.getByRole("heading", { name: SIGN_IN_HEADING }),
      ).toBeDefined();
      expect(window.sessionStorage.getItem(BLC_PLAN_STORAGE_KEY)).toBe(
        "premium_plus:annual",
      );
      expect(screen.getByText("Premium+ · annual · £199.99/yr")).toBeDefined();
      expect(
        screen.getByText(/cannot be moved to another one later/),
      ).toBeDefined();
      // The password form is behind a disclosure.
      expect(screen.queryByLabelText("Password")).toBeNull();
      expect(
        screen
          .getByRole("button", { name: "Use a password instead" })
          .getAttribute("aria-expanded"),
      ).toBe("false");

      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(screen.getByTestId("blc-plan-premium")).toBeDefined();
      expect(window.sessionStorage.getItem(BLC_PLAN_STORAGE_KEY)).toBeNull();
    });

    it("starts Apple/Google sign-in with the page's own return path and the code + plan in the proof", async () => {
      stubApi();
      const assign = vi.fn();
      vi.stubGlobal("location", {
        ...window.location,
        search: "?tduid=click-1",
        assign,
      });
      vi.mocked(auth.oauthUrl).mockResolvedValue("https://auth.example/apple");
      render();
      await applyCode();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with Premium" }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with Apple" }),
      );
      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith("https://auth.example/apple"),
      );
      expect(auth.oauthUrl).toHaveBeenCalledWith("apple", {
        returnPath: "/blue-light-card/callback",
        extra: { code: "BLC2026", plan: "premium:annual" },
      });
    });

    it("signs in with email + password and lands on the checkout step with the receipt prefilled", async () => {
      stubApi();
      vi.mocked(auth.signIn).mockResolvedValue(ACCOUNT);
      render();
      await applyCode();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with Premium" }),
      );
      usePassword();
      expect(
        screen
          .getByRole("button", { name: "Send me a sign-in link" })
          .getAttribute("aria-expanded"),
      ).toBe("true");
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "member@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "hunter22" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      expect(
        await screen.findByRole("heading", { name: "Confirm your plan" }),
      ).toBeDefined();
      expect(auth.signIn).toHaveBeenCalledWith(
        "member@example.com",
        "hunter22",
      );
      expect(screen.getByText("Premium · annual · £111.99/yr")).toBeDefined();
      expect(
        (screen.getByLabelText("Receipt email") as HTMLInputElement).value,
      ).toBe("member@example.com");
      expect(
        screen.getByText("member@example.com", { selector: "strong" }),
      ).toBeDefined();
    });

    it("surfaces a sign-in failure and offers a retry when it is transient", async () => {
      stubApi();
      vi.mocked(auth.signIn).mockRejectedValue(new Error("Too many attempts."));
      vi.mocked(auth.isRetryableAuthError).mockReturnValue(true);
      vi.mocked(auth.currentAccount)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(ACCOUNT);
      render();
      await applyCode();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with Premium" }),
      );
      usePassword();
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "member@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "x" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      expect((await screen.findByRole("alert")).textContent).toBe(
        "Too many attempts.",
      );
      fireEvent.click(screen.getByRole("button", { name: "Retry sign-in" }));
      expect(
        await screen.findByRole("heading", { name: "Confirm your plan" }),
      ).toBeDefined();
    });

    it("offers a retry when the restore itself fails transiently, and signs out if the retry then fails for good", async () => {
      stubApi();
      window.sessionStorage.setItem(BLC_CODE_STORAGE_KEY, "BLC2026");
      window.sessionStorage.setItem(BLC_PLAN_STORAGE_KEY, "premium:annual");
      vi.mocked(auth.currentAccount)
        .mockRejectedValueOnce(new Error("We couldn't reach sign-in services."))
        .mockRejectedValueOnce(new Error("Your account changed."));
      vi.mocked(auth.isRetryableAuthError)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      render();
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /couldn't reach/,
      );
      expect(auth.signOut).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Retry sign-in" }));
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /account changed/,
      );
      expect(auth.signOut).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByRole("button", { name: "Retry sign-in" }),
      ).toBeNull();
    });

    it("signs out on a non-retryable restore failure", async () => {
      stubApi();
      window.sessionStorage.setItem(BLC_CODE_STORAGE_KEY, "BLC2026");
      window.sessionStorage.setItem(BLC_PLAN_STORAGE_KEY, "premium:annual");
      vi.mocked(auth.currentAccount).mockRejectedValue(
        new Error("Your account changed. Please sign in again."),
      );
      render();
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /account changed/,
      );
      expect(auth.signOut).toHaveBeenCalled();
    });

    it("creates an email account only once the terms are ticked, then explains confirmation", async () => {
      stubApi();
      vi.mocked(auth.signUp).mockResolvedValue(null);
      render();
      await applyCode();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with Premium" }),
      );
      usePassword();
      fireEvent.click(
        screen.getByRole("button", {
          name: "New to Persistence? Create an email account",
        }),
      );
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "new@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Create a password"), {
        target: { value: "longenough" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create account" }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Create account" }),
        ).toHaveProperty("disabled", false),
      );
      expect(auth.signUp).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: "Create account" }));
      expect(
        await screen.findByText(/Check your email to confirm/),
      ).toBeDefined();
      expect(auth.signUp).toHaveBeenCalledWith(
        "new@example.com",
        "longenough",
        {
          returnPath: "/blue-light-card/callback",
          extra: { code: "BLC2026", plan: "premium:annual" },
        },
      );
      // Back to sign-in.
      fireEvent.click(
        screen.getByRole("button", {
          name: "Already have an account? Sign in",
        }),
      );
      expect(screen.getByLabelText("Password")).toBeDefined();
    });

    it("sends a sign-in link that returns to this page", async () => {
      stubApi();
      vi.mocked(auth.sendSignInLink).mockResolvedValue(undefined);
      render();
      await applyCode();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with Premium" }),
      );
      const link = screen.getByRole("button", {
        name: "Send me a sign-in link",
      });
      expect(link).toHaveProperty("disabled", true);
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "member@example.com" },
      });
      fireEvent.click(link);
      expect(
        await screen.findByText(/sign-in link is on its way/),
      ).toBeDefined();
      expect(auth.sendSignInLink).toHaveBeenCalledWith("member@example.com", {
        returnPath: "/blue-light-card/callback",
        extra: { code: "BLC2026", plan: "premium:annual" },
      });
    });
  });

  describe("the sign-in callback", () => {
    it("strips the auth code from the address bar, restores the code + plan from the proof, and lands on checkout", async () => {
      const fetcher = stubApi();
      window.history.replaceState(
        null,
        "",
        "/blue-light-card/callback?flow=nonce&code=secret",
      );
      vi.mocked(auth.callbackExtra).mockReturnValue({
        code: "BLC2026",
        plan: "premium_plus:annual",
      });
      vi.mocked(auth.completeCallback).mockResolvedValue(ACCOUNT);
      render("/blue-light-card/callback?flow=nonce&code=secret#frag");

      expect(window.location.pathname).toBe("/blue-light-card");
      expect(window.location.search).toBe("");
      expect(auth.callbackExtra).toHaveBeenCalledWith(
        "?flow=nonce&code=secret",
      );
      expect(auth.completeCallback).toHaveBeenCalledWith(
        "?flow=nonce&code=secret",
        "#frag",
      );
      expect(
        await screen.findByRole("heading", { name: "Confirm your plan" }),
      ).toBeDefined();
      expect(screen.getByText("Premium+ · annual · £199.99/yr")).toBeDefined();
      expect(JSON.parse(checkCalls(fetcher)[0][1].body as string)).toEqual({
        code: "BLC2026",
      });
    });

    it("reports a failed callback and lets the member try again", async () => {
      stubApi();
      window.sessionStorage.setItem(BLC_CODE_STORAGE_KEY, "BLC2026");
      window.sessionStorage.setItem(BLC_PLAN_STORAGE_KEY, "premium:annual");
      vi.mocked(auth.completeCallback).mockRejectedValue(
        new Error("Sign-in was cancelled or could not be completed."),
      );
      render("/blue-light-card/callback?error=access_denied");
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /cancelled or could not be completed/,
      );
      expect(auth.signOut).toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: "Continue with Apple" }),
      ).toBeDefined();
    });
  });

  describe("checkout", () => {
    beforeEach(() => {
      arriveViaAffiliate();
      vi.mocked(auth.currentAccount).mockResolvedValue(ACCOUNT);
      window.sessionStorage.setItem(BLC_CODE_STORAGE_KEY, "BLC2026");
      window.sessionStorage.setItem(BLC_PLAN_STORAGE_KEY, "premium:annual");
    });

    it("sends the exact request, fires InitiateCheckout and leaves for Stripe", async () => {
      setConsent({ advertising: true, affiliate: true });
      window.sessionStorage.setItem(tradedoubler.TDUID_STORAGE_KEY, "click-1");
      const assign = vi.fn();
      vi.stubGlobal("location", {
        ...window.location,
        search: "?tduid=click-1",
        assign,
      });
      const fetcher = stubApi();
      render();
      const receipt = await screen.findByLabelText("Receipt email");
      fireEvent.change(receipt, { target: { value: "receipt@example.com" } });
      fireEvent.click(
        screen.getByRole("button", { name: "Continue to secure payment" }),
      );
      await waitFor(() =>
        expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/pay"),
      );
      const [, init] = checkoutCalls(fetcher)[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(init.headers).toMatchObject({ Authorization: "Bearer verified" });
      const body = JSON.parse(init.body as string);
      expect(body).toEqual({
        tier: "premium",
        cadence: "annual",
        code: "BLC2026",
        email: "receipt@example.com",
        tduid: "click-1",
        campaign: "blc",
        marketing_consent: true,
        event_id: body.event_id,
        hp: "",
      });
    });

    it.each([
      [
        "active_subscription",
        409,
        "This account already has a paid plan. Sign in with a different account or contact support.",
      ],
      [
        "account_ineligible",
        403,
        "This account can't take this offer. Please contact support.",
      ],
      [
        "invalid_code",
        400,
        "That code can't be used. Check it in the Blue Light Card app or contact support.",
      ],
      [
        "boom",
        500,
        "We couldn't start the payment. Please try again in a moment.",
      ],
    ])(
      "shows the copy for %s and stays on the page",
      async (error, status, copy) => {
        vi.stubGlobal("location", {
          ...window.location,
          search: "?tduid=click-1",
          assign: vi.fn(),
        });
        stubApi({ checkout: { status, body: { ok: false, error } } });
        render();
        await screen.findByLabelText("Receipt email");
        fireEvent.click(
          screen.getByRole("button", { name: "Continue to secure payment" }),
        );
        expect((await screen.findByRole("alert")).textContent).toBe(copy);
        expect(window.location.assign).not.toHaveBeenCalled();
      },
    );

    it("refuses to submit without a Turnstile token when the challenge is configured", async () => {
      vi.spyOn(turnstile, "turnstileConfigured").mockReturnValue(true);
      vi.spyOn(turnstile, "turnstileSiteKey").mockReturnValue("");
      const fetcher = stubApi();
      render();
      await screen.findByLabelText("Receipt email");
      const submit = screen.getByRole("button", {
        name: "Continue to secure payment",
      });
      expect(submit).toHaveProperty("disabled", true);
      // Even if the button were forced, the hook refuses.
      fireEvent.submit(submit.closest("form")!);
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /security check hasn't loaded/,
      );
      expect(checkoutCalls(fetcher)).toHaveLength(0);
    });

    it("sends the Turnstile token when the challenge is solved, and resets it on a refusal", async () => {
      vi.spyOn(turnstile, "turnstileSiteKey").mockReturnValue("site-key");
      vi.spyOn(turnstile, "turnstileConfigured").mockReturnValue(true);
      const reset = vi.fn();
      window.turnstile = {
        render: (_el, opts) => {
          opts.callback?.("tok-1");
          return "widget-1";
        },
        remove: vi.fn(),
        reset,
      };
      vi.stubGlobal("location", {
        ...window.location,
        search: "?tduid=click-1",
        assign: vi.fn(),
      });
      const fetcher = stubApi({
        checkout: { status: 500, body: { ok: false, error: "boom" } },
      });
      try {
        render();
        await screen.findByLabelText("Receipt email");
        const submit = screen.getByRole("button", {
          name: "Continue to secure payment",
        });
        await waitFor(() => expect(submit).toHaveProperty("disabled", false));
        fireEvent.click(submit);
        await screen.findByRole("alert");
        const [, init] = checkoutCalls(fetcher)[0] as unknown as [
          string,
          RequestInit,
        ];
        expect(JSON.parse(init.body as string).turnstileToken).toBe("tok-1");
        expect(reset).toHaveBeenCalledWith("widget-1");
      } finally {
        delete window.turnstile;
      }
    });

    it("logs out back to the account step", async () => {
      stubApi();
      render();
      await screen.findByLabelText("Receipt email");
      fireEvent.click(screen.getByRole("button", { name: "Log out" }));
      expect(auth.signOut).toHaveBeenCalled();
      expect(
        screen.getByRole("heading", { name: SIGN_IN_HEADING }),
      ).toBeDefined();
    });
  });

  describe("the design's states", () => {
    beforeEach(arriveViaAffiliate);

    it("tabs code field → Apply → cadence toggle → plan CTA, per card", async () => {
      stubApi();
      render();
      await applyCode();
      const order = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".blc-offer input, .blc-offer button",
        ),
      )
        .filter((el) => !(el as HTMLButtonElement).disabled)
        .map((el) => el.id || el.textContent?.trim());
      expect(order).toEqual([
        "blc-code",
        "Apply",
        "Monthly",
        "Annual",
        "Continue with Premium",
        "Monthly",
        "Annual",
        "Continue with Premium+",
      ]);
      // The success tick sits beside the input, decorative only.
      expect(
        document.querySelector(".blc-code-tick")?.getAttribute("aria-hidden"),
      ).toBe("true");
    });

    it("sends the sign-in link on Enter in the email field while the password form is closed, and signs in once it is open", async () => {
      stubApi();
      vi.mocked(auth.sendSignInLink).mockResolvedValue(undefined);
      vi.mocked(auth.signIn).mockResolvedValue(ACCOUNT);
      render();
      await applyCode();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with Premium" }),
      );
      const email = screen.getByLabelText("Email");
      // A blank/invalid address submits nothing.
      fireEvent.submit(email.closest("form")!);
      expect(auth.sendSignInLink).not.toHaveBeenCalled();
      fireEvent.change(email, { target: { value: "member@example.com" } });
      fireEvent.submit(email.closest("form")!);
      await screen.findByText(/sign-in link is on its way/);
      expect(auth.sendSignInLink).toHaveBeenCalledTimes(1);
      expect(auth.signIn).not.toHaveBeenCalled();

      usePassword();
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "hunter22" },
      });
      fireEvent.submit(email.closest("form")!);
      expect(
        await screen.findByRole("heading", { name: "Confirm your plan" }),
      ).toBeDefined();
      expect(auth.signIn).toHaveBeenCalledWith(
        "member@example.com",
        "hunter22",
      );
    });

    it("closing the password disclosure drops a half-filled sign-up", async () => {
      stubApi();
      render();
      await applyCode();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with Premium" }),
      );
      usePassword();
      fireEvent.click(
        screen.getByRole("button", {
          name: "New to Persistence? Create an email account",
        }),
      );
      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(
        screen.getByRole("button", { name: "Send me a sign-in link" }),
      );
      expect(screen.queryByLabelText("Create a password")).toBeNull();
      usePassword();
      expect(screen.getByLabelText("Password")).toBeDefined();
      expect(screen.queryByRole("checkbox")).toBeNull();
    });

    it("logging out resets the sign-in form to its first state", async () => {
      stubApi();
      vi.mocked(auth.signIn).mockResolvedValue(ACCOUNT);
      render();
      await applyCode();
      fireEvent.click(
        screen.getByRole("button", { name: "Continue with Premium" }),
      );
      usePassword();
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: "member@example.com" },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "hunter22" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await screen.findByRole("heading", { name: "Confirm your plan" });
      fireEvent.click(screen.getByRole("button", { name: "Log out" }));
      expect(screen.queryByLabelText("Password")).toBeNull();
      expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
        "",
      );
    });

    it("goes back to the plans from the checkout step", async () => {
      stubApi();
      vi.mocked(auth.currentAccount).mockResolvedValue(ACCOUNT);
      window.sessionStorage.setItem(BLC_CODE_STORAGE_KEY, "BLC2026");
      window.sessionStorage.setItem(BLC_PLAN_STORAGE_KEY, "premium:annual");
      render();
      await screen.findByLabelText("Receipt email");
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(screen.getByTestId("blc-plan-premium")).toBeDefined();
      expect(window.sessionStorage.getItem(BLC_PLAN_STORAGE_KEY)).toBeNull();
    });
  });

  it("is noindex", () => {
    stubApi();
    render();
    expect(
      document.head
        .querySelector('meta[name="robots"]')
        ?.getAttribute("content"),
    ).toBe("noindex, nofollow");
  });
});
