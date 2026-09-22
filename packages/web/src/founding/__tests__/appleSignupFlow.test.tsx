import { webcrypto } from "node:crypto";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { StrictMode } from "react";
import FoundingAccess from "../FoundingAccess";
import * as auth from "../auth";

// Exercise the real page, hook and authentication module together. Only the
// external HTTP boundary is simulated; this cannot replace Apple's device test.
const identity = {
  id: "new-apple-user",
  email: "new-member@example.test",
  created_at: "2026-09-22T10:00:00Z",
  email_confirmed_at: "2026-09-22T10:00:00Z",
  app_metadata: { provider: "apple", providers: ["apple"] },
};
const tokens = {
  access_token: "test-access",
  refresh_token: "test-refresh",
  expires_in: 3600,
};
let fetcher: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/founding/access");
  vi.stubEnv("VITE_SUPABASE_URL", "https://auth.example.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "test-public-key");
  vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
  vi.stubEnv("VITE_CORE_API_URL", "https://api.example.test");
  vi.stubGlobal("crypto", webcrypto);
  fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("/subscriptions/me"))
      return Response.json({
        data: { tierName: "free", paymentStatus: "active", expiresAt: null },
      });
    if (url.endsWith("/token?grant_type=pkce")) return Response.json(tokens);
    if (url.endsWith("/user")) return Response.json(identity);
    throw new Error(`Unexpected HTTP request: ${url}`);
  });
  vi.stubGlobal("fetch", fetcher);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function returnFromApple() {
  const authorize = new URL(await auth.oauthUrl("apple"));
  const callback = new URL(authorize.searchParams.get("redirect_to")!);
  callback.searchParams.set("code", "one-time-code");
  window.history.replaceState(null, "", callback.pathname + callback.search);
}

it.each([false, true])(
  "completes new email signup after confirmation (new tab: %s)",
  async (newTab) => {
    let confirmationUrl: URL | undefined;
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith("/subscriptions/me"))
        return Response.json({
          data: { tierName: "free", paymentStatus: "active", expiresAt: null },
        });
      if (url.includes("/signup?")) {
        confirmationUrl = new URL(
          new URL(url).searchParams.get("redirect_to")!,
        );
        return Response.json({
          user: { ...identity, email_confirmed_at: null },
        });
      }
      if (url.endsWith("/user"))
        return Response.json({
          ...identity,
          app_metadata: { provider: "email", providers: ["email"] },
        });
      return Response.json(tokens);
    });
    const view = render(<FoundingAccess />);
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Sign in" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "New to Persistence? Create an email account",
      }),
    );
    fireEvent.change(screen.getByLabelText("Account email"), {
      target: { value: identity.email },
    });
    fireEvent.change(screen.getByLabelText("Create a password"), {
      target: { value: "test-only-password" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /I agree/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect((await screen.findByRole("status")).textContent).toContain(
      "Check your email",
    );
    expect(auth.loadSession()).toBeNull();
    expect(confirmationUrl).toBeDefined();
    view.unmount();
    if (newTab) sessionStorage.clear();
    confirmationUrl!.searchParams.set("code", "confirmed-email-code");
    window.history.replaceState(
      null,
      "",
      confirmationUrl!.pathname + confirmationUrl!.search,
    );
    render(<FoundingAccess />);
    expect(await screen.findByText(identity.email)).toBeDefined();
    expect(auth.loadSession()?.accessToken).toBe(tokens.access_token);
  },
);

it.each([identity.email, "member@privaterelay.appleid.com"])(
  "signs in a new confirmed Apple identity (%s) and restores it on reload",
  async (email) => {
    fetcher.mockImplementation(async (url: string) =>
      Response.json(
        url.endsWith("/subscriptions/me")
          ? {
              data: {
                tierName: "free",
                paymentStatus: "active",
                expiresAt: null,
              },
            }
          : url.endsWith("/user")
            ? { ...identity, email }
            : tokens,
      ),
    );
    await returnFromApple();
    const view = render(
      <StrictMode>
        <FoundingAccess />
      </StrictMode>,
    );
    expect(await screen.findByText(email)).toBeDefined();
    expect(screen.getByRole("button", { name: "Log out" })).toBeDefined();
    expect(auth.loadSession()?.accessToken).toBe(tokens.access_token);
    expect(window.location.pathname).toBe("/founding/access");
    expect(window.location.search).toBe("");
    expect(
      fetcher.mock.calls.filter(([url]) => url.includes("grant_type=pkce")),
    ).toHaveLength(1);
    view.unmount();
    render(<FoundingAccess />);
    expect(await screen.findByText(email)).toBeDefined();
    expect(
      fetcher.mock.calls.filter(([url]) => url.includes("grant_type=pkce")),
    ).toHaveLength(1);
  },
);

it("completes the callback in a new tab sharing the same browser proof", async () => {
  await returnFromApple();
  sessionStorage.clear();
  render(<FoundingAccess />);
  expect(await screen.findByText(identity.email)).toBeDefined();
  expect(auth.loadSession()).not.toBeNull();
});

it("shows a recoverable sign-in prompt if the callback arrives without browser proof", async () => {
  await returnFromApple();
  localStorage.clear(); // Another browser/webview does not share this proof.
  render(<FoundingAccess />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "same browser",
  );
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Continue with Apple" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(auth.loadSession()).toBeNull();
});

it("shows Apple cancellation without creating or saving a session", async () => {
  await returnFromApple();
  window.history.replaceState(
    null,
    "",
    "/founding/access/callback?error=access_denied",
  );
  render(<FoundingAccess />);
  expect((await screen.findByRole("alert")).textContent).toContain("cancelled");
  expect(fetcher).not.toHaveBeenCalled();
  expect(auth.loadSession()).toBeNull();
});

it("does not accept an unconfirmed account returned by the identity endpoint", async () => {
  await returnFromApple();
  fetcher.mockImplementation(async (url: string) =>
    Response.json(
      url.endsWith("/user")
        ? { ...identity, email_confirmed_at: null }
        : tokens,
    ),
  );
  render(<FoundingAccess />);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Verify your membership account email",
  );
  expect(auth.loadSession()).toBeNull();
  expect(screen.queryByRole("button", { name: "Log out" })).toBeNull();
});

it.each([false, true])(
  "recovers identity verification without replaying Apple's code (reload: %s)",
  async (reload) => {
    await returnFromApple();
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith("/user")) throw new TypeError("Load failed");
      return Response.json(tokens);
    });
    const view = render(<FoundingAccess />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Check your connection",
    );
    expect(auth.loadSession()).toBeNull();
    expect(screen.getByRole("button", { name: "Retry sign-in" })).toBeDefined();
    fetcher.mockImplementation(async (url: string) => {
      if (url.endsWith("/user")) return Response.json(identity);
      if (url.endsWith("/subscriptions/me"))
        return Response.json({
          data: {
            tierName: "start_up_coach_plus",
            paymentStatus: "active",
            expiresAt: "2099-12-22T10:00:00Z",
          },
        });
      throw new Error("Single-use code must not be exchanged again");
    });
    if (reload) {
      view.unmount();
      render(<FoundingAccess />);
    } else
      fireEvent.click(screen.getByRole("button", { name: "Retry sign-in" }));
    expect(await screen.findByText(identity.email)).toBeDefined();
    expect(auth.loadSession()?.accessToken).toBe(tokens.access_token);
    expect(
      fetcher.mock.calls.filter(([url]) => url.includes("grant_type=pkce")),
    ).toHaveLength(1);
    expect(await screen.findByText("Your access is ready")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Send verification code" }),
    ).toBeNull();
  },
);
