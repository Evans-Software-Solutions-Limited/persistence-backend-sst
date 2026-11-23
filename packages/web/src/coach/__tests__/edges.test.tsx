import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CoachApp from "../CoachApp";
import { loadSession } from "../api/coachAuth";
import type { CoachApi } from "../api/coachApi";
import { CoachApiContext } from "../hooks/coachQueries";
import { ClientPage } from "../clients/ClientPage";
import { InvitedClientContainer } from "../invited/InvitedClientContainer";
import { CopyFromDialog } from "../setup/CopyFromDialog";
import { PreviewPanel } from "../setup/PreviewPanel";
import {
  MealPlanEditor,
  RepeatingCheckinsEditor,
  StarterFormsEditor,
  TargetsEditor,
} from "../setup/SectionEditors";
import { SetupContainer } from "../setup/SetupContainer";
import { WhoContainer } from "../who/WhoContainer";
import {
  CLIENT_ID,
  FORMS,
  PLANS,
  PROFILE_ID,
  ROSTER,
  SCHEDULES,
  apiError,
  currentPath,
  detail,
  fakeApi,
  renderCoach,
  setOnline,
} from "./helpers";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockRejectedValue(new Error("no canvas")) },
}));

beforeEach(() => {
  setOnline(true);
  localStorage.clear();
  vi.stubEnv("VITE_SUPABASE_URL", "https://auth.test");
  vi.stubEnv("VITE_SUPABASE_ANON_KEY", "anon");
});
afterEach(() => {
  setOnline(true);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function app(route: string, api = fakeApi()) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <CoachApiContext.Provider value={api as unknown as CoachApi}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path="/coach/*" element={<CoachApp />} />
            <Route path="*" element={<p>site</p>} />
          </Routes>
        </MemoryRouter>
      </CoachApiContext.Provider>
    </QueryClientProvider>,
  );
}

describe("coach routes and sign-in", () => {
  it("signs in by email link", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    app("/coach/login");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: " ellie@example.com " },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );
    expect(await screen.findByText(/Check your email/)).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).email).toBe(
      "ellie@example.com",
    );
  });

  it("shows a sign-in failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 422 })),
    );
    app("/coach/login");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "x@y.co" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Email me a sign-in link" }),
    );
    expect(
      await screen.findByText("We couldn't send a link to that address"),
    ).toBeTruthy();
  });

  it("the callback stores the session and opens Clients", async () => {
    const b = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "");
    const token = `${b({})}.${b({ exp: 9_999_999_999 })}.s`;
    app(`/coach/callback#access_token=${token}&refresh_token=r`);
    expect(await screen.findByText("Ellie Hart")).toBeTruthy();
    expect(loadSession()?.refreshToken).toBe("r");
    expect(
      await screen.findByRole("heading", { name: "Clients" }),
    ).toBeTruthy();
  });

  it("unknown coach paths go to sign-in when signed out", async () => {
    app("/coach/whatever");
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeTruthy();
  });
});

