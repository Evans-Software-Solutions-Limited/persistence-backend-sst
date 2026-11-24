import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { InviteContainer } from "../invite/InviteContainer";
import { CoachApiError } from "../api/coachApi";
import { useNavigate } from "react-router";
import { InvitedClientContainer } from "../invited/InvitedClientContainer";
import { SetupContainer } from "../setup/SetupContainer";
import { WhoContainer } from "../who/WhoContainer";
import { ClientPage } from "../clients/ClientPage";
import { PerProfile } from "../CoachApp";
import {
  CLIENT_ID,
  PROFILE_ID,
  currentPath,
  detail,
  fakeApi,
  renderCoach,
  setOnline,
  settings,
} from "./helpers";

/**
 * Inspector Brad, sweep 4 on #549: a refetch while the coach is editing (e.g.
 * on window focus) must not move the baseline. Edits are compared with, and
 * the revision sent from, what the coach started from, so another device's
 * change is answered with a 409 instead of being silently undone.
 */

beforeEach(() => setOnline(true));
afterEach(() => setOnline(true));

const key = ["coach", "client-profile", PROFILE_ID];

/** Another device's change arrives by refetch; React Query notifies a tick later. */
async function refetchLands(queryClient: QueryClient) {
  await act(async () => {
    queryClient.setQueryData(key, fromPhone);
    await new Promise((r) => setTimeout(r, 10));
  });
}
const fromPhone = detail({
  revision: 5,
  goal: "Changed on the phone",
  privateNotes: "Phone note",
  setup: {
    welcome_message: [
      { refId: null, config: { text: "Phone welcome" }, sortOrder: 0 },
    ],
  },
});

