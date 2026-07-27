import { act, fireEvent, waitFor } from "@testing-library/react-native";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type {
  LoadoutPreview,
  LoadoutPreviewRow,
  SubstitutionReason,
} from "@/domain/models/loadout";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { ReferenceEntry } from "@/domain/models/reference-list";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { useLoadoutFlow } from "@/state/loadout-flow";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  LoadoutFlowContainer,
  buildRowTags,
  classifyAdaptingError,
} from "@/ui/containers/LoadoutFlowContainer";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    back: jest.fn(),
  },
  useRouter: () => ({ push: mockRouterPush, back: jest.fn() }),
}));

jest.mock("expo-camera", () => ({
  __esModule: true,
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

// ── Fixtures ────────────────────────────────────────────────────────────────

const reason = (
  overrides: Partial<SubstitutionReason> = {},
): SubstitutionReason => ({
  code: "kept_compatible",
  missingEquipment: [],
  matchedOn: [],
  flags: [],
  note: null,
  selectedBy: null,
  ...overrides,
});

const row = (
  overrides: Partial<LoadoutPreviewRow> = {},
): LoadoutPreviewRow => ({
  sortOrder: 1,
  status: "kept",
  exerciseId: "ex-1",
  substitutedFromExerciseId: null,
  reason: reason(),
  exercise: {
    id: "ex-1",
    name: "Dumbbell Bench Press",
    category: "strength",
    difficultyLevel: "intermediate",
    thumbnailUrl: null,
    equipmentRequired: [],
  },
  supersetGroup: null,
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 10,
  targetDurationSeconds: null,
  restSeconds: 90,
  notes: null,
  ...overrides,
});

const preview = (rows: LoadoutPreviewRow[]): LoadoutPreview => ({
  workoutId: "w-1",
  parentName: "Upper Body",
  savedGymId: null,
  equipmentTypeIds: ["eq-dumbbell"],
  rows,
  meta: {
    keptCount: rows.filter((r) => r.status === "kept").length,
    swappedCount: rows.filter((r) => r.status === "swapped").length,
    unresolvedCount: rows.filter((r) => r.status === "unresolved").length,
    intensityMismatchCount: 0,
    candidateCount: 10,
    candidatePoolTruncated: false,
    modelId: "haiku",
  },
});

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
  {
    id: "eq-cable",
    name: "cable",
    displayName: "Cable station",
    category: "cables",
  },
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
    // Real double: the collect step HIDES the scan when offline (AC-2.1/2.2 are
    // the floor), so `useOnlineStatus` is load-bearing on this screen.
    netInfo: new InMemoryNetInfoAdapter(),
  };
}

function renderFlow(api: InMemoryApiAdapter, storage: InMemoryStorageAdapter) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return renderWithTheme(
    <QueryClientProvider client={queryClient}>
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <LoadoutFlowContainer />
      </AdapterProvider>
    </QueryClientProvider>,
  );
}

function seedEquipment(storage: InMemoryStorageAdapter) {
  storage.cacheReferenceList("equipment", EQUIPMENT);
  storage.cacheReferenceList("muscle_groups", []);
  storage.cacheReferenceList("categories", []);
}

function openFlow(workoutName = "Upper Body") {
  useLoadoutFlow.getState().open("w-1", workoutName);
}

