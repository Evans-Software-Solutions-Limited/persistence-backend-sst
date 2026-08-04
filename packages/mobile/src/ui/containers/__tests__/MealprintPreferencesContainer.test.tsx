import { act, render, waitFor } from "@testing-library/react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useFuelSheets } from "@/state/fuel-sheets";
import { DEFAULT_MEALPRINT_PREFERENCES } from "@/domain/models/mealprint";
import type { MealprintPreferencesProps } from "@/ui/presenters/mealprint/MealprintPreferencesPresenter";
import { MealprintPreferencesContainer } from "../MealprintPreferencesContainer";

const mockProbe: { last: MealprintPreferencesProps | null } = { last: null };
jest.mock("@/ui/presenters/mealprint/MealprintPreferencesPresenter", () => ({
  MealprintPreferencesPresenter: (props: MealprintPreferencesProps) => {
    mockProbe.last = props;
    return null;
  },
}));

const mockBack = jest.fn();
const mockPush = jest.fn();
// ⚠ The `router` singleton's methods must be forwarding arrows, not the
// `jest.fn()`s directly: `jest.mock` factories are hoisted, so an eagerly-built
// object literal captures `mockBack`/`mockPush` before they are initialised and
// the container gets `router.back is not a function`.
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    back: (...a: unknown[]) => mockBack(...a),
    push: (...a: unknown[]) => mockPush(...a),
  },
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

// The container drains the sync queue inline after Save (optimistic cache +
// queue, drained for immediacy). That drain calls global fetch.
const mockFetch = jest.fn();
mockFetch.mockResolvedValue({
  ok: true,
  status: 200,
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
  mode: "wizard" | "editor" = "editor",
  seed?: (api: InMemoryApiAdapter, storage: InMemoryStorageAdapter) => void,
) {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  seed?.(api, storage);
  const utils = render(
    <AdapterProvider adapters={makeAdapters(api, storage)}>
      <MealprintPreferencesContainer mode={mode} />
    </AdapterProvider>,
  );
  return { ...utils, api, storage, probe: () => mockProbe.last! };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockProbe.last = null;
  useFuelSheets.setState({ rev: 0 });
});

/**
 * The preference write is QUEUED, not sent through the api adapter — so the
 * evidence is the sync worker's `fetch`, not `api.setMealprintPreferencesCalls`
 * (which the adapter's own method would populate and this path never reaches).
 */
function preferencePuts(): { url: string; body: unknown }[] {
  return mockFetch.mock.calls
    .map(([url, init]) => ({
      url: String(url),
      init: init as { method?: string; body?: string } | undefined,
    }))
    .filter(
      ({ url, init }) =>
        url.endsWith("/nutrition/preferences") && init?.method === "PUT",
    )
    .map(({ url, init }) => ({
      url,
      body: init?.body ? JSON.parse(init.body) : null,
    }));
}

