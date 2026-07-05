import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { AiEstimate } from "@/domain/models/nutrition";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { localDayISO } from "@/shared/utils";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  draftItemsFromEstimate,
  useAiDraftItems,
} from "@/ui/hooks/useAiDraftItems";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

(globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));

const USER = "user-1";

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
  const adapters: Adapters = {
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
  };
  return { adapters, storage };
}

function wrapper(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

const estimate: AiEstimate = {
  foods: [
    {
      name: "Grilled chicken breast",
      quantity: 1,
      unit: "piece",
      estimatedGrams: 180,
      kcal: 300,
      proteinG: 56,
      carbsG: 0,
      fatG: 7,
      confidence: 0.94,
    },
    {
      name: "Olive oil drizzle",
      quantity: 1,
      unit: "tbsp",
      estimatedGrams: 5,
      kcal: 40,
      proteinG: 0,
      carbsG: 0,
      fatG: 4.5,
      confidence: 0.62,
    },
  ],
  overallConfidence: 0.78,
  notes: null,
};

describe("draftItemsFromEstimate", () => {
  it("default-ticks items with confidence >= 0.7", () => {
    const items = draftItemsFromEstimate(estimate);
    expect(items[0]?.on).toBe(true);
  });

  it("default-unticks items with confidence < 0.7", () => {
    const items = draftItemsFromEstimate(estimate);
    expect(items[1]?.on).toBe(false);
  });

  it("ticks exactly at the 0.7 boundary", () => {
    const items = draftItemsFromEstimate({
      foods: [{ ...estimate.foods[0]!, confidence: 0.7 }],
      overallConfidence: 0.7,
      notes: null,
    });
    expect(items[0]?.on).toBe(true);
  });
});

describe("useAiDraftItems", () => {
  it("starts with an empty item list and 0 total", () => {
    const { adapters } = makeAdapters();
    const { result } = renderHook(() => useAiDraftItems(), {
      wrapper: wrapper(adapters),
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.totalKcal).toBe(0);
  });

  it("setItems seeds the draft and totalKcal sums only kept items", () => {
    const { adapters } = makeAdapters();
    const { result } = renderHook(() => useAiDraftItems(), {
      wrapper: wrapper(adapters),
    });
    act(() => result.current.setItems(draftItemsFromEstimate(estimate)));
    expect(result.current.items).toHaveLength(2);
    expect(result.current.totalKcal).toBe(300); // only the kept (>=0.7) item
  });

  it("onToggleItem flips a single item's on flag", () => {
    const { adapters } = makeAdapters();
    const { result } = renderHook(() => useAiDraftItems(), {
      wrapper: wrapper(adapters),
    });
    act(() => result.current.setItems(draftItemsFromEstimate(estimate)));
    act(() => result.current.onToggleItem(1));
    expect(result.current.items[1]?.on).toBe(true);
    expect(result.current.totalKcal).toBe(340);
  });

  it("onEditGrams rescales an item's macros and recomputes the total", () => {
    const { adapters } = makeAdapters();
    const { result } = renderHook(() => useAiDraftItems(), {
      wrapper: wrapper(adapters),
    });
    act(() => result.current.setItems(draftItemsFromEstimate(estimate)));
    act(() => result.current.onEditGrams(0, 90)); // half the grams
    expect(result.current.items[0]?.kcal).toBe(150);
    expect(result.current.totalKcal).toBe(150);
  });

  it("confirm logs one entry per kept item and returns the count", async () => {
    const { adapters, storage } = makeAdapters();
    const { result } = renderHook(() => useAiDraftItems(), {
      wrapper: wrapper(adapters),
    });
    act(() => result.current.setItems(draftItemsFromEstimate(estimate)));

    let count = 0;
    await act(async () => {
      count = await result.current.confirm("lunch");
    });
    expect(count).toBe(1); // only the kept item
    expect(
      storage.getCachedFuelToday(USER, localDayISO())?.entriesBySlot.lunch
        .length,
    ).toBe(1);
  });

  it("confirm is a no-op (returns 0) when nothing is kept", async () => {
    const { adapters, storage } = makeAdapters();
    const { result } = renderHook(() => useAiDraftItems(), {
      wrapper: wrapper(adapters),
    });
    act(() =>
      result.current.setItems(
        draftItemsFromEstimate(estimate).map((i) => ({ ...i, on: false })),
      ),
    );

    let count = -1;
    await act(async () => {
      count = await result.current.confirm("lunch");
    });
    expect(count).toBe(0);
    expect(
      storage.getCachedFuelToday(USER, localDayISO())?.entriesBySlot.lunch
        .length ?? 0,
    ).toBe(0);
  });

  it("confirm logs multiple kept items", async () => {
    const { adapters, storage } = makeAdapters();
    const { result } = renderHook(() => useAiDraftItems(), {
      wrapper: wrapper(adapters),
    });
    act(() =>
      result.current.setItems(
        draftItemsFromEstimate(estimate).map((i) => ({ ...i, on: true })),
      ),
    );

    let count = 0;
    await act(async () => {
      count = await result.current.confirm("dinner");
    });
    expect(count).toBe(2);
    await waitFor(() =>
      expect(
        storage.getCachedFuelToday(USER, localDayISO())?.entriesBySlot.dinner
          .length,
      ).toBe(2),
    );
  });
});
