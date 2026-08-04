import { act, render, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type {
  MySubscription,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import type { MealSuggestion } from "@/domain/models/mealprint";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { useFuelSheets } from "@/state/fuel-sheets";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { MealprintSuggestSheetProps } from "@/ui/presenters/mealprint/MealprintSuggestSheetPresenter";
import { MealprintSuggestSheetContainer } from "../MealprintSuggestSheetContainer";

const mockProbe: { last: MealprintSuggestSheetProps | null } = { last: null };
jest.mock("@/ui/presenters/mealprint/MealprintSuggestSheetPresenter", () => ({
  MealprintSuggestSheetPresenter: (props: MealprintSuggestSheetProps) => {
    mockProbe.last = props;
    return null;
  },
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() },
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
}));

let mockOnline = true;
jest.mock("@/ui/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => mockOnline,
}));

const mockFetch = jest.fn();
mockFetch.mockResolvedValue({
  ok: true,
  status: 201,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
});
(globalThis as Record<string, unknown>).fetch = mockFetch;

const SESSION: AuthSession = {
  accessToken: "t",
  refreshToken: "r",
  userId: "user-1",
  email: "u@example.com",
  expiresAt: Date.now() + 60_000,
};

function subscription(tierName: SubscriptionTierName): MySubscription {
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
    role: "user",
    hasUsedUserTrial: false,
    hasUsedTrainerTrial: false,
    isEligibleForUserTrial: true,
    isEligibleForTrainerTrial: true,
    scheduledChange: null,
  } as MySubscription;
}

