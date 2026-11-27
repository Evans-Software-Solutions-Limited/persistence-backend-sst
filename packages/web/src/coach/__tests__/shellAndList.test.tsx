import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { endSession, loadSession, saveSession } from "../api/coachAuth";
import { COACH_SUBSCRIPTION_REQUIRED, coachFetch } from "../api/coachApi";
import { ClientsListContainer } from "../clients/ClientsListContainer";
import { CoachLayout } from "../shell/CoachLayout";
import { CoachCallback, CoachSignInView } from "../shell/CoachSignIn";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient } from "@tanstack/react-query";
import {
  PROFILE_ID,
  ROSTER,
  apiError,
  currentPath,
  fakeApi,
  renderCoach,
  setOnline,
} from "./helpers";

function jwt(payload: Record<string, unknown>) {
  const b = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  return `${b({})}.${b(payload)}.s`;
}
const signIn = () =>
  saveSession({
    accessToken: jwt({ exp: 9_999_999_999 }),
    refreshToken: null,
    expiresAt: 9_999_999_999,
    email: "ellie@example.com",
  });

beforeEach(() => {
  localStorage.clear();
  setOnline(true);
});
afterEach(() => setOnline(true));

describe("CoachLayout", () => {
  it("sends a signed-out visitor to sign in", async () => {
    renderCoach(<CoachLayout />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api: fakeApi(),
    });
    await waitFor(() => expect(currentPath()).toBe("/coach/login"));
  });

  it("a session that ends mid-use returns to sign-in and drops cached data (review #549)", async () => {
    signIn();
    const { queryClient } = renderCoach(<CoachLayout />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api: fakeApi(),
    });
    expect(await screen.findByText("Ellie Hart")).toBeTruthy();
    expect(queryClient.getQueryData(["coach", "profile"])).toBeTruthy();
    act(() => endSession());
    await waitFor(() => expect(currentPath()).toBe("/coach/login"));
    expect(queryClient.getQueryData(["coach", "profile"])).toBeUndefined();
    expect(loadSession()).toBeNull();
  });

  it("shows the rail with the active count for a coach", async () => {
    signIn();
    renderCoach(<CoachLayout />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api: fakeApi(),
    });
    expect(await screen.findByText("Ellie Hart")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Main" });
    const clients = within(nav).getByRole("link", { name: /Clients/ });
    await waitFor(() => expect(clients.textContent).toContain("1"));
    // PER-131 built Today; Messages is still to come on the web.
    expect(
      within(nav).getByText("Messages").closest("[aria-disabled]"),
    ).toBeTruthy();
  });

  // PER-146: the coach platform is only for coaches with an active coach
  // subscription. Everyone else goes to the coach plans page.
  it("sends an athlete (no coach role) to coach plans", async () => {
    signIn();
    const api = fakeApi({
      profile: vi.fn().mockResolvedValue({
        id: "u",
        fullName: "Sam",
        avatarUrl: null,
        role: "user",
      }),
    });
    renderCoach(<CoachLayout />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api,
    });
    await waitFor(() =>
      expect(currentPath()).toBe("/pricing?for=coaches&from=coach"),
    );
    expect(screen.queryByText("Ellie Hart")).toBeNull();
    expect(screen.queryByText("This account isn't a coach account")).toBeNull();
  });

  it("sends a coach without a coach subscription to coach plans, without showing the workspace", async () => {
    signIn();
    const api = fakeApi({
      roster: vi
        .fn()
        .mockRejectedValue(
          apiError(403, { code: COACH_SUBSCRIPTION_REQUIRED, message: "x" }),
        ),
    });
    renderCoach(<CoachLayout />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api,
    });
    await waitFor(() =>
      expect(currentPath()).toBe("/pricing?for=coaches&from=coach"),
    );
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  });

  // Production retries the roster (React Query's default 3, with backoff).
  // The shell waits only for the FIRST attempt, never the retries.
  const retryingClient = () =>
    new QueryClient({
      defaultOptions: { queries: { retry: 3, retryDelay: 60_000 } },
    });

  it("shows the shell after the roster's first failure, without waiting out its retries", async () => {
    signIn();
    const roster = vi.fn().mockRejectedValue(apiError(500, null));
    const { queryClient } = renderCoach(<CoachLayout />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api: fakeApi({ roster }),
      queryClient: retryingClient(),
    });
    expect(await screen.findByText("Ellie Hart")).toBeTruthy();
    // Still retrying in the background (next attempt a minute away).
    expect(roster).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(["coach", "roster"])?.status).toBe(
      "pending",
    );
    expect(currentPath()).toBe("/coach/clients");
  });

  it("still leaves for coach plans on a refused first attempt when the roster would retry", async () => {
    signIn();
    renderCoach(<CoachLayout />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api: fakeApi({
        roster: vi
          .fn()
          .mockRejectedValue(
            apiError(403, { code: COACH_SUBSCRIPTION_REQUIRED, message: "x" }),
          ),
      }),
      queryClient: retryingClient(),
    });
    await waitFor(() =>
      expect(currentPath()).toBe("/pricing?for=coaches&from=coach"),
    );
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  });

  it("keeps the workspace on other roster errors (only the subscription code redirects)", async () => {
    signIn();
    renderCoach(<CoachLayout />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api: fakeApi({
        roster: vi
          .fn()
          .mockRejectedValue(apiError(403, { message: "Forbidden" })),
      }),
    });
    expect(await screen.findByText("Ellie Hart")).toBeTruthy();
    expect(currentPath()).toBe("/coach/clients");
  });

  it("a subscription that lapses mid-session sends the coach to coach plans on the next refused call", async () => {
    signIn();
    const { queryClient } = renderCoach(<CoachLayout />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api: fakeApi(),
    });
    expect(await screen.findByText("Ellie Hart")).toBeTruthy();
    expect(queryClient.getQueryData(["coach", "profile"])).toBeTruthy();

    // A real call refused by the API, as coachFetch sees it.
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ code: COACH_SUBSCRIPTION_REQUIRED, message: "x" }),
          { status: 403 },
        ),
    );
    await act(async () => {
      await expect(
        coachFetch("/trainers/me/clients", {}, fetchImpl),
      ).rejects.toMatchObject({ status: 403 });
    });
    await waitFor(() =>
      expect(currentPath()).toBe("/pricing?for=coaches&from=coach"),
    );
    expect(queryClient.getQueryData(["coach", "profile"])).toBeUndefined();
    // Still signed in: buying a plan in the app and coming back just works.
    expect(loadSession()).not.toBeNull();
  });

  it("returns to sign in when the API says signed out, and offers retry otherwise", async () => {
    signIn();
    renderCoach(<CoachLayout />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api: fakeApi({ profile: vi.fn().mockRejectedValue(apiError(401, null)) }),
    });
    await waitFor(() => expect(currentPath()).toBe("/coach/login"));

    signIn();
    const profile = vi.fn().mockRejectedValue(apiError(0, null, true));
    renderCoach(<CoachLayout />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api: fakeApi({ profile }),
    });
    expect(await screen.findByText(/You're offline/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(profile).toHaveBeenCalledTimes(2));
  });
});