describe("LoadoutFlowContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useLoadoutFlow.setState({ rev: 0 });
    useLoadoutFlow.getState().reset();
  });

  it("renders nothing at all until the flow is opened", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const { queryByTestId } = renderFlow(api, storage);
    expect(queryByTestId("loadout-flow")).toBeNull();
  });

  describe("collect", () => {
    it("lists saved gyms alongside the scan and the picker", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      api.savedGyms = [
        {
          id: "gym-1",
          name: "Hotel gym",
          equipmentTypeIds: ["eq-dumbbell", "eq-cable"],
          createdAt: null,
          updatedAt: null,
        },
      ];
      const { findByTestId } = renderFlow(api, storage);
      openFlow();

      expect(await findByTestId("loadout-collect-scan")).toBeTruthy();
      expect(await findByTestId("loadout-collect-manual")).toBeTruthy();
      expect(await findByTestId("loadout-collect-gym-gym-1")).toBeTruthy();
    });

    it("picking a saved gym previews with savedGymId ONLY — never both sources", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      api.savedGyms = [
        {
          id: "gym-1",
          name: "Hotel gym",
          equipmentTypeIds: ["eq-dumbbell"],
          createdAt: null,
          updatedAt: null,
        },
      ];
      api.loadoutPreview = preview([row()]);
      const { findByTestId } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-gym-gym-1"));

      await findByTestId("loadout-review");
      // Sending both — or neither — is a 400 the server cannot recover from.
      expect(api.previewLoadoutCalls).toEqual([
        { workoutId: "w-1", input: { savedGymId: "gym-1" } },
      ]);
    });
  });

  describe("manual picker", () => {
    it("groups chips from the API's category, not a hardcoded list", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      const { findByTestId, getByText } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-manual"));
      await findByTestId("loadout-manual");

      getByText("FREE WEIGHTS");
      getByText("CABLES");
      expect(await findByTestId("loadout-equip-eq-dumbbell")).toBeTruthy();
    });

    it("keeps Adapt disabled until something is selected", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      api.loadoutPreview = preview([row()]);
      const { findByTestId, queryByTestId } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-manual"));
      const cta = await findByTestId("loadout-manual-adapt");
      expect(cta.props.accessibilityState.disabled).toBe(true);

      fireEvent.press(cta);
      // An empty kit would make every loadable row unresolved — a review screen
      // of holes.
      expect(queryByTestId("loadout-adapting")).toBeNull();
      expect(api.previewLoadoutCalls).toHaveLength(0);
    });

    it("previews with equipmentTypeIds ONLY once a chip is ticked", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      api.loadoutPreview = preview([row()]);
      const { findByTestId } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-manual"));
      fireEvent.press(await findByTestId("loadout-equip-eq-dumbbell"));
      fireEvent.press(await findByTestId("loadout-manual-adapt"));

      await findByTestId("loadout-review");
      expect(api.previewLoadoutCalls).toEqual([
        { workoutId: "w-1", input: { equipmentTypeIds: ["eq-dumbbell"] } },
      ]);
    });

    it("refreshes the equipment list when the cache predates `category`", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      // ⚠ Every list is seeded NON-EMPTY and fresh, so `useReferenceLists`' own
      // 24h staleness refresh cannot fire. That isolates the grouping check as
      // the only thing that can trigger a fetch — otherwise this test passes on
      // the empty-cache refresh and proves nothing.
      storage.cacheReferenceList("equipment", [
        // A pre-Loadout cache row: no `category` KEY at all. Indistinguishable
        // from "uncategorised" unless the absence is checked — and every chip
        // would sit under "Other" for up to 24h with nothing able to say why.
        { id: "eq-dumbbell", name: "dumbbells", displayName: "Dumbbells" },
      ]);
      storage.cacheReferenceList("muscle_groups", [
        { id: "mg-1", name: "chest", displayName: "Chest" },
      ]);
      storage.cacheReferenceList("categories", [
        { id: "cat-1", name: "strength", displayName: "Strength" },
      ]);
      const spy = jest
        .spyOn(api, "getReferenceList")
        .mockResolvedValue(ok(EQUIPMENT));

      renderFlow(api, storage);
      openFlow();

      await waitFor(() => expect(spy).toHaveBeenCalled());
      expect(spy.mock.calls.map((call) => call[0])).toContain("equipment");
    });

    it("does NOT refresh when the cached list is already categorised", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      storage.cacheReferenceList("muscle_groups", [
        { id: "mg-1", name: "chest", displayName: "Chest" },
      ]);
      storage.cacheReferenceList("categories", [
        { id: "cat-1", name: "strength", displayName: "Strength" },
      ]);
      const spy = jest.spyOn(api, "getReferenceList");

      const { findByTestId } = renderFlow(api, storage);
      openFlow();
      await findByTestId("loadout-collect-manual");

      // A `category: null` row is the server saying "uncategorised" — that is an
      // ANSWER, not a stale cache, and refetching on it would churn every open.
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe("adapting", () => {
    it("stays on the skeleton until the REQUEST resolves — never a timer", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      let resolvePreview: () => void = () => {};
      jest.spyOn(api, "previewLoadout").mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePreview = () => resolve(ok(preview([row()])));
          }),
      );
      api.savedGyms = [
        {
          id: "gym-1",
          name: "Hotel gym",
          equipmentTypeIds: ["eq-dumbbell"],
          createdAt: null,
          updatedAt: null,
        },
      ];
      const { findByTestId, queryByTestId } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-gym-gym-1"));
      expect(await findByTestId("loadout-adapting")).toBeTruthy();

      // The prototype auto-advances at 1700ms. If that shipped, this would be
      // on the review step with no rows.
      await new Promise((r) => setTimeout(r, 50));
      expect(queryByTestId("loadout-review")).toBeNull();

      resolvePreview();
      expect(await findByTestId("loadout-review")).toBeTruthy();
    });

    it.each([
      [
        "entitlement",
        { kind: "api", code: "entitlement_denied", message: "" },
        "Loadout is a Premium+ feature",
      ],
      [
        "limit",
        { kind: "api", code: "server", message: "", status: 429 },
        "That's your adaptations for today",
      ],
      [
        "unavailable",
        { kind: "api", code: "server", message: "", status: 503 },
        "Loadout can't adapt right now",
      ],
      [
        "generic",
        { kind: "api", code: "network", message: "" },
        "Couldn't adapt this workout",
      ],
    ])("names the cause on a %s failure", async (_kind, error, heading) => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      jest.spyOn(api, "previewLoadout").mockResolvedValue(fail(error as never));
      api.savedGyms = [
        {
          id: "gym-1",
          name: "Hotel gym",
          equipmentTypeIds: ["eq-dumbbell"],
          createdAt: null,
          updatedAt: null,
        },
      ];
      const { findByTestId, getByText } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-gym-gym-1"));
      await findByTestId("loadout-adapting-error");
      getByText(heading);
      // Every failure keeps the picker reachable — it is the floor, not a
      // consolation prize (design § 1b).
      expect(await findByTestId("loadout-adapting-manual")).toBeTruthy();
    });

    it("offers no retry on a 429 — retrying a ceiling cannot succeed", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      jest
        .spyOn(api, "previewLoadout")
        .mockResolvedValue(
          fail({ kind: "api", code: "server", message: "", status: 429 }),
        );
      api.savedGyms = [
        {
          id: "gym-1",
          name: "Hotel gym",
          equipmentTypeIds: ["eq-dumbbell"],
          createdAt: null,
          updatedAt: null,
        },
      ];
      const { findByTestId, queryByTestId } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-gym-gym-1"));
      await findByTestId("loadout-adapting-error");
      expect(queryByTestId("loadout-adapting-retry")).toBeNull();
    });

    it("re-requests once on an explicit retry", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      const spy = jest
        .spyOn(api, "previewLoadout")
        .mockResolvedValueOnce(
          fail({ kind: "api", code: "server", message: "", status: 503 }),
        )
        .mockResolvedValueOnce(ok(preview([row()])));
      api.savedGyms = [
        {
          id: "gym-1",
          name: "Hotel gym",
          equipmentTypeIds: ["eq-dumbbell"],
          createdAt: null,
          updatedAt: null,
        },
      ];
      const { findByTestId } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-gym-gym-1"));
      fireEvent.press(await findByTestId("loadout-adapting-retry"));

      await findByTestId("loadout-review");
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe("review", () => {
    async function reachReview(
      api: InMemoryApiAdapter,
      storage: InMemoryStorageAdapter,
      rows: LoadoutPreviewRow[],
    ) {
      seedEquipment(storage);
      api.loadoutPreview = preview(rows);
      api.savedGyms = [
        {
          id: "gym-1",
          name: "Hotel gym",
          equipmentTypeIds: ["eq-dumbbell"],
          createdAt: null,
          updatedAt: null,
        },
      ];
      const utils = renderFlow(api, storage);
      openFlow();
      fireEvent.press(await utils.findByTestId("loadout-collect-gym-gym-1"));
      await utils.findByTestId("loadout-review");
      return utils;
    }

    it("renders KEPT and SWAPPED copy derived from reason.code", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const { getByText } = await reachReview(api, storage, [
        row({ sortOrder: 1 }),
        row({
          sortOrder: 2,
          status: "swapped",
          exerciseId: "ex-2",
          substitutedFromExerciseId: "ex-old",
          exercise: {
            id: "ex-2",
            name: "Dumbbell Row",
            category: "strength",
            difficultyLevel: "intermediate",
            thumbnailUrl: null,
            equipmentRequired: [],
          },
          reason: reason({
            code: "equipment_unavailable",
            missingEquipment: ["eq-cable"],
            matchedOn: ["primary_muscles"],
          }),
        }),
      ]);

      getByText("KEPT");
      getByText("SWAPPED");
      getByText("Your kit covers this one — unchanged.");
      // Names the missing kit by LABEL, resolved from the reference list.
      getByText("No Cable station available · same primary muscles");
    });

    it("renders the model's note as plain text in its OWN attributed block", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      // ⚠ UNTRUSTED. A stranger's PUBLIC workout is adaptable (AC-1.2) and
      // exercise names are unbounded, so this string is attacker-influenceable.
      const hostile = "[tap here](https://evil.example) <b>Do this instead</b>";
      const { findByTestId, getByText } = await reachReview(api, storage, [
        row({ reason: reason({ note: hostile }) }),
      ]);

      const note = await findByTestId("loadout-row-1-note");
      expect(note).toBeTruthy();
      // Rendered verbatim as TEXT — never parsed, never a link, never pressable.
      getByText(hostile);
      // And attributed, so it does not read as the app's own claim.
      getByText("Loadout's note");
    });

    it("omits the note block entirely for a whitespace-only note", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const { queryByTestId } = await reachReview(api, storage, [
        row({ reason: reason({ note: "   " }) }),
      ]);
      expect(queryByTestId("loadout-row-1-note")).toBeNull();
    });

    it("offers accept / swap / drop on an intensity mismatch — and NEVER a target change", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const { findByTestId, getByText, queryByText } = await reachReview(
        api,
        storage,
        [
          row({
            status: "swapped",
            reason: reason({
              code: "equipment_unavailable",
              flags: ["intensity_mismatch"],
            }),
            targetRepsMin: 4,
            targetRepsMax: 6,
          }),
        ],
      );

      await findByTestId("loadout-row-1-actions");
      getByText("Keep as accessory");
      getByText("Swap it");
      getByText("Leave it out");
      // ⚠ Changing the prescription relaxes design § 1 rule 2 and is Brad's call,
      // with its own slice. It must not appear as an action here.
      expect(queryByText(/adjust the target/i)).toBeNull();
      // The parent's targets are shown unchanged.
      getByText("3 sets × 4–6 reps");
    });

    it("routes the mismatch row's 'Swap it' and the unresolved row's 'Choose one' to the picker", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.substitutes = { best: [], others: [], meta: { truncated: false } };
      const { findByTestId } = await reachReview(api, storage, [
        row({
          sortOrder: 1,
          status: "swapped",
          reason: reason({
            code: "equipment_unavailable",
            flags: ["intensity_mismatch"],
          }),
        }),
        row({
          sortOrder: 2,
          status: "unresolved",
          exerciseId: null,
          exercise: null,
        }),
      ]);

      fireEvent.press(await findByTestId("loadout-row-1-action-swap"));
      expect(useLoadoutFlow.getState().swapTarget?.sortOrder).toBe(1);
      act(() => useLoadoutFlow.getState().closeSwap());

      // An unresolved row has no `exercise`, so the sheet has to fall back to a
      // placeholder name rather than rendering "undefined".
      fireEvent.press(await findByTestId("loadout-row-2-action-swap"));
      expect(useLoadoutFlow.getState().swapTarget).toEqual({
        sortOrder: 2,
        exerciseId: null,
        exerciseName: "This exercise",
      });
    });

    it("clears the attention banner when a mismatch is accepted as accessory volume", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const { findByTestId, queryByTestId } = await reachReview(api, storage, [
        row({
          status: "swapped",
          reason: reason({
            code: "equipment_unavailable",
            flags: ["intensity_mismatch"],
          }),
        }),
      ]);

      expect(await findByTestId("loadout-review-attention")).toBeTruthy();
      fireEvent.press(await findByTestId("loadout-row-1-accept"));
      await waitFor(() =>
        expect(queryByTestId("loadout-review-attention")).toBeNull(),
      );
    });

    it("drops a row on request, clearing the banner, and can put it back", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const { findByTestId, getByText, queryByTestId } = await reachReview(
        api,
        storage,
        [row({ status: "unresolved", exerciseId: null, exercise: null })],
      );

      expect(await findByTestId("loadout-review-attention")).toBeTruthy();
      fireEvent.press(await findByTestId("loadout-row-1-drop"));
      getByText("Left out of this variation");
      // Leaving it out IS a decision — the row must stop being counted.
      await waitFor(() =>
        expect(queryByTestId("loadout-review-attention")).toBeNull(),
      );

      fireEvent.press(await findByTestId("loadout-row-1-restore"));
      expect(await findByTestId("loadout-row-1-actions")).toBeTruthy();
      expect(await findByTestId("loadout-review-attention")).toBeTruthy();
    });

    it("a manual pick resolves an unresolved row and clears the banner", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      // In `best`, not `others`: the review step always has a kit context, so an
      // `others` row would (correctly) demand an override acknowledgement first.
      api.substitutes = {
        best: [
          {
            id: "ex-alt",
            name: "Dumbbell Fly",
            category: "strength",
            difficultyLevel: "intermediate",
            thumbnailUrl: null,
            equipmentRequired: [],
            matchedOn: [],
          },
        ],
        others: [],
        meta: { truncated: false },
      };
      const { findByTestId, queryByTestId } = await reachReview(api, storage, [
        row({
          status: "unresolved",
          exerciseId: null,
          exercise: null,
          // What `adaptWorkout` sets on every unresolved row — the source it
          // could not replace, and the only thing left to rank against.
          substitutedFromExerciseId: "ex-original",
        }),
      ]);

      expect(await findByTestId("loadout-review-attention")).toBeTruthy();
      fireEvent.press(await findByTestId("loadout-row-1-swap"));
      // ⚠ Would be an EMPTY picker if the container ranked against the row's own
      // (null) exerciseId — on the one row that most needs a replacement.
      fireEvent.press(await findByTestId("swap-best-ex-alt"));

      // ⚠ Without this, a flagged row could never be resolved and any Save gate
      // keyed on the count would deadlock the flow with no way forward.
      await waitFor(() =>
        expect(queryByTestId("loadout-review-attention")).toBeNull(),
      );
    });

    it("warns that undecided rows will be dropped BEFORE the user saves", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const { getByText } = await reachReview(api, storage, [
        row({ status: "unresolved", exerciseId: null, exercise: null }),
      ]);
      getByText(
        "1 exercise needs a decision. Anything you leave undecided is dropped from this variation.",
      );
    });
  });

  describe("saving", () => {
    async function reachReviewViaManual(
      api: InMemoryApiAdapter,
      storage: InMemoryStorageAdapter,
      rows: LoadoutPreviewRow[],
    ) {
      seedEquipment(storage);
      api.loadoutPreview = preview(rows);
      const utils = renderFlow(api, storage);
      openFlow();
      fireEvent.press(await utils.findByTestId("loadout-collect-manual"));
      fireEvent.press(await utils.findByTestId("loadout-equip-eq-dumbbell"));
      fireEvent.press(await utils.findByTestId("loadout-manual-adapt"));
      await utils.findByTestId("loadout-review");
      return utils;
    }

    it("round-trips the parent's targets and provenance verbatim", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const swapped = row({
        status: "swapped",
        exerciseId: "ex-2",
        substitutedFromExerciseId: "ex-old",
        reason: reason({
          code: "equipment_unavailable",
          missingEquipment: ["eq-cable"],
          matchedOn: ["primary_muscles"],
        }),
        supersetGroup: 1,
        restSeconds: 75,
        notes: "keep the elbows tucked",
      });
      const { findByTestId } = await reachReviewViaManual(api, storage, [
        swapped,
      ]);

      fireEvent.press(await findByTestId("loadout-review-save"));
      await findByTestId("loadout-saved");

      const [call] = api.createVariationCalls;
      expect(call.parentWorkoutId).toBe("w-1");
      expect(call.input.exercises).toEqual([
        expect.objectContaining({
          exerciseId: "ex-2",
          sortOrder: 1,
          supersetGroup: 1,
          targetSets: 3,
          targetRepsMin: 8,
          targetRepsMax: 10,
          restSeconds: 75,
          notes: "keep the elbows tucked",
          substitutedFromExerciseId: "ex-old",
          substitutionReason: swapped.reason,
        }),
      ]);
    });

    it("names the variation from the parent plus the setup label", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const { findByTestId } = await reachReviewViaManual(api, storage, [
        row(),
      ]);

      fireEvent.press(await findByTestId("loadout-review-save"));
      await findByTestId("loadout-saved");

      expect(api.createVariationCalls[0].input.name).toBe(
        "Upper Body · Custom gym",
      );
    });

    it("saves the gym first when the toggle is on, and links the variation to it", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      api.loadoutPreview = preview([row()]);
      const { findByTestId } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-manual"));
      fireEvent.press(await findByTestId("loadout-equip-eq-dumbbell"));
      fireEvent.changeText(
        await findByTestId("loadout-manual-name"),
        "Hotel gym",
      );
      fireEvent.press(await findByTestId("loadout-manual-adapt"));
      await findByTestId("loadout-review");
      fireEvent.press(await findByTestId("loadout-review-save"));
      await findByTestId("loadout-saved");

      expect(api.savedGyms.map((gym) => gym.name)).toEqual(["Hotel gym"]);
      expect(api.createVariationCalls[0].input.sourceGymId).toBe(
        api.savedGyms[0].id,
      );
    });

    it("still saves the variation when the gym save 409s on a duplicate name", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      api.loadoutPreview = preview([row()]);
      api.savedGyms = [
        {
          id: "gym-existing",
          name: "Hotel gym",
          equipmentTypeIds: ["eq-cable"],
          createdAt: null,
          updatedAt: null,
        },
      ];
      const { findByTestId } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-manual"));
      fireEvent.press(await findByTestId("loadout-equip-eq-dumbbell"));
      fireEvent.changeText(
        await findByTestId("loadout-manual-name"),
        "Hotel gym",
      );
      fireEvent.press(await findByTestId("loadout-manual-adapt"));
      await findByTestId("loadout-review");
      fireEvent.press(await findByTestId("loadout-review-save"));

      // The reviewed adaptation is the valuable thing. Losing it to a duplicate
      // NAME — a side quest the user ticked — would be the worst possible trade.
      await findByTestId("loadout-saved");
      expect(api.createVariationCalls).toHaveLength(1);
      expect(api.createVariationCalls[0].input.sourceGymId).toBeNull();
      // The kit still travels with the variation, so nothing is actually lost.
      expect(api.createVariationCalls[0].input.sourceEquipmentTypeIds).toEqual([
        "eq-dumbbell",
      ]);
    });

    it("excludes a RESOLVED row the user left out", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      // ⚠ Both rows are resolved on purpose. `buildVariationExercises` already
      // drops an UNRESOLVED row with no pick, so dropping one of those would
      // pass whether or not the container filters at all.
      const { findByTestId } = await reachReviewViaManual(api, storage, [
        row({ sortOrder: 1 }),
        row({
          sortOrder: 2,
          status: "swapped",
          exerciseId: "ex-2",
          // Flagged, so it offers the drop action — and RESOLVED, so
          // `buildVariationExercises` would happily send it if the container
          // failed to filter.
          reason: reason({
            code: "equipment_unavailable",
            flags: ["intensity_mismatch"],
          }),
        }),
      ]);

      fireEvent.press(await findByTestId("loadout-row-2-drop"));
      fireEvent.press(await findByTestId("loadout-review-save"));
      await findByTestId("loadout-saved");

      expect(
        api.createVariationCalls[0].input.exercises.map((e) => e.sortOrder),
      ).toEqual([1]);
    });

    it("also excludes an unresolved row that was never acted on", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const { findByTestId } = await reachReviewViaManual(api, storage, [
        row({ sortOrder: 1 }),
        row({
          sortOrder: 2,
          status: "unresolved",
          exerciseId: null,
          exercise: null,
        }),
      ]);

      fireEvent.press(await findByTestId("loadout-review-save"));
      await findByTestId("loadout-saved");

      // The wire schema requires an `exerciseId`, so it cannot be sent — which
      // is why the review banner warns about this before Save is tapped.
      expect(
        api.createVariationCalls[0].input.exercises.map((e) => e.sortOrder),
      ).toEqual([1]);
    });

    it("refuses to save a variation with nothing left in it", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const { findByTestId, getByText } = await reachReviewViaManual(
        api,
        storage,
        [row({ status: "unresolved", exerciseId: null, exercise: null })],
      );

      fireEvent.press(await findByTestId("loadout-row-1-drop"));
      fireEvent.press(await findByTestId("loadout-review-save"));

      // Better a stated refusal than an empty workout the user finds later.
      await findByTestId("loadout-review-save-error");
      getByText(
        "There's nothing left to save — every exercise has been left out.",
      );
      expect(api.createVariationCalls).toHaveLength(0);
    });

    it("Save & start starts a session against the NEW variation", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const { findByTestId } = await reachReviewViaManual(api, storage, [
        row(),
      ]);

      fireEvent.press(await findByTestId("loadout-review-save-start"));

      await waitFor(() =>
        expect(mockRouterPush).toHaveBeenCalledWith(
          "/(app)/session?workoutId=variation-1",
        ),
      );
      // The overlay closes first — otherwise a full-screen success screen sits
      // over the session that just started.
      expect(useLoadoutFlow.getState().step).toBeNull();
    });

    it("bumps `rev` so the parent's Saved-setups list re-reads", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const { findByTestId } = await reachReviewViaManual(api, storage, [
        row(),
      ]);
      const before = useLoadoutFlow.getState().rev;

      fireEvent.press(await findByTestId("loadout-review-save"));
      await findByTestId("loadout-saved");

      expect(useLoadoutFlow.getState().rev).toBe(before + 1);
    });

    it("explains an EQUIPMENT_NOT_AVAILABLE rejection in terms the user can act on", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      // Make the double's containment check bite: the row needs a barbell the
      // kit lacks and is not flagged as a deliberate override.
      api.saveContextEquipmentIds = ["eq-dumbbell"];
      api.exerciseEquipment.set("ex-1", ["eq-barbell"]);
      const { findByTestId, getByText } = await reachReviewViaManual(
        api,
        storage,
        [row()],
      );

      fireEvent.press(await findByTestId("loadout-review-save"));

      await findByTestId("loadout-review-save-error");
      getByText(
        "One of your picks doesn't fit the kit you chose. Open its swap sheet and confirm you want it anyway.",
      );
    });
  });

  describe("swapping a row by hand", () => {
    async function reachReviewWithGym(
      api: InMemoryApiAdapter,
      storage: InMemoryStorageAdapter,
      rows: LoadoutPreviewRow[],
    ) {
      seedEquipment(storage);
      api.loadoutPreview = preview(rows);
      api.savedGyms = [
        {
          id: "gym-1",
          name: "Hotel gym",
          equipmentTypeIds: ["eq-dumbbell"],
          createdAt: null,
          updatedAt: null,
        },
      ];
      const utils = renderFlow(api, storage);
      openFlow();
      fireEvent.press(await utils.findByTestId("loadout-collect-gym-gym-1"));
      await utils.findByTestId("loadout-review");
      return utils;
    }

    it("opens the swap sheet with the SAVED GYM's kit as the containment context", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.substitutes = {
        best: [
          {
            id: "ex-alt",
            name: "Dumbbell Fly",
            category: "strength",
            difficultyLevel: "intermediate",
            thumbnailUrl: null,
            equipmentRequired: ["eq-dumbbell"],
            matchedOn: ["primary_muscles"],
          },
        ],
        others: [],
        meta: { truncated: false },
      };
      const spy = jest.spyOn(api, "getExerciseSubstitutes");
      const { findByTestId } = await reachReviewWithGym(api, storage, [row()]);

      fireEvent.press(await findByTestId("loadout-row-1-swap"));
      await findByTestId("swap-best-ex-alt");

      // ⚠ The request only carried `savedGymId`, so the gym's kit has to come
      // from the LISTED gym row — otherwise the sheet claims nothing is
      // incompatible on the one path where the kit is best known.
      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({ equipment: ["eq-dumbbell"] }),
      );
    });

    it("shows the picked exercise, relabels the row, and sends it with the pick's provenance", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.substitutes = {
        best: [
          {
            id: "ex-alt",
            name: "Dumbbell Fly",
            category: "strength",
            difficultyLevel: "intermediate",
            thumbnailUrl: null,
            equipmentRequired: ["eq-dumbbell"],
            matchedOn: ["primary_muscles"],
          },
        ],
        others: [],
        meta: { truncated: false },
      };
      const { findByTestId, getByText, getAllByText } =
        await reachReviewWithGym(api, storage, [row()]);

      fireEvent.press(await findByTestId("loadout-row-1-swap"));
      fireEvent.press(await findByTestId("swap-best-ex-alt"));

      // `getAllByText`: the sheet stays mounted after selection (its close is
      // animated), so the name legitimately appears in both the list and the row.
      await waitFor(() =>
        expect(getAllByText("Dumbbell Fly").length).toBeGreaterThan(0),
      );
      getByText("YOUR PICK");
      getByText("You chose this one.");

      fireEvent.press(await findByTestId("loadout-review-save"));
      await findByTestId("loadout-saved");

      const [sent] = api.createVariationCalls[0].input.exercises;
      expect(sent.exerciseId).toBe("ex-alt");
      // A compatible pick is NOT an override — flagging it would disable the
      // server's real containment check for that row.
      expect(sent.isUserOverride).toBeUndefined();
      expect(sent.substitutionReason).toEqual(
        expect.objectContaining({ code: "user_override", flags: [] }),
      );
      // The row it replaced, so the provenance reads correctly later (AC-3.3).
      expect(sent.substitutedFromExerciseId).toBe("ex-1");
    });

    it("carries isUserOverride through an acknowledged incompatible pick, so the save is accepted", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      api.substitutes = {
        best: [],
        others: [
          {
            id: "ex-barbell",
            name: "Barbell Bench Press",
            category: "strength",
            difficultyLevel: "intermediate",
            thumbnailUrl: null,
            equipmentRequired: ["eq-barbell"],
            matchedOn: ["primary_muscles"],
          },
        ],
        meta: { truncated: false },
      };
      // Make the double's containment check real for this save.
      api.saveContextEquipmentIds = ["eq-dumbbell"];
      api.exerciseEquipment.set("ex-barbell", ["eq-barbell"]);
      const { findByTestId } = await reachReviewWithGym(api, storage, [row()]);

      fireEvent.press(await findByTestId("loadout-row-1-swap"));
      fireEvent.press(await findByTestId("swap-others-ex-barbell"));
      fireEvent.press(await findByTestId("swap-sheet-override-confirm-accept"));

      fireEvent.press(await findByTestId("loadout-review-save"));

      // ⚠ Without the flag this is a 400 EQUIPMENT_NOT_AVAILABLE and the whole
      // reviewed adaptation is lost to an error the user cannot act on.
      await findByTestId("loadout-saved");
      expect(api.createVariationCalls[0].input.exercises[0]).toEqual(
        expect.objectContaining({
          exerciseId: "ex-barbell",
          isUserOverride: true,
        }),
      );
    });
  });

  describe("navigation and reset", () => {
    it("closes the whole flow from collect", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      const { findByTestId } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-back"));
      expect(useLoadoutFlow.getState().step).toBeNull();
    });

    it("keeps the collect step mounted behind the scan sheet", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      const { findByTestId } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-scan"));
      // The sheet is an overlay ON the collect step, not a replacement for it —
      // dismissing it must not leave a blank screen.
      expect(await findByTestId("loadout-collect")).toBeTruthy();
      expect(await findByTestId("loadout-scan-sheet")).toBeTruthy();
    });

    it("hides the scan option entirely when offline", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const adapters = makeAdapters(api, storage);
      const { findByTestId, queryByTestId } = renderWithTheme(
        <QueryClientProvider client={queryClient}>
          <AdapterProvider
            adapters={{
              ...adapters,
              netInfo: new InMemoryNetInfoAdapter(false),
            }}
          >
            <LoadoutFlowContainer />
          </AdapterProvider>
        </QueryClientProvider>,
      );
      openFlow();

      await findByTestId("loadout-collect-manual");
      // Offered-then-failed is worse than not offered: the picker works offline
      // and is the floor (AC-2.1/2.2).
      expect(queryByTestId("loadout-collect-scan")).toBeNull();
    });

    it("RE-ADAPTS the same workout against the same gym after a close", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      api.loadoutPreview = preview([row()]);
      api.savedGyms = [
        {
          id: "gym-1",
          name: "Hotel gym",
          equipmentTypeIds: ["eq-dumbbell"],
          createdAt: null,
          updatedAt: null,
        },
      ];
      const { findByTestId } = renderFlow(api, storage);

      openFlow();
      fireEvent.press(await findByTestId("loadout-collect-gym-gym-1"));
      await findByTestId("loadout-review");
      act(() => useLoadoutFlow.getState().reset());

      // ⚠ Identical (workout, context), so a request-dedup key that is never
      // cleared matches and returns early — no request, no `previewResolved`,
      // and the skeleton renders forever with no retry affordance (that only
      // appears on an error). The pair would be dead for the whole app session.
      openFlow();
      fireEvent.press(await findByTestId("loadout-collect-gym-gym-1"));

      expect(await findByTestId("loadout-review")).toBeTruthy();
      expect(api.previewLoadoutCalls).toHaveLength(2);
    });

    it("does not duplicate an exercise already in the plan", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      api.loadoutPreview = preview([
        row({ sortOrder: 1, exerciseId: "ex-1" }),
        row({ sortOrder: 2, exerciseId: "ex-2" }),
      ]);
      api.substitutes = {
        best: [
          {
            id: "ex-1",
            name: "Dumbbell Bench Press",
            category: "strength",
            difficultyLevel: "intermediate",
            thumbnailUrl: null,
            equipmentRequired: [],
            matchedOn: [],
          },
        ],
        others: [],
        meta: { truncated: false },
      };
      const { findByTestId } = renderFlow(api, storage);
      openFlow();
      fireEvent.press(await findByTestId("loadout-collect-manual"));
      fireEvent.press(await findByTestId("loadout-equip-eq-dumbbell"));
      fireEvent.press(await findByTestId("loadout-manual-adapt"));
      await findByTestId("loadout-review");

      fireEvent.press(await findByTestId("loadout-row-2-swap"));

      // `workoutVariationsCreateHandler` does not reject duplicate exerciseIds,
      // so nothing downstream would catch this: the variation would prescribe
      // the same exercise twice, with two different reason blocks.
      const row1 = await findByTestId("swap-best-ex-1");
      expect(row1.props.accessibilityState.disabled).toBe(true);
    });

    it("closes from the success screen", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      api.loadoutPreview = preview([row()]);
      const { findByTestId } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-manual"));
      fireEvent.press(await findByTestId("loadout-equip-eq-dumbbell"));
      fireEvent.press(await findByTestId("loadout-manual-adapt"));
      fireEvent.press(await findByTestId("loadout-review-save"));
      fireEvent.press(await findByTestId("loadout-saved-done"));

      expect(useLoadoutFlow.getState().step).toBeNull();
    });

    it("does NOT save a gym when the toggle is off", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      api.loadoutPreview = preview([row()]);
      const create = jest.spyOn(api, "createSavedGym");
      const { findByTestId } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-manual"));
      fireEvent.press(await findByTestId("loadout-equip-eq-dumbbell"));
      fireEvent.press(await findByTestId("loadout-manual-save-toggle"));
      fireEvent.press(await findByTestId("loadout-manual-adapt"));
      fireEvent.press(await findByTestId("loadout-review-save"));
      await findByTestId("loadout-saved");

      expect(create).not.toHaveBeenCalled();
    });

    it("unticking a chip removes it from the request", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      api.loadoutPreview = preview([row()]);
      const { findByTestId } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-manual"));
      fireEvent.press(await findByTestId("loadout-equip-eq-dumbbell"));
      fireEvent.press(await findByTestId("loadout-equip-eq-cable"));
      fireEvent.press(await findByTestId("loadout-equip-eq-dumbbell"));
      fireEvent.press(await findByTestId("loadout-manual-adapt"));
      await findByTestId("loadout-review");

      expect(api.previewLoadoutCalls[0].input).toEqual({
        equipmentTypeIds: ["eq-cable"],
      });
    });

    it("clears local decisions when a DIFFERENT workout is adapted", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedEquipment(storage);
      api.loadoutPreview = preview([row()]);
      const { findByTestId } = renderFlow(api, storage);
      openFlow();

      fireEvent.press(await findByTestId("loadout-collect-manual"));
      fireEvent.press(await findByTestId("loadout-equip-eq-dumbbell"));
      await findByTestId("loadout-equip-eq-dumbbell");

      act(() => useLoadoutFlow.getState().open("w-2", "Lower Body"));
      fireEvent.press(await findByTestId("loadout-collect-manual"));

      // Selections keyed to workout A must not survive into workout B — the
      // store resets itself, but the picker's local state lives here.
      const cta = await findByTestId("loadout-manual-adapt");
      expect(cta.props.accessibilityState.disabled).toBe(true);
    });
  });

  describe("the upsell sheet", () => {
    it("is reachable with NO flow open — a locked entry point has no flow to be in", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const { findByTestId } = renderFlow(api, storage);

      useLoadoutFlow.getState().openUpsell();

      expect(await findByTestId("loadout-upsell-sheet")).toBeTruthy();
      expect(useLoadoutFlow.getState().step).toBeNull();
    });

    it("shows no price at all when the catalog has none (premium_plus is inactive pre-launch)", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const { findByTestId, queryByTestId } = renderFlow(api, storage);

      useLoadoutFlow.getState().openUpsell();
      await findByTestId("loadout-upsell-sheet");

      // Never a literal. The prototype's £19.99 is retired and the real figure is
      // £29.99 in the catalog — a hardcoded fallback is exactly that drift.
      expect(queryByTestId("loadout-upsell-price")).toBeNull();
    });
  });
});

