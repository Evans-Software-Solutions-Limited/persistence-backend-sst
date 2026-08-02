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

  it("never sends a term the box no longer starts with", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [],
      others: [candidate({ id: "ex-1", name: "Dumbbell Bench Press" })],
      meta: { truncated: false },
    };
    const spy = jest.spyOn(api, "getExerciseSubstitutes");
    const { findByTestId } = renderSheet(api);
    const input = await findByTestId("swap-sheet-search");

    fireEvent.changeText(input, "bench");
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "bench" }),
      ),
    );

    // Cleared, then retyped inside the debounce window. `useDebouncedValue`
    // still holds "bench", so anything that only special-cases the empty box
    // hands the deleted term straight back.
    fireEvent.changeText(input, "");
    fireEvent.changeText(input, "s");

    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "s" }),
      ),
    );
    const sentTerms = spy.mock.calls.map((call) => call[0].search);
    expect(sentTerms.slice(sentTerms.indexOf("bench") + 1)).not.toContain(
      "bench",
    );
  });

  it("does not fire a broad refetch on every backspace", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [],
      others: [candidate({ id: "ex-1", name: "Dumbbell Bench Press" })],
      meta: { truncated: false },
    };
    const spy = jest.spyOn(api, "getExerciseSubstitutes");
    const { findByTestId } = renderSheet(api);
    const input = await findByTestId("swap-sheet-search");

    fireEvent.changeText(input, "bench");
    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "bench" }),
      ),
    );
    const afterSettled = spy.mock.calls.length;

    // Backspacing makes the box a PREFIX of the settled term for 250 ms. Falling
    // to "" there issues an un-debounced `limit: 400` fetch of both pools per
    // keystroke — discarded when the new term settles, and if one lands inside
    // the window it repaints with the broad pool, which the client filter can
    // then empty. The settled term is a subset of what the shorter box wants, so
    // holding it under-returns briefly and never mis-returns.
    fireEvent.changeText(input, "benc");
    expect(spy.mock.calls.length).toBe(afterSettled);

    await waitFor(() =>
      expect(spy).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "benc" }),
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

  /**
   * The early return fetches nothing, so nothing downstream overwrites what the
   * previous open left behind. Both of these render on an OPEN sheet.
   */
  describe("reopening for a source it cannot rank", () => {
    const show = (
      rerender: (ui: React.ReactElement) => void,
      api: InMemoryApiAdapter,
      visible: boolean,
      forExerciseId: string | null,
    ) =>
      rerender(
        <AdapterProvider adapters={makeAdapters(api)}>
          <EquipmentAwareSwapSheet
            visible={visible}
            onClose={jest.fn()}
            forExerciseId={forExerciseId}
            exerciseName="Cable Fly"
            onSelect={jest.fn()}
          />
        </AdapterProvider>,
      );

    it("does NOT blank the list on the close path — the sheet is still on screen", async () => {
      const api = new InMemoryApiAdapter();
      api.substitutes = {
        best: [],
        others: [candidate({ id: "ex-bench", name: "Bench Press" })],
        meta: { truncated: false },
      };
      const { findByTestId, queryByTestId, rerender } = renderSheet(api, {
        forExerciseId: "ex-source",
      });
      await findByTestId("swap-others-ex-bench");

      // `BottomSheet` keeps its children mounted through the slide-down, so
      // clearing here would replace the row the user just tapped with "No
      // alternatives found for this exercise." for the length of the dismiss.
      show(rerender, api, false, "ex-source");

      expect(queryByTestId("swap-others-ex-bench")).not.toBeNull();
      expect(queryByTestId("swap-sheet-empty")).toBeNull();
    });

    it("does NOT wipe the search box or the override panel on the way out", async () => {
      const api = new InMemoryApiAdapter();
      api.substitutes = {
        best: [],
        others: [
          candidate({ id: "ex-bench", name: "Bench Press" }),
          candidate({ id: "ex-fly", name: "Cable Fly" }),
        ],
        meta: { truncated: false },
      };
      const { findByTestId, queryByTestId, rerender } = renderSheet(api, {
        forExerciseId: "ex-source",
      });
      fireEvent.changeText(await findByTestId("swap-sheet-search"), "bench");
      await waitFor(() =>
        expect(queryByTestId("swap-others-ex-fly")).toBeNull(),
      );

      show(rerender, api, false, "ex-source");

      // Clearing on the close edge visibly empties the field and re-expands the
      // list as the sheet slides away.
      expect(queryByTestId("swap-others-ex-fly")).toBeNull();
    });

    it("DOES reset the search when it opens again", async () => {
      const api = new InMemoryApiAdapter();
      api.substitutes = {
        best: [],
        others: [
          candidate({ id: "ex-bench", name: "Bench Press" }),
          candidate({ id: "ex-fly", name: "Cable Fly" }),
        ],
        meta: { truncated: false },
      };
      const { findByTestId, queryByTestId, rerender } = renderSheet(api, {
        forExerciseId: "ex-source",
      });
      fireEvent.changeText(await findByTestId("swap-sheet-search"), "bench");
      await waitFor(() =>
        expect(queryByTestId("swap-others-ex-fly")).toBeNull(),
      );

      show(rerender, api, false, "ex-source");
      show(rerender, api, true, "ex-source");

      // The reset moved to the open edge; it must still happen.
      expect(await findByTestId("swap-others-ex-fly")).toBeTruthy();
    });

    it("does not send the previous open's search term on reopening", async () => {
      const api = new InMemoryApiAdapter();
      api.substitutes = {
        best: [],
        others: [candidate({ id: "ex-bench", name: "Bench Press" })],
        meta: { truncated: false },
      };
      const { findByTestId, rerender } = renderSheet(api, {
        forExerciseId: "ex-source",
      });
      fireEvent.changeText(await findByTestId("swap-sheet-search"), "bench");
      const spy = jest.spyOn(api, "getExerciseSubstitutes");
      await waitFor(() =>
        expect(spy).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: "bench" }),
        ),
      );

      show(rerender, api, false, "ex-source");
      show(rerender, api, true, "ex-source");

      // Resetting `query` in a sibling EFFECT would let one request go out under
      // the previous open's term before the re-render corrected it; the debounce
      // would then hold "bench" for another 250 ms on top.
      await waitFor(() =>
        expect(
          spy.mock.calls[spy.mock.calls.length - 1]?.[0],
        ).not.toHaveProperty("search"),
      );
    });

    it("does NOT flip to the empty state when a dismiss beats the response", async () => {
      const api = new InMemoryApiAdapter();
      jest
        .spyOn(api, "getExerciseSubstitutes")
        .mockReturnValue(new Promise(() => {}));
      const { findByTestId, queryByTestId, rerender } = renderSheet(api, {
        forExerciseId: "ex-source",
      });
      await findByTestId("swap-sheet-loading");

      // Clearing `isLoading` alone reaches the same bad frame from the other
      // side: `result` is still EMPTY_RESULT and `error` is null, so `isEmpty`
      // goes true the moment the spinner goes — mid-slide-down.
      show(rerender, api, false, "ex-source");

      expect(queryByTestId("swap-sheet-empty")).toBeNull();
    });

    it("does not leave the previous row's candidates on screen", async () => {
      const api = new InMemoryApiAdapter();
      api.substitutes = {
        best: [],
        others: [candidate({ id: "ex-bench", name: "Bench Press" })],
        meta: { truncated: false },
      };
      const { findByTestId, queryByTestId, rerender } = renderSheet(api, {
        forExerciseId: "ex-source",
      });
      await findByTestId("swap-others-ex-bench");

      show(rerender, api, false, "ex-source");
      show(rerender, api, true, null);

      // Otherwise: a bench press's alternatives, under the eyebrow "CABLE FLY".
      expect(await findByTestId("swap-sheet-empty")).toBeTruthy();
      expect(queryByTestId("swap-others-ex-bench")).toBeNull();
    });

    it("does not leave a stale network error on screen", async () => {
      const api = new InMemoryApiAdapter();
      jest
        .spyOn(api, "getExerciseSubstitutes")
        .mockResolvedValue(
          fail({ kind: "api", code: "network", message: "offline" }),
        );
      const { findByTestId, queryByTestId, rerender } = renderSheet(api, {
        forExerciseId: "ex-source",
      });
      await findByTestId("swap-sheet-error");

      show(rerender, api, false, "ex-source");
      show(rerender, api, true, null);

      // "Check your connection" for a row nothing was ever asked about is the
      // exact message that nulling an unsynced source id exists to stop.
      expect(await findByTestId("swap-sheet-empty")).toBeTruthy();
      expect(queryByTestId("swap-sheet-error")).toBeNull();
    });
  });

  /**
   * The pool is fetched at 400 (`ADAPTATION_CANDIDATE_CAP`, which
   * `exerciseRepository` records 28 of E2's 80 fixture pools hitting), and the
   * groups render in a plain `ScrollView` with no windowing at ~8 native views
   * a row. Rendering both pools eagerly is ~800 rows on a sheet that opens
   * mid-workout.
   */
  it("mounts at most 50 rows per group, and says the rest are there", async () => {
    const api = new InMemoryApiAdapter();
    const many = (prefix: string) =>
      Array.from({ length: 120 }, (_, i) =>
        candidate({ id: `${prefix}-${i}`, name: `${prefix} ${i}` }),
      );
    api.substitutes = {
      best: many("best"),
      others: many("other"),
      // The SERVER did not truncate; this ceiling did. The note must still
      // appear, or the rows it is hiding are hidden silently.
      meta: { truncated: false },
    };

    const { findByTestId, queryByTestId } = renderSheet(api, {
      equipmentTypeIds: ["eq-dumbbell"],
    });
    await findByTestId("swap-best-best-0");

    expect(queryByTestId("swap-best-best-49")).not.toBeNull();
    expect(queryByTestId("swap-best-best-50")).toBeNull();
    expect(queryByTestId("swap-others-other-49")).not.toBeNull();
    expect(queryByTestId("swap-others-other-50")).toBeNull();
    expect(queryByTestId("swap-sheet-truncated")).not.toBeNull();
  });

  it("says nothing about more matches when a group lands on exactly the ceiling", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [],
      others: Array.from({ length: 50 }, (_, i) =>
        candidate({ id: `other-${i}`, name: `Other ${i}` }),
      ),
      meta: { truncated: false },
    };
    const { findByTestId, queryByTestId } = renderSheet(api);
    await findByTestId("swap-others-other-49");

    // Counting the SLICED length cannot tell "sliced from 120" from "matched
    // exactly 50", and promises rows that searching will never surface.
    expect(queryByTestId("swap-sheet-truncated")).toBeNull();
  });

  it("counts the local-only group toward the note — the search can't reach those rows", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = { best: [], others: [], meta: { truncated: false } };
    const { findByTestId, queryByTestId } = renderSheet(api, {
      localOnlyCandidates: Array.from({ length: 60 }, (_, i) =>
        candidate({ id: `local-${i}`, name: `Local ${i}`, matchedOn: [] }),
      ),
    });
    await findByTestId("swap-local-local-0");

    expect(queryByTestId("swap-local-local-49")).not.toBeNull();
    expect(queryByTestId("swap-local-local-50")).toBeNull();
    // These rows do not exist server-side, so nothing else would ever surface
    // number 51 — dropping them silently is the worst case of the three groups.
    expect(queryByTestId("swap-sheet-truncated")).not.toBeNull();
  });

  it("searches the whole fetched pool, not just the rows it mounted", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = {
      best: [],
      others: [
        ...Array.from({ length: 60 }, (_, i) =>
          candidate({ id: `filler-${i}`, name: `Filler ${i}` }),
        ),
        candidate({ id: "ex-deep", name: "Zercher Squat" }),
      ],
      meta: { truncated: false },
    };
    const { findByTestId, queryByTestId } = renderSheet(api);
    await findByTestId("swap-others-filler-0");
    // Ranked past the render ceiling, so it is not mounted yet.
    expect(queryByTestId("swap-others-ex-deep")).toBeNull();

    fireEvent.changeText(await findByTestId("swap-sheet-search"), "zercher");

    // Slicing before matching would make the search — and the note that tells
    // the user to use it — able to find nothing past row 50.
    expect(await findByTestId("swap-others-ex-deep")).toBeTruthy();
  });

  it("does not claim a match signal for a row nothing ranked", async () => {
    const api = new InMemoryApiAdapter();
    api.substitutes = { best: [], others: [], meta: { truncated: false } };
    const { findByTestId, getByText, queryByText } = renderSheet(api, {
      localOnlyCandidates: [
        candidate({ id: "local-abc", name: "Cable Fly", matchedOn: [] }),
      ],
    });
    await findByTestId("swap-local-local-abc");

    getByText("Not synced yet");
    // The ranked lists' fallback would assert a similarity nothing computed.
    expect(queryByText("A close match")).toBeNull();
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