describe("section editors", () => {
  const base = { disabled: false, clientFirst: "Lena" };

  it("starter forms: reorder by dragging, remove, and empty library", () => {
    const onChange = vi.fn();
    const items = [
      { refId: "f-goals", config: {}, sortOrder: 0 },
      { refId: "f-life", config: {}, sortOrder: 1 },
    ];
    const { container, rerender } = render(
      <StarterFormsEditor
        {...base}
        items={items}
        onChange={onChange}
        forms={FORMS}
      />,
    );
    const blocks = container.querySelectorAll("section");
    fireEvent.dragStart(blocks[1]);
    fireEvent.dragOver(blocks[0]);
    fireEvent.drop(blocks[0]);
    expect(onChange).toHaveBeenLastCalledWith([
      { refId: "f-life", config: {}, sortOrder: 0 },
      { refId: "f-goals", config: {}, sortOrder: 1 },
    ]);
    fireEvent.drop(blocks[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Lifestyle and schedule" }),
    );
    expect(onChange).toHaveBeenLastCalledWith([
      { refId: "f-goals", config: {}, sortOrder: 0 },
    ]);
    rerender(
      <StarterFormsEditor
        {...base}
        items={[{ refId: "gone", config: {}, sortOrder: 0 }]}
        onChange={onChange}
        forms={[]}
      />,
    );
    expect(screen.getByText("Form")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Add a form from your Library" }),
    );
    expect(screen.getByText("No forms in your Library yet.")).toBeTruthy();
  });

  it("repeating check-ins: daily and once rules, empty library", () => {
    const onChange = vi.fn();
    const daily = {
      ...SCHEDULES[0],
      id: "d",
      trigger: "daily",
      weekday: null,
      reminders: [],
    };
    const once = {
      ...SCHEDULES[0],
      id: "o",
      trigger: "once",
      weekday: null,
      timeLocal: null,
    };
    render(
      <RepeatingCheckinsEditor
        {...base}
        items={[
          { refId: "d", config: {}, sortOrder: 0 },
          { refId: "o", config: {}, sortOrder: 1 },
        ]}
        onChange={onChange}
        forms={FORMS}
        schedules={[daily, once]}
      />,
    );
    expect(
      screen.getByText("For Lena only. Starts when Lena accepts."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Due day")).toBeNull();
    fireEvent.change(screen.getAllByLabelText("Due time")[0], {
      target: { value: "10:00" },
    });
    expect(onChange.mock.calls[0][0][0].config).toEqual({
      override: { dueAfterHours: 1 },
    });
    fireEvent.change(screen.getAllByDisplayValue("09:00")[0], {
      target: { value: "" },
    });
    expect(onChange.mock.calls[1][0][0].config.override.timeLocal).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Add a check-in from your Library" }),
    );
    expect(
      screen.getByText("No repeating check-ins in your Library yet."),
    ).toBeTruthy();
  });

  it("targets: switching to coach-set starts empty", () => {
    const onChange = vi.fn();
    render(
      <TargetsEditor {...base} items={[]} onChange={onChange} error={null} />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "You set them" }));
    expect(onChange).toHaveBeenCalledWith([
      { refId: null, sortOrder: 0, config: {} },
    ]);
    fireEvent.click(screen.getByRole("radio", { name: "Lena sets them" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("meal plans: remove one, and an empty library", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <MealPlanEditor
        {...base}
        items={[{ refId: "p-train", config: {}, sortOrder: 0 }]}
        onChange={onChange}
        plans={PLANS}
      />,
    );
    expect(screen.queryByText(/No meal plan added/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Training day meals" }),
    );
    expect(onChange).toHaveBeenCalledWith([]);
    rerender(
      <MealPlanEditor {...base} items={[]} onChange={onChange} plans={[]} />,
    );
    expect(screen.getByText("No meal plans in your Library yet.")).toBeTruthy();
  });
});

describe("dialogs and panels", () => {
  it("copy-from searches a long list and explains an empty one", () => {
    const sources = Array.from({ length: 6 }, (_, i) => ({
      kind: "client" as const,
      id: `c${i}`,
      name: i === 0 ? "Sam Patel" : `Client ${i}`,
      initials: "C",
      detail: "Active client",
    }));
    const onClose = vi.fn();
    const { rerender } = render(
      <CopyFromDialog
        sources={sources}
        busy={false}
        error={null}
        clientFirst="Lena"
        onCopy={vi.fn()}
        onClose={onClose}
      />,
    );
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search clients" }),
      { target: { value: "sam" } },
    );
    expect(
      within(screen.getByRole("list")).getAllByRole("listitem"),
    ).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
    rerender(
      <CopyFromDialog
        sources={[]}
        busy={false}
        error={null}
        clientFirst="Lena"
        onCopy={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(screen.getByText("No other clients to copy from yet.")).toBeTruthy();
  });

  it("preview shows a loading state and closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <PreviewPanel
        loading
        onClose={onClose}
        model={{
          clientFirstName: "Lena",
          coachName: "Ellie Hart",
          coachInitials: "EH",
          welcomeMessage: null,
          startForms: [],
          plans: [],
          targets: null,
        }}
      />,
    );
    expect(screen.getByText("Loading…")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("container edges", () => {
  it("invited page: never sent says Send invite; clipboard refusal explains", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const live = {
      code: "X",
      link: "l",
      expiresAt: "2099-01-01T00:00:00Z",
      status: "active" as const,
    };
    renderCoach(<InvitedClientContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}`,
      path: "/coach/clients/invited/:profileId",
      api: fakeApi({
        profileDetail: vi
          .fn()
          .mockResolvedValue(
            detail({ invite: live, goal: null, privateNotes: null }),
          ),
      }),
    });
    expect(
      await screen.findByText("No notes yet. Only you see these."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText(/didn't allow copying/)).toBeTruthy();
    cleanup();
    renderCoach(<InvitedClientContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}`,
      path: "/coach/clients/invited/:profileId",
      api: fakeApi({ profileDetail: vi.fn().mockResolvedValue(detail()) }),
    });
    expect(
      await screen.findByRole("button", { name: "Send invite" }),
    ).toBeTruthy();
  });

  it("invited page: a failed note save and a failed load", async () => {
    renderCoach(<InvitedClientContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}`,
      path: "/coach/clients/invited/:profileId",
      api: fakeApi({
        patchProfile: vi
          .fn()
          .mockRejectedValue(apiError(400, { message: "Too long" })),
      }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Private notes"), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Too long")).toBeTruthy();
    cleanup();
    setOnline(false);
    renderCoach(<InvitedClientContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}`,
      path: "/coach/clients/invited/:profileId",
      api: fakeApi({
        profileDetail: vi.fn().mockRejectedValue(apiError(0, null, true)),
      }),
    });
    expect(
      await screen.findByText(/This client loads when you're back online/),
    ).toBeTruthy();
  });

  it("client page shows when they were last active", async () => {
    const api = fakeApi({
      roster: vi.fn().mockResolvedValue({
        ...ROSTER,
        data: [
          {
            ...ROSTER.data[0],
            lastSeenAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
          },
        ],
      }),
    });
    renderCoach(<ClientPage />, {
      route: `/coach/clients/${CLIENT_ID}/settings`,
      path: "/coach/clients/:clientId/:tab?",
      api,
    });
    expect(
      await screen.findByText("Lean bulk · Wk 6 / 12 · active 2h ago"),
    ).toBeTruthy();
  });

  it("Who: another failure while editing shows the server's message", async () => {
    const api = fakeApi({
      patchProfile: vi
        .fn()
        .mockRejectedValue(
          apiError(400, { message: "displayName is required" }),
        ),
    });
    renderCoach(<WhoContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/who`,
      path: "/coach/clients/invited/:profileId/who",
      api,
    });
    fireEvent.change(await screen.findByLabelText("Last name"), {
      target: { value: "Ortiz-Bell" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: set up" }));
    expect(await screen.findByText("displayName is required")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(currentPath()).toBe(`/coach/clients/invited/${PROFILE_ID}`);
  });

  it("Setup: copying offline is refused; a failed load can be retried", async () => {
    const api = fakeApi();
    renderCoach(<SetupContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/setup`,
      path: "/coach/clients/invited/:profileId/setup/:section?",
      api,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: /Copy setup from a client/ }),
    );
    const dialog = await screen.findByRole("dialog");
    setOnline(false);
    fireEvent.click(
      await within(dialog).findByRole("button", { name: "Copy" }),
    );
    expect(
      await within(dialog).findByText(
        "You're offline. Copying needs a connection.",
      ),
    ).toBeTruthy();
    expect(api.copyFrom).not.toHaveBeenCalled();
    cleanup();
    setOnline(true);
    const profileDetail = vi.fn().mockRejectedValue(apiError(500, null));
    renderCoach(<SetupContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/setup`,
      path: "/coach/clients/invited/:profileId/setup/:section?",
      api: fakeApi({ profileDetail }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(profileDetail).toHaveBeenCalledTimes(2));
  });
});
