import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ClientPage } from "../clients/ClientPage";
import { InviteContainer } from "../invite/InviteContainer";
import { InvitedClientContainer } from "../invited/InvitedClientContainer";
import {
  CLIENT_ID,
  PROFILE_ID,
  apiError,
  currentPath,
  detail,
  fakeApi,
  renderCoach,
  setOnline,
  settings,
} from "./helpers";

vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,QR") },
}));

const INVITE = `/coach/clients/invited/${PROFILE_ID}/invite`;
const INVITED = `/coach/clients/invited/${PROFILE_ID}`;
const live = {
  code: "LN4Q8T",
  link: "persistencemobile://accept-invite?code=LN4Q8T",
  expiresAt: new Date(Date.now() + 7 * 86_400_000 - 60_000).toISOString(),
  status: "active" as const,
};
const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  setOnline(true);
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
});
afterEach(() => setOnline(true));

describe("Add client · 3 Invite (C11c)", () => {
  it("issues the code on arrival and shows code, QR, email and what's ready", async () => {
    const profileDetail = vi
      .fn()
      .mockResolvedValueOnce(
        detail({
          setup: {
            welcome_message: [
              { refId: null, config: { text: "Hi" }, sortOrder: 0 },
            ],
          },
        }),
      )
      .mockResolvedValue(
        detail({
          invite: live,
          setup: {
            welcome_message: [
              { refId: null, config: { text: "Hi" }, sortOrder: 0 },
            ],
          },
        }),
      );
    const api = fakeApi({ profileDetail });
    renderCoach(<InviteContainer />, {
      route: INVITE,
      path: "/coach/clients/invited/:profileId/invite",
      api,
    });
    expect(await screen.findByText("LN4Q8T")).toBeTruthy();
    expect(api.issueInvite).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/expires in 7 days/)).toBeTruthy();
    const email = screen.getByRole("link", { name: "Email Lena" });
    expect(email.getAttribute("href")).toMatch(
      /^mailto:lena\.ortiz%40example\.com\?subject=/,
    );
    expect(
      screen.getByText(/Email goes to lena.ortiz@example.com/),
    ).toBeTruthy();
    expect(screen.getByText("Your welcome message")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Download QR" }).getAttribute("href"),
      ).toBe("data:image/png;base64,QR"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(live.link));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(currentPath()).toBe(INVITED);
  });

  it("asks for the declaration first and doesn't issue until it's confirmed", async () => {
    const api = fakeApi({
      declaration: vi.fn().mockResolvedValue({
        currentVersion: "2026-11-v1",
        acceptedVersion: null,
        acceptedAt: null,
      }),
    });
    renderCoach(<InviteContainer />, {
      route: INVITE,
      path: "/coach/clients/invited/:profileId/invite",
      api,
    });
    const dialog = await screen.findByRole("dialog", {
      name: "Before you invite clients",
    });
    expect(within(dialog).getByText(/PAR-Q/)).toBeTruthy();
    expect(api.issueInvite).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Not now" }));
    expect(
      await screen.findByText("Lena doesn't have a code yet."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Send invite" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("checkbox"),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm and continue" }),
    );
    await waitFor(() => expect(api.issueInvite).toHaveBeenCalledTimes(1));
  });

  it("expired code: says so and resends", async () => {
    const api = fakeApi({
      profileDetail: vi
        .fn()
        .mockResolvedValue(detail({ invite: { ...live, status: "expired" } })),
    });
    renderCoach(<InviteContainer />, {
      route: INVITE,
      path: "/coach/clients/invited/:profileId/invite",
      api,
    });
    expect(
      await screen.findByText("Lena's code has expired. Send a new one."),
    ).toBeTruthy();
    expect(api.issueInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Resend invite" }));
    await waitFor(() => expect(api.issueInvite).toHaveBeenCalled());
  });

  it("offline: nothing is issued and sending waits", async () => {
    setOnline(false);
    const api = fakeApi();
    renderCoach(<InviteContainer />, {
      route: INVITE,
      path: "/coach/clients/invited/:profileId/invite",
      api,
    });
    expect(await screen.findByText("Offline")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Send invite" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(api.issueInvite).not.toHaveBeenCalled();
  });

  it("goes Back to set up, previews, and sends accepted clients to their page", async () => {
    const api = fakeApi({
      profileDetail: vi.fn().mockResolvedValue(detail({ invite: live })),
    });
    renderCoach(<InviteContainer />, {
      route: INVITE,
      path: "/coach/clients/invited/:profileId/invite",
      api,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Preview as Lena" }),
    );
    expect(await screen.findByRole("dialog", { name: /Preview/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(currentPath()).toBe(`${INVITED}/setup`);

    renderCoach(<InviteContainer />, {
      route: INVITE,
      path: "/coach/clients/invited/:profileId/invite",
      api: fakeApi({
        profileDetail: vi
          .fn()
          .mockResolvedValue(detail({ status: "active", clientId: CLIENT_ID })),
      }),
    });
    await waitFor(() =>
      expect(currentPath()).toBe(`/coach/clients/${CLIENT_ID}`),
    );
  });

  it("a cancelled invite says so", async () => {
    renderCoach(<InviteContainer />, {
      route: INVITE,
      path: "/coach/clients/invited/:profileId/invite",
      api: fakeApi({
        profileDetail: vi
          .fn()
          .mockResolvedValue(detail({ status: "cancelled" })),
      }),
    });
    expect(await screen.findByText(/This invite was cancelled/)).toBeTruthy();
  });
});

describe("Invited client (C11d)", () => {
  const ready = detail({
    invite: live,
    setup: {
      starter_form: [{ refId: "f-goals", config: {}, sortOrder: 0 }],
      repeating_form: [{ refId: "s-weekly", config: {}, sortOrder: 0 }],
    },
  });

  it("only Overview is open; rows open their section; notes show", async () => {
    const api = fakeApi({ profileDetail: vi.fn().mockResolvedValue(ready) });
    renderCoach(<InvitedClientContainer />, {
      route: INVITED,
      path: "/coach/clients/invited/:profileId",
      api,
    });
    expect(
      await screen.findByRole("heading", { name: "Lena Ortiz" }),
    ).toBeTruthy();
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(11);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(
      tabs.slice(1).every((t) => t.getAttribute("aria-disabled") === "true"),
    ).toBe(true);
    expect(tabs[1].getAttribute("aria-label")).toBe(
      "Training, opens when Lena accepts",
    );
    expect(
      screen.getByText("Sundays 09:00 · due Mon 12:00 · 2 reminders"),
    ).toBeTruthy();
    expect(screen.getByText("Desk job, left shoulder tight.")).toBeTruthy();
    expect(
      screen.getByText("The other tabs open once Lena accepts."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Meal plan" }));
    expect(currentPath()).toBe(`${INVITED}/setup/meal_plan?from=invited`);
  });

  it("Copy link, and Resend makes a new code then opens it", async () => {
    const api = fakeApi({ profileDetail: vi.fn().mockResolvedValue(ready) });
    renderCoach(<InvitedClientContainer />, {
      route: INVITED,
      path: "/coach/clients/invited/:profileId",
      api,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(live.link));
    fireEvent.click(screen.getByRole("button", { name: "Resend invite" }));
    await waitFor(() => expect(currentPath()).toBe(INVITE));
  });

  it("Cancel invite asks first, then cancels and returns to Clients", async () => {
    const api = fakeApi({ profileDetail: vi.fn().mockResolvedValue(ready) });
    renderCoach(<InvitedClientContainer />, {
      route: INVITED,
      path: "/coach/clients/invited/:profileId",
      api,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel invite" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Cancel Lena's invite?",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Keep invite" }),
    );
    expect(api.cancelInvite).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel invite" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Cancel invite",
      }),
    );
    await waitFor(() =>
      expect(api.cancelInvite).toHaveBeenCalledWith(PROFILE_ID),
    );
    await waitFor(() => expect(currentPath()).toBe("/coach/clients"));
  });

  it("a failed cancel stays put and says why", async () => {
    const api = fakeApi({
      profileDetail: vi.fn().mockResolvedValue(ready),
      cancelInvite: vi.fn().mockRejectedValue(apiError(0, null, true)),
    });
    renderCoach(<InvitedClientContainer />, {
      route: INVITED,
      path: "/coach/clients/invited/:profileId",
      api,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Cancel invite" }),
    );
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "Cancel invite",
      }),
    );
    expect(
      await screen.findByText(
        "You're offline. Sending an invite needs a connection.",
      ),
    ).toBeTruthy();
    expect(currentPath()).toBe(INVITED);
  });

  it("edits private notes with the revision; 409 shows the other device's notes", async () => {
    const api = fakeApi({
      profileDetail: vi.fn().mockResolvedValue(ready),
      patchProfile: vi.fn().mockResolvedValueOnce({
        ...ready,
        privateNotes: "New note",
        revision: 4,
      }),
    });
    renderCoach(<InvitedClientContainer />, {
      route: INVITED,
      path: "/coach/clients/invited/:profileId",
      api,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Private notes"), {
      target: { value: " New note " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.patchProfile).toHaveBeenCalledWith(
        PROFILE_ID,
        { privateNotes: "New note" },
        3,
      ),
    );
    expect(await screen.findByText("New note")).toBeTruthy();

    api.patchProfile.mockRejectedValueOnce(
      apiError(409, {
        code: "revision_conflict",
        current: { ...ready, privateNotes: "Phone note", revision: 7 },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Private notes"), {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Updated on another device/)).toBeTruthy();
    expect(screen.getByText("Phone note")).toBeTruthy();
  });

  it("unchanged notes don't write; Cancel closes the editor", async () => {
    const api = fakeApi({ profileDetail: vi.fn().mockResolvedValue(ready) });
    renderCoach(<InvitedClientContainer />, {
      route: INVITED,
      path: "/coach/clients/invited/:profileId",
      api,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Private notes")).toBeNull(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.patchProfile).not.toHaveBeenCalled();
  });

  it("expired: pill says so, Copy link is off; offline locks actions", async () => {
    const api = fakeApi({
      profileDetail: vi
        .fn()
        .mockResolvedValue(
          detail({ invite: { ...live, expiresAt: "2020-01-01T00:00:00Z" } }),
        ),
    });
    renderCoach(<InvitedClientContainer />, {
      route: INVITED,
      path: "/coach/clients/invited/:profileId",
      api,
    });
    expect(await screen.findByText("Code expired")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Copy link" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    setOnline(false);
    expect(
      await screen.findByText(/Offline · showing Lena as of/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Resend invite",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Cancel invite",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("not found, and accepted clients redirect", async () => {
    renderCoach(<InvitedClientContainer />, {
      route: INVITED,
      path: "/coach/clients/invited/:profileId",
      api: fakeApi({
        profileDetail: vi.fn().mockRejectedValue(apiError(404, null)),
      }),
    });
    expect(
      await screen.findByText("This client isn't in your list."),
    ).toBeTruthy();
    renderCoach(<InvitedClientContainer />, {
      route: INVITED,
      path: "/coach/clients/invited/:profileId",
      api: fakeApi({
        profileDetail: vi
          .fn()
          .mockResolvedValue(detail({ status: "active", clientId: CLIENT_ID })),
      }),
    });
    await waitFor(() =>
      expect(currentPath()).toBe(`/coach/clients/${CLIENT_ID}`),
    );
  });
});

describe("Client settings (C3.9)", () => {
  const PAGE = `/coach/clients/${CLIENT_ID}/settings`;
  const PATH = "/coach/clients/:clientId/:tab?";

  it("opens on Settings with the client header; other tabs not on the web yet", async () => {
    renderCoach(<ClientPage />, {
      route: `/coach/clients/${CLIENT_ID}`,
      path: PATH,
      api: fakeApi(),
    });
    await waitFor(() => expect(currentPath()).toBe(PAGE));
    expect(
      await screen.findByRole("heading", { name: "Sam Patel" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("tab", { name: "Settings" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("tab", { name: "Overview, not on the web yet" }),
    ).toBeTruthy();
    expect(await screen.findByText("Features for Sam")).toBeTruthy();
    expect(screen.queryByText("Training plan")).toBeNull();
  });

  it("each switch saves with the revision", async () => {
    const api = fakeApi({
      patchSettings: vi.fn().mockImplementation(async (_c, patch) => ({
        ...settings(),
        ...patch,
        revision: 5,
      })),
    });
    renderCoach(<ClientPage />, { route: PAGE, path: PATH, api });
    fireEvent.click(
      await screen.findByRole("switch", { name: "Progress photos" }),
    );
    await waitFor(() =>
      expect(api.patchSettings).toHaveBeenCalledWith(
        CLIENT_ID,
        { features: { photos: false } },
        4,
      ),
    );
    fireEvent.click(await screen.findByRole("radio", { name: "Mute all" }));
    await waitFor(() =>
      expect(api.patchSettings).toHaveBeenLastCalledWith(
        CLIENT_ID,
        { alertMode: "mute" },
        5,
      ),
    );
  });

  it("tracking training starts at three sessions a week, adjustable 1–14", async () => {
    let current = settings();
    const api = fakeApi({
      patchSettings: vi.fn().mockImplementation(async (_c, patch) => {
        current = { ...current, ...patch, revision: current.revision + 1 };
        return current;
      }),
    });
    renderCoach(<ClientPage />, { route: PAGE, path: PATH, api });
    fireEvent.click(await screen.findByRole("switch", { name: "Training" }));
    await waitFor(() =>
      expect(api.patchSettings).toHaveBeenCalledWith(
        CLIENT_ID,
        { trackTraining: true, sessionsPerWeek: 3 },
        4,
      ),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "More sessions" }),
    );
    await waitFor(() =>
      expect(api.patchSettings).toHaveBeenLastCalledWith(
        CLIENT_ID,
        { sessionsPerWeek: 4 },
        5,
      ),
    );
    await waitFor(() => expect(screen.getByText("4")).toBeTruthy());
    fireEvent.click(screen.getByRole("switch", { name: "Calories" }));
    await waitFor(() =>
      expect(api.patchSettings).toHaveBeenLastCalledWith(
        CLIENT_ID,
        { trackCalories: false },
        6,
      ),
    );
  });

  it("409: shows the other device's settings", async () => {
    const api = fakeApi({
      patchSettings: vi.fn().mockRejectedValue(
        apiError(409, {
          code: "revision_conflict",
          current: settings({ alertMode: "everything", revision: 9 }),
        }),
      ),
    });
    renderCoach(<ClientPage />, { route: PAGE, path: PATH, api });
    fireEvent.click(await screen.findByRole("radio", { name: "Mute all" }));
    expect(await screen.findByText(/Updated on another device/)).toBeTruthy();
    expect(
      screen
        .getByRole("radio", { name: "Boost: every event" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("a failed save puts the switch back and says why", async () => {
    const api = fakeApi({
      patchSettings: vi.fn().mockRejectedValue(apiError(0, null, true)),
    });
    renderCoach(<ClientPage />, { route: PAGE, path: PATH, api });
    const sw = await screen.findByRole("switch", { name: "Messages" });
    fireEvent.click(sw);
    expect(
      await screen.findByText(
        "You're offline. Settings change when you're back online.",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("switch", { name: "Messages" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("offline: banner and everything locked", async () => {
    renderCoach(<ClientPage />, { route: PAGE, path: PATH, api: fakeApi() });
    await screen.findByText("Features for Sam");
    setOnline(false);
    expect(await screen.findByText(/Offline · showing Sam as of/)).toBeTruthy();
    expect(
      (screen.getByRole("switch", { name: "Habits" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "End coaching with Sam",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("End coaching asks first, then ends it and returns to Clients", async () => {
    const api = fakeApi();
    renderCoach(<ClientPage />, { route: PAGE, path: PATH, api });
    fireEvent.click(
      await screen.findByRole("button", { name: "End coaching with Sam" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "End coaching with Sam?",
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Keep coaching" }),
    );
    expect(api.endCoaching).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "End coaching with Sam" }),
    );
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "End coaching",
      }),
    );
    await waitFor(() =>
      expect(api.endCoaching).toHaveBeenCalledWith(CLIENT_ID),
    );
    await waitFor(() => expect(currentPath()).toBe("/coach/clients"));
  });

  it("a failed end says why", async () => {
    const api = fakeApi({
      endCoaching: vi
        .fn()
        .mockRejectedValue(
          apiError(404, { message: "Client relationship not found" }),
        ),
    });
    renderCoach(<ClientPage />, { route: PAGE, path: PATH, api });
    fireEvent.click(
      await screen.findByRole("button", { name: "End coaching with Sam" }),
    );
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", {
        name: "End coaching",
      }),
    );
    expect(
      await screen.findByText("Client relationship not found"),
    ).toBeTruthy();
  });

  it("someone who isn't an active client, and settings that fail to load", async () => {
    renderCoach(<ClientPage />, {
      route: "/coach/clients/nobody/settings",
      path: PATH,
      api: fakeApi(),
    });
    expect(
      await screen.findByText("This client isn't one of your active clients."),
    ).toBeTruthy();
    cleanup();

    const failing = vi.fn().mockRejectedValue(apiError(500, null));
    renderCoach(<ClientPage />, {
      route: PAGE,
      path: PATH,
      api: fakeApi({ settings: failing }),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(failing).toHaveBeenCalledTimes(2));
  });
});