describe("MealprintPreferencesContainer", () => {
  it("seeds the form from the fetched preferences", async () => {
    const { probe } = mount("editor", (api) => {
      api.mealprintPreferences = {
        ...api.mealprintPreferences,
        dietaryPatterns: ["vegan", "gluten_free"],
        avoidAllergens: ["peanuts"],
        avoidFoods: ["olives"],
        likedFoods: ["tofu"],
        mealsPerDay: 5,
        effortLevel: "quick",
        isDefault: false,
      };
    });

    await waitFor(() => expect(probe().dietaryPatterns).toHaveLength(2));
    expect(probe().avoidAllergens).toEqual(["peanuts"]);
    expect(probe().avoidFoods).toEqual(["olives"]);
    expect(probe().likedFoods).toEqual(["tofu"]);
    expect(probe().mealsPerDay).toBe(5);
    expect(probe().effortLevel).toBe("quick");
  });

  it("⚠ drops vocabulary values this build does not recognise instead of rendering a dead chip", async () => {
    // The DTO types these as `string[]`; a row written by a newer server would
    // otherwise render an undefined-labelled chip AND be echoed back on save.
    const { probe } = mount("editor", (api) => {
      api.mealprintPreferences = {
        ...api.mealprintPreferences,
        dietaryPatterns: ["vegan", "carnivore"],
        avoidAllergens: ["milk", "kiwi"],
        isDefault: false,
      };
    });
    await waitFor(() => expect(probe().dietaryPatterns).toEqual(["vegan"]));
    expect(probe().avoidAllergens).toEqual(["milk"]);
  });

  it("clamps an out-of-range mealsPerDay from the wire", async () => {
    const { probe } = mount("editor", (api) => {
      api.mealprintPreferences = {
        ...api.mealprintPreferences,
        mealsPerDay: 99,
        isDefault: false,
      };
    });
    await waitFor(() => expect(probe().mealsPerDay).toBe(6));
  });

  it("⚠ does NOT re-seed once the user has started editing", async () => {
    // The latch: a network refresh landing a second after mount must not discard
    // typing — on this screen that means losing an allergen selection.
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Cache holds one shape; the fetch will answer with a different one.
    storage.cacheMealprintPreferences("user-1", {
      ...api.mealprintPreferences,
      mealsPerDay: 3,
      isDefault: false,
    });
    api.mealprintPreferences = {
      ...api.mealprintPreferences,
      mealsPerDay: 6,
      isDefault: false,
    };

    render(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <MealprintPreferencesContainer mode="editor" />
      </AdapterProvider>,
    );

    await waitFor(() => expect(mockProbe.last?.mealsPerDay).toBe(3));
    // The user changes it; the refresh has landed by now.
    act(() => mockProbe.last!.onMealsPerDayChange(2));
    await waitFor(() => expect(mockProbe.last?.mealsPerDay).toBe(2));
    // Still 2, not the fetched 6.
    expect(mockProbe.last?.mealsPerDay).toBe(2);
  });

  it("toggles a pattern on and off", async () => {
    const { probe } = mount();
    await waitFor(() => expect(probe().dietaryPatterns).toEqual([]));
    act(() => probe().onTogglePattern("vegan"));
    await waitFor(() => expect(probe().dietaryPatterns).toEqual(["vegan"]));
    act(() => probe().onTogglePattern("vegan"));
    await waitFor(() => expect(probe().dietaryPatterns).toEqual([]));
  });

  it("toggles an allergen on and off", async () => {
    const { probe } = mount();
    await waitFor(() => expect(probe().avoidAllergens).toEqual([]));
    act(() => probe().onToggleAllergen("sesame"));
    await waitFor(() => expect(probe().avoidAllergens).toEqual(["sesame"]));
    act(() => probe().onToggleAllergen("sesame"));
    await waitFor(() => expect(probe().avoidAllergens).toEqual([]));
  });

  it("adds a dislike, trimming and collapsing whitespace", async () => {
    const { probe } = mount();
    await waitFor(() => expect(probe().avoidFoods).toEqual([]));
    act(() => probe().onAvoidFoodDraftChange("  button   mushrooms  "));
    act(() => probe().onAddAvoidFood());
    await waitFor(() =>
      expect(probe().avoidFoods).toEqual(["button mushrooms"]),
    );
    // The draft clears so the field is ready for the next entry.
    expect(probe().avoidFoodDraft).toBe("");
  });

  it("dedupes case-insensitively — the server normalises, so 'Olives' and 'olives' are one row", async () => {
    const { probe } = mount();
    await waitFor(() => expect(probe().avoidFoods).toEqual([]));
    act(() => probe().onAvoidFoodDraftChange("Olives"));
    act(() => probe().onAddAvoidFood());
    await waitFor(() => expect(probe().avoidFoods).toEqual(["Olives"]));
    act(() => probe().onAvoidFoodDraftChange("olives"));
    act(() => probe().onAddAvoidFood());
    await waitFor(() => expect(probe().avoidFoods).toEqual(["Olives"]));
  });

  it("ignores an empty or whitespace-only entry", async () => {
    const { probe } = mount();
    await waitFor(() => expect(probe().avoidFoods).toEqual([]));
    act(() => probe().onAvoidFoodDraftChange("   "));
    act(() => probe().onAddAvoidFood());
    expect(probe().avoidFoods).toEqual([]);
  });

  it("refuses an over-long entry client-side rather than earning a 400 from the queue", async () => {
    // ⚠ The write is QUEUED, so a rejected PUT surfaces on the sync-failure screen
    // minutes later. The keystroke is the only good place to refuse it.
    const { probe } = mount();
    await waitFor(() => expect(probe().avoidFoods).toEqual([]));
    act(() => probe().onAvoidFoodDraftChange("x".repeat(121)));
    act(() => probe().onAddAvoidFood());
    expect(probe().avoidFoods).toEqual([]);
  });

  it("removes a dislike and a like", async () => {
    const { probe } = mount("editor", (api) => {
      api.mealprintPreferences = {
        ...api.mealprintPreferences,
        avoidFoods: ["olives", "marmite"],
        likedFoods: ["tofu"],
        isDefault: false,
      };
    });
    await waitFor(() => expect(probe().avoidFoods).toHaveLength(2));
    act(() => probe().onRemoveAvoidFood("olives"));
    await waitFor(() => expect(probe().avoidFoods).toEqual(["marmite"]));
    act(() => probe().onRemoveLikedFood("tofu"));
    await waitFor(() => expect(probe().likedFoods).toEqual([]));
  });

  it("adds and dedupes likes on the same rules as dislikes", async () => {
    const { probe } = mount();
    await waitFor(() => expect(probe().likedFoods).toEqual([]));
    act(() => probe().onLikedFoodDraftChange("Chicken thighs"));
    act(() => probe().onAddLikedFood());
    await waitFor(() => expect(probe().likedFoods).toEqual(["Chicken thighs"]));
    act(() => probe().onLikedFoodDraftChange("chicken thighs"));
    act(() => probe().onAddLikedFood());
    expect(probe().likedFoods).toEqual(["Chicken thighs"]);
    act(() => probe().onLikedFoodDraftChange(""));
    act(() => probe().onAddLikedFood());
    expect(probe().likedFoods).toEqual(["Chicken thighs"]);
  });

  it("clamps the meals stepper at both ends", async () => {
    const { probe } = mount();
    await waitFor(() => expect(probe().mealsPerDay).toBe(4));
    act(() => probe().onMealsPerDayChange(99));
    await waitFor(() => expect(probe().mealsPerDay).toBe(6));
    act(() => probe().onMealsPerDayChange(0));
    await waitFor(() => expect(probe().mealsPerDay).toBe(2));
  });

  it("changes the effort level", async () => {
    const { probe } = mount();
    await waitFor(() => expect(probe().effortLevel).toBe("balanced"));
    act(() => probe().onEffortLevelChange("high_maintenance"));
    await waitFor(() => expect(probe().effortLevel).toBe("high_maintenance"));
  });

  it("saves the edited shape, notifies Fuel and navigates back", async () => {
    const { probe, storage } = mount();
    await waitFor(() => expect(probe().mealsPerDay).toBe(4));
    act(() => probe().onToggleAllergen("milk"));
    act(() => probe().onEffortLevelChange("quick"));
    await act(async () => {
      probe().onSave();
    });

    await waitFor(() => expect(preferencePuts()).toHaveLength(1));
    expect(preferencePuts()[0]?.body).toMatchObject({
      avoidAllergens: ["milk"],
      effortLevel: "quick",
      locale: "en-GB",
    });
    expect(storage.getCachedMealprintPreferences("user-1")?.isDefault).toBe(
      false,
    );
    // Fuel's entry card reads the same cache — nudge it so a first-run save stops
    // offering the wizard immediately.
    expect(useFuelSheets.getState().rev).toBe(1);
    expect(mockBack).toHaveBeenCalled();
  });

  it("⚠ wizard SKIP saves the defaults rather than just navigating back (AC 1.4)", async () => {
    // Skipping is a real choice. Persisting it is what stops `isDefault` staying
    // true and the wizard reappearing on every launch.
    const { probe } = mount("wizard");
    await waitFor(() => expect(probe().mode).toBe("wizard"));
    await act(async () => {
      probe().onDismiss();
    });
    await waitFor(() => expect(preferencePuts()).toHaveLength(1));
    expect(preferencePuts()[0]?.body).toEqual({
      ...DEFAULT_MEALPRINT_PREFERENCES,
      dietaryPatterns: [],
      avoidAllergens: [],
      avoidFoods: [],
      likedFoods: [],
    });
    expect(mockBack).toHaveBeenCalled();
  });

  it("editor CANCEL discards — no write at all", async () => {
    const { probe, storage } = mount("editor");
    await waitFor(() => expect(probe().mode).toBe("editor"));
    act(() => probe().onToggleAllergen("milk"));
    await act(async () => {
      probe().onDismiss();
    });
    expect(preferencePuts()).toHaveLength(0);
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(mockBack).toHaveBeenCalled();
  });

  it("⚠ a double-tap on Save enqueues ONE write, not two full replacements", async () => {
    const { probe } = mount();
    await waitFor(() => expect(probe().mealsPerDay).toBe(4));
    await act(async () => {
      probe().onSave();
      probe().onSave();
    });
    await waitFor(() => expect(preferencePuts()).toHaveLength(1));
    expect(preferencePuts()).toHaveLength(1);
  });

  it("reports a load failure without blocking the form once anything is cached", async () => {
    const api = new InMemoryApiAdapter();
    api.shouldFail = true;
    const storage = new InMemoryStorageAdapter();
    storage.cacheMealprintPreferences("user-1", {
      ...api.mealprintPreferences,
      mealsPerDay: 3,
      isDefault: false,
    });
    render(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <MealprintPreferencesContainer mode="editor" />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last?.mealsPerDay).toBe(3));
    // Cache present → the form is usable, so no blocking loader and no banner.
    expect(mockProbe.last?.isLoadingInitial).toBe(false);
  });

  it("withholds the form entirely when there is nothing cached to edit", async () => {
    const api = new InMemoryApiAdapter();
    api.shouldFail = true;
    // ⚠ `unauthorized`, not the fake's default `server`. `useCachedResource` runs
    // a cold-start retry ladder (0 / 1500 / 4000 ms) on an EMPTY cache for
    // retryable codes, so a `server` failure would not surface inside `waitFor`'s
    // 1 s budget — and the test would be asserting the retry, not the error state.
    api.failError = { kind: "api", code: "unauthorized", message: "nope" };
    render(
      <AdapterProvider
        adapters={makeAdapters(api, new InMemoryStorageAdapter())}
      >
        <MealprintPreferencesContainer mode="editor" />
      </AdapterProvider>,
    );
    // ⚠ `loadFailed`, not an inline error banner. An editable form over an unread
    // server row is a delete button for the user's allergen list — see the
    // "unseeded-write guard" block below.
    await waitFor(() => expect(mockProbe.last?.loadFailed).toBe(true));
    expect(mockProbe.last?.isLoadingInitial).toBe(false);
  });
});

