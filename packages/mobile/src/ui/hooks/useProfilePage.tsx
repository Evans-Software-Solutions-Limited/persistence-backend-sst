import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getProfilePageQuery } from "@/application/queries/profile-page.query";
import type { ProfilePageData } from "@/domain/models/profilePage";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * React hook exposing the profile-page cache to the Profile tab.
 *
 * Behaviour mirrors `useDashboard`:
 * - Reads synchronously from StoragePort on mount (cache-first).
 * - If the cache is empty or stale, fires a background refresh exactly
 *   once per (user, mount).
 * - `refresh()` always re-fetches, bypassing the TTL (pull-to-refresh).
 * - Failure leaves the cached payload intact; `error` surfaces so the
 *   UI can render a non-blocking indicator.
 * - Same-user concurrent `refresh()` callers share one in-flight
 *   promise; cross-user refreshes start a fresh fetch.
 *
 * Spec: specs/milestones/M6-profile/BACKEND_BRIEF.md
 */

/**
 * Bounded auto-fetch retry (QA-9). Total attempts = 1 initial + retries; e.g.
 * 3 → the initial fetch plus two retries at 2s and 4s (linear backoff) before
 * giving up and leaving `error` set for the UI to offer a manual retry.
 */
const AUTO_FETCH_MAX_ATTEMPTS = 3;
const AUTO_FETCH_RETRY_BASE_MS = 2000;

export type ProfilePageState = {
  payload: ProfilePageData | null;
  isStale: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  syncedAt: string | null;
  /**
   * True from the moment the bounded auto-fetch is armed until it either
   * recovers or exhausts its attempts — including the backoff gaps between
   * attempts, when `isRefreshing` is momentarily false. Consumers should hold
   * their loading state (rather than treat a lull as failure) while this is
   * true, so an error surface appears only once the retries are truly done.
   */
  isAutoRetrying: boolean;
  refresh: () => Promise<void>;
};

/**
 * `enabled` (default `true`) gates the automatic (mount + bounded-retry)
 * fetch — NOT the explicit `refresh()`. `<AuthGate>` (app/_layout.tsx) relies
 * on the default `true` to gate the whole render tree and must keep fetching
 * unconditionally; the two always-mounted sheet callers (ProfileDrawer,
 * WeighInSheet) pass their own `open`/`visible` flag instead, so the profile
 * fetch waits for a real open rather than firing on every cold launch (launch
 * fan-out reduction).
 */
