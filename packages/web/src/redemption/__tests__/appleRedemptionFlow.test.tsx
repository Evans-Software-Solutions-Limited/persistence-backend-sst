import { webcrypto } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import RedeemPage from "../RedeemPage";
import * as auth from "../auth";
import { saveDraft } from "../draft";

// Real page, hook, auth and voucher client; only external HTTP is simulated.
const identity = {
  id: "apple-member",
  email: "private@privaterelay.appleid.com",
  email_confirmed_at: "2026-09-28",
};
const tokens = {
  access_token: "apple-token",
  refresh_token: "refresh",
  expires_in: 3600,
};
const draft = {
  code: "APPLE-VOUCHER",
  eligibilityEmail: "",
  accountEmail: "",
  differentAccount: false,
};
let restricted: boolean;
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/redeem");
  vi.stubEnv("VITE_SUPABASE_URL", "https://auth.example.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "public");
  vi.stubEnv("VITE_CORE_API_URL", "https://api.example.test");
  vi.stubGlobal("crypto", webcrypto);
  restricted = false;
  fetcher = vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith("/token?grant_type=pkce")) return Response.json(tokens);
    if (url.endsWith("/user")) return Response.json(identity);
    if (url.endsWith("/vouchers/check"))
      return Response.json({
        data: { valid: true, requiresEligibilityEmail: restricted },
      });
    if (url.endsWith("/vouchers/prepare")) {
      const body = JSON.parse(init.body as string);
      return Response.json({
        data: {
          challengeId: "challenge",
          verified: !restricted,
          eligibilityEmail: body.eligibilityEmail ?? identity.email,
          accountEmail: identity.email,
          businessName: "Example",
          tierName: "premium",
          months: 12,
          expiresAt: "2027-09-28T00:00:00Z",
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function callback() {
  const authorize = new URL(await auth.appleOAuthUrl());
  const cb = new URL(authorize.searchParams.get("redirect_to")!);
  cb.searchParams.set("code", "single-use");
  window.history.replaceState(null, "", cb.pathname + cb.search);
}
async function ready() {
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled"),
    ).toBe(false),
  );
}
it.each([false, true])(
  "starts Apple with no account email after preflight (restricted: %s)",
  async (hasRestriction) => {
    restricted = hasRestriction;
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<RedeemPage />);
    await ready();
    expect(screen.queryByLabelText("Membership account email")).toBeNull();
    fireEvent.change(screen.getByLabelText("Membership code"), {
      target: { value: draft.code },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    if (restricted) {
      await screen.findByLabelText("Eligibility email");
      fireEvent.change(screen.getByLabelText("Eligibility email"), {
        target: { value: "employee@work.test" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    }
    await screen.findByRole("button", { name: "Continue with Apple" });
    fireEvent.click(
      screen.getByRole("button", { name: "Continue with Apple" }),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    expect(new URL(assign.mock.calls[0][0]).searchParams.get("provider")).toBe(
      "apple",
    );
    expect(
      JSON.parse(sessionStorage.getItem("persistence.redemption.draft")!),
    ).toMatchObject({
      ...draft,
      eligibilityEmail: restricted ? "employee@work.test" : "",
    });
    expect(
      fetcher.mock.calls.every(([url]) => url.endsWith("/vouchers/check")),
    ).toBe(true);
  },
);
it.each([false, true])(
  "restores voucher and uses verified relay identity with explicit confirmation (restricted: %s)",
  async (hasRestriction) => {
    restricted = hasRestriction;
    saveDraft({
      ...draft,
      eligibilityEmail: restricted ? "employee@work.test" : "",
      accountEmail: "previous@example.test",
    });
    await callback();
    render(
      <StrictMode>
        <RedeemPage />
      </StrictMode>,
    );
    await ready();
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(
      (screen.getByLabelText("Membership code") as HTMLInputElement).value,
    ).toBe(draft.code);
    expect(screen.getByText(identity.email)).toBeDefined();
    expect(
      fetcher.mock.calls.filter(([url]) => url.includes("grant_type=pkce")),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    if (restricted) {
      await screen.findByLabelText("Eligibility email");
      expect(
        (screen.getByLabelText("Eligibility email") as HTMLInputElement).value,
      ).toBe("employee@work.test");
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    }
    await screen.findByRole("heading", {
      name: restricted ? "Verify your eligibility email" : "Make it yours",
    });
    const request = fetcher.mock.calls.find(([url]) =>
      url.endsWith("/vouchers/prepare"),
    )!;
    expect(JSON.parse(request[1].body)).toEqual({
      code: draft.code,
      ...(restricted ? { eligibilityEmail: "employee@work.test" } : {}),
    });
    expect(request[1].headers.Authorization).toBe("Bearer apple-token");
    expect(
      fetcher.mock.calls.some(([url]) => url.endsWith("/vouchers/redeem")),
    ).toBe(false);
  },
);
it.each([false, true])(
  "recovers /user after code exchange without replay (reload: %s)",
  async (reload) => {
    saveDraft(draft);
    await callback();
    fetcher
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(Response.json({}, { status: 503 }));
    const view = render(
      <StrictMode>
        <RedeemPage />
      </StrictMode>,
    );
    await screen.findByRole("button", { name: "Retry sign-in" });
    expect(auth.loadSession()).toBeNull();
    if (reload) {
      view.unmount();
      render(<RedeemPage />);
    } else
      fireEvent.click(screen.getByRole("button", { name: "Retry sign-in" }));
    await waitFor(() => expect(screen.getByText(identity.email)).toBeDefined());
    expect(auth.loadSession()?.accessToken).toBe(tokens.access_token);
    expect(
      fetcher.mock.calls.filter(([url]) => url.includes("grant_type=pkce")),
    ).toHaveLength(1);
    expect(
      (screen.getByLabelText("Membership code") as HTMLInputElement).value,
    ).toBe(draft.code);
  },
);
it("keeps the voucher and enables fresh Apple sign-in after cancellation", async () => {
  saveDraft(draft);
  await callback();
  window.history.replaceState(
    null,
    "",
    window.location.pathname + window.location.search + "&error=access_denied",
  );
  render(<RedeemPage />);
  await ready();
  expect(screen.getByRole("alert").textContent).toContain(
    "could not be verified",
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(auth.loadSession()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(
    await screen.findByRole("button", { name: "Continue with Apple" }),
  ).toBeDefined();
});
it.each([401, 503])(
  "handles failed identity retry safely (HTTP %s)",
  async (status) => {
    saveDraft(draft);
    await callback();
    fetcher
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(Response.json({}, { status: 503 }));
    render(<RedeemPage />);
    await screen.findByRole("button", { name: "Retry sign-in" });
    fetcher.mockResolvedValueOnce(Response.json({}, { status }));
    fireEvent.click(screen.getByRole("button", { name: "Retry sign-in" }));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Continue" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(auth.loadSession()).toBeNull();
    expect(!!screen.queryByRole("button", { name: "Retry sign-in" })).toBe(
      status === 503,
    );
    expect(
      !!sessionStorage.getItem("persistence.redemption.pending-session"),
    ).toBe(status === 503);
  },
);
