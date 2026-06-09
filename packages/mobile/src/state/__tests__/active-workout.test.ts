import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  activeWorkoutElapsedSeconds,
  pointerFromSession,
  STALE_THRESHOLD_HOURS,
  useActiveWorkout,
  type ActiveWorkoutPointer,
} from "../active-workout";

/**
 * useActiveWorkout slice tests.
 *
 * Spec: specs/05-active-session/design.md § useActiveWorkout Zustand slice
 *         (Revised 2026-06-07 — Hybrid architecture)
 * Closes: specs/05-active-session/requirements.md STORY-006, STORY-007
 *         tasks.md T-05.1.5
 */

const STORAGE_KEY = "persistence.activeWorkout";

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as jest.Mock;

function makePointer(
  overrides: Partial<ActiveWorkoutPointer> = {},
): ActiveWorkoutPointer {
  return {
    sessionId: "local-abc",
    workoutId: "w-1",
    name: "Upper Body",
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  useActiveWorkout.setState({ active: null, expanded: false });
  mockGetItem.mockReset();
  mockSetItem.mockReset();
  mockRemoveItem.mockReset();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
  mockRemoveItem.mockResolvedValue(undefined);
});

describe("useActiveWorkout — defaults", () => {
  it("starts with no active workout, minimised", () => {
    const s = useActiveWorkout.getState();
    expect(s.active).toBeNull();
    expect(s.expanded).toBe(false);
  });
});

describe("useActiveWorkout — actions", () => {
  it("start() sets the pointer expanded + persists", () => {
    const p = makePointer();
    useActiveWorkout.getState().start(p);

    const s = useActiveWorkout.getState();
    expect(s.active).toEqual(p);
    expect(s.expanded).toBe(true);
    expect(mockSetItem).toHaveBeenCalledTimes(1);
    const [key, raw] = mockSetItem.mock.calls[0];
    expect(key).toBe(STORAGE_KEY);
    expect(JSON.parse(raw)).toEqual({ v: 1, pointer: p });
  });

  it("adopt() sets the pointer minimised + persists", () => {
    const p = makePointer();
    useActiveWorkout.getState().adopt(p);

    const s = useActiveWorkout.getState();
    expect(s.active).toEqual(p);
    expect(s.expanded).toBe(false);
    expect(mockSetItem).toHaveBeenCalledTimes(1);
  });

  it("minimize() collapses, expand() re-opens", () => {
    useActiveWorkout.getState().start(makePointer());
    expect(useActiveWorkout.getState().expanded).toBe(true);

    useActiveWorkout.getState().minimize();
    expect(useActiveWorkout.getState().expanded).toBe(false);

    useActiveWorkout.getState().expand();
    expect(useActiveWorkout.getState().expanded).toBe(true);
  });

  it("end() clears state + removes the persisted key", async () => {
    useActiveWorkout.getState().start(makePointer());
    await useActiveWorkout.getState().end();

    const s = useActiveWorkout.getState();
    expect(s.active).toBeNull();
    expect(s.expanded).toBe(false);
    expect(mockRemoveItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it("start() swallows a failed persist + still applies the pointer (warns)", () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockSetItem.mockRejectedValueOnce(new Error("disk full"));

    const p = makePointer();
    expect(() => useActiveWorkout.getState().start(p)).not.toThrow();
    expect(useActiveWorkout.getState().active).toEqual(p);
    // The rejection is handled in a microtask — let it settle, then assert.
    return Promise.resolve().then(() => {
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("persist failed"),
        expect.any(Error),
      );
      warn.mockRestore();
    });
  });

  it("end() swallows a failed removeItem (warns)", async () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockRemoveItem.mockRejectedValueOnce(new Error("io"));

    await expect(useActiveWorkout.getState().end()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("removeItem failed"),
      expect.any(Error),
    );
    warn.mockRestore();
  });
});

