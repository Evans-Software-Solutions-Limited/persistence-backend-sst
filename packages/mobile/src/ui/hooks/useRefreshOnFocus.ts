import { useCallback, useRef } from "react";
import { useFocusEffect } from "expo-router";

/**
 * Run `onFocus` every time a screen REGAINS focus, skipping the FIRST focus
 * (which coincides with mount, where the cache-first read hooks already run
 * their once-per-mount auto-refresh). Without this, expo-router keeps tab
 * screens mounted, so a screen only ever fetches once per app launch and shows
 * stale data on re-entry until pull-to-refresh or an app restart.
 *
 * Mirrors the skip-first-focus pattern already used ad-hoc in
 * `ClientsContainer` / `ClientDetailContainer`; centralised here so every
 * kept-alive tab can refresh on re-entry consistently and cheaply.
 *
 * `onFocus` should be a stable callback (wrap the refresh calls in
 * `useCallback`) — the focus effect re-subscribes when its identity changes.
 */
export function useRefreshOnFocus(onFocus: () => void): void {
  const isFirstFocus = useRef(true);
  // Keep the latest callback in a ref so the focus effect below can stay
  // STABLE (`[]` deps). If we depended on `onFocus` directly, its identity
  // churns whenever the caller's refresh closures change (e.g. when `userId`
  // resolves async) — and `useFocusEffect` RE-RUNS its callback on identity
  // change while focused, which would fire the "skipped" first refresh right
  // after mount and clobber the just-loaded cache. A stable effect callback
  // runs exactly once per real focus event, so skip-first is reliable.
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;
  useFocusEffect(
    useCallback(() => {
      if (isFirstFocus.current) {
        isFirstFocus.current = false;
        return;
      }
      onFocusRef.current();
    }, []),
  );
}