describe("a refetch while editing keeps the starting point", () => {
  it("Who: only the edited field is sent, with the revision the form loaded", async () => {
    const api = fakeApi({
      patchProfile: vi.fn().mockResolvedValue(detail({ revision: 6 })),
    });
    const { queryClient } = renderCoach(<WhoContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/who`,
      path: "/coach/clients/invited/:profileId/who",
      api,
    });
    fireEvent.change(await screen.findByLabelText("Email or mobile"), {
      target: { value: "lena@new.example.com" },
    });
    await refetchLands(queryClient);
    fireEvent.click(screen.getByRole("button", { name: "Next: set up" }));
    await waitFor(() => expect(api.patchProfile).toHaveBeenCalled());
    expect(api.patchProfile).toHaveBeenCalledWith(
      PROFILE_ID,
      { contactEmail: "lena@new.example.com" },
      3,
    );
  });

  it("Set up: the section is saved with the revision the edit began on", async () => {
    const api = fakeApi({
      replaceSection: vi.fn().mockResolvedValue(detail({ revision: 6 })),
    });
    const { queryClient } = renderCoach(<SetupContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/setup/welcome_message`,
      path: "/coach/clients/invited/:profileId/setup/:section?",
      api,
    });
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Mine" },
    });
    await refetchLands(queryClient);
    expect(
      (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
    ).toBe("Mine");
    fireEvent.click(screen.getByRole("button", { name: "Next: invite" }));
    await waitFor(() => expect(api.replaceSection).toHaveBeenCalled());
    expect(api.replaceSection.mock.calls[0][3]).toBe(3);
  });

  it("Invited page: notes are saved with the revision from when Edit was pressed", async () => {
    const api = fakeApi({
      patchProfile: vi.fn().mockResolvedValue(detail({ revision: 6 })),
    });
    const { queryClient } = renderCoach(<InvitedClientContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}`,
      path: "/coach/clients/invited/:profileId",
      api,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Private notes"), {
      target: { value: "Mine" },
    });
    await refetchLands(queryClient);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.patchProfile).toHaveBeenCalledWith(
        PROFILE_ID,
        { privateNotes: "Mine" },
        3,
      ),
    );
  });
});

describe("a draft left in another section (sweep 6)", () => {
  let go: (to: string) => void = () => {};
  function GrabNavigate() {
    const navigate = useNavigate();
    go = (to) => void navigate(to);
    return null;
  }

  it("moves to the new revision after the coach's own save elsewhere", async () => {
    const afterWelcome = detail({
      revision: 4,
      setup: {
        welcome_message: [
          { refId: null, config: { text: "Hi" }, sortOrder: 0 },
        ],
      },
    });
    const api = fakeApi({
      replaceSection: vi
        .fn()
        .mockResolvedValueOnce(afterWelcome)
        .mockResolvedValueOnce(detail({ revision: 5 })),
    });
    const at = (s: string) => `/coach/clients/invited/${PROFILE_ID}/setup/${s}`;
    renderCoach(
      <>
        <SetupContainer />
        <GrabNavigate />
      </>,
      {
        route: at("meal_plan"),
        path: "/coach/clients/invited/:profileId/setup/:section?",
        api,
      },
    );
    // Draft a meal plan, then leave it unsaved the way browser Back does.
    fireEvent.click((await screen.findAllByRole("button", { name: "Add" }))[0]);
    act(() => go(at("welcome_message")));
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Hi" },
    });
    // Saving the welcome message moves the profile to revision 4.
    fireEvent.click(screen.getByRole("button", { name: /Meal plan/ }));
    await waitFor(() => expect(api.replaceSection).toHaveBeenCalledTimes(1));
    await screen.findByRole("heading", { name: "Meal plan" });
    fireEvent.click(screen.getByRole("button", { name: "Next: invite" }));
    await waitFor(() => expect(api.replaceSection).toHaveBeenCalledTimes(2));
    const [, section, , revision] = api.replaceSection.mock.calls[1];
    expect(section).toBe("meal_plan");
    expect(revision).toBe(4);
  });
});

describe("sweep 7", () => {
  it("Copy-from keeps unsaved edits in sections it didn't copy", async () => {
    const copied = detail({
      revision: 9,
      setup: { meal_plan: [{ refId: "p-train", config: {}, sortOrder: 0 }] },
    });
    const api = fakeApi({
      copyFrom: vi.fn().mockResolvedValue(copied),
      replaceSection: vi.fn().mockResolvedValue(detail({ revision: 10 })),
    });
    renderCoach(<SetupContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/setup/welcome_message`,
      path: "/coach/clients/invited/:profileId/setup/:section?",
      api,
    });
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Hi Lena" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Copy setup from a client/ }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Copy" }));
    await screen.findByText("Copied from Sam Patel");
    expect(
      (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
    ).toBe("Hi Lena");
    fireEvent.click(screen.getByRole("button", { name: "Next: invite" }));
    await waitFor(() =>
      expect(api.replaceSection).toHaveBeenCalledWith(
        PROFILE_ID,
        "welcome_message",
        [{ refId: null, sortOrder: 0, config: { text: "Hi Lena" } }],
        9,
      ),
    );
  });

  it("the invite step doesn't issue from cached data when a code exists on the server", async () => {
    const issuedElsewhere = detail({
      invite: {
        code: "PH0NE1",
        link: "l",
        expiresAt: "2099-01-01T00:00:00Z",
        status: "active",
      },
    });
    const api = fakeApi({
      profileDetail: vi.fn().mockResolvedValue(issuedElsewhere),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    // Cached from the Setup page, before the phone issued its code.
    queryClient.setQueryData(key, detail());
    renderCoach(<InviteContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/invite`,
      path: "/coach/clients/invited/:profileId/invite",
      api,
      queryClient,
    });
    expect(await screen.findByText("PH0NE1")).toBeTruthy();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.issueInvite).not.toHaveBeenCalled();
  });
});

describe("a 409 from a change outside what the coach edited (sweep 8)", () => {
  // The phone resent the code: revision moved, nothing the coach edits did.
  const elsewhere = detail({
    revision: 7,
    invite: {
      code: "NEW123",
      link: "l",
      expiresAt: "2099-01-01T00:00:00Z",
      status: "active",
    },
  });
  const conflict = () =>
    new CoachApiError(409, { code: "revision_conflict", current: elsewhere });

  it("Set up: saves the draft again on the new revision", async () => {
    const api = fakeApi({
      replaceSection: vi
        .fn()
        .mockRejectedValueOnce(conflict())
        .mockResolvedValueOnce(detail({ revision: 8 })),
    });
    renderCoach(<SetupContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/setup/welcome_message`,
      path: "/coach/clients/invited/:profileId/setup/:section?",
      api,
    });
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Hi Lena" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: invite" }));
    await waitFor(() => expect(api.replaceSection).toHaveBeenCalledTimes(2));
    expect(api.replaceSection.mock.calls[1][3]).toBe(7);
    expect(screen.queryByText(/Updated on another device/)).toBeNull();
  });

  it("Who: sends the same change on the new revision", async () => {
    const api = fakeApi({
      patchProfile: vi
        .fn()
        .mockRejectedValueOnce(conflict())
        .mockResolvedValueOnce(detail({ revision: 8 })),
    });
    renderCoach(<WhoContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/who`,
      path: "/coach/clients/invited/:profileId/who",
      api,
    });
    fireEvent.change(await screen.findByLabelText("Goal, optional"), {
      target: { value: "Run 5k" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: set up" }));
    await waitFor(() => expect(api.patchProfile).toHaveBeenCalledTimes(2));
    expect(api.patchProfile.mock.calls[1]).toEqual([
      PROFILE_ID,
      { goal: "Run 5k" },
      7,
    ]);
  });

  it("Invited page: saves the note again on the new revision", async () => {
    const api = fakeApi({
      patchProfile: vi
        .fn()
        .mockRejectedValueOnce(conflict())
        .mockResolvedValueOnce(detail({ revision: 8, privateNotes: "Mine" })),
    });
    renderCoach(<InvitedClientContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}`,
      path: "/coach/clients/invited/:profileId",
      api,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Private notes"), {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.patchProfile).toHaveBeenCalledTimes(2));
    expect(api.patchProfile.mock.calls[1][2]).toBe(7);
    expect(await screen.findByText("Mine")).toBeTruthy();
    expect(screen.queryByText(/Updated on another device/)).toBeNull();
  });
});

