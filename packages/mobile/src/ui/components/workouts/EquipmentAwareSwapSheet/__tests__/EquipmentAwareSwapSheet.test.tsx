import { fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { SubstituteCandidate } from "@/domain/models/loadout";
import type { AuthSession } from "@/domain/ports/auth.port";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { EquipmentAwareSwapSheet } from "../EquipmentAwareSwapSheet";
import { renderWithTheme } from "../../../../../../__tests__/test-utils";

/**
 * Same convention as every other heavy container suite here (ProfileContainer,
 * ExerciseListContainer, SubscriptionSelectionContainer…): these mount the real
 * Tamagui provider, a React Query client and gorhom sheet machinery per case,
 * and run alongside 459 other suites on a contended CI runner, where jest's 5 s
 * default is the wrong budget for this shape. See
 * `LoadoutFlowContainer.test.tsx` for the measurement that prompted it.
 */
jest.setTimeout(20_000);

jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: jest.fn(), back: jest.fn() },
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

const candidate = (
  overrides: Partial<SubstituteCandidate> = {},
): SubstituteCandidate => ({
  id: "ex-1",
  name: "Dumbbell Bench Press",
  category: "strength",
  difficultyLevel: "intermediate",
  thumbnailUrl: null,
  equipmentRequired: [],
  matchedOn: ["primary_muscles"],
  ...overrides,
});

