import { act, render, waitFor } from "@testing-library/react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { ProfilePageData } from "@/domain/models/profilePage";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { FuelTargetsPresenterProps } from "@/ui/presenters/FuelTargetsPresenter";
import { FuelTargetsContainer } from "../FuelTargetsContainer";

const mockProbe: { last: FuelTargetsPresenterProps | null } = { last: null };
jest.mock("@/ui/presenters/FuelTargetsPresenter", () => ({
  FuelTargetsPresenter: (props: FuelTargetsPresenterProps) => {
    mockProbe.last = props;
    return null;
  },
}));

const mockBack = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));

// The container fires an inline `processSyncQueue` drain after Save
// (offline-first: optimistic cache + queue, drain for immediacy). That drain
// calls global fetch — stub it so the drain resolves cleanly.
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
  email: "alex@example.com",
  expiresAt: Date.now() + 60_000,
};

function makeProfilePagePayload(
  overrides: Partial<ProfilePageData["profile"]> = {},
): ProfilePageData {
  return {
    profile: {
      id: "user-1",
      fullName: "Alex",
      email: "alex@example.com",
      username: null,
      avatarUrl: null,
      role: "user",
      fitnessLevel: "intermediate",
      dateOfBirth: "1996-01-15",
      gender: "male",
      heightCm: 178,
      weightKg: 79.8,
      preferredUnits: "metric",
      isProfilePublic: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    },
    subscription: {
      tierName: null,
      tierDisplayName: null,
      status: null,
      isFreeTier: true,
      isTrainerTier: false,
      expiresAt: null,
      cancelledAt: null,
      workoutLimit: null,
      isUnlimited: false,
    },
    stats: { workoutsCompleted: 0 },
    recentAchievements: [],
    activeTrainers: [],
    pendingTrainerRequests: [],
  };
}