function suggestion(over: Partial<MealSuggestion> = {}): MealSuggestion {
  return {
    name: "Greek yoghurt & berries",
    reason: "Protein without much of the budget.",
    items: [
      {
        candidateId: "food-1",
        kind: "food",
        name: "Greek yoghurt 0%",
        servings: 1.5,
        servingLabel: "170 g pot",
        kcal: 150,
        proteinG: 25,
        carbsG: 9,
        fatG: 0,
        unverified: false,
      },
      {
        candidateId: "recipe-1",
        kind: "recipe",
        name: "Berry compote",
        servings: 1,
        servingLabel: "1 serving",
        kcal: 45,
        proteinG: 1,
        carbsG: 11,
        fatG: 0,
        unverified: true,
      },
    ],
    kcal: 195,
    proteinG: 26,
    carbsG: 20,
    fatG: 0,
    containsUnverified: true,
    partialEnforcementOnly: false,
    ...over,
  };
}

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
): Adapters {
  return {
    api,
    auth: {
      getSession: jest.fn(async () => ok(SESSION)),
      onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
        cb(SESSION);
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

function mount(
  seed?: (api: InMemoryApiAdapter, storage: InMemoryStorageAdapter) => void,
) {
  const api = new InMemoryApiAdapter();
  api.mySubscription = subscription("premium_plus");
  const storage = new InMemoryStorageAdapter();
  seed?.(api, storage);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <MealprintSuggestSheetContainer />
      </AdapterProvider>
    </QueryClientProvider>,
  );
  return { ...utils, api, storage, probe: () => mockProbe.last! };
}

function open() {
  act(() => useFuelSheets.getState().openMealprintSuggest());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProbe.last = null;
  mockOnline = true;
  useFuelSheets.setState({
    sheet: null,
    slot: "breakfast",
    date: "2026-08-03",
    rev: 0,
  });
  mockFetch.mockResolvedValue({
    ok: true,
    status: 201,
    headers: { get: () => null },
    json: async () => ({ data: {} }),
  });
});

describe("MealprintSuggestSheetContainer", () => {
  it("⚠ issues NOTHING on mount — it is root-mounted and closed", async () => {
    // Root-mounting means always mounted, and closing is not unmounting. Seven
    // sheets fetching on mount is what produced ~28 requests inside 100 ms against
    // a 10-concurrency Lambda quota, ~16 of them 503s.
    const { api, probe } = mount();
    const prefSpy = jest.spyOn(api, "getMealprintPreferences");
    const suggestSpy = jest.spyOn(api, "suggestMeals");
    await waitFor(() => expect(probe()).not.toBeNull());
    expect(probe().visible).toBe(false);
    expect(prefSpy).not.toHaveBeenCalled();
    expect(suggestSpy).not.toHaveBeenCalled();
  });

  it("fetches preferences on the FIRST real open", async () => {
    const { api, probe } = mount((a) => {
      a.mealprintPreferences = {
        ...a.mealprintPreferences,
        dietaryPatterns: ["halal"],
        isDefault: false,
      };
    });
    const spy = jest.spyOn(api, "getMealprintPreferences");
    open();
    await waitFor(() => expect(spy).toHaveBeenCalled());
    // …and threads the patterns through so the halal/kosher caveat can render.
    await waitFor(() => expect(probe().dietaryPatterns).toEqual(["halal"]));
  });

  it("reports offline and refuses to spend a request", async () => {
    mockOnline = false;
    const { api, probe } = mount();
    const spy = jest.spyOn(api, "suggestMeals");
    open();
    await waitFor(() => expect(probe().offline).toBe(true));
    act(() => probe().onGenerate());
    expect(spy).not.toHaveBeenCalled();
  });

  it("sends the shape, the device's local day and a trimmed steer", async () => {
    const { api, probe } = mount();
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    act(() => probe().onShapeChange("snack"));
    act(() => probe().onSteerChange("  something sweet  "));
    await act(async () => {
      probe().onGenerate();
    });
    await waitFor(() => expect(api.suggestMealsCalls).toHaveLength(1));
    expect(api.suggestMealsCalls[0]).toEqual({
      shape: "snack",
      date: "2026-08-03",
      steer: "something sweet",
    });
  });

  it("OMITS an all-whitespace steer rather than sending an empty string", async () => {
    const { api, probe } = mount();
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    act(() => probe().onSteerChange("   "));
    await act(async () => {
      probe().onGenerate();
    });
    await waitFor(() => expect(api.suggestMealsCalls).toHaveLength(1));
    expect(api.suggestMealsCalls[0]?.steer).toBeUndefined();
  });

  it("surfaces suggestions and the label-check flag", async () => {
    const { probe } = mount((a) => {
      a.mealSuggestResult = {
        suggestions: [suggestion()],
        emptyReason: null,
        remaining: { kcal: 620, proteinG: 42, carbsG: 60, fatG: 20 },
        containsUnverified: true,
        partialEnforcementOnly: false,
        labelCheckRequired: true,
      };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
    });
    await waitFor(() => expect(probe().stage).toBe("results"));
    expect(probe().suggestions).toHaveLength(1);
    expect(probe().labelCheckRequired).toBe(true);
    expect(probe().remaining?.kcal).toBe(620);
  });

  it("⚠ defaults labelCheckRequired to FALSE before any result", async () => {
    // Nothing should claim a disclaimer the server has not sent; the server always
    // sends `true`, so this only covers the pre-result stages.
    const { probe } = mount();
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    expect(probe().labelCheckRequired).toBe(false);
  });

  it("carries an empty no_candidates result as a RESULT, not an error", async () => {
    const { probe } = mount();
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
    });
    await waitFor(() => expect(probe().stage).toBe("results"));
    expect(probe().emptyReason).toBe("no_candidates");
    expect(probe().errorMessage).toBeNull();
  });

  it("selects a suggestion into a draft seeded with the store's slot", async () => {
    useFuelSheets.setState({ slot: "dinner" });
    const { probe } = mount((a) => {
      a.mealSuggestResult = {
        suggestions: [suggestion()],
        emptyReason: null,
        remaining: null,
        containsUnverified: false,
        partialEnforcementOnly: false,
        labelCheckRequired: true,
      };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
    });
    await waitFor(() => expect(probe().stage).toBe("results"));
    act(() => probe().onSelectSuggestion(0));
    await waitFor(() => expect(probe().stage).toBe("draft"));
    expect(probe().draft?.slot).toBe("dinner");
    expect(probe().draft?.items.every((i) => i.on)).toBe(true);
    expect(probe().draftKcal).toBe(195);
  });

  it("ignores an out-of-range selection index", async () => {
    const { probe } = mount((a) => {
      a.mealSuggestResult = {
        suggestions: [suggestion()],
        emptyReason: null,
        remaining: null,
        containsUnverified: false,
        partialEnforcementOnly: false,
        labelCheckRequired: true,
      };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
    });
    await waitFor(() => expect(probe().stage).toBe("results"));
    act(() => probe().onSelectSuggestion(7));
    expect(probe().stage).toBe("results");
  });

  it("toggles a draft item, and the kcal follows what is kept", async () => {
    const { probe } = await openWithDraft();
    expect(probe().draftKcal).toBe(195);
    act(() => probe().onToggleDraftItem(1));
    await waitFor(() => expect(probe().draftKcal).toBe(150));
  });

  it("changes the draft's slot", async () => {
    const { probe } = await openWithDraft();
    act(() => probe().onSlotChange("lunch"));
    await waitFor(() => expect(probe().draft?.slot).toBe("lunch"));
  });

  it("returns to the results from the draft", async () => {
    const { probe } = await openWithDraft();
    act(() => probe().onBackToResults());
    await waitFor(() => expect(probe().stage).toBe("results"));
  });

  it("⚠ logs each kept item by REFERENCE, with macros and a name for the offline fallback", async () => {
    // The reference keeps the entry server-authoritative and editable; the macros
    // and `customName` are what stop the ring reading +0 kcal and the row reading
    // "Logged food" when the curated candidate is not in `cached_foods` — which is
    // the normal case for a Mealprint suggestion.
    const { probe, storage } = await openWithDraft();
    await act(async () => {
      probe().onConfirm();
    });
    await waitFor(() => expect(probe().stage).toBe("added"));

    const day = storage.getCachedFuelToday("user-1", "2026-08-03");
    const logged = [
      ...(day?.entriesBySlot.breakfast ?? []),
      ...(day?.entriesBySlot.lunch ?? []),
      ...(day?.entriesBySlot.snack ?? []),
      ...(day?.entriesBySlot.dinner ?? []),
    ];
    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatchObject({
      foodId: "food-1",
      recipeId: null,
      servings: 1.5,
      kcal: 150,
      customName: "Greek yoghurt 0%",
    });
    expect(logged[1]).toMatchObject({
      recipeId: "recipe-1",
      foodId: null,
      servings: 1,
      kcal: 45,
      customName: "Berry compote",
    });
    // Fuel re-reads its aggregate off this.
    expect(useFuelSheets.getState().rev).toBe(1);
  });

  it("logs into the slot the user picked, on the store's active day", async () => {
    useFuelSheets.setState({ date: "2026-08-01" });
    const { probe, storage } = await openWithDraft();
    act(() => probe().onSlotChange("snack"));
    await waitFor(() => expect(probe().draft?.slot).toBe("snack"));
    await act(async () => {
      probe().onConfirm();
    });
    await waitFor(() => expect(probe().stage).toBe("added"));
    const day = storage.getCachedFuelToday("user-1", "2026-08-01");
    expect(day?.entriesBySlot.snack).toHaveLength(2);
  });

  it("skips dropped items", async () => {
    const { probe, storage } = await openWithDraft();
    act(() => probe().onToggleDraftItem(1));
    await waitFor(() => expect(probe().draftKcal).toBe(150));
    await act(async () => {
      probe().onConfirm();
    });
    await waitFor(() => expect(probe().stage).toBe("added"));
    const day = storage.getCachedFuelToday("user-1", "2026-08-03");
    expect(day?.entriesBySlot.breakfast).toHaveLength(1);
  });

  it("does nothing when every item is dropped", async () => {
    const { probe, storage } = await openWithDraft();
    act(() => probe().onToggleDraftItem(0));
    act(() => probe().onToggleDraftItem(1));
    await waitFor(() => expect(probe().draftKcal).toBe(0));
    await act(async () => {
      probe().onConfirm();
    });
    expect(probe().stage).toBe("draft");
    expect(storage.getCachedFuelToday("user-1", "2026-08-03")).toBeNull();
  });

  it("⚠ a double-tap on the confirm logs the draft ONCE", async () => {
    const { probe, storage } = await openWithDraft();
    await act(async () => {
      probe().onConfirm();
      probe().onConfirm();
    });
    await waitFor(() => expect(probe().stage).toBe("added"));
    const day = storage.getCachedFuelToday("user-1", "2026-08-03");
    expect(day?.entriesBySlot.breakfast).toHaveLength(2);
  });

  it("classifies a 429 as non-retryable and does not offer the paywall", async () => {
    const { probe } = mount((a) => {
      a.nextMealSuggestError = { status: 429, message: "ai_daily_limit" };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
    });
    await waitFor(() => expect(probe().stage).toBe("error"));
    expect(probe().errorRetryable).toBe(false);
    expect(probe().errorIsEntitlement).toBe(false);
  });

  it("flags a 402 as an entitlement failure and wires the paywall", async () => {
    const { probe } = mount((a) => {
      a.nextMealSuggestError = { status: 402, message: "denied" };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
    });
    await waitFor(() => expect(probe().stage).toBe("error"));
    expect(probe().errorIsEntitlement).toBe(true);
    act(() => probe().onUpgrade());
    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining("tier=premium_plus"),
    );
  });

  it("pushes the paywall instead of requesting when the gate denies mid-session", async () => {
    const api = new InMemoryApiAdapter();
    api.mySubscription = subscription("premium");
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <AdapterProvider
          adapters={makeAdapters(api, new InMemoryStorageAdapter())}
        >
          <MealprintSuggestSheetContainer />
        </AdapterProvider>
      </QueryClientProvider>,
    );
    open();
    await waitFor(() => expect(mockProbe.last?.visible).toBe(true));
    await act(async () => {
      mockProbe.last!.onGenerate();
    });
    expect(api.suggestMealsCalls).toHaveLength(0);
    expect(mockPush).toHaveBeenCalledWith(
      expect.stringContaining("tier=premium_plus"),
    );
  });

  it("resets to setup when reopened, discarding the previous draft", async () => {
    const { probe } = await openWithDraft();
    expect(probe().stage).toBe("draft");
    act(() => useFuelSheets.getState().close());
    await waitFor(() => expect(probe().visible).toBe(false));
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    expect(probe().stage).toBe("setup");
    expect(probe().draft).toBeNull();
    expect(probe().steer).toBe("");
    expect(probe().shape).toBe("either");
  });

  it("onClose clears the store only while this sheet is the visible one", async () => {
    const { probe } = mount();
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    act(() => probe().onClose());
    expect(useFuelSheets.getState().sheet).toBeNull();

    // A controlled handoff to another root sheet must be a no-op here, or the
    // Snap/Quick-add sheet would be closed out from under itself.
    act(() => useFuelSheets.getState().openSnap("lunch"));
    await waitFor(() => expect(probe().visible).toBe(false));
    act(() => probe().onClose());
    expect(useFuelSheets.getState().sheet).toBe("snap");
  });

  it("refuses to retry while offline", async () => {
    const { api, probe } = mount((a) => {
      a.nextMealSuggestError = { status: 503, message: "ai_unavailable" };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
    });
    await waitFor(() => expect(probe().stage).toBe("error"));
    // `useOnlineStatus` is mocked as a plain read, so flipping the flag alone does
    // not re-render — nudge a state change that does, the way a real connectivity
    // event would. (`onSlotChange` would NOT work here: the draft is null in the
    // error stage, so its setter returns the same value and React bails out.)
    mockOnline = false;
    act(() => probe().onSteerChange("x"));
    await waitFor(() => expect(probe().offline).toBe(true));
    await act(async () => {
      probe().onRetry();
    });
    expect(api.suggestMealsCalls).toHaveLength(1);
  });
});

