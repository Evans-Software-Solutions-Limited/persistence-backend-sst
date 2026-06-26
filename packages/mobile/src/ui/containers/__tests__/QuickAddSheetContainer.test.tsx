import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import * as Haptics from "expo-haptics";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { localDayISO } from "@/shared/utils";
import type { Food } from "@/domain/models/nutrition";
import { useFuelSheets } from "@/state/fuel-sheets";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { QuickAddSheetProps } from "@/ui/presenters/QuickAddSheetPresenter";
import { QuickAddSheetContainer } from "../QuickAddSheetContainer";

const mockProbe: { last: QuickAddSheetProps | null } = { last: null };

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
jest.mock("@/ui/presenters/QuickAddSheetPresenter", () => ({
  QuickAddSheetPresenter: (props: QuickAddSheetProps) => {
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
const food: Food = {
  id: "f1",
  name: "Oatmeal",
  brand: null,
  barcode: "1",
  kcal: 300,
  proteinG: 10,
  carbsG: 50,
  fatG: 5,
  servingSize: 100,
  servingUnit: "g",
  source: "user",
  createdBy: USER,
};

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

describe("QuickAddSheetContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    jest.clearAllMocks();
    act(() =>
      useFuelSheets.setState({ sheet: null, slot: "breakfast", rev: 0 }),
    );
  });

  it("is hidden until the quick-add sheet is opened", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <QuickAddSheetContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.visible).toBe(false);
    act(() => useFuelSheets.getState().openQuickAdd("lunch"));
    expect(mockProbe.last?.visible).toBe(true);
    expect(mockProbe.last?.slot).toBe("lunch");
  });

  it("logs the selected food, signals a refresh, and closes", async () => {
    const { adapters, storage } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <QuickAddSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openQuickAdd("dinner"));

    act(() => mockProbe.last!.onSelect(food));
    await waitFor(() => expect(mockProbe.last?.selected?.id).toBe("f1"));

    await act(async () => {
      mockProbe.last!.onAdd();
    });

    // Optimistic entry written to the cached dinner slot (the queued POST may
    // already have drained against the mocked fetch — the cache write is the
    // durable optimistic signal).
    const cached = storage.getCachedFuelToday(USER, localDayISO());
    expect(cached?.entriesBySlot.dinner.length).toBe(1);
    expect(Haptics.notificationAsync as jest.Mock).toHaveBeenCalled();
    expect(useFuelSheets.getState().sheet).toBeNull();
    expect(useFuelSheets.getState().rev).toBe(1);
  });
});
