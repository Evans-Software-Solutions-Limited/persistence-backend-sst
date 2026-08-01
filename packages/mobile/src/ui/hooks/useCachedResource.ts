import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import type { Result, ApiError } from "@/shared/errors";
import type { StoragePort } from "@/domain/ports/storage.port";
import type { ApiPort } from "@/domain/ports/api.port";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Cold-start retry cadence (ms to wait BEFORE each attempt). A fresh-cache first
 * load — brand-new account, or an existing account on a new device — has no
 * cached value to fall back on, so a single failed fetch strands the user on the
 * error screen (a warm device silently shows its stale cache instead). The very
 * first backend request after idle can also hit a cold Lambda that exceeds the
 * per-request 10s timeout (`DASHBOARD_REQUEST_TIMEOUT_MS`); attempts 2 and 3
 * land after it has warmed. Only used when the cache is empty AND the failure is
 * transient (see `isRetryableColdStartError`).
 */
export const COLD_START_RETRY_DELAYS_MS = [0, 1500, 4000];

/**
 * Transient failures worth retrying on a cold start: a timed-out request (cold
 * Lambda), a network blip, or a server 5xx. A 4xx (unauthorized, not-found,
 * entitlement-denied) does NOT self-heal — retrying would only delay the correct
 * error state — so those surface immediately.
 */
