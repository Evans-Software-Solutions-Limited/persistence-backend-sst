/**
 * PER-137: the guarded orientation lock. A binary without the native module
 * (1.2.0, over the air) must never crash and simply stays portrait.
 */

import {
  canChangeOrientation,
  lockLandscape,
  lockPortrait,
  resetScreenOrientationForTests,
} from "../screenOrientation";

const mockNative: { module: unknown; throws: boolean } = {
  module: {},
  throws: false,
};
jest.mock("expo", () => ({
  requireOptionalNativeModule: (name: string) => {
    if (mockNative.throws) throw new Error("no expo");
    return name === "ExpoScreenOrientation" ? mockNative.module : null;
  },
}));
const mockLockAsync = jest.fn(async (_lock: number) => {});
jest.mock("expo-screen-orientation", () => ({
  lockAsync: (lock: number) => mockLockAsync(lock),
  OrientationLock: { PORTRAIT_UP: 1, LANDSCAPE: 5 },
}));

beforeEach(() => {
  mockNative.module = {};
  mockNative.throws = false;
  mockLockAsync.mockClear();
  resetScreenOrientationForTests();
});

describe("screenOrientation", () => {
  it("locks portrait and landscape when the native module is in the binary", async () => {
    expect(canChangeOrientation()).toBe(true);
    await lockPortrait();
    await lockLandscape();
    expect(mockLockAsync.mock.calls).toEqual([[1], [5]]);
  });

  it("does nothing on a 1.2.0 binary without the native module", async () => {
    mockNative.module = null;
    expect(canChangeOrientation()).toBe(false);
    await expect(lockPortrait()).resolves.toBeUndefined();
    await expect(lockLandscape()).resolves.toBeUndefined();
    expect(mockLockAsync).not.toHaveBeenCalled();
  });

  it("does nothing when the module lookup itself throws", async () => {
    mockNative.throws = true;
    await lockLandscape();
    expect(canChangeOrientation()).toBe(false);
    expect(mockLockAsync).not.toHaveBeenCalled();
  });

  it("never throws when the native lock fails", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockLockAsync.mockRejectedValueOnce(new Error("unsupported"));
    await expect(lockLandscape()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