describe("MealprintPreferencesContainer — caps and the signed-out path", () => {
  it("refuses a free-text entry once the cap is reached", async () => {
    // ⚠ The list cap, not the per-entry length cap. Enforced here as well as by the
    // handler and the DB CHECK, because the write is QUEUED — a server rejection
    // surfaces on the sync-failure screen minutes later, not inline.
    const full = Array.from({ length: 60 }, (_, i) => `food-${i}`);
    const { probe } = mount("editor", (api) => {
      api.mealprintPreferences = {
        ...api.mealprintPreferences,
        avoidFoods: full,
        likedFoods: full,
        isDefault: false,
      };
    });
    await waitFor(() => expect(probe().avoidFoods).toHaveLength(60));

    act(() => probe().onAvoidFoodDraftChange("one more"));
    act(() => probe().onAddAvoidFood());
    await waitFor(() => expect(probe().avoidFoodDraft).toBe(""));
    expect(probe().avoidFoods).toHaveLength(60);

    act(() => probe().onLikedFoodDraftChange("one more"));
    act(() => probe().onAddLikedFood());
    await waitFor(() => expect(probe().likedFoodDraft).toBe(""));
    expect(probe().likedFoods).toHaveLength(60);
  });

  it("refuses an over-long LIKE entry too", async () => {
    const { probe } = mount();
    await waitFor(() => expect(probe().likedFoods).toEqual([]));
    act(() => probe().onLikedFoodDraftChange("y".repeat(121)));
    act(() => probe().onAddLikedFood());
    expect(probe().likedFoods).toEqual([]);
  });

  it("ignores an unrecognised effortLevel from the wire rather than desyncing the segmented control", async () => {
    const { probe } = mount("editor", (api) => {
      api.mealprintPreferences = {
        ...api.mealprintPreferences,
        // Cast: the DTO narrows this, but it is a plain string on the wire and a
        // newer server could send a level this build has no option for.
        effortLevel: "extreme" as never,
        mealsPerDay: 5,
        isDefault: false,
      };
    });
    await waitFor(() => expect(probe().mealsPerDay).toBe(5));
    expect(probe().effortLevel).toBe("balanced");
  });

  it("says so — and does NOT navigate away — when there is no session to save under", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const adapters = makeAdapters(api, storage);
    // ⚠ The REACHABLE shape of the no-session save. Opening the screen already
    // signed out cannot get here — with no userId the cache read yields null, so
    // the unseeded-write guard short-circuits first. Signing out from ANOTHER
    // surface while this screen is open does: `seededRef` is already armed, so
    // `commit` proceeds and `mutate` answers null. Navigating back then would claim
    // a save that never happened.
    let emit: ((s: AuthSession | null) => void) | null = null;
    (
      adapters.auth as unknown as { onAuthStateChange: jest.Mock }
    ).onAuthStateChange = jest.fn((cb: (s: AuthSession | null) => void) => {
      emit = cb;
      cb(SESSION);
      return () => {};
    });

    render(
      <AdapterProvider adapters={adapters}>
        <MealprintPreferencesContainer mode="editor" />
      </AdapterProvider>,
    );
    // Seeded from the 404-free default row while still signed in.
    await waitFor(() => expect(mockProbe.last?.mealsPerDay).toBe(4));
    expect(mockProbe.last?.loadFailed).toBe(false);

    await act(async () => {
      emit?.(null);
    });
    await act(async () => {
      mockProbe.last!.onSave();
    });
    await waitFor(() =>
      expect(mockProbe.last?.errorMessage).toMatch(/signed in/i),
    );
    expect(mockBack).not.toHaveBeenCalled();
    expect(preferencePuts()).toHaveLength(0);
  });
});