function makeAdapters(api: InMemoryApiAdapter): Adapters {
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
    storage: new InMemoryStorageAdapter(),
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function renderSheet(
  api: InMemoryApiAdapter,
  props: Partial<React.ComponentProps<typeof EquipmentAwareSwapSheet>> = {},
) {
  const onSelect = props.onSelect ?? jest.fn();
  const utils = renderWithTheme(
    <AdapterProvider adapters={makeAdapters(api)}>
      <EquipmentAwareSwapSheet
        visible
        onClose={jest.fn()}
        forExerciseId="ex-source"
        exerciseName="Machine Chest Press"
        {...props}
        onSelect={onSelect}
      />
    </AdapterProvider>,
  );
  return { ...utils, onSelect };
}

describe("EquipmentAwareSwapSheet", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("with a kit context — `others` IS the incompatible list", () => {
    const KIT = ["eq-dumbbell"];

    function seed(api: InMemoryApiAdapter) {
      api.substitutes = {
        best: [candidate({ id: "ex-ok", name: "Dumbbell Press" })],
        others: [
          candidate({
            id: "ex-bad",
            name: "Barbell Bench Press",
            equipmentRequired: ["eq-barbell"],
          }),
        ],
        meta: { truncated: false },
      };
    }

    it("sends the kit and renders both lists under distinct headings", async () => {
      const api = new InMemoryApiAdapter();
      seed(api);
      const spy = jest.spyOn(api, "getExerciseSubstitutes");

      const { findByTestId, getByText } = renderSheet(api, {
        equipmentTypeIds: KIT,
      });

      expect(await findByTestId("swap-best-ex-ok")).toBeTruthy();
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ equipment: KIT }),
      );
      getByText("BEST MATCHES");
      getByText("DOESN'T FIT YOUR KIT");
    });

    it("selects a compatible row immediately, with isUserOverride FALSE", async () => {
      const api = new InMemoryApiAdapter();
      seed(api);
      const { findByTestId, onSelect } = renderSheet(api, {
        equipmentTypeIds: KIT,
      });

      fireEvent.press(await findByTestId("swap-best-ex-ok"));
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ex-ok" }),
        false,
      );
    });

    it("does NOT select an incompatible row on the first tap — it asks first", async () => {
      const api = new InMemoryApiAdapter();
      seed(api);
      const { findByTestId, onSelect } = renderSheet(api, {
        equipmentTypeIds: KIT,
      });

      fireEvent.press(await findByTestId("swap-others-ex-bad"));

      expect(await findByTestId("swap-sheet-override-confirm")).toBeTruthy();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("confirming the acknowledgement selects with isUserOverride TRUE", async () => {
      const api = new InMemoryApiAdapter();
      seed(api);
      const { findByTestId, onSelect } = renderSheet(api, {
        equipmentTypeIds: KIT,
      });

      fireEvent.press(await findByTestId("swap-others-ex-bad"));
      fireEvent.press(await findByTestId("swap-sheet-override-confirm-accept"));

      // ⚠ THE flag the save path keys on. Without it the whole reviewed
      // adaptation is rejected 400 EQUIPMENT_NOT_AVAILABLE.
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ex-bad" }),
        true,
      );
    });

    it("cancelling the acknowledgement selects nothing and returns to the list", async () => {
      const api = new InMemoryApiAdapter();
      seed(api);
      const { findByTestId, onSelect, queryByTestId } = renderSheet(api, {
        equipmentTypeIds: KIT,
      });

      fireEvent.press(await findByTestId("swap-others-ex-bad"));
      fireEvent.press(await findByTestId("swap-sheet-override-confirm-cancel"));

      expect(onSelect).not.toHaveBeenCalled();
      expect(queryByTestId("swap-sheet-override-confirm")).toBeNull();
      expect(await findByTestId("swap-best-ex-ok")).toBeTruthy();
    });

    it("names the MISSING equipment in the acknowledgement when it can resolve it", async () => {
      const api = new InMemoryApiAdapter();
      seed(api);
      const { findByTestId, getByText } = renderSheet(api, {
        equipmentTypeIds: KIT,
        equipmentNameById: new Map([
          ["eq-barbell", "Barbell"],
          ["eq-dumbbell", "Dumbbells"],
        ]),
      });

      fireEvent.press(await findByTestId("swap-others-ex-bad"));
      // Only the equipment the user LACKS — listing kit they already own would
      // make the sentence false.
      getByText("This needs Barbell, which isn't in the kit you picked.");
    });

    it("lists ONLY the equipment the user lacks, not the whole requirement", async () => {
      const api = new InMemoryApiAdapter();
      api.substitutes = {
        best: [],
        others: [
          candidate({
            id: "ex-mixed",
            name: "Barbell Floor Press",
            // Needs one thing they HAVE and one they don't.
            equipmentRequired: ["eq-dumbbell", "eq-barbell"],
          }),
        ],
        meta: { truncated: false },
      };
      const { findByTestId, getByText } = renderSheet(api, {
        equipmentTypeIds: KIT,
        equipmentNameById: new Map([
          ["eq-barbell", "Barbell"],
          ["eq-dumbbell", "Dumbbells"],
        ]),
      });

      fireEvent.press(await findByTestId("swap-others-ex-mixed"));
      // Naming "Dumbbells" here would tell the user they lack kit they picked.
      getByText("This needs Barbell, which isn't in the kit you picked.");
    });

    it("falls back to a vaguer sentence when no missing name resolves", async () => {
      const api = new InMemoryApiAdapter();
      seed(api);
      const { findByTestId, getByText } = renderSheet(api, {
        equipmentTypeIds: KIT,
        // A uuid in a sentence is worse than a vaguer sentence.
        equipmentNameById: new Map(),
      });

      fireEvent.press(await findByTestId("swap-others-ex-bad"));
      getByText("This one doesn't fit the kit you picked.");
    });
  });

  describe("with NO kit context — `others` is just the library", () => {
    it("omits `equipment`, dims nothing, and selects in one tap", async () => {
      const api = new InMemoryApiAdapter();
      api.substitutes = {
        best: [],
        others: [candidate({ id: "ex-lib", name: "Push-Up" })],
        meta: { truncated: false },
      };
      const spy = jest.spyOn(api, "getExerciseSubstitutes");

      const { findByTestId, getByText, onSelect } = renderSheet(api);

      fireEvent.press(await findByTestId("swap-others-ex-lib"));

      expect(spy.mock.calls[0]?.[0]).not.toHaveProperty("equipment");
      getByText("MATCHES");
      // No acknowledgement: nothing was checked, so nothing may be CLAIMED
      // incompatible.
      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ex-lib" }),
        false,
      );
    });

    it("treats an EMPTY kit array as no context, matching the server", async () => {
      const api = new InMemoryApiAdapter();
      api.substitutes = {
        best: [],
        others: [candidate({ id: "ex-lib", name: "Push-Up" })],
        meta: { truncated: false },
      };
      const spy = jest.spyOn(api, "getExerciseSubstitutes");

      const { findByTestId, getByText, onSelect } = renderSheet(api, {
        equipmentTypeIds: [],
      });

      fireEvent.press(await findByTestId("swap-others-ex-lib"));

      expect(spy.mock.calls[0]?.[0]).not.toHaveProperty("equipment");
      getByText("MATCHES");
      expect(onSelect).toHaveBeenCalledWith(expect.anything(), false);
    });
  });

  it("renders a reason line per row from the ranker's signals", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [],
      others: [
        candidate({
          id: "ex-1",
          matchedOn: ["primary_muscles", "logged_before"],
        }),
      ],
      meta: { truncated: false },
    };
    const { findByTestId, getByText } = renderSheet(api);
    await findByTestId("swap-others-ex-1");
    getByText("same primary muscles and you've trained it before");
  });

  it("falls back to a neutral reason when the row matched on nothing", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [],
      others: [candidate({ id: "ex-1", matchedOn: [] })],
      meta: { truncated: false },
    };
    const { findByTestId, getByText } = renderSheet(api);
    await findByTestId("swap-others-ex-1");
    getByText("A close match");
  });

  it("filters immediately and sends the tokenised name search to the server", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [],
      others: [
        candidate({ id: "ex-1", name: "Dumbbell Bench Press" }),
        candidate({ id: "ex-2", name: "Cable Fly" }),
      ],
      meta: { truncated: false },
    };
    const spy = jest.spyOn(api, "getExerciseSubstitutes");
    const { findByTestId, queryByTestId } = renderSheet(api);
    await findByTestId("swap-others-ex-1");

    fireEvent.changeText(
      await findByTestId("swap-sheet-search"),
      "press-bench",
    );

    await waitFor(() => expect(queryByTestId("swap-others-ex-2")).toBeNull());
    expect(queryByTestId("swap-others-ex-1")).not.toBeNull();
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "press-bench" }),
      ),
    );
  });

  it("says so when a search matches nothing, distinctly from an empty feed", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [],
      others: [candidate({ id: "ex-1", name: "Cable Fly" })],
      meta: { truncated: false },
    };
    const { findByTestId, getByText } = renderSheet(api);
    await findByTestId("swap-others-ex-1");

    fireEvent.changeText(await findByTestId("swap-sheet-search"), "zzz");
    await waitFor(() => getByText("No matches with that name."));
  });

  it("renders an empty state when the endpoint returns nothing", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = { best: [], others: [], meta: { truncated: false } };
    const { findByTestId } = renderSheet(api);
    expect(await findByTestId("swap-sheet-empty")).toBeTruthy();
  });

  it("surfaces a failed fetch instead of an empty list", async () => {
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getExerciseSubstitutes")
      .mockResolvedValue(
        fail({ kind: "api", code: "network", message: "offline" }),
      );
    const { findByTestId, queryByTestId } = renderSheet(api);
    expect(await findByTestId("swap-sheet-error")).toBeTruthy();
    // "No alternatives found" would blame the library for a network failure.
    expect(queryByTestId("swap-sheet-empty")).toBeNull();
  });

  it("says the list was capped when the server truncated it", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [],
      others: [candidate({ id: "ex-1" })],
      meta: { truncated: true },
    };
    const { findByTestId } = renderSheet(api);
    expect(await findByTestId("swap-sheet-truncated")).toBeTruthy();
  });

  it("hides the Create affordance when no handler is supplied (the Loadout case)", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [],
      others: [candidate({ id: "ex-1" })],
      meta: { truncated: false },
    };
    const { findByTestId, queryByTestId } = renderSheet(api);
    await findByTestId("swap-others-ex-1");
    expect(queryByTestId("swap-sheet-create")).toBeNull();
  });

  it("does not fetch when there is no source exercise to rank against", async () => {
    const api = new InMemoryApiAdapter();
    const spy = jest.spyOn(api, "getExerciseSubstitutes");
    renderSheet(api, { forExerciseId: null });
    await waitFor(() => expect(spy).not.toHaveBeenCalled());
  });

  it("re-fetches when the kit changes, and clears the previous row's list", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [candidate({ id: "ex-a", name: "A" })],
      others: [],
      meta: { truncated: false },
    };
    const spy = jest.spyOn(api, "getExerciseSubstitutes");
    const { findByTestId, rerender } = renderSheet(api, {
      equipmentTypeIds: ["eq-1"],
    });
    await findByTestId("swap-best-ex-a");

    rerender(
      <AdapterProvider adapters={makeAdapters(api)}>
        <EquipmentAwareSwapSheet
          visible
          onClose={jest.fn()}
          forExerciseId="ex-source"
          exerciseName="Machine Chest Press"
          equipmentTypeIds={["eq-1", "eq-2"]}
          onSelect={jest.fn()}
        />
      </AdapterProvider>,
    );

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
  });

  it("does NOT re-fetch when the caller hands over an equal array by identity", async () => {
    // The Loadout review step rebuilds its context object every render; refetching
    // on each would put the sheet in a permanent loading state.
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [candidate({ id: "ex-a", name: "A" })],
      others: [],
      meta: { truncated: false },
    };
    const spy = jest.spyOn(api, "getExerciseSubstitutes");
    const { findByTestId, rerender } = renderSheet(api, {
      equipmentTypeIds: ["eq-1"],
    });
    await findByTestId("swap-best-ex-a");

    rerender(
      <AdapterProvider adapters={makeAdapters(api)}>
        <EquipmentAwareSwapSheet
          visible
          onClose={jest.fn()}
          forExerciseId="ex-source"
          exerciseName="Machine Chest Press"
          equipmentTypeIds={["eq-1"]}
          onSelect={jest.fn()}
        />
      </AdapterProvider>,
    );

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });

  it("clears the previous row's candidates while the next request is in flight", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [],
      others: [candidate({ id: "ex-first", name: "First" })],
      meta: { truncated: false },
    };
    const { findByTestId, queryByTestId, rerender } = renderSheet(api, {
      forExerciseId: "ex-a",
    });
    await findByTestId("swap-others-ex-first");

    // The next row's request never resolves, so anything still on screen is
    // left over from the PREVIOUS row — every entry a plausible wrong answer
    // rendered under a different exercise's name.
    jest
      .spyOn(api, "getExerciseSubstitutes")
      .mockReturnValue(new Promise(() => {}));

    rerender(
      <AdapterProvider adapters={makeAdapters(api)}>
        <EquipmentAwareSwapSheet
          visible
          onClose={jest.fn()}
          forExerciseId="ex-b"
          exerciseName="Another Exercise"
          onSelect={jest.fn()}
        />
      </AdapterProvider>,
    );

    await waitFor(() =>
      expect(queryByTestId("swap-others-ex-first")).toBeNull(),
    );
    expect(await findByTestId("swap-sheet-loading")).toBeTruthy();
  });

  it("KEEPS the current rows while a search-term refetch is in flight", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [],
      others: [candidate({ id: "ex-first", name: "Bench Press" })],
      meta: { truncated: false },
    };
    const { findByTestId, queryByTestId } = renderSheet(api);
    await findByTestId("swap-others-ex-first");

    // Same row, same kit — only the search term moved. Unlike the row change
    // above, these rows are still the RIGHT row's, and the client-side filter
    // has already narrowed them. Blanking them for the round trip is the exact
    // flicker that filtering immediately over the current response avoids.
    jest
      .spyOn(api, "getExerciseSubstitutes")
      .mockReturnValue(new Promise(() => {}));

    fireEvent.changeText(await findByTestId("swap-sheet-search"), "bench");

    await waitFor(() =>
      expect(queryByTestId("swap-sheet-loading")).not.toBeNull(),
    );
    expect(queryByTestId("swap-others-ex-first")).not.toBeNull();
  });

  it("clears the loading flag when it closes mid-request, so a later sourceless open is not stuck", async () => {
    const api = new InMemoryApiAdapter();
    // Never settles: `.finally` is gated on `!cancelled`, so closing the sheet
    // leaves nothing to turn the flag off.
    jest
      .spyOn(api, "getExerciseSubstitutes")
      .mockReturnValue(new Promise(() => {}));
    const { findByTestId, queryByTestId, rerender } = renderSheet(api, {
      forExerciseId: "ex-a",
    });
    await findByTestId("swap-sheet-loading");

    const show = (visible: boolean, forExerciseId: string | null) =>
      rerender(
        <AdapterProvider adapters={makeAdapters(api)}>
          <EquipmentAwareSwapSheet
            visible={visible}
            onClose={jest.fn()}
            forExerciseId={forExerciseId}
            exerciseName="Machine Chest Press"
            onSelect={jest.fn()}
          />
        </AdapterProvider>,
      );

    show(false, "ex-a");
    // Reopened for a row the sheet cannot rank — the source has fallen out of
    // the session, or it has not synced yet. This open takes the early return,
    // so nothing else would ever clear the flag.
    show(true, null);

    expect(await findByTestId("swap-sheet-empty")).toBeTruthy();
    expect(queryByTestId("swap-sheet-loading")).toBeNull();
  });

  it("shows a caller-owned unavailable message", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [],
      others: [candidate({ id: "ex-1" })],
      meta: { truncated: false },
    };
    const { findByTestId, getByText } = renderSheet(api, {
      unavailableMessage: "That exercise isn't available on this device yet.",
    });
    await findByTestId("swap-sheet-unavailable");
    getByText("That exercise isn't available on this device yet.");
  });
});
