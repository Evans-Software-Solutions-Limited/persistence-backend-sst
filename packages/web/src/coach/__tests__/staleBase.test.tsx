import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { InviteContainer } from "../invite/InviteContainer";
import { useNavigate } from "react-router";
import { InvitedClientContainer } from "../invited/InvitedClientContainer";
import { SetupContainer } from "../setup/SetupContainer";
import { WhoContainer } from "../who/WhoContainer";
import { PROFILE_ID, detail, fakeApi, renderCoach, setOnline } from "./helpers";

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
    go = (to) => navigate(to);
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