describe("leaving set-up saves (sweep 9)", () => {
  const SETUP_PATH = "/coach/clients/invited/:profileId/setup/:section?";
  const welcome = `/coach/clients/invited/${PROFILE_ID}/setup/welcome_message`;

  it("the link above the title saves, like the footer's Back", async () => {
    const api = fakeApi({
      replaceSection: vi.fn().mockResolvedValue(detail({ revision: 4 })),
    });
    renderCoach(<SetupContainer />, {
      route: `${welcome}?from=invited`,
      path: SETUP_PATH,
      api,
    });
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Hi Lena" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lena Ortiz" }));
    await waitFor(() =>
      expect(api.replaceSection).toHaveBeenCalledWith(
        PROFILE_ID,
        "welcome_message",
        [{ refId: null, sortOrder: 0, config: { text: "Hi Lena" } }],
        3,
      ),
    );
    await waitFor(() =>
      expect(currentPath()).toBe(`/coach/clients/invited/${PROFILE_ID}`),
    );
  });

  it("leaving another way (the rail) saves the unsaved edit in the background", async () => {
    const api = fakeApi({
      replaceSection: vi.fn().mockResolvedValue(detail({ revision: 4 })),
    });
    const { unmount } = renderCoach(<SetupContainer />, {
      route: welcome,
      path: SETUP_PATH,
      api,
    });
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Hi Lena" },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    unmount();
    await waitFor(() =>
      expect(api.replaceSection).toHaveBeenCalledWith(
        PROFILE_ID,
        "welcome_message",
        [{ refId: null, sortOrder: 0, config: { text: "Hi Lena" } }],
        3,
      ),
    );
  });

  it("an unsaved but invalid draft isn't sent on the way out", async () => {
    const api = fakeApi();
    const { unmount } = renderCoach(<SetupContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/setup/nutrition_target`,
      path: SETUP_PATH,
      api,
    });
    fireEvent.click(await screen.findByRole("radio", { name: "You set them" }));
    fireEvent.change(screen.getByLabelText("kcal a day"), {
      target: { value: "2100" },
    });
    unmount();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.replaceSection).not.toHaveBeenCalled();
  });
});

describe("invite step after a failed refetch (sweep 9)", () => {
  it("doesn't issue from cached data when the fresh read failed", async () => {
    const api = fakeApi({
      profileDetail: vi
        .fn()
        .mockRejectedValue(
          new CoachApiError(503, { code: "auth_unavailable" }),
        ),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(key, detail());
    renderCoach(<InviteContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/invite`,
      path: "/coach/clients/invited/:profileId/invite",
      api,
      queryClient,
    });
    await waitFor(() => expect(api.profileDetail).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 30));
    expect(api.issueInvite).not.toHaveBeenCalled();
  });
});