describe("Coach sign-in", () => {
  it("renders the form, the sent state and errors", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <CoachSignInView
        email="e@x.co"
        onEmail={vi.fn()}
        onSubmit={onSubmit}
        state="idle"
        error="Nope"
      />,
    );
    expect(screen.getByText("Nope")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );
    expect(onSubmit).toHaveBeenCalled();
    rerender(
      <CoachSignInView
        email="e@x.co"
        onEmail={vi.fn()}
        onSubmit={onSubmit}
        state="sent"
        error={null}
      />,
    );
    expect(screen.getByText(/Check your email/)).toBeTruthy();
  });

  it("shows a callback error with a way back", () => {
    render(
      <MemoryRouter
        initialEntries={["/coach/callback#error_description=Expired"]}
      >
        <Routes>
          <Route path="/coach/callback" element={<CoachCallback />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeTruthy();
  });
});

describe("Clients list (C11e)", () => {
  it("puts Invited above Active, with the counts", async () => {
    renderCoach(<ClientsListContainer />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api: fakeApi(),
    });
    expect(await screen.findByText("1 active · 1 invited")).toBeTruthy();
    const headings = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["Invited", "Active"]);
    expect(
      screen.getByRole("link", { name: /Lena Ortiz/ }).getAttribute("href"),
    ).toBe(`/coach/clients/invited/${PROFILE_ID}`);
    expect(screen.getByRole("link", { name: /Sam Patel/ })).toBeTruthy();
    expect(screen.getByText("Lean bulk · Wk 6 / 12")).toBeTruthy();
  });

  it("marks an expired code, and offers Send for one never sent", async () => {
    const api = fakeApi({
      roster: vi.fn().mockResolvedValue({
        data: [],
        invited: [
          { ...ROSTER.invited[0], inviteExpiresAt: "2020-01-01T00:00:00Z" },
          {
            ...ROSTER.invited[0],
            profileId: "p2",
            displayName: "Dan Kerr",
            inviteStatus: "not_sent",
            inviteExpiresAt: null,
          },
        ],
      }),
    });
    renderCoach(<ClientsListContainer />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api,
    });
    expect(await screen.findByText("Code expired")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send" })).toBeTruthy();
    expect(screen.getByText(/No active clients yet/)).toBeTruthy();
  });

  it("Resend makes a new code and opens the invite to share it", async () => {
    const api = fakeApi();
    renderCoach(<ClientsListContainer />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Resend" }));
    await waitFor(() =>
      expect(api.issueInvite).toHaveBeenCalledWith(
        PROFILE_ID,
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(currentPath()).toBe(`/coach/clients/invited/${PROFILE_ID}/invite`),
    );
  });

  it("asks for the coach declaration before the first invite", async () => {
    const api = fakeApi({
      declaration: vi.fn().mockResolvedValue({
        currentVersion: "2026-11-v1",
        acceptedVersion: null,
        acceptedAt: null,
      }),
    });
    renderCoach(<ClientsListContainer />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Resend" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Before you invite clients",
    });
    expect(api.issueInvite).not.toHaveBeenCalled();
    const confirm = within(dialog).getByRole("button", {
      name: "Confirm and continue",
    }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.acceptDeclaration).toHaveBeenCalledWith(
        "2026-11-v1",
        expect.stringMatching(/^[0-9a-f]{64}$/),
        expect.any(String),
      ),
    );
    await waitFor(() => expect(api.issueInvite).toHaveBeenCalled());
  });

  it("opens the declaration when the invite route refuses, and reports a new version", async () => {
    const api = fakeApi({
      declaration: vi.fn().mockRejectedValue(apiError(500, null)),
      issueInvite: vi
        .fn()
        .mockRejectedValue(apiError(403, { code: "declaration_required" })),
      acceptDeclaration: vi
        .fn()
        .mockRejectedValue(
          apiError(409, { code: "declaration_version_mismatch" }),
        ),
    });
    renderCoach(<ClientsListContainer />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Resend" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Confirm and continue" }),
    );
    expect(
      await within(dialog).findByText(/The declaration has changed/),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows server errors from a resend", async () => {
    const api = fakeApi({
      issueInvite: vi
        .fn()
        .mockRejectedValue(
          apiError(402, { message: "You've used all your client seats" }),
        ),
    });
    renderCoach(<ClientsListContainer />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Resend" }));
    expect(
      await screen.findByText("You've used all your client seats"),
    ).toBeTruthy();
  });

  it("offline: banner with the time, and Resend waits for a connection", async () => {
    const api = fakeApi();
    renderCoach(<ClientsListContainer />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api,
    });
    await screen.findByText("1 active · 1 invited");
    setOnline(false);
    expect(
      await screen.findByText(/Offline · showing your clients as of \d\d:\d\d/),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Resend" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("explains a failed load and retries", async () => {
    setOnline(false);
    const roster = vi.fn().mockRejectedValue(apiError(0, null, true));
    renderCoach(<ClientsListContainer />, {
      route: "/coach/clients",
      path: "/coach/clients",
      api: fakeApi({ roster }),
    });
    expect(
      await screen.findByText(/Your clients load when you're back online/),
    ).toBeTruthy();
    setOnline(true);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(roster).toHaveBeenCalledTimes(2));
  });
});