function isRetryableColdStartError(error: ApiError): boolean {
  return (
    error.code === "timeout" ||
    error.code === "network" ||
    error.code === "server"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generic cache-first read hook (06-progress-goals, Phase 06.7). Distils the
 * offline-first pattern proven by `useDashboard` so the dozen Progress/Home
 * read hooks don't each re-implement it:
 *
 *  - synchronous cache read on mount (renders instantly, offline);
 *  - background refresh per user when the cache is empty/stale — retried with
 *    backoff on a cold start (empty cache) so a slow/cold first request doesn't
 *    strand a brand-new user on the error screen (`COLD_START_RETRY_DELAYS_MS`);
 *  - `refresh()` drains the sync queue first (so optimistic mutations land
 *    before the GET), then fetches; a session flip mid-flight is guarded so a
 *    stale user's payload can't pollute another user's cache;
 *  - failure leaves the cached value intact and surfaces `error`.
 *
 * `read` returns the cached value + staleness; `fetcher` hits the API; `write`
 * persists a successful fetch (pass a no-op to skip caching).
 */
export type CachedResourceConfig<T> = {
  read: (
    storage: StoragePort,
    userId: string,
  ) => { value: T | null; isStale: boolean };
  fetcher: (api: ApiPort) => Promise<Result<T, ApiError>>;
  write: (storage: StoragePort, userId: string, value: T) => void;
  /**
   * Local tables this resource reads from. When supplied, a write to any of them
   * triggers an automatic cache re-read (see the `storage.subscribe` effect
   * below) so an optimistic offline mutation surfaces without the caller having
   * to remember a `reload()`. Omit to keep the previous behaviour.
   *
   * ⚠ List ONLY tables `read` actually consults. A table here whose row is deleted
   * is interpreted as an invalidation and triggers a silent NETWORK refresh (see
   * the effect below), so an over-broad list converts unrelated local
   * invalidations into round trips — `HOME_TABLES` carried `cached_dashboard` this
   * way and made a per-set `invalidateDashboard()` fetch Home mid-workout.
   *
   * Pass a module-level constant (e.g. `RECIPE_TABLES`) rather than building the
   * array inline per render.
   */
  tables?: readonly string[];
  /**
   * Gate for the AUTOMATIC fetch paths (mount auto-refresh + the bus-driven
   * silent refresh below) — NOT for the synchronous cache `read` or the
   * explicit `refresh()`/`reload()` the caller invokes. Defaults to `true`.
   *
   * Exists for the always-mounted bottom sheets (feedback_sheets_mount_at_root
   * — root-mounting is correct, it's what keeps z-order + the slide-out exit
   * animation working): seven of them called this hook unconditionally, so
   * their data fetches fired on every cold launch regardless of whether the
   * sheet was ever opened. ~28 requests inside 100ms against a 10-concurrency
   * Lambda quota meant ~16 came back 503. Callers pass their sheet's own
   * `open`/`visible` flag here so the fetch waits for a real open.
   *
   * `false → true` still fires the mount auto-refresh exactly once (the
   * one-shot latch below is only armed once `enabled` has let the effect run
   * past the guard), so a sheet opened for the first time still refreshes on
   * that first open — it just doesn't refresh before anyone asked.
   */
  enabled?: boolean;
};

export type CachedResourceState<T> = {
  data: T | null;
  isStale: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  /**
   * Network refresh: drain the queue, fetch server-truth, reconcile cache.
   * Pass `{ silent: true }` for a background/focus refresh that updates data
   * WITHOUT toggling `isRefreshing` (so it doesn't flash the RefreshControl).
   */
  refresh: (opts?: { silent?: boolean }) => Promise<void>;
  /**
   * Synchronous cache re-read: re-runs `read` and pushes the result into local
   * state, with NO network call. This is the reactive bridge for optimistic
   * mutations — a command writes to the cache and returns void, so without this
   * the mounted component's `data` snapshot stays stale until a re-mount or a
   * successful `refresh` (the habit-grid-toggle bug). Call `reload()` right
   * after an optimistic write to reflect it instantly, offline-safe; `refresh`
   * still reconciles with server truth afterward. Mirrors `useGetFuelToday`.
   */
  reload: () => void;
};

export function useCachedResource<T>(
  config: CachedResourceConfig<T>,
): CachedResourceState<T> {
  const { api, auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const { read, fetcher, write, enabled = true } = config;

  // Mirrors `enabled`, written DURING RENDER (not inside a `useEffect`) so
  // it's already up to date by the time the mount-effect's CLEANUP runs in
  // the same commit — an effect-based ref update would still read the OLD
  // value there, because React runs every changed effect's cleanup before
  // running any new effect's body. This is what lets that cleanup tell a
  // `enabled: true → false` sheet CLOSE (component stays mounted — the
  // cleanup must reset in-flight state) apart from a real unmount or an
  // unrelated dependency change (state must NOT be reset there).
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const [cacheVersion, setCacheVersion] = useState(0);
  const initial = useMemo(() => {
    void cacheVersion;
    if (!userId) return { value: null as T | null, isStale: true };
    const r = read(storage, userId);
    return { value: r.value, isStale: r.isStale };
    // `read` is a stable closure from the caller; userId/cacheVersion drive it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, userId, cacheVersion]);

  const [data, setData] = useState<T | null>(initial.value);
  const [isStale, setIsStale] = useState(initial.isStale);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // Re-sync local state when the signed-in user changes.
  const prevUserRef = useRef<string | null>(userId);
  useEffect(() => {
    if (prevUserRef.current === userId) return;
    prevUserRef.current = userId;
    setData(initial.value);
    setIsStale(initial.isStale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const latestUserRef = useRef<string | null>(userId);
  useEffect(() => {
    latestUserRef.current = userId;
  }, [userId]);

  const inFlightRef = useRef(false);

  // One fetch pass: drain the sync queue, GET, and write-through on success.
  // Returns the `ApiError` on failure (or null on success / a session flip
  // mid-flight). Deliberately does NOT touch `error`, `isRefreshing`, or
  // `inFlightRef` — the caller owns that lifecycle, so the cold-start path can
  // retry across attempts without flashing the error state between them.
  const attemptFetch = useCallback(async (): Promise<ApiError | null> => {
    try {
      await processSyncQueue(storage, auth, getApiBaseUrl());
    } catch (err) {
      console.error("[useCachedResource] queue flush failed:", err);
    }
    if (userId == null || latestUserRef.current !== userId) return null;
    const result = await fetcher(api);
    if (!result.ok) {
      return latestUserRef.current === userId ? result.error : null;
    }
    if (latestUserRef.current !== userId) return null;
    write(storage, userId, result.value);
    setData(result.value);
    setIsStale(false);
    setCacheVersion((v) => v + 1);
    return null;
    // read/fetcher/write are stable caller closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, auth, storage, userId]);

  const refresh = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!userId || inFlightRef.current) return;
      inFlightRef.current = true;
      // `silent` fetches server-truth WITHOUT toggling `isRefreshing`, so a
      // background/focus refresh doesn't flash the RefreshControl spinner (a
      // programmatic `refreshing={true}` shows the pull spinner even without a
      // pull). Pull-to-refresh omits it and keeps the visible indicator.
      const showSpinner = !opts?.silent;
      if (showSpinner) setIsRefreshing(true);
      setError(null);
      try {
        const err = await attemptFetch();
        if (err && latestUserRef.current === userId) setError(err);
      } finally {
        if (showSpinner) setIsRefreshing(false);
        inFlightRef.current = false;
      }
    },
    [userId, attemptFetch],
  );

  const reload = useCallback(() => {
    if (!userId) return;
    const r = read(storage, userId);
    setData(r.value);
    setIsStale(r.isStale);
    // `read` is a stable caller closure (same convention as `refresh`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, userId]);

  // Local-write reactivity. When the caller declares which tables back this
  // resource, a write to any of them re-reads the cache automatically — the same
  // thing `reload()` does, minus the requirement that every writer remember to
  // call it. That requirement is what made offline-created rows invisible: a
  // recipe written by `useCreateRecipe` landed in `cached_recipes`, but
  // `RecipesLibraryContainer` had no focus re-read and no `reload()`, and this
  // hook's mount auto-refresh is one-shot per userId — so the row stayed hidden
  // until a manual pull-to-refresh.
  //
  // `tables` is captured on mount (a resource's backing tables are fixed), so a
  // caller may pass an inline literal without resubscribing every render.
  //
  // ⚠ This does NOT simply call `reload()`. Several of these tables are
  // invalidated by DELETING the row (`invalidateHome`, `invalidateDashboard`,
  // `invalidateGoals`), which is a write, so the bus fires and a plain `reload()`
  // would read `null` and push it into state. On Home that means
  // `data === null` → `isLoading` true → the whole screen becomes a spinner, with
  // nothing to clear it (the mount auto-refresh is one-shot per userId). Tapping
  // "Weigh in" would blank Home until the user left the tab; offline it would
  // never recover.
  //
  // An invalidation means "this is stale, go and refetch" — NOT "there is no
  // data". So: adopt a real value, but treat a vanished row as staleness over the
  // data already on screen and kick a silent refresh to actually replace it.
  // `reload()` itself keeps its existing null-adopting semantics for its explicit
  // callers, which pass through this path deliberately unchanged.
  const tablesRef = useRef(config.tables);
  useEffect(() => {
    const tables = tablesRef.current;
    if (!tables || tables.length === 0) return;
    if (!userId) return;
    return storage.subscribe(tables, () => {
      const r = read(storage, userId);
      if (r.value !== null) {
        setData(r.value);
        setIsStale(r.isStale);
        return;
      }
      // Row gone. Keep what is rendered, mark it stale, and refetch — but
      // only the network half when `enabled`. A closed sheet still wants the
      // synchronous re-read above (its cached snapshot must stay correct for
      // the moment it opens), it just shouldn't spend a request while nobody
      // is looking at it.
      //
      setIsStale(true);
      if (enabled === false) {
        // DISABLED: no refresh is coming, so nothing else will re-read the
        // cache. `setIsStale(true)` alone only updates the STATE this hook
        // returns — it does NOT make the mount auto-refresh effect below
        // re-fire, because that effect gates on `initialIsStale`, derived
        // from the `initial` useMemo keyed on `[storage, userId,
        // cacheVersion]`. None of those move just because local `isStale`
        // state changed. Bumping `cacheVersion` forces that memo to re-run
        // `read()` against the just-invalidated cache, so `initialIsStale`
        // reflects reality by the time this resource is next opened. Latent
        // today (both `tables`-declaring hooks hardcode `isStale: true`), but
        // load-bearing the moment any hook adds `tables` with a real
        // TTL-based `read()`.
        //
        // ⚠ Scoped to the disabled branch DELIBERATELY. Bumping
        // unconditionally regressed Home: `cacheVersion` moves
        // `initialHasNoCache`, which is a dependency of the mount
        // auto-refresh effect, so an invalidation arriving mid-fetch tore
        // that effect down while the component was still mounted AND still
        // enabled — a case the cleanup's `enabledRef.current === false` guard
        // deliberately excludes. The in-flight attempt then settled with
        // `cancelled === true`, so both `setIsRefreshing(false)` and
        // `setError` were skipped and the superseding instance early-returned
        // on the still-armed latch: `HomePresenter`'s `RefreshControl` span
        // forever and the error never surfaced. Trigger was ordinary — cold
        // launch with a stale `cached_home`, then tapping a habit or logging
        // a weigh-in before the request landed (`invalidateHome()` deletes
        // the row). Nothing needs the bump on the enabled path on SUCCESS:
        // `refresh()` below re-reads and writes through on its own. That does
        // NOT hold if the silent refresh below fails, or is swallowed by
        // `refresh`'s own `if (inFlightRef.current) return` guard — `initial`
        // then keeps the pre-invalidation read.
        //
        // ⚠ That gap is REACHABLE TODAY, via `useGetHome` — it declares
        // `tables` and its `read` computes a real TTL
        // (`isHomeStale(storage.getHomeAge(...))`). Note the condition is
        // `tables` + a real-TTL `read` and nothing else: the gap lives on the
        // ENABLED path, so a hook that never receives `enabled` is
        // permanently on it. Consequence is benign — `HomeContainer` has both
        // a focus refresh and pull-to-refresh, either of which recovers it —
        // which is why this is documented rather than fixed. The other two
        // `tables`-declaring hooks (`useGetMeals`, `useGetRecipes`) hardcode
        // `isStale: true` and so cannot hit it.
        setCacheVersion((v) => v + 1);
        return;
      }
      void refresh({ silent: true });
    });
    // `read` is a stable caller closure (same convention as `refresh`/`reload`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storage, userId, refresh, enabled]);

  const autoRefreshedRef = useRef<string | null>(null);
  const initialIsStale = initial.isStale;
  const initialHasNoCache = initial.value == null;
  /**
   * Bumped by an ABANDONED attempt's `finally` when the resource has been
   * re-enabled in the meantime, purely to re-run the arming effect below.
   *
   * The cleanup un-arms `autoRefreshedRef` synchronously, but `inFlightRef`
   * stays `true` until the abandoned promise actually settles. Reopen inside
   * that window (up to ~10s on a cold Lambda, and the cold-start ladder waits
   * 5.5s of its own) and the arming effect hits `if (inFlightRef.current)
   * return` — bailing BEFORE it arms, so nothing is latched. If that abandoned
   * attempt then FAILS, its failure path touches no state at all (`setError`
   * and `setIsRefreshing` are both skipped under `cancelled`, and `inFlightRef`
   * is a ref) — so nothing re-renders, no dependency moves, and the effect
   * never runs again. Result: an open sheet with no data, no error, no
   * spinner, and no recovery short of an unmount or a user switch.
   *
   * The success path self-heals (`attemptFetch` writes `data` + bumps
   * `cacheVersion` regardless of `cancelled`), which is why this is
   * failure-only — and why it needs an explicit nudge rather than a dependency
   * that happens to move.
   */
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    if (!userId) {
      autoRefreshedRef.current = null;
      return;
    }
    // Gate BEFORE the one-shot latch is checked/armed — not after — so a
    // disabled resource never marks `autoRefreshedRef`. That's what lets a
    // later `enabled` flip to `true` still find the latch unset and run the
    // auto-refresh exactly once, instead of the gate silently eating the
    // resource's only shot at it.
    if (enabled === false) return;
    if (autoRefreshedRef.current === userId) return;
    if (!initialIsStale) return;
    if (inFlightRef.current) return;
    autoRefreshedRef.current = userId;

    // Retry with backoff ONLY on a cold start (no cached value to fall back on).
    // With a stale-but-present cache, one attempt is enough — the stale data
    // already renders, so a failed refresh is invisible and needn't retry.
    const delays = initialHasNoCache ? COLD_START_RETRY_DELAYS_MS : [0];

    let cancelled = false;
    inFlightRef.current = true;
    setIsRefreshing(true);
    setError(null);

    // Whether this run ultimately failed — the ONLY case the `retryTick` nudge
    // below applies to. A run that succeeded already wrote `data` and bumped
    // `cacheVersion` (which self-heals a reopen without any nudge), so nudging
    // it too would fire a second fetch against data milliseconds old.
    let failed = false;
    void (async () => {
      try {
        let lastError: ApiError | null = null;
        for (let attempt = 0; attempt < delays.length; attempt++) {
          if (cancelled || latestUserRef.current !== userId) break;
          if (delays[attempt] > 0) {
            await sleep(delays[attempt]);
            if (cancelled || latestUserRef.current !== userId) break;
          }
          // Even if `attemptFetch` THROWS (fetcher rejects, or
          // processSyncQueue rethrows past its own try/catch), the
          // `finally` below still releases `inFlightRef` — otherwise a
          // thrown rejection here would leave `inFlightRef.current` stuck
          // `true` forever, and `refresh()`'s `if (inFlightRef.current)
          // return` would silently no-op on every future call until an
          // app restart (QA-14a).
          lastError = await attemptFetch();
          if (!lastError) break; // success — attemptFetch already wrote `data`
          if (!isRetryableColdStartError(lastError)) break; // 4xx: don't retry
        }
        if (lastError) failed = true;
        if (!cancelled && lastError && latestUserRef.current === userId) {
          setError(lastError);
        }
      } catch (err) {
        failed = true;
        // `attemptFetch` isn't supposed to throw (it returns the ApiError
        // on failure), but a misbehaving `fetcher` rejecting instead of
        // resolving a `Result` must not escape as an unhandled rejection
        // off this void-called IIFE — log and fall through to `finally`.
        console.error("[useCachedResource] mount auto-refresh failed:", err);
      } finally {
        // `cancelled` guards against a stale/late-resolving fetch clobbering
        // fresher state after a genuine unmount or a userId change — NOT
        // against a `enabled` flip, which the cleanup below handles
        // immediately and explicitly instead of waiting for this to settle.
        if (!cancelled) setIsRefreshing(false);
        inFlightRef.current = false;
        // Abandoned (the sheet closed mid-fetch), FAILED, and re-enabled again
        // since — the user reopened before it settled. The arming effect
        // already early-returned on `inFlightRef` above, and on the failure
        // path nothing else moves a dependency, so nudge it explicitly now
        // that the slot is free. See `retryTick`.
        //
        // Success is excluded because it needs no nudge — it writes `data` and
        // moves `initialHasNoCache`/`cacheVersion` itself. ⚠ Note that for a
        // resource whose `read` hardcodes `isStale: true` (today: the two
        // `tables`-declaring hooks, `useGetMeals` and `useGetRecipes`) that
        // same dependency movement re-runs this effect against an un-armed
        // latch and so does refetch once on this interleaving. That is a
        // property of an always-stale `read`, not of the nudge — gating the
        // nudge on `failed` does not (and cannot) suppress it.
        if (cancelled && failed && enabledRef.current) {
          setRetryTick((t) => t + 1);
        }
      }
    })();

    return () => {
      cancelled = true;
      // A `enabled: true → false` flip re-runs this effect (it's a
      // dependency) but the component STAYS MOUNTED — the sheet just closed,
      // it did not unmount. `enabledRef.current` was already updated to the
      // NEW value during render, before this cleanup runs in the same
      // commit, so this reliably distinguishes that case from a real
      // unmount or an unrelated dependency change (where `enabled` is still
      // `true` and none of this should run).
      //
      // Without this: closing mid-fetch left `isRefreshing` stuck `true`
      // forever on the success path (the `finally` above skips resetting it
      // once `cancelled` is true) and silently swallowed the error on the
      // failure path (`setError` above is ALSO skipped) — AND
      // `autoRefreshedRef` was already armed for this user before the async
      // work even started, so reopening never re-fired the fetch either way.
      // Resetting both here — synchronously, not waiting for the in-flight
      // promise to settle — un-arms the latch so the next open genuinely
      // refetches (only pointless if the abandoned fetch already succeeded
      // and bumped `cacheVersion`, in which case `initialIsStale` will
      // correctly report fresh and the arming effect skips redundant work).
      if (enabledRef.current === false) {
        setIsRefreshing(false);
        autoRefreshedRef.current = null;
      }
    };
    // attemptFetch is stable per (api/auth/storage/userId); initial* gate entry.
  }, [
    userId,
    initialIsStale,
    initialHasNoCache,
    attemptFetch,
    enabled,
    retryTick,
  ]);

  return { data, isStale, isRefreshing, error, refresh, reload };
}
