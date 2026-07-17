import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * useCoachLibrarySegment slice tests.
 *
 * Spec: specs/24-coach-authoring/design.md § B.1, § B.6
 *       specs/24-coach-authoring/requirements.md STORY-001 (AC 1.5)
 *
 * The store hydrates from AsyncStorage on module import. Tests use
 * `jest.isolateModules` + per-test `getItem` mocks to exercise the
 * cold-launch hydration branches deterministically — mirrors
 * `useTrainSegment.test.ts`.
 */

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as jest.Mock;

const KEY = "persistence.coach.library.segment";

beforeEach(() => {
  mockGetItem.mockReset();
  mockSetItem.mockReset();
  mockRemoveItem.mockReset();
  mockSetItem.mockResolvedValue(undefined);
  mockRemoveItem.mockResolvedValue(undefined);
});

/**
 * Load a fresh copy of the module so the import-time hydration runs with the
 * `getItem` mock configured for this test. Returns the store hook + waits a
 * microtask tick so the hydration promise settles.
 */
async function loadFresh() {
  let mod!: typeof import("../useCoachLibrarySegment");
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("../useCoachLibrarySegment");
  });
  // Let the import-time AsyncStorage.getItem().then(...) settle.
  await Promise.resolve();
  await Promise.resolve();
  return mod;
}

describe("useCoachLibrarySegment", () => {
  it("defaults to 'Programmes' when nothing is persisted", async () => {
    mockGetItem.mockResolvedValue(null);
    const { useCoachLibrarySegment } = await loadFresh();

    expect(useCoachLibrarySegment.getState().segment).toBe("Programmes");
    expect(useCoachLibrarySegment.getState().hydrated).toBe(true);
  });

  it("hydrates the persisted segment value on import", async () => {
    mockGetItem.mockResolvedValue("Exercises");
    const { useCoachLibrarySegment } = await loadFresh();

    expect(useCoachLibrarySegment.getState().segment).toBe("Exercises");
    expect(useCoachLibrarySegment.getState().hydrated).toBe(true);
  });

  it("ignores an invalid persisted value, keeping the default", async () => {
    mockGetItem.mockResolvedValue("Garbage");
    const { useCoachLibrarySegment } = await loadFresh();

    expect(useCoachLibrarySegment.getState().segment).toBe("Programmes");
    expect(useCoachLibrarySegment.getState().hydrated).toBe(true);
  });

  it("setSegment updates state + persists to AsyncStorage", async () => {
    mockGetItem.mockResolvedValue(null);
    const { useCoachLibrarySegment } = await loadFresh();

    useCoachLibrarySegment.getState().setSegment("Workouts");

    expect(useCoachLibrarySegment.getState().segment).toBe("Workouts");
    expect(mockSetItem).toHaveBeenCalledWith(KEY, "Workouts");
  });

  it("setSegment swallows a failed persist (fire-and-forget)", async () => {
    mockGetItem.mockResolvedValue(null);
    const { useCoachLibrarySegment } = await loadFresh();
    mockSetItem.mockRejectedValueOnce(new Error("disk gone"));

    expect(() =>
      useCoachLibrarySegment.getState().setSegment("Exercises"),
    ).not.toThrow();
    expect(useCoachLibrarySegment.getState().segment).toBe("Exercises");
    // Let the rejected setItem promise settle so the .catch runs.
    await Promise.resolve();
  });

  it("a setSegment write wins the race against a late module-load hydration", async () => {
    // Simulate a write firing before getItem resolves: hold the getItem
    // promise, call setSegment, then resolve getItem with the prior
    // session's value. The late hydration must NOT clobber the write.
    let resolveGet!: (v: string | null) => void;
    mockGetItem.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveGet = resolve;
        }),
    );

    let mod!: typeof import("../useCoachLibrarySegment");
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require("../useCoachLibrarySegment");
    });

    mod.useCoachLibrarySegment.getState().setSegment("Exercises");
    expect(mod.useCoachLibrarySegment.getState().segment).toBe("Exercises");

    // Now the stale disk value resolves — guard should drop it.
    resolveGet("Workouts");
    await Promise.resolve();
    await Promise.resolve();

    expect(mod.useCoachLibrarySegment.getState().segment).toBe("Exercises");
  });

  it("marks hydrated even when the disk read rejects", async () => {
    mockGetItem.mockRejectedValue(new Error("disk gone"));
    const { useCoachLibrarySegment } = await loadFresh();

    expect(useCoachLibrarySegment.getState().hydrated).toBe(true);
    expect(useCoachLibrarySegment.getState().segment).toBe("Programmes");
  });

  it("reset() clears the segment + drops the persisted key", async () => {
    mockGetItem.mockResolvedValue(null);
    const { useCoachLibrarySegment } = await loadFresh();
    useCoachLibrarySegment.setState({ segment: "Exercises" });

    useCoachLibrarySegment.getState().reset();

    const s = useCoachLibrarySegment.getState();
    expect(s.segment).toBe("Programmes");
    expect(mockRemoveItem).toHaveBeenCalledWith(KEY);
  });

  it("reset() swallows a failed key removal (best-effort persist)", async () => {
    mockGetItem.mockResolvedValue(null);
    const { useCoachLibrarySegment } = await loadFresh();
    mockRemoveItem.mockRejectedValueOnce(new Error("disk gone"));
    useCoachLibrarySegment.setState({ segment: "Workouts" });

    expect(() => useCoachLibrarySegment.getState().reset()).not.toThrow();
    expect(useCoachLibrarySegment.getState().segment).toBe("Programmes");
    // Let the rejected removeItem promise settle so the .catch runs.
    await Promise.resolve();
  });
});