describe("classifyAdaptingError", () => {
  it("maps 402 by CODE, not by status", () => {
    // The adapter stamps `entitlement_denied`; keying on a status would miss it
    // if the transport ever normalises differently.
    expect(
      classifyAdaptingError({
        kind: "api",
        code: "entitlement_denied",
        message: "",
      }),
    ).toBe("entitlement");
  });

  it.each([
    [429, "limit"],
    [503, "unavailable"],
    [500, "generic"],
    [400, "generic"],
  ])("maps status %s to %s", (status, expected) => {
    expect(
      classifyAdaptingError({
        kind: "api",
        code: "server",
        message: "",
        status,
      }),
    ).toBe(expected);
  });

  it("maps a status-less transport failure to generic", () => {
    expect(
      classifyAdaptingError({ kind: "api", code: "network", message: "" }),
    ).toBe("generic");
  });
});

describe("buildRowTags", () => {
  it("numbers singles and letters superset runs", () => {
    const tags = buildRowTags([
      row({ sortOrder: 1, supersetGroup: null }),
      row({ sortOrder: 2, supersetGroup: 3 }),
      row({ sortOrder: 3, supersetGroup: 3 }),
      row({ sortOrder: 4, supersetGroup: null }),
      row({ sortOrder: 5, supersetGroup: 7 }),
      row({ sortOrder: 6, supersetGroup: 7 }),
    ]);
    expect(tags.map((t) => t.tag)).toEqual(["1", "A1", "A2", "2", "B1", "B2"]);
    expect(tags.map((t) => t.isSupersetMember)).toEqual([
      false,
      true,
      true,
      false,
      true,
      true,
    ]);
  });

  it("keys letters on the GROUP, so an interleaved group keeps its letter", () => {
    const tags = buildRowTags([
      row({ sortOrder: 1, supersetGroup: 2 }),
      row({ sortOrder: 2, supersetGroup: 5 }),
      row({ sortOrder: 3, supersetGroup: 2 }),
    ]);
    expect(tags.map((t) => t.tag)).toEqual(["A1", "B1", "A2"]);
  });

  it("falls back to a number past the last letter rather than rendering undefined", () => {
    const tags = buildRowTags(
      Array.from({ length: 9 }, (_, i) =>
        row({ sortOrder: i + 1, supersetGroup: i + 1 }),
      ),
    );
    expect(tags[7]?.tag).toBe("H1");
    expect(tags[8]?.tag).toBe("91");
  });

  it("returns an empty list for an empty plan", () => {
    expect(buildRowTags([])).toEqual([]);
  });
});
