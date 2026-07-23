import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { AiEstimate } from "@/domain/models/nutrition";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { localDayISO, previousDayISO } from "@/shared/utils";
import { useFuelSheets } from "@/state/fuel-sheets";
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
  beforeEach(() => {
    act(() => useFuelSheets.getState().setDate(localDayISO()));
  });

  it("confirm logs onto the shared store's active day, not always today (BRIEF-7 QA-20)", async () => {
    const { adapters, storage } = makeAdapters();
    const pastDay = previousDayISO(previousDayISO(localDayISO()));
    act(() => useFuelSheets.getState().setDate(pastDay));
    const { result } = renderHook(() => useAiDraftItems(), {
      wrapper: wrapper(adapters),
    });
    act(() => result.current.setItems(draftItemsFromEstimate(estimate)));

    await act(async () => {
      await result.current.confirm("lunch");
    });
    expect(
      storage.getCachedFuelToday(USER, pastDay)?.entriesBySlot.lunch.length,
    ).toBe(1);
    expect(
      storage.getCachedFuelToday(USER, localDayISO())?.entriesBySlot.lunch
        .length ?? 0,
    ).toBe(0);
  });

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
    const lunch = storage.getCachedFuelToday(USER, localDayISO())?.entriesBySlot
      .lunch;
    expect(lunch?.length).toBe(1);
    // The AI item's name is persisted as customName so the logged row shows
    // "Grilled chicken breast", not the "Quick entry" fallback.
    expect(lunch?.[0]?.customName).toBe("Grilled chicken breast");
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

  it("a double-tap confirm logs the draft exactly once (in-flight guard)", async () => {
    const { adapters, storage } = makeAdapters();
    const { result } = renderHook(() => useAiDraftItems(), {
      wrapper: wrapper(adapters),
    });
    act(() => result.current.setItems(draftItemsFromEstimate(estimate)));

    let first = 0;
    let second = -1;
    await act(async () => {
      // Fire both taps before either resolves — the second must be
      // rejected synchronously by the in-flight ref guard.
      const p1 = result.current.confirm("lunch");
      const p2 = result.current.confirm("lunch");
      [first, second] = await Promise.all([p1, p2]);
    });
    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(
      storage.getCachedFuelToday(USER, localDayISO())?.entriesBySlot.lunch
        .length,
    ).toBe(1);
  });

  it("exposes confirming=true while a confirm is in flight, false after", async () => {
    const { adapters } = makeAdapters();
    const { result } = renderHook(() => useAiDraftItems(), {
      wrapper: wrapper(adapters),
    });
    act(() => result.current.setItems(draftItemsFromEstimate(estimate)));
    expect(result.current.confirming).toBe(false);

    let pending: Promise<number> | null = null;
    act(() => {
      pending = result.current.confirm("lunch");
    });
    expect(result.current.confirming).toBe(true);
    await act(async () => {
      await pending;
    });
    expect(result.current.confirming).toBe(false);
  });

  it("zeroing grams then re-editing recovers macros from the original AI basis", () => {
    const { adapters } = makeAdapters();
    const { result } = renderHook(() => useAiDraftItems(), {
      wrapper: wrapper(adapters),
    });
    act(() => result.current.setItems(draftItemsFromEstimate(estimate)));
    const originalKcal = result.current.items[0]!.kcal; // 300 @ 180g

    act(() => result.current.onEditGrams(0, 0)); // cleared input
    expect(result.current.items[0]?.kcal).toBe(0);

    act(() => result.current.onEditGrams(0, 180)); // back to original grams
    expect(result.current.items[0]?.kcal).toBe(originalKcal);

    act(() => result.current.onEditGrams(0, 90)); // and rescaling still works
    expect(result.current.items[0]?.kcal).toBe(originalKcal / 2);
  });

  it("repeated grams edits rescale from the original basis (no cumulative drift)", () => {
    const { adapters } = makeAdapters();
    const { result } = renderHook(() => useAiDraftItems(), {
      wrapper: wrapper(adapters),
    });
    act(() => result.current.setItems(draftItemsFromEstimate(estimate)));
    const originalKcal = result.current.items[0]!.kcal;

    for (const grams of [37, 291, 64, 180]) {
      act(() => result.current.onEditGrams(0, grams));
    }
    // Final edit returned to the original 180g — kcal must be exactly the
    // original, not a drifted product of intermediate roundings.
    expect(result.current.items[0]?.kcal).toBe(originalKcal);
  });
});