export function useProfilePage(enabled = true): ProfilePageState {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  // Mirrors `enabled`, written DURING RENDER (not inside a `useEffect`) so
  // it's already up to date by the time an effect's CLEANUP runs in the same
  // commit — an effect-based ref update (`useEffect(() => { ref.current =
  // enabled }, [enabled])`) would still read the OLD value there, because
  // React runs every changed effect's cleanup before running any new
  // effect's body. The retry chain below (`autoAttempt`, its `setTimeout`
  // continuation) also reads this from an async callback, where an
  // effect-based ref would have been fine — this ref serves both.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const [cacheVersion, setCacheVersion] = useState(0);

  const initial = useMemo(() => {
    void cacheVersion;
    if (!userId) {
      return { payload: null, isStale: true, syncedAt: null as string | null };
    }
    const { payload, isStale, cached } = getProfilePageQuery(storage, userId);
    return {
      payload,
      isStale,
      syncedAt: cached?.syncedAt ?? null,
    };
  }, [storage, userId, cacheVersion]);

  const [payload, setPayload] = useState<ProfilePageData | null>(
    initial.payload,
  );
  const [isStale, setIsStale] = useState(initial.isStale);
  const [syncedAt, setSyncedAt] = useState<string | null>(initial.syncedAt);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [isAutoRetrying, setIsAutoRetrying] = useState(false);

  const previousUserIdRef = useRef<string | null>(userId);
  useEffect(() => {
    if (previousUserIdRef.current === userId) return;
    previousUserIdRef.current = userId;
    setPayload(initial.payload);
    setIsStale(initial.isStale);
    setSyncedAt(initial.syncedAt);
    // Clear the prior user's error so it can't leak across a logout→login into
    // a session whose cache is already fresh (no auto-fetch would fire to
    // reset it). Consumers gate on `payload===null` today, but this keeps the
    // error contract honest regardless.
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const latestUserIdRef = useRef<string | null>(userId);
  useEffect(() => {
    latestUserIdRef.current = userId;
  }, [userId]);

  const inFlightRef = useRef<{
    userId: string;
    promise: Promise<void>;
  } | null>(null);
  // Outcome of the most recently completed fetch, for the auto-retry loop to
  // read without depending on (and racing) React state updates — the error
  // object can be reference-identical across attempts, so a state-reactive
  // scheduler can miss the transition.
  const lastFetchOkRef = useRef(false);
  const refresh = useCallback(async () => {
    if (!userId) return;
    if (inFlightRef.current && inFlightRef.current.userId === userId) {
      return inFlightRef.current.promise;
    }
    setIsRefreshing(true);
    setError(null);
    const work = (async () => {
      try {
        if (latestUserIdRef.current !== userId) return;
        const result = await api.getProfilePage();
        if (!result.ok) {
          lastFetchOkRef.current = false;
          if (latestUserIdRef.current === userId) setError(result.error);
          return;
        }
        if (latestUserIdRef.current !== userId) return;
        storage.cacheProfilePage(userId, result.value);
        setPayload(result.value);
        setIsStale(false);
        setSyncedAt(storage.getProfilePageAge(userId));
        setCacheVersion((v) => v + 1);
        lastFetchOkRef.current = true;
      } finally {
        setIsRefreshing(false);
        if (inFlightRef.current?.userId === userId) {
          inFlightRef.current = null;
        }
      }
    })();
    inFlightRef.current = { userId, promise: work };
    return work;
  }, [api, storage, userId]);

  // Auto-fetch on (user, mount) when the cache is stale, with a BOUNDED retry
  // on failure. The previous one-shot latch armed *before* the fetch and never
  // re-fired, so a single cold-start blip on first sign-in stranded the profile
  // (and the ProfileDrawer, which has no pull-to-refresh) on a permanent
  // loader. We now retry a few times with linear backoff, then stop and leave
  // `error` set so the UI can offer a manual retry.
  // (BRIEF-7 QA-9 / the deferred follow-up flagged in #296.)
  //
  // The retry is a promise chain off `refresh` (reading `lastFetchOkRef`)
  // rather than an effect reacting to `error`/`isRefreshing`, because those
  // can net-unchanged across a failed attempt (same error reference, refreshing
  // toggling false→true→false) and a state-reactive scheduler would stall.
  const autoFetchRef = useRef<{ userId: string; attempts: number } | null>(
    null,
  );
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialIsStale = initial.isStale;

  // A stable ref-held pointer to the latest attempt fn, so the backoff timer
  // can recurse without `autoAttempt` listing itself as a dependency.
  const autoAttemptRef = useRef<() => void>(() => {});
  const autoAttempt = useCallback(() => {
    // Explicit belt-and-suspenders gate on top of the `autoFetchRef` reset
    // below: closing the sheet (`enabled: true → false`) is NOT an unmount —
    // the component stays mounted, so this scheduled/in-flight chain must
    // stop itself rather than relying solely on the arming effect having
    // already un-armed `autoFetchRef` first.
    if (!enabledRef.current) return;
    const state = autoFetchRef.current;
    if (!state || state.userId !== latestUserIdRef.current) return;
    if (state.attempts >= AUTO_FETCH_MAX_ATTEMPTS) return;
    state.attempts += 1;
    // The bounded auto-retry is now in progress — hold the UI's loading state
    // through the backoff gaps (when `isRefreshing` briefly drops) so the
    // error surface only shows once we've truly given up.
    setIsAutoRetrying(true);
    void Promise.resolve(refresh()).then(() => {
      const s = autoFetchRef.current;
      // The sheet closed while this attempt's `refresh()` was in flight. The
      // request already happened (it can't be un-sent) and `refresh()` has
      // already written any failure into `error` — but that failure belongs to
      // an attempt the user abandoned by closing, so surfacing it would greet
      // them with a stale error card on the NEXT open, for a request they
      // never waited on. Clear it, and stop the chain here so no further
      // attempt is scheduled against a closed sheet (Inspector Brad: 2 wasted
      // requests measured 10s after close). The arming effect has already
      // un-armed `autoFetchRef`, so reopening starts a clean chain from
      // attempt 0 — which is what actually refreshes the data.
      //
      // Deliberately NOT folded into `refresh()`'s own `setError`: an explicit
      // caller-invoked `refresh()` (pull-to-refresh) is never gated and MUST
      // still surface its error, even while `enabled` is false.
      if (!enabledRef.current) {
        setError(null);
        setIsAutoRetrying(false);
        return;
      }
      // Bail if the arm state changed since this attempt began — identity
      // (`s !== state`), not just value, so a re-armed same-user object (or a
      // direct A→B user switch that already reassigned the ref) is caught too.
      if (!s || s !== state || s.userId !== latestUserIdRef.current) {
        return;
      }
      if (lastFetchOkRef.current) {
        setIsAutoRetrying(false); // recovered
        return;
      }
      if (s.attempts >= AUTO_FETCH_MAX_ATTEMPTS) {
        setIsAutoRetrying(false); // exhausted — let the error surface show
        return;
      }
      if (retryTimerRef.current) return; // already scheduled
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        autoAttemptRef.current();
      }, AUTO_FETCH_RETRY_BASE_MS * s.attempts);
    });
  }, [refresh]);
  useEffect(() => {
    autoAttemptRef.current = autoAttempt;
  }, [autoAttempt]);

  // Arm (or re-arm on user change, e.g. logout → login). Clears any retry left
  // pending from a prior user so a stale timer can't fetch for the wrong id.
  useEffect(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (!userId) {
      autoFetchRef.current = null;
      setIsAutoRetrying(false);
      return;
    }
    // A `true → false` flip is the sheet CLOSING, not unmounting — the
    // component stays mounted, so this effect re-runs rather than a real
    // teardown running. Un-arm the latch and clear `isAutoRetrying` HERE
    // (not just skip arming) so a later reopen starts a fresh bounded-retry
    // chain from attempt 0, instead of finding `autoFetchRef.current` still
    // set to this userId (from before the close) and silently no-op'ing on
    // the `autoFetchRef.current?.userId === userId` check below forever.
    // Without this reset: close mid-retry stranded the profile on a
    // permanent loader (the #296-style regression) — attempts 2/3 never got
    // to run (see `autoAttempt`'s own `enabledRef` guard), `isAutoRetrying`
    // stayed `true` (so `profileErrored` in ProfileDrawerContainer never
    // flips true either), and no later open could re-arm.
    if (!enabled) {
      autoFetchRef.current = null;
      setIsAutoRetrying(false);
      return;
    }
    if (autoFetchRef.current?.userId === userId) return;
    autoFetchRef.current = { userId, attempts: 0 };
    if (!initialIsStale) {
      // Fresh cache for the new user — nothing to retry.
      setIsAutoRetrying(false);
      return;
    }
    autoAttempt();
  }, [userId, initialIsStale, autoAttempt, enabled]);

  // Clear a pending retry on unmount so it can't fire after teardown.
  useEffect(
    () => () => {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    },
    [],
  );

  return {
    payload,
    isStale,
    isRefreshing,
    error,
    syncedAt,
    isAutoRetrying,
    refresh,
  };
}
