import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { localDayISO } from "@/shared/utils";
import type { Food } from "@/domain/models/nutrition";
import { useFuelSheets } from "@/state/fuel-sheets";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { ScanBarcodeSheetProps } from "@/ui/presenters/ScanBarcodeSheetPresenter";
import { ScanBarcodeSheetContainer } from "../ScanBarcodeSheetContainer";

const mockProbe: { last: ScanBarcodeSheetProps | null } = { last: null };

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
jest.mock("@/ui/presenters/ScanBarcodeSheetPresenter", () => ({
  ScanBarcodeSheetPresenter: (props: ScanBarcodeSheetProps) => {
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
  barcode: "5012345678900",
  kcal: 300,
  proteinG: 10,
  carbsG: 50,
  fatG: 5,
  servingSize: 100,
  servingUnit: "g",
  source: "openfoodfacts",
  createdBy: null,
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

describe("ScanBarcodeSheetContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    jest.clearAllMocks();
    act(() =>
      useFuelSheets.setState({ sheet: null, slot: "breakfast", rev: 0 }),
    );
  });

  it("resolves a cached barcode to the found stage", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([food]);
    render(
      <Wrapper adapters={adapters}>
        <ScanBarcodeSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openScan("snack"));
    expect(mockProbe.last?.visible).toBe(true);

    await act(async () => {
      mockProbe.last!.onBarcodeScanned("5012345678900");
    });

    await waitFor(() => expect(mockProbe.last?.stage).toBe("found"));
    expect(mockProbe.last?.food?.id).toBe("f1");
  });

  it("logs the found food and closes", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([food]);
    render(
      <Wrapper adapters={adapters}>
        <ScanBarcodeSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openScan("snack"));
    await act(async () => {
      mockProbe.last!.onBarcodeScanned("5012345678900");
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("found"));

    await act(async () => {
      mockProbe.last!.onAdd();
    });

    expect(
      storage.getCachedFuelToday(USER, localDayISO())?.entriesBySlot.snack
        .length,
    ).toBe(1);
    expect(useFuelSheets.getState().sheet).toBeNull();
    expect(useFuelSheets.getState().rev).toBe(1);
  });

  it("debounces duplicate reads, then resets on rescan", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([food]);
    render(
      <Wrapper adapters={adapters}>
        <ScanBarcodeSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openScan());
    await act(async () => {
      mockProbe.last!.onBarcodeScanned("5012345678900");
      mockProbe.last!.onBarcodeScanned("5012345678900");
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("found"));
    act(() => mockProbe.last!.onRescan());
    expect(mockProbe.last?.stage).toBe("scanning");
  });

  it("falls back to the offline state when uncached and offline", async () => {
    const { adapters } = makeAdapters();
    // Force offline: no cached food + disconnected netInfo.
    (adapters as { netInfo: unknown }).netInfo = {
      isConnected: async () => false,
      subscribe: (cb: (c: boolean) => void) => {
        cb(false);
        return () => {};
      },
    };
    render(
      <Wrapper adapters={adapters}>
        <ScanBarcodeSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openScan());
    await act(async () => {
      mockProbe.last!.onBarcodeScanned("0000000000000");
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("offline"));
  });

  it("runs the Serving/Grams/Cups portion math", async () => {
    const { adapters, storage } = makeAdapters();
    storage.cacheFoods([food]); // servingSize 100, 300 kcal
    render(
      <Wrapper adapters={adapters}>
        <ScanBarcodeSheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openScan("snack"));
    await act(async () => {
      mockProbe.last!.onBarcodeScanned("5012345678900");
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("found"));

    // serving mode: 1 serving → 300 kcal, 100 g
    expect(mockProbe.last?.scaled.kcal).toBe(300);
    expect(mockProbe.last?.effectiveGrams).toBe(100);

    // grams mode: default grams = servingSize (100); +10 → 110 g → 330 kcal
    act(() => mockProbe.last!.onPortionModeChange("grams"));
    act(() => mockProbe.last!.onPortionInc());
    await waitFor(() => expect(mockProbe.last?.effectiveGrams).toBe(110));
    expect(mockProbe.last?.scaled.kcal).toBe(330);

    // cups mode: 1 cup ≈ 245 g → 2.45 servings → 735 kcal
    act(() => mockProbe.last!.onPortionModeChange("cups"));
    await waitFor(() => expect(mockProbe.last?.effectiveGrams).toBe(245));
    expect(mockProbe.last?.scaled.kcal).toBe(735);
    act(() => mockProbe.last!.onPortionDec()); // 0.75 cups
    await waitFor(() => expect(mockProbe.last?.effectiveGrams).toBe(184));
  });
});