describe("MealprintPreferencesContainer — Skip must not erase saved choices (Brad, device)", () => {
  /**
   * ⚠ The THIRD route into an allergen wipe, and the one the `isUnseeded` guard
   * cannot see, because here the read SUCCEEDS.
   *
   * `useMealprintEntry` reads preferences CACHE-ONLY, so on a reinstall / new
   * device / sign-out-in, `data === null` → the Fuel card reports `needsSetup` →
   * it opens the WIZARD. This container then fetches for itself, succeeds, and
   * seeds the form with the user's real allergen list. `isUnseeded` is now false,
   * so the old code fell straight through to `commit(DEFAULT_MEALPRINT_PREFERENCES)`.
   * One tap on the only exit the wizard offered, and the allergens were gone.
   *
   * Found by Brad on device, from the observation that the wizard has no Cancel —
   * only a Skip. The missing button and the data loss were the same defect.
   */
  function mountWizardOverSavedChoices() {
    const api = new InMemoryApiAdapter();
    api.mealprintPreferences = {
      ...api.mealprintPreferences,
      avoidAllergens: ["peanuts"],
      avoidFoods: ["olives"],
      isDefault: false,
    };
    const storage = new InMemoryStorageAdapter();
    render(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <MealprintPreferencesContainer mode="wizard" />
      </AdapterProvider>,
    );
    return { api, storage, probe: () => mockProbe.last! };
  }

  it("⚠ dismissing the wizard over SAVED choices writes NOTHING", async () => {
    const { probe, storage } = mountWizardOverSavedChoices();
    // Wait for the seed, so `isUnseeded` is genuinely false — otherwise this test
    // would pass via the older guard and prove nothing.
    await waitFor(() => expect(probe().avoidAllergens).toEqual(["peanuts"]));
    expect(probe().loadFailed).toBe(false);

    await act(async () => {
      probe().onDismiss();
    });

    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(preferencePuts()).toHaveLength(0);
    expect(mockBack).toHaveBeenCalled();
  });

  it("calls it Cancel, not Skip, when there is something to keep", async () => {
    // "Skip setup" is what makes a user expect their answers to be discarded, so
    // the label has to follow the behaviour.
    const { probe } = mountWizardOverSavedChoices();
    await waitFor(() => expect(probe().avoidAllergens).toEqual(["peanuts"]));
    expect(probe().dismissLabel).toBe("Cancel");
  });

  it("⚠ but a GENUINE first run still saves the defaults — that write is what stops the wizard reappearing", async () => {
    // AC 1.4. `isDefault: true` is the endpoint's no-row answer, so there is
    // nothing to preserve and the write is the whole point.
    const probe = (() => {
      const api = new InMemoryApiAdapter();
      api.mealprintPreferences = {
        ...api.mealprintPreferences,
        isDefault: true,
      };
      render(
        <AdapterProvider
          adapters={makeAdapters(api, new InMemoryStorageAdapter())}
        >
          <MealprintPreferencesContainer mode="wizard" />
        </AdapterProvider>,
      );
      return () => mockProbe.last!;
    })();

    await waitFor(() => expect(probe().isLoadingInitial).toBe(false));
    expect(probe().dismissLabel).toBe("Skip");

    await act(async () => {
      probe().onDismiss();
    });
    // The queue is drained inline after commit, so assert on the PUT that went
    // out rather than on a pending mutation that has already been flushed.
    await waitFor(() => expect(preferencePuts()).toHaveLength(1));
    expect(preferencePuts()[0].body).toMatchObject({ avoidAllergens: [] });
  });
});