/** Open, generate one suggestion and select it — the shared draft-stage setup. */
async function openWithDraft() {
  const harness = mount((a) => {
    a.mealSuggestResult = {
      suggestions: [suggestion()],
      emptyReason: null,
      remaining: null,
      containsUnverified: true,
      partialEnforcementOnly: false,
      labelCheckRequired: true,
    };
  });
  open();
  await waitFor(() => expect(harness.probe().visible).toBe(true));
  await act(async () => {
    harness.probe().onGenerate();
  });
  await waitFor(() => expect(harness.probe().stage).toBe("results"));
  act(() => harness.probe().onSelectSuggestion(0));
  await waitFor(() => expect(harness.probe().stage).toBe("draft"));
  return harness;
}

describe("MealprintSuggestSheetContainer — the disclaimer floor (Inspector 🟠)", () => {
  it("⚠ passes labelCheckRequired TRUE when a result omits the field", async () => {
    // `suggestMeals` is an unvalidated cast over the wire. A deploy skew or a DTO
    // refactor that dropped the field would otherwise render real suggestions with
    // NO allergen disclaimer — the exact failure the server's unconditional `true`
    // exists to prevent. Failing safe costs a redundant caveat.
    const { probe } = mount((a) => {
      a.mealSuggestResult = {
        suggestions: [suggestion()],
        emptyReason: null,
        remaining: null,
        containsUnverified: false,
        partialEnforcementOnly: false,
        // Modelling a body that predates (or postdates) the field.
        labelCheckRequired: undefined as never,
      };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    await act(async () => {
      probe().onGenerate();
    });
    await waitFor(() => expect(probe().stage).toBe("results"));
    expect(probe().labelCheckRequired).toBe(true);
  });

  it("threads the server's partialEnforcementOnly through as the caveat floor", async () => {
    const { probe } = mount((a) => {
      a.mealSuggestResult = {
        suggestions: [suggestion()],
        emptyReason: null,
        remaining: null,
        containsUnverified: false,
        partialEnforcementOnly: true,
        labelCheckRequired: true,
      };
    });
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    // No preferences cached, so the local patterns are empty — this is the halal
    // user on a fresh install whose preferences fetch has not landed.
    expect(probe().dietaryPatterns).toEqual([]);
    await act(async () => {
      probe().onGenerate();
    });
    await waitFor(() => expect(probe().stage).toBe("results"));
    expect(probe().serverPartialEnforcementOnly).toBe(true);
  });

  it("reports serverPartialEnforcementOnly false before any result", async () => {
    const { probe } = mount();
    open();
    await waitFor(() => expect(probe().visible).toBe(true));
    expect(probe().serverPartialEnforcementOnly).toBe(false);
  });
});

describe("MealprintSuggestSheetContainer — the post-confirm timer (Inspector 🟡)", () => {
  /**
   * Capture ONLY the 900 ms confirmation timer and leave every other `setTimeout`
   * alone — React Query's internals and the SQLite change bus both use it, so a
   * blanket fake would change what is under test.
   */
  function captureConfirmTimer() {
    const pending: (() => void)[] = [];
    const real = globalThis.setTimeout;
    const spy = jest.spyOn(globalThis, "setTimeout").mockImplementation(((
      fn: () => void,
      ms?: number,
      ...rest: unknown[]
    ) => {
      if (ms === 900) {
        pending.push(fn);
        return 0 as unknown as ReturnType<typeof setTimeout>;
      }
      return (real as (...a: unknown[]) => unknown)(fn, ms, ...rest);
    }) as never);
    return { pending, restore: () => spy.mockRestore() };
  }

  it("⚠ does NOT close a sibling sheet the user opened before it fired", async () => {
    // Users do not wait 900 ms. Dismiss "Added ✓" by backdrop or swipe, tap Scan,
    // and an unguarded `close()` sets `sheet: null` — snapping Scan shut. Same
    // reason `onSheetClose` guards on `visible`.
    const timer = captureConfirmTimer();
    try {
      const { probe } = await openWithDraft();
      await act(async () => {
        probe().onConfirm();
      });
      await waitFor(() => expect(probe().stage).toBe("added"));
      expect(timer.pending).toHaveLength(1);

      // The user dismisses and opens a sibling before the timer fires.
      act(() => useFuelSheets.getState().openScan("lunch"));
      expect(useFuelSheets.getState().sheet).toBe("scan");

      act(() => timer.pending[0]!());
      expect(useFuelSheets.getState().sheet).toBe("scan");
    } finally {
      timer.restore();
    }
  });

  it("still dismisses itself when it IS the sheet on screen", async () => {
    // The guard must not defeat the feature it guards.
    const timer = captureConfirmTimer();
    try {
      const { probe } = await openWithDraft();
      await act(async () => {
        probe().onConfirm();
      });
      await waitFor(() => expect(probe().stage).toBe("added"));
      act(() => timer.pending[0]!());
      expect(useFuelSheets.getState().sheet).toBeNull();
    } finally {
      timer.restore();
    }
  });
});

describe("MealprintSuggestSheetContainer — a confirm that fails PART-WAY (Inspector 🟢)", () => {
  it("⚠ surfaces a non-retryable error instead of a false success", async () => {
    // The loop awaits one mutation per item, so a throw on item 2 leaves item 1
    // logged. Falling through to `added` would dismiss the sheet 900 ms later and
    // the user would never know — then re-confirm and double-log item 1.
    const { probe, storage } = await openWithDraft();
    let calls = 0;
    const realEnqueue = storage.enqueueMutation.bind(storage);
    jest
      .spyOn(storage, "enqueueMutation")
      .mockImplementation((...args: Parameters<typeof realEnqueue>) => {
        calls += 1;
        if (calls === 2) throw new Error("sqlite: disk I/O error");
        return realEnqueue(...args);
      });

    await act(async () => {
      probe().onConfirm();
    });

    await waitFor(() => expect(probe().stage).toBe("error"));
    // Non-retryable ON PURPOSE: a retry re-logs whatever already landed.
    expect(probe().errorRetryable).toBe(false);
    expect(probe().errorIsEntitlement).toBe(false);
    expect(probe().errorMessage).toMatch(/check your meal log/i);
    // Fuel must still re-read — part of the draft really is logged.
    expect(useFuelSheets.getState().rev).toBe(1);
    // And the button is usable again rather than stuck spinning.
    expect(probe().confirming).toBe(false);
  });
});
