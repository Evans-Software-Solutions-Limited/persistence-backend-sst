import { afterEach, expect, it, vi } from "vitest";
import { appDestination } from "../appDestination";
import { appStore, playStore } from "@/marketing/config";

afterEach(() => vi.restoreAllMocks());

it.each([
  ["iPhone", "apps.apple.com", "Open in App Store"],
  ["iPad", "apps.apple.com", "Open in App Store"],
  ["Android", "play.google.com", "Open in Google Play"],
])("routes %s to the configured store", (ua, host, label) => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  const target = appDestination();
  expect(new URL(target.href).hostname).toBe(host);
  expect(target.label).toBe(label);
  expect(new URL(target.href).hash).toBe("");
});

it.each(["Windows NT", "Macintosh", "Googlebot iPhone"])(
  "routes %s to the homepage",
  (ua) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
    expect(appDestination()).toEqual({ href: "/", label: "Go to Persistence" });
  },
);

it.each([
  ["iPhone", appStore],
  ["Android", playStore],
] as const)(
  "falls back to home when the %s store is unavailable",
  (ua, store) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
    const available = store.available;
    try {
      store.available = false;
      expect(appDestination().href).toBe("/");
    } finally {
      store.available = available;
    }
  },
);
