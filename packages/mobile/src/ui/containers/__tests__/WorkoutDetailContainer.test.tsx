import { fireEvent, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { Workout } from "@/domain/models/workout";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useLoadoutFlow } from "@/state/loadout-flow";
import { WorkoutDetailContainer } from "@/ui/containers/WorkoutDetailContainer";
import { renderWithTheme } from "../../../../__tests__/test-utils";

const buildWorkout = (overrides: Partial<Workout> = {}): Workout => ({
  id: overrides.id ?? "w-1",
  name: overrides.name ?? "Push Day",
  description: overrides.description ?? "Heavy chest session",
  createdBy: "user-1",
  visibility: "private",
  estimatedDurationMinutes: 60,
  exercises: overrides.exercises ?? [
    {
      id: "we-1",
      exerciseId: "ex-bench",
      sortOrder: 1,
      supersetGroup: null,
      targetSets: 4,
      targetRepsMin: 8,
      targetRepsMax: 12,
      targetDurationSeconds: null,
      restSeconds: 90,
      notes: null,
      exercise: {
        id: "ex-bench",
        name: "Bench Press",
        category: "strength",
        difficultyLevel: "intermediate",
        videoUrl: null,
        thumbnailUrl: null,
      },
    },
  ],
  createdAt: "2026-04-28T00:00:00Z",
  updatedAt: "2026-04-28T00:00:00Z",
  showInOwnerLibrary: overrides.showInOwnerLibrary ?? true,
  ...overrides,
});

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
  const auth = {
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    signInWithOAuth: jest.fn(),
    signOut: jest.fn(),
    getSession: jest.fn(async () => ok(session)),
    // Fire the auth-state callback synchronously at registration —
    // see SwapExercisePopover.test.tsx for the full rationale (CI
    // flake from deferred-via-setTimeout setState racing with test-
    // library polling).
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    resetPassword: jest.fn(),
    refreshSession: jest.fn(),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo: {} as Adapters["netInfo"],
  };
}

/**
 * The container reads `useLoadoutGate` (spec-21 T-2.2), which is React Query
 * backed, so every render needs a client. Retries are off so a deliberately
 * failing adapter call resolves once instead of stalling the test.
 */
function withAdapters(adapters: Adapters, ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <AdapterProvider adapters={adapters}>{ui}</AdapterProvider>
    </QueryClientProvider>
  );
}

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
const mockUseLocalSearchParams = jest.fn(
  () => ({ id: "w-1" }) as Record<string, string>,
);
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
  },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