describe("MealprintPreferencesContainer — STALE CACHE wipes (Inspector 🟠, 4th sweep)", () => {
  /**
   * Device A cached `{isDefault: true}` (opened the editor once, cancelled). The
   * user then set allergens on device B. Back on A the cache is a HIT, so the form
   * is live immediately and every guard computed from `data` sees "nothing saved".
   */
  function mountStaleCache(mode: "wizard" | "editor") {
    const api = new InMemoryApiAdapter();
    // Server truth: the user HAS allergens.
    api.mealprintPreferences = {
      ...api.mealprintPreferences,
      avoidAllergens: ["peanuts"],
      isDefault: false,
    };
    const storage = new InMemoryStorageAdapter();
    // Cache truth: an older, default row.
    storage.cacheMealprintPreferences(SESSION.userId, {
      ...api.mealprintPreferences,
      avoidAllergens: [],
      isDefault: true,
    });
    render(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <MealprintPreferencesContainer mode={mode} />
      </AdapterProvider>,
    );
    return { api, storage, probe: () => mockProbe.last! };
  }

  // ⚠ HONESTY NOTE: this does NOT isolate the pre-fetch window — `act` flushes the
  // in-memory fetch before `onDismiss` runs, so `hasSavedChoices` blocks the write
  // here regardless of `serverTruthKnown`. Verified: it passes with the guard
  // reverted. It is kept as an end-to-end "no write on this path" assertion; the
  // test that actually pins `serverTruthKnown` is the label one below, which DOES
  // fail when reverted. Isolating the window needs a fetch whose resolution the test
  // controls.
  it("does not write on the stale-cache wizard path (end-to-end, not window-isolating)", async () => {
    const { probe, storage } = mountStaleCache("wizard");
    await act(async () => {
      probe().onDismiss();
    });
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(preferencePuts()).toHaveLength(0);
    expect(mockBack).toHaveBeenCalled();
  });

  it("⚠ and does not offer 'Skip' while the server is still unknown", async () => {
    const { probe } = mountStaleCache("wizard");
    // Before server truth lands the label must not promise a write.
    expect(probe().dismissLabel).toBe("Cancel");
  });

  it("⚠ RE-SEEDS from the network, so SAVE cannot write the stale row over the new one", async () => {
    // No race needed for this one: the old `seededRef` bail pinned the form to the
    // cache for life, so the form showed empty allergens and Save destroyed the
    // real list.
    const { probe } = mountStaleCache("editor");
    await waitFor(() => expect(probe().avoidAllergens).toEqual(["peanuts"]));
  });

  it("still does not re-seed over edits the user has already made", async () => {
    // The guarantee `touchedRef` exists for — re-seeding must not clobber a live edit.
    const { probe } = mountStaleCache("editor");
    await act(async () => {
      probe().onToggleAllergen("sesame");
    });
    await waitFor(() => expect(probe().avoidAllergens).toContain("sesame"));
    // The network value must NOT overwrite the user's own selection.
    expect(probe().avoidAllergens).not.toEqual(["peanuts"]);
  });
});

