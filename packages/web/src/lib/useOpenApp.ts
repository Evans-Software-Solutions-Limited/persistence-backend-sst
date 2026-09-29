import { useEffect, useRef, type MouseEvent } from "react";
import { appDestination } from "./appDestination";
import { currentPlatform } from "./platform";

const APP_URL = "persistencemobile://train";
const FALLBACK_DELAY_MS = 2500;

/** User-initiated app opening; no membership details or auth tokens leave the page. */
export function useOpenApp() {
  const platform = currentPlatform();
  const store = appDestination();
  const cancelPending = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancelPending.current?.(), []);

  const href =
    platform === "android"
      ? `intent://train#Intent;scheme=persistencemobile;package=com.bradleyevans96.persistence;S.browser_fallback_url=${encodeURIComponent(new URL(store.href, window.location.origin).href)};end`
      : platform === "ios"
        ? APP_URL
        : store.href;

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // Android delegates fallback to the browser's intent resolver. Modified
    // clicks retain ordinary link semantics and must not redirect this tab.
    if (
      platform !== "ios" ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;

    cancelPending.current?.();
    const cancel = () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", cancel);
    };
    const visibilityChanged = () => {
      if (document.visibilityState === "hidden") cancel();
    };
    const timer = window.setTimeout(() => {
      cancel();
      if (document.visibilityState === "visible")
        window.location.assign(store.href);
    }, FALLBACK_DELAY_MS);
    cancelPending.current = cancel;
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", cancel);
    // Let the real anchor launch the registered scheme from this user gesture.
    // If the app takes over, cancel permanently so returning cannot open a store.
  }

  return { href, label: "Open app", onClick, storeHref: store.href };
}