describe("sweep 10", () => {
  it("a 409 because the client just accepted goes to their page, without a resend", async () => {
    const accepted = detail({
      revision: 7,
      status: "active",
      clientId: CLIENT_ID,
    });
    const api = fakeApi({
      replaceSection: vi.fn().mockRejectedValue(
        new CoachApiError(409, {
          code: "revision_conflict",
          current: accepted,
        }),
      ),
    });
    renderCoach(<SetupContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/setup/welcome_message`,
      path: "/coach/clients/invited/:profileId/setup/:section?",
      api,
    });
    fireEvent.change(await screen.findByLabelText("Message"), {
      target: { value: "Hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: invite" }));
    await waitFor(() =>
      expect(currentPath()).toBe(`/coach/clients/${CLIENT_ID}`),
    );
    expect(api.replaceSection).toHaveBeenCalledTimes(1);
  });

  it("settings: a 409 from a different setting resends this change", async () => {
    const changedOnPhone = settings({
      revision: 9,
      features: { ...settings().features, messages: false },
    });
    const api = fakeApi({
      patchSettings: vi
        .fn()
        .mockRejectedValueOnce(
          new CoachApiError(409, {
            code: "revision_conflict",
            current: changedOnPhone,
          }),
        )
        .mockImplementationOnce(async (_c, patch) => ({
          ...changedOnPhone,
          ...patch,
          features: { ...changedOnPhone.features, ...patch.features },
          revision: 10,
        })),
    });
    renderCoach(<ClientPage />, {
      route: `/coach/clients/${CLIENT_ID}/settings`,
      path: "/coach/clients/:clientId/:tab?",
      api,
    });
    fireEvent.click(
      await screen.findByRole("switch", { name: "Progress photos" }),
    );
    await waitFor(() => expect(api.patchSettings).toHaveBeenCalledTimes(2));
    expect(api.patchSettings.mock.calls[1]).toEqual([
      CLIENT_ID,
      { features: { photos: false } },
      9,
    ]);
    expect(screen.queryByText(/Updated on another device/)).toBeNull();
    expect(
      screen
        .getByRole("switch", { name: "Messages" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });
});

describe("drafts belong to one client (sweep 11)", () => {
  let go: (to: string) => void = () => {};
  function GrabNavigate() {
    const navigate = useNavigate();
    go = (to) => void navigate(to);
    return null;
  }
  const OTHER = "33333333-3333-4333-8333-333333333333";

  it("a jump between two clients' set-up pages never saves one's draft into the other", async () => {
    const api = fakeApi({
      profileDetail: vi.fn(async (id: string) =>
        detail({ id, displayName: id === OTHER ? "Bo Bell" : "Lena Ortiz" }),
      ),
      replaceSection: vi.fn(async (id: string) => detail({ id, revision: 4 })),
    });
    const setup = (id: string) =>
      `/coach/clients/invited/${id}/setup/welcome_message`;
    const { unmount } = renderCoach(
      <>
        <PerProfile screen={SetupContainer} />
        <GrabNavigate />
      </>,
      {
        route: setup(OTHER),
        path: "/coach/clients/invited/:profileId/setup/:section?",
        api,
      },
    );
    await screen.findByRole("heading", { name: "Set up Bo" });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Hi Bo" },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => go(setup(PROFILE_ID)));
    await screen.findByRole("heading", { name: "Set up Lena" });
    expect(
      (screen.getByLabelText("Message") as HTMLTextAreaElement).value,
    ).toBe("");
    unmount();
    await new Promise((r) => setTimeout(r, 20));
    const toLena = api.replaceSection.mock.calls.filter(
      ([id]) => id === PROFILE_ID,
    );
    expect(toLena).toHaveLength(0);
    expect(
      api.replaceSection.mock.calls.filter(([id]) => id === OTHER),
    ).toHaveLength(1);
  });
});

describe("after a resend the cache keeps the server's newer copy (sweep 12)", () => {
  const resentOnPhone = detail({
    revision: 7,
    invite: {
      code: "NEW123",
      link: "l2",
      expiresAt: "2099-01-01T00:00:00Z",
      status: "active",
    },
  });
  const conflict = () =>
    new CoachApiError(409, {
      code: "revision_conflict",
      current: resentOnPhone,
    });
  // PATCH answers a plain profile: no invite, no set-up.
  const {
    invite: _i,
    setup: _s,
    ...plain
  } = detail({
    revision: 8,
    privateNotes: "Mine",
    goal: "Run 5k",
  });
  void _i;
  void _s;

  it("notes: the new code from the other device stays in the cache", async () => {
    const api = fakeApi({
      profileDetail: vi.fn().mockResolvedValue(
        detail({
          invite: {
            code: "OLD111",
            link: "l1",
            expiresAt: "2099-01-01T00:00:00Z",
            status: "active",
          },
        }),
      ),
      patchProfile: vi
        .fn()
        .mockRejectedValueOnce(conflict())
        .mockResolvedValueOnce(plain),
    });
    const { queryClient } = renderCoach(<InvitedClientContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}`,
      path: "/coach/clients/invited/:profileId",
      api,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Private notes"), {
      target: { value: "Mine" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.patchProfile).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        (queryClient.getQueryData(key) as { invite: { code: string } }).invite
          .code,
      ).toBe("NEW123"),
    );
    expect(
      (queryClient.getQueryData(key) as { revision: number }).revision,
    ).toBe(8);
  });

  it("Who: the new code from the other device stays in the cache", async () => {
    const api = fakeApi({
      patchProfile: vi
        .fn()
        .mockRejectedValueOnce(conflict())
        .mockResolvedValueOnce(plain),
    });
    const { queryClient } = renderCoach(<WhoContainer />, {
      route: `/coach/clients/invited/${PROFILE_ID}/who`,
      path: "/coach/clients/invited/:profileId/who",
      api,
    });
    fireEvent.change(await screen.findByLabelText("Goal, optional"), {
      target: { value: "Run 5k" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Next: set up" }));
    await waitFor(() => expect(api.patchProfile).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        (queryClient.getQueryData(key) as { invite: { code: string } }).invite
          .code,
      ).toBe("NEW123"),
    );
  });
});
