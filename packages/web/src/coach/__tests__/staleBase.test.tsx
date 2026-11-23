import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
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
