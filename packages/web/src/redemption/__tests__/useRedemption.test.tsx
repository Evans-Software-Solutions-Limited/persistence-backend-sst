import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRedemption } from "../useRedemption";
import * as auth from "../auth";
import { voucherApi } from "../api";
vi.mock("../auth", () => ({
  currentAccount: vi.fn(),
  completeCallback: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("../api", () => ({
  voucherApi: { prepare: vi.fn(), verify: vi.fn(), redeem: vi.fn() },
}));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/redeem");
  vi.mocked(auth.currentAccount).mockResolvedValue(null);
});
afterEach(cleanup);
it("cannot verify or redeem without a verified challenge", async () => {
  const { result } = renderHook(useRedemption);
  await waitFor(() => expect(result.current.busy).toBe(false));
  await act(() => result.current.verify("123456"));
  await act(() => result.current.redeem());
  expect(voucherApi.verify).not.toHaveBeenCalled();
  expect(voucherApi.redeem).not.toHaveBeenCalled();
});
it("ignores late identity success after unmount", async () => {
  let finish!: (value: null) => void;
  vi.mocked(auth.currentAccount).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { unmount } = renderHook(useRedemption);
  unmount();
  await act(async () => {
    finish(null);
  });
  expect(auth.signOut).not.toHaveBeenCalled();
});
it("does not sign out another flow when an old identity request fails after unmount", async () => {
  let fail!: (reason: Error) => void;
  vi.mocked(auth.currentAccount).mockReturnValue(
    new Promise((_, reject) => {
      fail = reject;
    }),
  );
  const { unmount } = renderHook(useRedemption);
  unmount();
  await act(async () => {
    fail(new Error("stale request"));
  });
  expect(auth.signOut).not.toHaveBeenCalled();
});