describe("useActiveWorkout — rehydrate", () => {
  it("no stored key → { resumed: false }, state untouched", async () => {
    mockGetItem.mockResolvedValueOnce(null);
    const result = await useActiveWorkout.getState().rehydrate();
    expect(result).toEqual({ resumed: false });
    expect(useActiveWorkout.getState().active).toBeNull();
  });

  it("corrupt JSON → clears key + { resumed: false }", async () => {
    mockGetItem.mockResolvedValueOnce("}{ not json");
    const result = await useActiveWorkout.getState().rehydrate();
    expect(result).toEqual({ resumed: false });
    expect(mockRemoveItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(useActiveWorkout.getState().active).toBeNull();
  });

  it("valid JSON but invalid pointer shape → clears key + { resumed: false }", async () => {
    mockGetItem.mockResolvedValueOnce(
      JSON.stringify({ v: 1, pointer: { sessionId: "x" } }),
    );
    const result = await useActiveWorkout.getState().rehydrate();
    expect(result).toEqual({ resumed: false });
    expect(mockRemoveItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it("payload missing the pointer field → invalid", async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify({ v: 1 }));
    const result = await useActiveWorkout.getState().rehydrate();
    expect(result).toEqual({ resumed: false });
    expect(mockRemoveItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it("explicit null pointer → invalid", async () => {
    mockGetItem.mockResolvedValueOnce(JSON.stringify({ v: 1, pointer: null }));
    const result = await useActiveWorkout.getState().rehydrate();
    expect(result).toEqual({ resumed: false });
    expect(mockRemoveItem).toHaveBeenCalledWith(STORAGE_KEY);
  });

  it("fresh session → restores minimised, { resumed: true } (no staleHours)", async () => {
    const p = makePointer({ startedAt: new Date().toISOString() });
    mockGetItem.mockResolvedValueOnce(JSON.stringify({ v: 1, pointer: p }));

    const result = await useActiveWorkout.getState().rehydrate();
    expect(result).toEqual({ resumed: true });

    const s = useActiveWorkout.getState();
    expect(s.active).toEqual(p);
    expect(s.expanded).toBe(false);
  });

  it("stale session (>24h) → restores minimised + reports staleHours", async () => {
    const old = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const p = makePointer({ startedAt: old });
    mockGetItem.mockResolvedValueOnce(JSON.stringify({ v: 1, pointer: p }));

    const result = await useActiveWorkout.getState().rehydrate();
    expect(result.resumed).toBe(true);
    expect(
      (result as { resumed: true; staleHours?: number }).staleHours,
    ).toBeGreaterThan(STALE_THRESHOLD_HOURS);
    expect(useActiveWorkout.getState().active).toEqual(p);
  });

  it("getItem read failure → { resumed: false } (warns)", async () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockGetItem.mockRejectedValueOnce(new Error("io"));

    const result = await useActiveWorkout.getState().rehydrate();
    expect(result).toEqual({ resumed: false });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("rehydrate read failed"),
      expect.any(Error),
    );
    warn.mockRestore();
  });
});

describe("pointerFromSession", () => {
  it("maps the immutable identity fields", () => {
    const p = pointerFromSession({
      id: "local-9",
      workoutId: null,
      name: "Quick Start",
      startedAt: "2026-06-07T10:00:00.000Z",
    });
    expect(p).toEqual({
      sessionId: "local-9",
      workoutId: null,
      name: "Quick Start",
      startedAt: "2026-06-07T10:00:00.000Z",
      withClient: undefined,
      retroactive: undefined,
    });
  });

  it("carries trainer context when supplied", () => {
    const p = pointerFromSession(
      {
        id: "s1",
        workoutId: "w",
        name: "X",
        startedAt: "2026-06-07T10:00:00Z",
      },
      {
        withClient: { id: "c1", initials: "AB", name: "Alex B" },
        retroactive: true,
      },
    );
    expect(p.withClient).toEqual({ id: "c1", initials: "AB", name: "Alex B" });
    expect(p.retroactive).toBe(true);
  });
});

describe("activeWorkoutElapsedSeconds", () => {
  it("computes floor seconds since startedAt", () => {
    const now = Date.parse("2026-06-07T10:01:05.500Z");
    expect(activeWorkoutElapsedSeconds("2026-06-07T10:00:00.000Z", now)).toBe(
      65,
    );
  });

  it("clamps negatives (clock skew) to 0", () => {
    const now = Date.parse("2026-06-07T09:59:00.000Z");
    expect(activeWorkoutElapsedSeconds("2026-06-07T10:00:00.000Z", now)).toBe(
      0,
    );
  });

  it("returns 0 for an unparseable startedAt", () => {
    expect(activeWorkoutElapsedSeconds("not-a-date", Date.now())).toBe(0);
  });

  it("defaults `now` to the current clock when omitted", () => {
    const startedAt = new Date(Date.now() - 3000).toISOString();
    const elapsed = activeWorkoutElapsedSeconds(startedAt);
    expect(elapsed).toBeGreaterThanOrEqual(2);
    expect(elapsed).toBeLessThan(10);
  });
});
