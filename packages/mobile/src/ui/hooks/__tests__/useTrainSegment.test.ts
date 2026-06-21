import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * useTrainSegment slice tests.
 *
 * Spec: specs/14-navigation/design.md § Testing strategy > useTrainSegment
 * Closes: specs/14-navigation/requirements.md STORY-009 AC 9.4 (segment
 *         persistence half) + STORY-005 AC 5.2
 *
 * The store hydrates from AsyncStorage on module import. Tests use
 * `jest.isolateModules` + per-test `getItem` mocks to exercise the
 * cold-launch hydration branches deterministically.
 */

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;
const mockRemoveItem = AsyncStorage.removeItem as jest.Mock;

const KEY = "persistence.train.segment";

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
  let mod!: typeof import("../useTrainSegment");
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("../useTrainSegment");
  });
  // Let the import-time AsyncStorage.getItem().then(...) settle.
  await Promise.resolve();
  await Promise.resolve();
  return mod;
}

describe("useTrainSegment", () => {
  it("defaults to 'Workouts' when nothing is persisted", async () => {
    mockGetItem.mockResolvedValue(null);
    const { useTrainSegment } = await loadFresh();

    expect(useTrainSegment.getState().segment).toBe("Workouts");
    expect(useTrainSegment.getState().hydrated).toBe(true);
  });

  it("hydrates the persisted segment value on import", async () => {
    mockGetItem.mockResolvedValue("Exercises");
    const { useTrainSegment } = await loadFresh();

    expect(useTrainSegment.getState().segment).toBe("Exercises");
    expect(useTrainSegment.getState().hydrated).toBe(true);
  });

  it("ignores an invalid persisted value, keeping the default", async () => {
    mockGetItem.mockResolvedValue("Garbage");
    const { useTrainSegment } = await loadFresh();

    expect(useTrainSegment.getState().segment).toBe("Workouts");
    expect(useTrainSegment.getState().hydrated).toBe(true);
  });

  it("setSegment updates state + persists to AsyncStorage", async () => {
    mockGetItem.mockResolvedValue(null);
    const { useTrainSegment } = await loadFresh();

    useTrainSegment.getState().setSegment("Exercises");

    expect(useTrainSegment.getState().segment).toBe("Exercises");
    expect(mockSetItem).toHaveBeenCalledWith(KEY, "Exercises");
  });

  it("setSegment swallows a failed persist (fire-and-forget)", async () => {
    mockGetItem.mockResolvedValue(null);
    const { useTrainSegment } = await loadFresh();
    mockSetItem.mockRejectedValueOnce(new Error("disk gone"));

    expect(() =>
      useTrainSegment.getState().setSegment("Exercises"),
    ).not.toThrow();
    expect(useTrainSegment.getState().segment).toBe("Exercises");
    // Let the rejected setItem promise settle so the .catch runs.
    await Promise.resolve();
  });

  it("a setSegment write wins the race against a late module-load hydration", async () => {
    // Simulate a deep link firing setSegment before getItem resolves: hold
    // the getItem promise, call setSegment, then resolve getItem with the
    // prior session's value. The late hydration must NOT clobber the write.
    let resolveGet!: (v: string | null) => void;
    mockGetItem.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveGet = resolve;
        }),
    );

    let mod!: typeof import("../useTrainSegment");
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require("../useTrainSegment");
    });

    // Deep-link redirect writes Exercises before disk read settles.
    mod.useTrainSegment.getState().setSegment("Exercises");
    expect(mod.useTrainSegment.getState().segment).toBe("Exercises");

    // Now the stale disk value resolves — guard should drop it.
    resolveGet("Workouts");
    await Promise.resolve();
    await Promise.resolve();

    expect(mod.useTrainSegment.getState().segment).toBe("Exercises");
  });

  it("setPendingCreate + clearPendingCreate manage the one-shot flag", async () => {
    mockGetItem.mockResolvedValue(null);
    const { useTrainSegment } = await loadFresh();

    expect(useTrainSegment.getState().pendingCreate).toBe(false);
    useTrainSegment.getState().setPendingCreate(true);
    expect(useTrainSegment.getState().pendingCreate).toBe(true);
    useTrainSegment.getState().clearPendingCreate();
    expect(useTrainSegment.getState().pendingCreate).toBe(false);
  });

  it("setPendingSegment + consumePendingSegment manage the one-shot target", async () => {
    mockGetItem.mockResolvedValue(null);
    const { useTrainSegment } = await loadFresh();

    // Unset → consume returns null and leaves state alone.
    expect(useTrainSegment.getState().pendingSegment).toBeNull();
    expect(useTrainSegment.getState().consumePendingSegment()).toBeNull();

    useTrainSegment.getState().setPendingSegment("Workouts");
    expect(useTrainSegment.getState().pendingSegment).toBe("Workouts");

    // Consume returns the target AND clears it (one-shot) — a second consume
    // yields null so an ordinary re-focus won't re-apply it.
    expect(useTrainSegment.getState().consumePendingSegment()).toBe("Workouts");
    expect(useTrainSegment.getState().pendingSegment).toBeNull();
    expect(useTrainSegment.getState().consumePendingSegment()).toBeNull();
  });

  it("setPendingSegment does NOT touch the active segment", async () => {
    mockGetItem.mockResolvedValue(null);
    const { useTrainSegment } = await loadFresh();

    useTrainSegment.getState().setPendingSegment("Workouts");
    // The pending one-shot is intent-only; the live segment is unchanged until
    // a consumer applies it via setSegment.
    expect(useTrainSegment.getState().segment).toBe("Workouts");
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it("marks hydrated even when the disk read rejects", async () => {
    mockGetItem.mockRejectedValue(new Error("disk gone"));
    const { useTrainSegment } = await loadFresh();

    expect(useTrainSegment.getState().hydrated).toBe(true);
    expect(useTrainSegment.getState().segment).toBe("Workouts");
  });

  it("reset() clears segment + pendingCreate + pendingSegment + drops the persisted key", async () => {
    mockGetItem.mockResolvedValue(null);
    const { useTrainSegment } = await loadFresh();
    useTrainSegment.setState({
      segment: "Exercises",
      pendingCreate: true,
      pendingSegment: "Exercises",
    });

    useTrainSegment.getState().reset();

    const s = useTrainSegment.getState();
    expect(s.segment).toBe("Workouts");
    expect(s.pendingCreate).toBe(false);
    expect(s.pendingSegment).toBeNull();
    expect(mockRemoveItem).toHaveBeenCalledWith(KEY);
  });

  it("reset() swallows a failed key removal (best-effort persist)", async () => {
    mockGetItem.mockResolvedValue(null);
    const { useTrainSegment } = await loadFresh();
    mockRemoveItem.mockRejectedValueOnce(new Error("disk gone"));
    useTrainSegment.setState({ segment: "Exercises", pendingCreate: true });

    expect(() => useTrainSegment.getState().reset()).not.toThrow();
    expect(useTrainSegment.getState().segment).toBe("Workouts");
    // Let the rejected removeItem promise settle so the .catch runs.
    await Promise.resolve();
  });
});
