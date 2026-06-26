import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import * as Haptics from "expo-haptics";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { localDayISO } from "@/shared/utils";
import type { FuelToday } from "@/domain/models/nutrition";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { WaterLogSheetProps } from "@/ui/presenters/WaterLogSheetPresenter";
import { WaterLogSheetContainer } from "../WaterLogSheetContainer";

const mockProbe: { last: WaterLogSheetProps | null } = { last: null };

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
jest.mock("@/ui/presenters/WaterLogSheetPresenter", () => ({
  WaterLogSheetPresenter: (props: WaterLogSheetProps) => {
    mockProbe.last = props;
    return null;
  },
}));

(globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));

const USER = "user-1";

function makeFuel(cups: number): FuelToday {
  return {
    date: localDayISO(),
    targets: {
      userId: USER,
      dailyKcal: 2000,
      proteinG: 150,
      carbsG: 200,
      fatG: 60,
      waterCups: 10,
      preset: "custom",
      setByUserId: null,
      setByName: null,
      updatedAt: null,
    },
    consumed: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, waterCups: cups },
    remainingKcal: 2000,
    entriesBySlot: { breakfast: [], lunch: [], snack: [], dinner: [] },
  };
}

function makeAdapters() {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "a@b.com",
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
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {
        isConnected: async () => true,
        subscribe: () => () => {},
      } as unknown as Adapters["netInfo"],
    } as Adapters,
  };
}

function Wrapper({
  adapters,
  children,
}: {
  adapters: Adapters;
  children: ReactNode;
}) {
  return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
}

describe("WaterLogSheetContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    jest.clearAllMocks();
  });

  it("seeds cups + goal from the cached day and logs taps", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFuelToday(USER, localDayISO(), makeFuel(4));
    render(
      <Wrapper adapters={adapters}>
        <WaterLogSheetContainer visible onClose={jest.fn()} />
      </Wrapper>,
    );
    await waitFor(() => expect(mockProbe.last?.cups).toBe(4));
    expect(mockProbe.last?.goal).toBe(10);

    await act(async () => {
      mockProbe.last!.onSetCups(6);
    });
    expect(Haptics.selectionAsync as jest.Mock).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        storage.getCachedFuelToday(USER, localDayISO())?.consumed.waterCups,
      ).toBe(6),
    );
  });
});
