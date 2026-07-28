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
    payments: {} as Adapters["payments"],
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

  it("shows an empty state that says how gyms get created", async () => {
    const api = new InMemoryApiAdapter();
    const { findByTestId } = renderScreen(api);
    expect(await findByTestId("saved-gyms-empty")).toBeTruthy();
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
    const { findByTestId } = renderScreen(api);

    fireEvent.press(await findByTestId("saved-gym-gym-1-delete"));
    fireEvent.press(await findByTestId("saved-gym-gym-1-delete-confirm"));

    // Hiding it permanently would show a gym they still have as gone — and the
    // next refresh would resurrect it anyway.
    expect(await findByTestId("saved-gym-gym-1")).toBeTruthy();
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

  it("goes back", async () => {
    const api = new InMemoryApiAdapter();
    const { findByTestId } = renderScreen(api);
    fireEvent.press(await findByTestId("saved-gyms-back"));
    expect(mockRouterBack).toHaveBeenCalled();
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
