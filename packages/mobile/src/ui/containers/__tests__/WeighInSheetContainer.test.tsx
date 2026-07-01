import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { ProfilePageData } from "@/domain/models/profilePage";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { StubHealthAdapter } from "@/adapters/health";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { WeighInSheetContainer } from "../WeighInSheetContainer";

function makeProfilePagePayload(
  overrides: Partial<ProfilePageData["profile"]> = {},
): ProfilePageData {
  return {
    profile: {
      id: "user-1",
      fullName: "Brad Simms",
      email: "brad@example.com",
      username: null,
      avatarUrl: null,
      role: "user",
      fitnessLevel: "intermediate",
      dateOfBirth: null,
      gender: null,
      heightCm: null,
      weightKg: null,
      weightUnit: "kg",
      heightUnit: "cm",
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

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

const mockFetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));
(globalThis as Record<string, unknown>).fetch = mockFetch;

const USER = "user-1";

function makeAdapters(): {
  adapters: Adapters;
  storage: InMemoryStorageAdapter;
} {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    storage,
    adapters: {
      api,
      auth,
      storage,
      health: new StubHealthAdapter(),
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {} as Adapters["netInfo"],
    },
  };
}

describe("WeighInSheetContainer", () => {
  beforeEach(() => mockFetch.mockClear());

  it("logs the weigh-in and closes on save", async () => {
    const { adapters } = makeAdapters();
    const onClose = jest.fn();
    const { getByText } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <WeighInSheetContainer visible onClose={onClose} />
      </AdapterProvider>,
    );
    fireEvent.press(getByText(/Log/));
    // Save → useLogMeasurement (optimistic append + queue + drain) → close.
    // The optimistic body-trend write itself is unit-tested in
    // log-measurement.command.test (06.6); here we prove the container wiring.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("prefills weight (lb→kg) + body fat from Apple Health and writes both back on save", async () => {
    const { adapters } = makeAdapters();
    const writeBodyWeight = jest.fn(async () => ok(undefined));
    const writeBodyFat = jest.fn(async () => ok(undefined));
    Object.assign(adapters.health, {
      getLatestBodyWeight: async () =>
        ok({ value: 176, unit: "lbs" as const, date: "2026-06-10T07:00:00Z" }),
      getLatestBodyFat: async () => ok(18.5),
      writeBodyWeight,
      writeBodyFat,
    });
    const onClose = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <WeighInSheetContainer visible onClose={onClose} />
      </AdapterProvider>,
    );
    // 176 lb → ~79.8 kg, displayed in kg.
    await waitFor(() =>
      expect(getByTestId("weigh-in-input").props.value).toBe("79.8"),
    );
    expect(getByTestId("weigh-in-bodyfat-input").props.value).toBe("18.5");

    fireEvent.press(getByText(/Log/));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // Weight written in kg; body fat as the 0..100 percentage (adapter converts
    // to HealthKit's fraction).
    expect(writeBodyWeight).toHaveBeenCalledWith(
      expect.closeTo(79.8, 1),
      expect.any(Date),
    );
    expect(writeBodyFat).toHaveBeenCalledWith(18.5, expect.any(Date));
  });

  it("defaults the unit toggle to lb when the profile's weightUnit is lb", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheProfilePage(
      USER,
      makeProfilePagePayload({ weightUnit: "lb" }),
    );
    const onClose = jest.fn();
    const { getByTestId } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <WeighInSheetContainer visible onClose={onClose} />
      </AdapterProvider>,
    );
    // No prefill/history in this fixture, so the canonical weight is the
    // default 80kg — displayed in lb (176.4) once the profile's imperial
    // preference has seeded the toggle. Displayed in kg (80.0) would mean
    // the wiring never took effect.
    await waitFor(() =>
      expect(getByTestId("weigh-in-input").props.value).toBe("176.4"),
    );
  });

  it("defaults the unit toggle to kg when the profile's weightUnit is kg (unchanged)", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheProfilePage(
      USER,
      makeProfilePagePayload({ weightUnit: "kg" }),
    );
    const onClose = jest.fn();
    const { getByTestId } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <WeighInSheetContainer visible onClose={onClose} />
      </AdapterProvider>,
    );
    await waitFor(() =>
      expect(getByTestId("weigh-in-input").props.value).toBe("80.0"),
    );
  });

  it("does not write to Apple Health when the log is rejected", async () => {
    const { adapters } = makeAdapters();
    const writeBodyWeight = jest.fn(async () => ok(undefined));
    const writeBodyFat = jest.fn(async () => ok(undefined));
    Object.assign(adapters.health, { writeBodyWeight, writeBodyFat });
    const onClose = jest.fn();
    const { getByTestId, getByText } = renderWithTheme(
      <AdapterProvider adapters={adapters}>
        <WeighInSheetContainer visible onClose={onClose} />
      </AdapterProvider>,
    );
    // A negative weight is rejected by logMeasurementCommand (weightKg <= 0).
    fireEvent.changeText(getByTestId("weigh-in-input"), "-50");
    await act(async () => {
      fireEvent.press(getByText(/Log/));
      await new Promise((r) => setTimeout(r, 0));
    });
    // The bad value never reaches Apple Health, and the sheet stays open so the
    // user can correct it.
    expect(writeBodyWeight).not.toHaveBeenCalled();
    expect(writeBodyFat).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
