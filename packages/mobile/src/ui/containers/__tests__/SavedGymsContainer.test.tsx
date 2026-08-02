import { fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { ReferenceEntry } from "@/domain/models/reference-list";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { SavedGymsContainer } from "@/ui/containers/SavedGymsContainer";
import { summariseKit } from "@/ui/presenters/loadout/SavedGymsPresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";

/**
 * Same convention as every other heavy container suite here (ProfileContainer,
 * ExerciseListContainer, SubscriptionSelectionContainer…): these mount the real
 * Tamagui provider, a React Query client and gorhom sheet machinery per case,
 * and run alongside 459 other suites on a contended CI runner, where jest's 5 s
 * default is the wrong budget for this shape. See
 * `LoadoutFlowContainer.test.tsx` for the measurement that prompted it.
 */
jest.setTimeout(20_000);

const mockRouterBack = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: jest.fn(), back: (...a: unknown[]) => mockRouterBack(...a) },
  useRouter: () => ({ push: jest.fn(), back: mockRouterBack }),
}));

const EQUIPMENT: ReferenceEntry[] = [
  {
    id: "eq-dumbbell",
    name: "dumbbells",
    displayName: "Dumbbells",
    category: "free_weights",
  },
  {
    id: "eq-barbell",
    name: "barbell",
    displayName: "Barbell",
    category: "free_weights",
  },
  { id: "eq-cable", name: "cable", displayName: "Cable", category: "cables" },
];

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
): Adapters {
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  };
  return {
    api,
    auth: {
      getSession: jest.fn(async () => ok(session)),
      onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
        cb(session);
        return () => {};
      }),
      getAccessToken: jest.fn(async () => "t"),
    } as unknown as Adapters["auth"],
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function renderScreen(
  api: InMemoryApiAdapter,
  equipment: ReferenceEntry[] = EQUIPMENT,
) {
  const storage = new InMemoryStorageAdapter();
  storage.cacheReferenceList("equipment", equipment);
  storage.cacheReferenceList("muscle_groups", [
    { id: "mg-1", name: "chest", displayName: "Chest" },
  ]);
  storage.cacheReferenceList("categories", [
    { id: "cat-1", name: "strength", displayName: "Strength" },
  ]);
  return renderWithTheme(
    <AdapterProvider adapters={makeAdapters(api, storage)}>
      <SavedGymsContainer />
    </AdapterProvider>,
  );
}

function seedGym(api: InMemoryApiAdapter) {
  api.savedGyms = [
    {
      id: "gym-1",
      name: "Hotel gym",
      equipmentTypeIds: ["eq-dumbbell", "eq-cable"],
      createdAt: null,
      updatedAt: null,
    },
  ];
}

