import { act, cleanup, renderHook } from "@testing-library/react";
import type { MouseEvent } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useOpenApp } from "../useOpenApp";
import { appStore, playStore } from "@/marketing/config";

const assign = vi.fn();
const click = (overrides = {}) =>
  ({ button: 0, ...overrides }) as MouseEvent<HTMLAnchorElement>;
function device(ua: string) {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
}
beforeEach(() => {
  vi.useFakeTimers();
  assign.mockReset();
  vi.stubGlobal("location", { ...window.location, assign });
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  device("iPhone");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each(["iPhone", "iPad"])(
  "opens the installed app on %s then falls back to Apple",
  (ua) => {
    device(ua);
    const { result } = renderHook(useOpenApp);
    expect(result.current.href).toBe("persistencemobile://train");
    expect(result.current.label).toBe("Open app");
    expect(result.current.storeHref).toBe(appStore.url);
    act(() => result.current.onClick(click()));
    expect(assign).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(2500));
    expect(assign).toHaveBeenCalledExactlyOnceWith(appStore.url);
  },
);

it("lets Android resolve the app or the configured Google Play fallback", () => {
  device("Android");
  const { result } = renderHook(useOpenApp);
  expect(result.current.href).toBe(
    `intent://train#Intent;scheme=persistencemobile;package=com.bradleyevans96.persistence;S.browser_fallback_url=${encodeURIComponent(playStore.url!)};end`,
  );
  expect(result.current.storeHref).toBe(playStore.url);
  act(() => result.current.onClick(click()));
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["Macintosh", "Windows NT", "Googlebot iPhone"])(
  "keeps %s on the download site",
  (ua) => {
    device(ua);
    const { result } = renderHook(useOpenApp);
    expect(result.current.href).toBe("/");
    expect(result.current.label).toBe("Open app");
  },
);

it.each(["visibilitychange", "pagehide"])(
  "cancels permanently on %s so returning from the app cannot open the store",
  (event) => {
    const { result } = renderHook(useOpenApp);
    act(() => result.current.onClick(click()));
    if (event === "visibilitychange") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event(event));
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    } else window.dispatchEvent(new Event(event));
    act(() => vi.advanceTimersByTime(5000));
    expect(assign).not.toHaveBeenCalled();
  },
);

it("ignores visible visibility events and retains the missing-app fallback", () => {
  const { result } = renderHook(useOpenApp);
  act(() => result.current.onClick(click()));
  document.dispatchEvent(new Event("visibilitychange"));
  act(() => vi.advanceTimersByTime(2500));
  expect(assign).toHaveBeenCalledOnce();
});

it("does not redirect a hidden document even if no event was delivered", () => {
  const { result } = renderHook(useOpenApp);
  act(() => result.current.onClick(click()));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  act(() => vi.advanceTimersByTime(2500));
  expect(assign).not.toHaveBeenCalled();
});

it.each([
  { metaKey: true },
  { ctrlKey: true },
  { shiftKey: true },
  { altKey: true },
  { button: 1 },
  { defaultPrevented: true },
])(
  "does not redirect the current page for a modified or prevented click %j",
  (override) => {
    const { result } = renderHook(useOpenApp);
    act(() => result.current.onClick(click(override)));
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("replaces the pending fallback on repeat clicks and cleans up on unmount", () => {
  const { result, unmount } = renderHook(useOpenApp);
  act(() => result.current.onClick(click()));
  act(() => vi.advanceTimersByTime(1000));
  act(() => result.current.onClick(click()));
  expect(vi.getTimerCount()).toBe(1);
  act(() => vi.advanceTimersByTime(1500));
  expect(assign).not.toHaveBeenCalled();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it("can unmount before a click", () => {
  const { unmount } = renderHook(useOpenApp);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