describe("WorkoutDetailContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLocalSearchParams.mockReturnValue({ id: "w-1" });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders cached workout name + exercise rows", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(buildWorkout()));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout());

    const { findByText, findAllByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
    );
    // v3 renders the name in both the header AND the hero (prototype-faithful).
    expect((await findAllByText("Push Day")).length).toBeGreaterThanOrEqual(1);
    expect(await findByText("Bench Press")).toBeTruthy();
    expect(await findByText("Heavy chest session")).toBeTruthy();
  });

  it("back button calls router.back", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(buildWorkout()));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout());

    const { getByTestId, findByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
    );
    await findByText("Bench Press");
    fireEvent.press(getByTestId("workout-detail-back"));
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });

  it("tapping an exercise pushes the exercise detail route", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(buildWorkout()));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout());

    const { getByTestId, findByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
    );
    await findByText("Bench Press");
    fireEvent.press(getByTestId("workout-detail-exercise-ex-bench"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/exercises/ex-bench");
  });

  it("Start Workout opens the active-session modal seeded from the workout id (M3)", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(ok(buildWorkout()));
    const storage = new InMemoryStorageAdapter();
    storage.cacheWorkoutDetail("user-1", buildWorkout());

    const { getByTestId, findByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
    );
    await findByText("Bench Press");
    fireEvent.press(getByTestId("workout-detail-start"));
    expect(mockRouterPush).toHaveBeenCalledWith("/(app)/session?workoutId=w-1");
  });

  it("renders the loader on cold start when no cached detail", async () => {
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getWorkout")
      .mockImplementation(() => new Promise(() => {}));
    const storage = new InMemoryStorageAdapter();

    const { getByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
    );
    await waitFor(() =>
      expect(getByTestId("workout-detail-loading")).toBeTruthy(),
    );
  });

  it("renders empty placeholder when route param `id` is missing", () => {
    mockUseLocalSearchParams.mockReturnValue({});
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const { queryByText, getByText } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
    );
    // Header falls back to "Workout" when no name is loaded.
    expect(getByText("Workout")).toBeTruthy();
    // No Bench Press content because the workout id never resolved.
    expect(queryByText("Bench Press")).toBeNull();
  });

  it("renders the error state when fetch fails and no cache exists", async () => {
    const api = new InMemoryApiAdapter();
    jest.spyOn(api, "getWorkout").mockResolvedValue(
      fail({
        kind: "api",
        code: "not_found",
        message: "Workout not found",
      }),
    );
    const storage = new InMemoryStorageAdapter();

    const { findByTestId } = renderWithTheme(
      withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
    );
    expect(await findByTestId("workout-detail-error")).toBeTruthy();
  });

  describe("Loadout (spec-21 T-2.2 / T-2.8)", () => {
    beforeEach(() => {
      useLoadoutFlow.getState().reset();
      useLoadoutFlow.setState({ rev: 0 });
    });

    function subscription(tierName: "free" | "premium_plus") {
      return {
        subscriptionId: "sub-1",
        tierName,
        paymentStatus: "active",
        billingCycle: "monthly",
        startsAt: "2026-07-01T00:00:00Z",
        expiresAt: null,
        cancelledAt: null,
        trialEndsAt: null,
        externalSubscriptionId: null,
        tierDisplayName: tierName,
        tierDescription: null,
        workoutLimit: null,
        aiAccess: true,
        aiWorkoutLimit: 0,
        gymBuddyAccess: false,
        trainerClientLimit: null,
        isTrainerTier: false,
        role: "user" as const,
        hasUsedUserTrial: false,
        hasUsedTrainerTrial: false,
        isEligibleForUserTrial: true,
        isEligibleForTrainerTrial: true,
        scheduledChange: null,
      };
    }

    function seedOwnedWorkout(
      api: InMemoryApiAdapter,
      storage: InMemoryStorageAdapter,
      tierName: "free" | "premium_plus" = "free",
    ) {
      const workout = buildWorkout();
      storage.cacheWorkoutDetail("user-1", workout);
      jest.spyOn(api, "getWorkout").mockResolvedValue(ok(workout));
      // ⚠ Always seeded. With no subscription the gate never RESOLVES, and the
      // card correctly renders neither locked nor unlocked — so a test that
      // omits this is asserting against the pending state by accident.
      api.mySubscription = subscription(tierName) as never;
      return workout;
    }

    it("renders the locked entry card for a user without Premium+", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedOwnedWorkout(api, storage);
      const { findByText } = renderWithTheme(
        withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
      );

      expect(
        await findByText(
          "Unlock to re-map this workout to whatever kit you have",
        ),
      ).toBeTruthy();
    });

    it("shows NEITHER state, and does nothing on tap, until the subscription resolves", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const workout = buildWorkout();
      storage.cacheWorkoutDetail("user-1", workout);
      jest.spyOn(api, "getWorkout").mockResolvedValue(ok(workout));
      // Never resolves — the cold-start window.
      jest
        .spyOn(api, "getMySubscription")
        .mockReturnValue(new Promise(() => {}));

      const { findByTestId, queryByText } = renderWithTheme(
        withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
      );

      const card = await findByTestId("loadout-entry-card");
      // ⚠ A padlock here is shown to PAYING Premium+ users on every cold start,
      // because the verdict denies an unresolved subscription by design.
      expect(
        queryByText("Unlock to re-map this workout to whatever kit you have"),
      ).toBeNull();
      expect(card.props.accessibilityState.disabled).toBe(true);

      fireEvent.press(card);
      // And tapping must not sell the feature to someone who may already own it.
      expect(useLoadoutFlow.getState().upsellOpen).toBe(false);
      expect(useLoadoutFlow.getState().step).toBeNull();
    });

    it("opens the UPSELL — not the flow — when the user isn't entitled", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedOwnedWorkout(api, storage);
      const { findByTestId } = renderWithTheme(
        withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
      );

      fireEvent.press(await findByTestId("loadout-entry-card"));

      // design § 5.2 makes this a conversion surface with no taster behind it,
      // so a dead tap throws away the only pitch the feature gets.
      expect(useLoadoutFlow.getState().upsellOpen).toBe(true);
      expect(useLoadoutFlow.getState().step).toBeNull();
      expect(mockRouterPush).not.toHaveBeenCalledWith("/(app)/loadout");
    });

    /**
     * ⚠ The sheet is mounted in THIS screen's tree, not at the layout root, and
     * these tests live here for the same reason. This screen is
     * `presentation: "modal"`; a root-mounted sheet renders behind it, which
     * would make the locked card — the FREE user's only path into the feature —
     * appear to do nothing.
     */
    it("renders the upsell sheet inside this screen, so it clears the presented route", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedOwnedWorkout(api, storage);
      const { findByTestId } = renderWithTheme(
        withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
      );

      fireEvent.press(await findByTestId("loadout-entry-card"));
      expect(await findByTestId("loadout-upsell-sheet")).toBeTruthy();
    });

    it("shows no price at all when the catalog has none (premium_plus is inactive pre-launch)", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedOwnedWorkout(api, storage);
      const { findByTestId, queryByTestId } = renderWithTheme(
        withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
      );

      fireEvent.press(await findByTestId("loadout-entry-card"));
      await findByTestId("loadout-upsell-sheet");

      // Never a literal. The prototype's £19.99 is retired and the real figure is
      // £29.99 in the catalog — a hardcoded fallback is exactly that drift.
      expect(queryByTestId("loadout-upsell-price")).toBeNull();
    });

    it("opens the FLOW, seeded with the workout, for an entitled user", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const workout = seedOwnedWorkout(api, storage, "premium_plus");
      const { findByTestId, getByText } = renderWithTheme(
        withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
      );

      await waitFor(() =>
        getByText("Re-map this workout to whatever kit you have today"),
      );
      fireEvent.press(await findByTestId("loadout-entry-card"));

      expect(useLoadoutFlow.getState().step).toBe("collect");
      expect(useLoadoutFlow.getState().workoutId).toBe(workout.id);
      expect(useLoadoutFlow.getState().workoutName).toBe(workout.name);
      expect(useLoadoutFlow.getState().upsellOpen).toBe(false);
      // Both happen: the store carries the workout, the router opens the flow.
      // (Their ORDER is not asserted — both are synchronous in one tick and the
      // route reads the store on mount, so it cannot matter.)
      expect(mockRouterPush).toHaveBeenCalledWith("/(app)/loadout");
    });

    it("lists saved setups and opens one as its own workout", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedOwnedWorkout(api, storage);
      await api.createWorkoutVariation("w-1", {
        name: "Push Day · Hotel gym",
        exercises: [{ exerciseId: "ex-bench", sortOrder: 1 }],
      });
      const { findByTestId } = renderWithTheme(
        withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
      );

      fireEvent.press(await findByTestId("loadout-variation-variation-1"));
      // A variation IS a workout, so it opens on this same screen.
      expect(mockRouterPush).toHaveBeenCalledWith(
        "/(app)/workouts/variation-1",
      );
    });

    it("derives the hero's muscle pills and equipment eyebrow from the cached library", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedOwnedWorkout(api, storage);
      // The workout DTO carries neither, so both come off the exercise cache.
      storage.cacheExercises([
        {
          id: "ex-bench",
          name: "Bench Press",
          description: null,
          instructions: null,
          category: "strength",
          difficulty: "intermediate",
          primaryMuscleGroups: ["chest"],
          secondaryMuscleGroups: [],
          equipment: ["barbell"],
          primaryMuscleGroupLabels: ["Chest"],
          secondaryMuscleGroupLabels: [],
          equipmentLabels: ["Barbell"],
          videoUrl: null,
          thumbnailUrl: null,
          isCustom: false,
          createdBy: null,
        },
      ]);
      const { findByText } = renderWithTheme(
        withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
      );

      expect(await findByText("Chest")).toBeTruthy();
      expect(await findByText("BARBELL · WORKOUT")).toBeTruthy();
    });

    it("routes the owner's edit button to the editor", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      seedOwnedWorkout(api, storage);
      const { findByTestId } = renderWithTheme(
        withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
      );

      fireEvent.press(await findByTestId("workout-detail-edit"));
      expect(mockRouterPush).toHaveBeenCalledWith("/(app)/workouts/w-1/edit");
    });

    it("hides the whole Loadout block on someone else's workout", async () => {
      const api = new InMemoryApiAdapter();
      const storage = new InMemoryStorageAdapter();
      const workout = buildWorkout({ createdBy: "someone-else" });
      storage.cacheWorkoutDetail("user-1", workout);
      jest.spyOn(api, "getWorkout").mockResolvedValue(ok(workout));
      const variations = jest.spyOn(api, "getWorkoutVariations");
      const { findByTestId, queryByTestId } = renderWithTheme(
        withAdapters(makeAdapters(api, storage), <WorkoutDetailContainer />),
      );

      await findByTestId("workout-detail-start");
      expect(queryByTestId("loadout-entry-card")).toBeNull();
      // Variations are caller-scoped server-side, so this would always be empty.
      expect(variations).not.toHaveBeenCalled();
    });
  });
});