describe("SavedGymsContainer", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lists gyms with a kit summary", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    const { findByTestId, getByText } = renderScreen(api);

    await findByTestId("saved-gym-gym-1");
    getByText("Hotel gym");
    getByText("Dumbbells · Cable");
  });

  it("shows an empty state, which now pitches rather than instructs", async () => {
    const api = new InMemoryApiAdapter();
    const { findByTestId, queryByText } = renderScreen(api);
    expect(await findByTestId("saved-gyms-empty")).toBeTruthy();
    // It used to instruct: go adapt a workout and tick "Save" — the only route
    // to a gym before AC-7.2a. With a create button on the same screen that
    // sends the user the long way round. (The intro line above still mentions
    // adapting, correctly — that is what gyms are FOR.)
    expect(queryByText(/tick/i)).toBeNull();
    expect(queryByText(/next time you adapt/i)).toBeNull();
  });

  it("surfaces a failed list read", async () => {
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getSavedGyms")
      .mockResolvedValue(fail({ kind: "api", code: "network", message: "" }));
    const { findByTestId } = renderScreen(api);
    expect(await findByTestId("saved-gyms-error")).toBeTruthy();
  });

  it("renames a gym and re-reads the list", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    const { findByTestId, getByText } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-edit"));
    fireEvent.changeText(
      await findByTestId("saved-gym-gym-1-name"),
      "Garage gym",
    );
    fireEvent.press(await findByTestId("saved-gym-gym-1-save"));

    await waitFor(() => getByText("Garage gym"));
    expect(api.savedGyms[0].name).toBe("Garage gym");
  });

  it("TRIMS the name before saving", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    const { findByTestId } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-edit"));
    fireEvent.changeText(
      await findByTestId("saved-gym-gym-1-name"),
      "  Garage gym  ",
    );
    fireEvent.press(await findByTestId("saved-gym-gym-1-save"));

    // The server's uniqueness check is on `lower(btrim(name))`, so an untrimmed
    // name stores padding that the duplicate check cannot see — two gyms that
    // read identically and one 409 the user cannot explain.
    await waitFor(() => expect(api.savedGyms[0].name).toBe("Garage gym"));
  });

  it("edits a gym's equipment", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    const { findByTestId } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-edit"));
    fireEvent.press(await findByTestId("saved-gym-gym-1-equip-eq-barbell"));
    fireEvent.press(await findByTestId("saved-gym-gym-1-save"));

    // A gym you cannot correct has to be deleted and rebuilt the first time the
    // real gym adds a rack — the opposite of the reuse `saved_gyms` exists for.
    await waitFor(() =>
      expect(api.savedGyms[0].equipmentTypeIds).toContain("eq-barbell"),
    );
  });

  it("keeps the editor OPEN with a field error on a duplicate name (409)", async () => {
    const api = new InMemoryApiAdapter();
    api.savedGyms = [
      {
        id: "gym-1",
        name: "Hotel gym",
        equipmentTypeIds: ["eq-dumbbell"],
        createdAt: null,
        updatedAt: null,
      },
      {
        id: "gym-2",
        name: "Garage",
        equipmentTypeIds: ["eq-barbell"],
        createdAt: null,
        updatedAt: null,
      },
    ];
    const { findByTestId, getByText } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-edit"));
    fireEvent.changeText(await findByTestId("saved-gym-gym-1-name"), "Garage");
    fireEvent.press(await findByTestId("saved-gym-gym-1-save"));

    // Recoverable and likely, so it is a field prompt — not a toast over a
    // closed editor with the typed value thrown away.
    expect(await findByTestId("saved-gym-gym-1-edit-error")).toBeTruthy();
    getByText("You already have a gym with that name.");
    expect(await findByTestId("saved-gym-gym-1-name")).toBeTruthy();
  });

  it("refuses to save a blank name without calling the API", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    const update = jest.spyOn(api, "updateSavedGym");
    const { findByTestId, getByText } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-edit"));
    fireEvent.changeText(await findByTestId("saved-gym-gym-1-name"), "   ");
    fireEvent.press(await findByTestId("saved-gym-gym-1-save"));

    getByText("Give this gym a name.");
    expect(update).not.toHaveBeenCalled();
  });

  it("blocks saving a gym with no equipment", async () => {
    const api = new InMemoryApiAdapter();
    api.savedGyms = [
      {
        id: "gym-1",
        name: "Hotel gym",
        equipmentTypeIds: ["eq-dumbbell"],
        createdAt: null,
        updatedAt: null,
      },
    ];
    const update = jest.spyOn(api, "updateSavedGym");
    const { findByTestId } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-edit"));
    fireEvent.press(await findByTestId("saved-gym-gym-1-equip-eq-dumbbell"));

    const save = await findByTestId("saved-gym-gym-1-save");
    expect(save.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(save);
    // An empty gym makes every loadable row unresolved on anything adapted
    // against it.
    expect(update).not.toHaveBeenCalled();
  });

  it("surfaces a non-409 save failure on the same field", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    jest
      .spyOn(api, "updateSavedGym")
      .mockResolvedValue(fail({ kind: "api", code: "network", message: "" }));
    const { findByTestId, getByText } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-edit"));
    fireEvent.press(await findByTestId("saved-gym-gym-1-save"));

    await findByTestId("saved-gym-gym-1-edit-error");
    getByText(
      "Couldn't save those changes. Check your connection and try again.",
    );
  });

  it("cancels an edit without touching the gym", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    const update = jest.spyOn(api, "updateSavedGym");
    const { findByTestId, queryByTestId } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-edit"));
    fireEvent.press(await findByTestId("saved-gym-gym-1-cancel"));

    await waitFor(() =>
      expect(queryByTestId("saved-gym-gym-1-editor")).toBeNull(),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("asks before deleting, and says variations survive", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    const { findByTestId, getByText } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-delete"));
    await findByTestId("saved-gym-gym-1-confirm-delete");
    // AC-7.3 — `source_gym_id` goes null and each variation keeps its stored kit
    // summary. "Delete" next to a name the user sees on three saved workouts
    // otherwise reads like it takes those with it.
    getByText(
      "Workout variations you saved with this gym are kept — they just stop being linked to it.",
    );
  });

  it("keeps the gym when the delete is cancelled", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    const remove = jest.spyOn(api, "deleteSavedGym");
    const { findByTestId } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-delete"));
    fireEvent.press(await findByTestId("saved-gym-gym-1-delete-cancel"));

    expect(await findByTestId("saved-gym-gym-1")).toBeTruthy();
    expect(remove).not.toHaveBeenCalled();
  });

  it("drops the row the instant delete is confirmed, before the server answers", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    // Never settles, so nothing but the optimistic hide can remove the row.
    jest.spyOn(api, "deleteSavedGym").mockReturnValue(new Promise(() => {}));
    const { findByTestId, queryByTestId } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-delete"));
    fireEvent.press(await findByTestId("saved-gym-gym-1-delete-confirm"));

    // ⚠ Clearing `pendingDeleteId` alone swaps the confirm card back for the
    // ROW, and `remove()` needs two sequential round trips before the list
    // re-reads — so without the optimistic hide the row the user just deleted
    // reappears for that whole window, reading as "the delete didn't work".
    expect(queryByTestId("saved-gym-gym-1")).toBeNull();
  });

  it("puts the row BACK when the delete fails", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    jest
      .spyOn(api, "deleteSavedGym")
      .mockResolvedValue(fail({ kind: "api", code: "network", message: "" }));
    const { findByTestId, findByText } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-delete"));
    fireEvent.press(await findByTestId("saved-gym-gym-1-delete-confirm"));

    // Hiding it permanently would show a gym they still have as gone — and the
    // next refresh would resurrect it anyway.
    expect(await findByTestId("saved-gym-gym-1")).toBeTruthy();
    expect(await findByText(/Couldn't delete that gym/)).toBeTruthy();
  });

  it("clears a failed delete's banner once a later edit succeeds", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    const remove = jest
      .spyOn(api, "deleteSavedGym")
      .mockResolvedValue(fail({ kind: "api", code: "network", message: "" }));
    const { findByTestId, findByText, queryByText } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-delete"));
    fireEvent.press(await findByTestId("saved-gym-gym-1-delete-confirm"));
    await findByText(/Couldn't delete that gym/);
    remove.mockRestore();

    // Back online, renaming a DIFFERENT thing entirely. The delete banner
    // outranks `loadError` and is otherwise only cleared by starting another
    // delete, so it would hang over a screen where nothing is wrong.
    fireEvent.press(await findByTestId("saved-gym-gym-1-edit"));
    fireEvent.changeText(await findByTestId("saved-gym-gym-1-name"), "Garage");
    fireEvent.press(await findByTestId("saved-gym-gym-1-save"));

    await waitFor(() =>
      expect(queryByText(/Couldn't delete that gym/)).toBeNull(),
    );
  });

  it("deletes on confirmation and the list re-reads", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    const { findByTestId, queryByTestId } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-delete"));
    fireEvent.press(await findByTestId("saved-gym-gym-1-delete-confirm"));

    // ⚠ The CAUSE first, then the effect. Asserting only that the row vanished
    // raced a two-round-trip chain (delete, then refresh) against `waitFor`'s
    // 1 s default, which held locally and failed on a loaded CI runner.
    await waitFor(() => expect(api.savedGyms).toHaveLength(0));
    await waitFor(() => expect(queryByTestId("saved-gym-gym-1")).toBeNull());
  });

  it("refreshes the equipment list when the cached one predates `category`", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    const spy = jest
      .spyOn(api, "getReferenceList")
      .mockResolvedValue(ok(EQUIPMENT));
    // No `category` KEY at all — a cache written before Loadout. Left alone, the
    // editor would put every chip under "Other" for up to 24h.
    renderScreen(api, [
      { id: "eq-dumbbell", name: "dumbbells", displayName: "Dumbbells" },
    ]);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(spy.mock.calls.map((call) => call[0])).toContain("equipment");
  });

  it("falls back to the canonical name when a chip has no displayName", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    const { findByTestId, getByText } = renderScreen(api, [
      // `displayName` is nullable — equipment rows have no such column today.
      {
        id: "eq-dumbbell",
        name: "dumbbells",
        displayName: null,
        category: null,
      },
    ]);

    fireEvent.press(await findByTestId("saved-gym-gym-1-edit"));
    getByText("dumbbells");
    // An uncategorised row lands in Other and stays SELECTABLE rather than
    // vanishing from the picker.
    getByText("OTHER");
  });

  /**
   * ⚠ Creation (AC-7.2a). Before the Train-hub move a gym could only be born as
   * a by-product of adapting a workout — `createSavedGym` had exactly two call
   * sites and both were in `LoadoutFlowContainer` — so a hub tab with no creator
   * would have been a dead end on a new account.
   */
  it("creates a gym from the segment, with no workout involved", async () => {
    const api = new InMemoryApiAdapter();
    api.savedGyms = [];
    const { findByTestId } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gyms-create"));
    fireEvent.changeText(
      await findByTestId("saved-gym-new-name"),
      "  Garage  ",
    );
    fireEvent.press(await findByTestId("saved-gym-new-equip-eq-barbell"));
    fireEvent.press(await findByTestId("saved-gym-new-save"));

    await waitFor(() => expect(api.savedGyms).toHaveLength(1));
    // Trimmed for the same reason a rename is: the server's uniqueness check is
    // on `lower(btrim(name))`, so stored padding is invisible to it.
    expect(api.savedGyms[0].name).toBe("Garage");
    expect(api.savedGyms[0].equipmentTypeIds).toEqual(["eq-barbell"]);
  });

  it("will not create a gym with no equipment", async () => {
    const api = new InMemoryApiAdapter();
    api.savedGyms = [];
    const { findByTestId } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gyms-create"));
    fireEvent.changeText(await findByTestId("saved-gym-new-name"), "Empty");
    const save = await findByTestId("saved-gym-new-save");
    expect(save.props.accessibilityState.disabled).toBe(true);

    fireEvent.press(save);
    // Same rule the editor already enforces: an empty gym makes every loadable
    // row unresolved on anything adapted against it.
    expect(api.savedGyms).toHaveLength(0);
  });

  it("keeps the CREATE card open with a field error on a duplicate name (409)", async () => {
    const api = new InMemoryApiAdapter();
    api.savedGyms = [
      {
        id: "gym-1",
        name: "Garage",
        equipmentTypeIds: ["eq-dumbbell"],
        createdAt: null,
        updatedAt: null,
      },
    ];
    const { findByTestId, getByText } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gyms-create"));
    fireEvent.changeText(await findByTestId("saved-gym-new-name"), "garage");
    fireEvent.press(await findByTestId("saved-gym-new-equip-eq-barbell"));
    fireEvent.press(await findByTestId("saved-gym-new-save"));

    // A duplicate is as likely creating as renaming, and as recoverable — the
    // card has to stay open with the typed value so the name can be adjusted.
    await waitFor(() => getByText("You already have a gym with that name."));
    await findByTestId("saved-gym-new-editor");
    expect(api.savedGyms).toHaveLength(1);
  });

  /**
   * ⚠ The create dead end. `EquipmentChipGrid` renders nothing for empty groups
   * and the save button is disabled at zero selected, so an empty equipment
   * catalogue gave a name field, no chips and a permanently greyed "Create gym"
   * with nothing explaining why. Unreachable before creation existed — an
   * existing gym always opens with its kit pre-selected — and now the primary CTA
   * of the tab a new account lands on.
   */
  it("explains itself when the equipment catalogue could not be loaded", async () => {
    const api = new InMemoryApiAdapter();
    api.savedGyms = [];
    const { findByTestId } = renderScreen(api, []);

    fireEvent.press(await findByTestId("saved-gyms-create"));
    await findByTestId("saved-gym-new-equip-empty");
    const save = await findByTestId("saved-gym-new-save");
    expect(save.props.accessibilityState.disabled).toBe(true);
  });

  it("actually reissues the equipment fetch from the failure copy", async () => {
    const api = new InMemoryApiAdapter();
    api.savedGyms = [];
    const refresh = jest.spyOn(api, "getReferenceList");
    const { findByTestId } = renderScreen(api, []);

    fireEvent.press(await findByTestId("saved-gyms-create"));
    await findByTestId("saved-gym-new-equip-empty");
    const before = refresh.mock.calls.length;

    // ⚠ `useReferenceLists` latches its auto-refresh per mount, so before this
    // button the copy said "try again" with nothing that could — reopening the
    // editor showed the same message and issued no request.
    fireEvent.press(await findByTestId("saved-gym-new-equip-retry"));
    await waitFor(() =>
      expect(refresh.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it("hides the create button while an existing gym is being edited", async () => {
    const api = new InMemoryApiAdapter();
    seedGym(api);
    const { findByTestId, queryByTestId } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-edit"));
    // Left visible, tapping it during an in-flight save swapped `editing` for a
    // fresh draft that the settling save then wrote into — wiping what had been
    // typed, or captioning the new card with the OTHER gym's 409.
    expect(queryByTestId("saved-gyms-create")).toBeNull();
  });

  it("offers the create button again once the draft is cancelled", async () => {
    const api = new InMemoryApiAdapter();
    api.savedGyms = [];
    const { findByTestId, queryByTestId } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gyms-create"));
    expect(queryByTestId("saved-gyms-create")).toBeNull();

    fireEvent.press(await findByTestId("saved-gym-new-cancel"));
    await findByTestId("saved-gyms-create");
    expect(queryByTestId("saved-gym-new-editor")).toBeNull();
  });

  it("no longer renders a back button — it is hub body content, not a screen", async () => {
    const api = new InMemoryApiAdapter();
    const { findByTestId, queryByTestId } = renderScreen(api);
    await findByTestId("saved-gyms");
    // `TrainHubContainer` owns the chrome and has already applied `insets.top`.
    expect(queryByTestId("saved-gyms-back")).toBeNull();
    expect(mockRouterBack).not.toHaveBeenCalled();
  });
});

describe("summariseKit", () => {
  const names = new Map([
    ["eq-1", "Dumbbells"],
    ["eq-2", "Barbell"],
    ["eq-3", "Cable"],
    ["eq-4", "Bench"],
  ]);

  it("lists up to three names", () => {
    expect(summariseKit(["eq-1", "eq-2"], names)).toBe("Dumbbells · Barbell");
  });

  it("summarises the tail beyond three", () => {
    // A commercial gym has 24 items; listing them would push the row to six
    // lines and tell the user nothing extra.
    expect(summariseKit(["eq-1", "eq-2", "eq-3", "eq-4"], names)).toBe(
      "Dumbbells · Barbell · Cable +1 more",
    );
  });

  it("falls back to a COUNT when no name resolves (reference cache not loaded)", () => {
    expect(summariseKit(["eq-x", "eq-y"], names)).toBe("2 items");
    expect(summariseKit(["eq-x"], names)).toBe("1 item");
  });

  it("reports zero items rather than an empty line", () => {
    expect(summariseKit([], names)).toBe("0 items");
  });
});