describe("MealprintPreferencesContainer — the unseeded-write guard (Inspector 🔴)", () => {
  /** A device with an EMPTY cache whose preferences read fails. */
  function mountUnseededFailure(mode: "wizard" | "editor") {
    const api = new InMemoryApiAdapter();
    api.shouldFail = true;
    // Non-retryable, so the error surfaces inside waitFor's budget rather than
    // sitting in `useCachedResource`'s cold-start retry ladder.
    api.failError = { kind: "api", code: "unauthorized", message: "nope" };
    const storage = new InMemoryStorageAdapter();
    render(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <MealprintPreferencesContainer mode={mode} />
      </AdapterProvider>,
    );
    return { api, storage, probe: () => mockProbe.last! };
  }

  it("tells the presenter to withhold the form", async () => {
    const { probe } = mountUnseededFailure("editor");
    await waitFor(() => expect(probe().loadFailed).toBe(true));
    expect(probe().isLoadingInitial).toBe(false);
  });

  it("⚠ SAVE writes nothing — a full replacement built from empty defaults would delete the server's allergen list", async () => {
    const { probe, storage } = mountUnseededFailure("editor");
    await waitFor(() => expect(probe().loadFailed).toBe(true));
    await act(async () => {
      probe().onSave();
    });
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(preferencePuts()).toHaveLength(0);
    await waitFor(() =>
      expect(probe().errorMessage).toMatch(/nothing to save yet/i),
    );
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("⚠ the WIZARD's skip writes nothing either — it is a real save of the defaults", async () => {
    // This is the reachable path: an empty cache makes `useMealprintEntry` report
    // `needsSetup`, so a reinstalled device opens the wizard first — and Skip would
    // have queued four empty arrays over a real server row.
    const { probe, storage } = mountUnseededFailure("wizard");
    await waitFor(() => expect(probe().loadFailed).toBe(true));
    await act(async () => {
      probe().onDismiss();
    });
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(preferencePuts()).toHaveLength(0);
    // …and it still lets the user leave, rather than trapping them.
    expect(mockBack).toHaveBeenCalled();
  });

  it("re-reads on retry, and the form unlocks once the read lands", async () => {
    const api = new InMemoryApiAdapter();
    api.shouldFail = true;
    api.failError = { kind: "api", code: "unauthorized", message: "nope" };
    render(
      <AdapterProvider
        adapters={makeAdapters(api, new InMemoryStorageAdapter())}
      >
        <MealprintPreferencesContainer mode="editor" />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last?.loadFailed).toBe(true));

    api.shouldFail = false;
    api.mealprintPreferences = {
      ...api.mealprintPreferences,
      avoidAllergens: ["peanuts"],
      isDefault: false,
    };
    await act(async () => {
      mockProbe.last!.onRetryLoad();
    });
    await waitFor(() => expect(mockProbe.last?.loadFailed).toBe(false));
    // Seeded from the server row, so a Save now replaces it with the same data.
    expect(mockProbe.last?.avoidAllergens).toEqual(["peanuts"]);
  });

  it("⚠ a refresh that fails AFTER seeding does NOT tear the form down", async () => {
    // The guard is about an UNSEEDED form. A user editing real values must not have
    // the screen replaced under them because a background refresh blipped.
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheMealprintPreferences("user-1", {
      ...api.mealprintPreferences,
      avoidAllergens: ["milk"],
      isDefault: false,
    });
    api.shouldFail = true;
    api.failError = { kind: "api", code: "unauthorized", message: "nope" };

    render(
      <AdapterProvider adapters={makeAdapters(api, storage)}>
        <MealprintPreferencesContainer mode="editor" />
      </AdapterProvider>,
    );
    await waitFor(() =>
      expect(mockProbe.last?.avoidAllergens).toEqual(["milk"]),
    );
    expect(mockProbe.last?.loadFailed).toBe(false);

    // …and the save still works off the seeded values.
    await act(async () => {
      mockProbe.last!.onSave();
    });
    await waitFor(() => expect(preferencePuts()).toHaveLength(1));
    expect(preferencePuts()[0]?.body).toMatchObject({
      avoidAllergens: ["milk"],
    });
  });
});