function makeAdapters(): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
  storage: InMemoryStorageAdapter;
} {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const auth = {
    getSession: jest.fn(async () => ok(SESSION)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(SESSION);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api,
    storage,
    adapters: {
      api,
      auth,
      storage,
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {} as Adapters["netInfo"],
    },
  };
}

describe("FuelTargetsContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    mockBack.mockClear();
    mockPush.mockClear();
    mockFetch.mockClear();
  });

  it("derives age/gender/height/weight from the profile and computes a live kcal target", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheProfilePage("user-1", makeProfilePagePayload());
    render(
      <AdapterProvider adapters={adapters}>
        <FuelTargetsContainer />
      </AdapterProvider>,
    );

    await waitFor(() => expect(mockProbe.last?.age).not.toBeNull());
    expect(mockProbe.last?.gender).toBe("male");
    expect(mockProbe.last?.heightCm).toBe(178);
    expect(mockProbe.last?.weightKg).toBe(79.8);
    // Complete profile (male/age/height/weight) + default moderate activity +
    // maintain goal → a real, non-null kcal target.
    expect(mockProbe.last?.kcal).not.toBeNull();
    expect(mockProbe.last?.macroGrams).not.toBeNull();
  });

  it("shows null kcal/macros when the profile is incomplete (no gender set)", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheProfilePage(
      "user-1",
      makeProfilePagePayload({ gender: null }),
    );
    render(
      <AdapterProvider adapters={adapters}>
        <FuelTargetsContainer />
      </AdapterProvider>,
    );

    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    expect(mockProbe.last?.gender).toBeNull();
    expect(mockProbe.last?.kcal).toBeNull();
    expect(mockProbe.last?.macroGrams).toBeNull();
  });

  it("recomputes tdee/kcal live when the activity level changes", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheProfilePage("user-1", makeProfilePagePayload());
    render(
      <AdapterProvider adapters={adapters}>
        <FuelTargetsContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last?.tdee).not.toBeNull());
    const moderateTdee = mockProbe.last!.tdee!;

    await act(async () => {
      mockProbe.last?.onActivityChange("athlete");
    });
    expect(mockProbe.last?.activityId).toBe("athlete");
    // Athlete multiplier (1.9) > moderate (1.55) for the same BMR.
    expect(mockProbe.last!.tdee!).toBeGreaterThan(moderateTdee);
  });

  it("surfaces the trainer-attribution name from an existing coach-set target", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheProfilePage("user-1", makeProfilePagePayload());
    api.nutritionTarget = {
      userId: "user-1",
      dailyKcal: 2200,
      proteinG: 165,
      carbsG: 220,
      fatG: 61,
      waterCups: 10,
      preset: "custom",
      setByUserId: "coach-1",
      setByName: "Coach Bradley",
      updatedAt: "2026-06-01T00:00:00.000Z",
    };
    render(
      <AdapterProvider adapters={adapters}>
        <FuelTargetsContainer />
      </AdapterProvider>,
    );
    await waitFor(() =>
      expect(mockProbe.last?.trainerName).toBe("Coach Bradley"),
    );
  });

  it("has no trainer attribution when no target exists", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheProfilePage("user-1", makeProfilePagePayload());
    render(
      <AdapterProvider adapters={adapters}>
        <FuelTargetsContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    expect(mockProbe.last?.trainerName).toBeNull();
  });

  it("hydrates the water goal from an existing target once (a later refresh doesn't clobber a user edit)", async () => {
    const { adapters, api, storage } = makeAdapters();
    storage.cacheProfilePage("user-1", makeProfilePagePayload());
    api.nutritionTarget = {
      userId: "user-1",
      dailyKcal: 2200,
      proteinG: 165,
      carbsG: 220,
      fatG: 61,
      waterCups: 10,
      preset: "custom",
      setByUserId: null,
      setByName: null,
      updatedAt: "2026-06-01T00:00:00.000Z",
    };
    render(
      <AdapterProvider adapters={adapters}>
        <FuelTargetsContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last?.waterCups).toBe(10));

    await act(async () => {
      mockProbe.last?.onWaterCupsChange(12);
    });
    expect(mockProbe.last?.waterCups).toBe(12);
  });

  it("defaults the water goal to 8 cups when no target exists", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheProfilePage("user-1", makeProfilePagePayload());
    render(
      <AdapterProvider adapters={adapters}>
        <FuelTargetsContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    expect(mockProbe.last?.waterCups).toBe(8);
  });

  it("switching into Custom mode snapshots the previous preset's split; sliders then update it independently (no rebalance)", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheProfilePage("user-1", makeProfilePagePayload());
    render(
      <AdapterProvider adapters={adapters}>
        <FuelTargetsContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last?.macroMode).toBe("maintain"));

    await act(async () => {
      mockProbe.last?.onMacroModeChange("cut");
    });
    expect(mockProbe.last?.macroSplit).toEqual({
      proteinPct: 40,
      carbsPct: 35,
      fatPct: 25,
    });

    await act(async () => {
      mockProbe.last?.onMacroModeChange("custom");
    });
    // Custom starts from 'cut's values, not some other stale default.
    expect(mockProbe.last?.macroSplit).toEqual({
      proteinPct: 40,
      carbsPct: 35,
      fatPct: 25,
    });

    await act(async () => {
      mockProbe.last?.onProteinPctChange(60);
    });
    // Protein moves alone — carbs/fat untouched (no auto-rebalance).
    expect(mockProbe.last?.macroSplit).toEqual({
      proteinPct: 60,
      carbsPct: 35,
      fatPct: 25,
    });

    await act(async () => {
      mockProbe.last?.onCarbsPctChange(10);
    });
    await act(async () => {
      mockProbe.last?.onFatPctChange(30);
    });
    // Each slider updates only its own field.
    expect(mockProbe.last?.macroSplit).toEqual({
      proteinPct: 60,
      carbsPct: 10,
      fatPct: 30,
    });
  });

  it("onOpenProfile routes to Edit Profile", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheProfilePage("user-1", makeProfilePagePayload());
    render(
      <AdapterProvider adapters={adapters}>
        <FuelTargetsContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    await act(async () => {
      mockProbe.last?.onOpenProfile();
    });
    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/edit");
  });

  it("onCancel routes back", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheProfilePage("user-1", makeProfilePagePayload());
    render(
      <AdapterProvider adapters={adapters}>
        <FuelTargetsContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last).not.toBeNull());
    await act(async () => {
      mockProbe.last?.onCancel();
    });
    expect(mockBack).toHaveBeenCalled();
  });

  it("Save PUTs the live-computed kcal/macros/water and routes back", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheProfilePage("user-1", makeProfilePagePayload());
    render(
      <AdapterProvider adapters={adapters}>
        <FuelTargetsContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last?.kcal).not.toBeNull());
    const { kcal, macroGrams, waterCups, macroMode } = mockProbe.last!;

    await act(async () => {
      await mockProbe.last?.onSave();
    });

    await waitFor(() => expect(mockBack).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/nutrition/targets");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({
      dailyKcal: kcal,
      proteinG: macroGrams!.proteinG,
      carbsG: macroGrams!.carbsG,
      fatG: macroGrams!.fatG,
      waterCups,
      preset: macroMode,
    });
  });

  it("does not save (and shows an error) when the profile is incomplete", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheProfilePage(
      "user-1",
      makeProfilePagePayload({ gender: null }),
    );
    render(
      <AdapterProvider adapters={adapters}>
        <FuelTargetsContainer />
      </AdapterProvider>,
    );
    await waitFor(() => expect(mockProbe.last?.kcal).toBeNull());

    await act(async () => {
      await mockProbe.last?.onSave();
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });
});
