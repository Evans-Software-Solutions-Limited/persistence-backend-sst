import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  DEFAULT_ATHLETE_ONBOARDING_INTENTS,
  ONBOARDING_PAGES,
  type CoachClientBand,
  type OnboardingAnalyticsEventName,
  type OnboardingIntentKey,
  type OnboardingPage,
  type OnboardingPath,
  type OnboardingState,
  type OnboardingUpdateInput,
} from "@/domain/models/onboarding";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { useAuth } from "@/ui/hooks/useAuth";

function makeInitialState(userId: string): OnboardingState {
  return {
    userId,
    version: 1,
    currentPage: "welcome",
    completedPages: [],
    skippedPages: [],
    status: "in_progress",
    path: "athlete",
    coachClientBand: null,
    intentKeys: [...DEFAULT_ATHLETE_ONBOARDING_INTENTS],
    completedAt: null,
    dismissedAt: null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * True when a failed read never reached the server — offline, a captive
 * portal, DNS, or our own timeout. `sst-api.adapter` maps every transport
 * failure to `network`/`timeout` and every answer the server actually gave to
 * some other code, so this cleanly separates "we could not ask" from "we
 * asked and it went wrong".
 */
function isUnreachableError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === "network" || code === "timeout";
}

function normalizeRemoteState(
  userId: string,
  remote: OnboardingState | null,
): OnboardingState | null {
  // A backend-created empty/default row represents "not started", not a user
  // choosing no capabilities. Preserve the product's Premium+ defaults.
  if (
    remote &&
    remote.status === "in_progress" &&
    remote.currentPage === "welcome" &&
    remote.path === null &&
    remote.intentKeys.length === 0 &&
    remote.completedPages.length === 0 &&
    remote.skippedPages.length === 0
  ) {
    return makeInitialState(userId);
  }
  return remote;
}

function withoutServerFields(state: OnboardingState): OnboardingUpdateInput {
  const { userId: _userId, updatedAt: _updatedAt, ...input } = state;
  return input;
}

export type OnboardingContextValue = {
  state: OnboardingState | null;
  /**
   * True only while there is no state to act on at all — not while a
   * background refresh is in flight. A cached offline mirror clears it.
   */
  isLoading: boolean;
  loadError: unknown | null;
  retryLoad: () => void;
  goBack: () => Promise<OnboardingPage>;
  completePage: (page: OnboardingPage) => Promise<OnboardingPage | null>;
  skipPage: (page: OnboardingPage) => Promise<OnboardingPage | null>;
  dismissJourney: () => Promise<void>;
  completeJourney: () => Promise<void>;
  setPath: (
    path: OnboardingPath,
    band?: CoachClientBand | null,
  ) => Promise<void>;
  setIntentChoice: (
    group: "nutrition" | "training",
    intent: OnboardingIntentKey,
  ) => Promise<void>;
  track: (
    name: OnboardingAnalyticsEventName,
    properties?: Record<string, string | number | boolean | null>,
  ) => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const userIdRef = useRef(userId);
  const identityRef = useRef({ userId, epoch: 0 });
  /**
   * True while the state on hand is a locally seeded guess rather than
   * anything the server has confirmed. Gates every outbound write.
   */
  const isProvisionalRef = useRef(false);
  /**
   * True once the user has actually ADVANCED a provisional journey.
   *
   * The distinction matters at reconcile time. An untouched seed is pure
   * guesswork and must lose to whatever the server says, or its defaults
   * would overwrite a real in-progress row. A journey the user walked offline
   * is their genuine, most recent intent and has to survive the reconnect —
   * without this, four pages of work were discarded by the very retry that
   * was added to recover from being offline.
   */
  const hasProvisionalEditsRef = useRef(false);
  if (identityRef.current.userId !== userId) {
    identityRef.current = {
      userId,
      epoch: identityRef.current.epoch + 1,
    };
    // Cleared here, not only on sign-out: `useAuth` can hand us B directly
    // from A with no intervening null (a confirmation or recovery deep link
    // for a second account). Left set, A's provisional flag would swallow B's
    // first write.
    isProvisionalRef.current = false;
    hasProvisionalEditsRef.current = false;
  }
  userIdRef.current = userId;
  const [state, setState] = useState<OnboardingState | null>(null);
  const stateRef = useRef<OnboardingState | null>(null);
  const [loadFailure, setLoadFailure] = useState<{
    userId: string;
    error: unknown;
  } | null>(null);
  const [loadRevision, setLoadRevision] = useState(0);
  const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
  const revisionRef = useRef(0);

  const enqueueUpdate = useCallback(
    (input: OnboardingUpdateInput, requestUserId: string, epoch: number) => {
      const request = writeQueueRef.current.then(() => {
        if (
          userIdRef.current !== requestUserId ||
          identityRef.current.epoch !== epoch
        ) {
          return null;
        }
        return api.updateOnboarding(input);
      });
      // A rejected request must not poison later writes. The API normally
      // returns Result failures, but keeping the queue recoverable also covers
      // an unexpected adapter throw.
      writeQueueRef.current = request.then(
        () => undefined,
        () => undefined,
      );
      return request;
    },
    [api],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let active = true;
    if (!userId) {
      isProvisionalRef.current = false;
      setState(null);
      setLoadFailure(null);
      return () => {
        active = false;
      };
    }

    setLoadFailure(null);
    const cached = storage.getCachedOnboarding(userId);
    if (cached) setState(cached);

    void (async () => {
      const remote = await api.getOnboarding();
      if (!active) return;
      if (!remote.ok) {
        // A failed read is not evidence that onboarding has never started, so
        // a user-scoped offline mirror always wins when we have one.
        //
        // With no mirror we have to choose, and the two failures are not the
        // same thing. If the request never reached the server, the journey is
        // still completable entirely on-device, so seed it locally rather than
        // wall the account off behind an error — every page but the plan
        // picker works offline, and that one degrades (Brad's call,
        // 2026-09-07). The seed is deliberately NOT written to the mirror: it
        // is a guess about an account we could not read, and it must never
        // later outrank the server's own record of it.
        //
        // A server that answered with an error is different. That IS evidence
        // the account read is broken, and replaying onboarding over real
        // progress could clobber it — so keep the error wall for that.
        if (cached) {
          setState(cached);
          setLoadFailure({ userId, error: remote.error });
          return;
        }
        // No mirror and the server was never reached: seed a journey so the
        // user is not walled off, but treat it as PROVISIONAL. It is a guess
        // about an account we could not read, so for as long as it stands it
        // lives in memory only — `persist` neither mirrors it nor uploads it
        // (see `isProvisionalRef`). Without that, the first Continue would
        // PUT the seed's defaults over whatever real in-progress row the
        // server holds, and `onboardingStateRepository.put` would accept it:
        // its guard only protects a terminal row, not an in-progress one.
        const unreachable = isUnreachableError(remote.error);
        isProvisionalRef.current = unreachable;
        setState(unreachable ? makeInitialState(userId) : null);
        setLoadFailure({ userId, error: remote.error });
        return;
      }
      // Work done on a provisional journey is real work, and it is the only
      // copy of itself — it was deliberately never mirrored. Promote it to
      // the local candidate so the merge below can weigh it, otherwise the
      // reconnect read discards every page the user completed offline and
      // writes the reset over it. An UNTOUCHED seed is not promoted: it is
      // guesswork, and letting its defaults compete would put back the
      // clobber that keeping it out of the mirror was protecting against.
      const provisional =
        isProvisionalRef.current &&
        hasProvisionalEditsRef.current &&
        stateRef.current?.userId === userId
          ? stateRef.current
          : null;
      const local = cached ?? provisional;
      // A real answer supersedes any provisional seed, so local writes may
      // reach the mirror and the server again from here.
      isProvisionalRef.current = false;
      hasProvisionalEditsRef.current = false;
      const serverState = normalizeRemoteState(userId, remote.value);
      // A journey the server considers finished cannot be un-finished by a
      // local one that is merely newer. Without this, an offline seed (or an
      // offline replay) carrying a fresh `updatedAt` would outrank a genuine
      // `completed` and march the user back through setup on reconnect.
      const serverIsTerminal =
        serverState !== null && serverState.status !== "in_progress";
      const next =
        serverState &&
        (!local ||
          (serverIsTerminal && local.status === "in_progress") ||
          Date.parse(serverState.updatedAt) >= Date.parse(local.updatedAt))
          ? serverState
          : (local ?? makeInitialState(userId));
      setState(next);
      storage.cacheOnboarding(userId, next);

      // A newer local journey wins and is reconciled server-side. Terminal
      // server states cannot be reverted, so never upload over one.
      if (
        local &&
        (!serverState ||
          (serverState.status === "in_progress" &&
            Date.parse(local.updatedAt) > Date.parse(serverState.updatedAt)))
      ) {
        void enqueueUpdate(
          withoutServerFields(local),
          userId,
          identityRef.current.epoch,
        );
      }
    })();

    return () => {
      active = false;
    };
  }, [api, enqueueUpdate, loadRevision, storage, userId]);

  const retryLoad = useCallback(() => {
    setLoadRevision((revision) => revision + 1);
  }, []);

  /**
   * Self-heal on reconnect.
   *
   * A seeded journey suppresses the error wall (state is no longer null), so
   * `retryLoad`'s only caller is unreachable in exactly the case that needs it
   * most — and the load effect keys on nothing to do with connectivity. Left
   * alone, a user seeded in a lift would be marched through a journey they may
   * already have finished for the rest of the session. Retry the read the
   * moment the connection actually comes back.
   *
   * Keyed on the offline→online TRANSITION, not on `isOnline` itself, because
   * `useOnlineStatus` starts optimistically `true` and a bare truthy check
   * would re-fire the read immediately after every failure.
   */
  const isOnline = useOnlineStatus();
  const hasBeenOffline = useRef(false);
  useEffect(() => {
    if (!isOnline) {
      hasBeenOffline.current = true;
      return;
    }
    if (hasBeenOffline.current && loadFailure !== null) {
      hasBeenOffline.current = false;
      setLoadRevision((revision) => revision + 1);
    }
  }, [isOnline, loadFailure]);

  const persist = useCallback(
    async (derive: (current: OnboardingState) => OnboardingState) => {
      if (!userId) return null;
      const requestUserId = userId;
      const requestEpoch = identityRef.current.epoch;
      const current =
        stateRef.current?.userId === requestUserId
          ? stateRef.current
          : makeInitialState(requestUserId);
      if (current.status !== "in_progress") return current;
      const optimistic = {
        ...derive(current),
        updatedAt: new Date().toISOString(),
      };
      const revision = ++revisionRef.current;
      stateRef.current = optimistic;
      setState(optimistic);
      // A provisional journey stays in memory. Mirroring it would let it
      // outrank the server's own record on the next launch, and uploading it
      // would overwrite a real in-progress row with the seed's defaults —
      // the server only refuses writes over a TERMINAL row. The journey is
      // still fully usable; it is just not evidence of anything yet, and a
      // successful read (retried on reconnect) clears the flag.
      if (isProvisionalRef.current) {
        hasProvisionalEditsRef.current = true;
        return optimistic;
      }
      storage.cacheOnboarding(userId, optimistic);
      const result = await enqueueUpdate(
        withoutServerFields(optimistic),
        requestUserId,
        requestEpoch,
      );
      if (
        result?.ok &&
        userIdRef.current === requestUserId &&
        identityRef.current.epoch === requestEpoch &&
        revisionRef.current === revision
      ) {
        stateRef.current = result.value;
        setState(result.value);
        storage.cacheOnboarding(userId, result.value);
        return result.value;
      }
      return optimistic;
    },
    [enqueueUpdate, storage, userId],
  );

  const track = useCallback(
    (
      name: OnboardingAnalyticsEventName,
      properties?: Record<string, string | number | boolean | null>,
    ) => {
      // The backend derives user identity from auth. Properties are restricted
      // to page/intent/tier metadata; never pass profile or health values.
      void api.trackAnalyticsEvent({ name, properties });
    },
    [api],
  );

  const nextPage = (page: OnboardingPage): OnboardingPage | null => {
    const index = ONBOARDING_PAGES.indexOf(page);
    return ONBOARDING_PAGES[index + 1] ?? null;
  };

  const completePage = useCallback(
    async (page: OnboardingPage) => {
      const next = nextPage(page);
      await persist((current) => ({
        ...current,
        currentPage: next ?? current.currentPage,
        completedPages: current.completedPages.includes(page)
          ? current.completedPages
          : [...current.completedPages, page],
      }));
      track("onboarding_page_completed", { page });
      return next;
    },
    [persist, track],
  );

  const skipPage = useCallback(
    async (page: OnboardingPage) => {
      const next = nextPage(page);
      await persist((current) => ({
        ...current,
        currentPage: next ?? current.currentPage,
        skippedPages: current.skippedPages.includes(page)
          ? current.skippedPages
          : [...current.skippedPages, page],
      }));
      track("onboarding_page_skipped", { page });
      return next;
    },
    [persist, track],
  );

  const goBack = useCallback(async () => {
    const current = stateRef.current?.currentPage ?? "welcome";
    const index = ONBOARDING_PAGES.indexOf(current);
    const previous = ONBOARDING_PAGES[Math.max(0, index - 1)];
    await persist((value) => ({ ...value, currentPage: previous }));
    return previous;
  }, [persist]);

  const dismissJourney = useCallback(async () => {
    await persist((current) => ({
      ...current,
      status: "dismissed",
      dismissedAt: new Date().toISOString(),
    }));
    track("onboarding_dismissed");
  }, [persist, track]);

  const completeJourney = useCallback(async () => {
    await persist((current) => ({
      ...current,
      status: "completed",
      completedAt: new Date().toISOString(),
    }));
    track("onboarding_completed");
  }, [persist, track]);

  const setPath = useCallback(
    async (path: OnboardingPath, band: CoachClientBand | null = null) => {
      await persist((current) => ({
        ...current,
        path,
        coachClientBand: path === "coach" ? band : null,
      }));
    },
    [persist],
  );

  const setIntentChoice = useCallback(
    async (group: "nutrition" | "training", intent: OnboardingIntentKey) => {
      const prefix = group === "nutrition" ? "nutrition_" : "training_";
      await persist((current) => ({
        ...current,
        intentKeys: [
          ...current.intentKeys.filter((key) => !key.startsWith(prefix)),
          intent,
        ],
      }));
      track("onboarding_intent_changed", { intentKey: intent });
    },
    [persist, track],
  );

  const value = useMemo<OnboardingContextValue>(() => {
    // Never expose another account's cached state or load failure during the
    // passive-effect window after an auth identity changes.
    const visibleState = state?.userId === userId ? state : null;
    const visibleLoadError =
      loadFailure?.userId === userId ? loadFailure.error : null;
    return {
      state: visibleState,
      // "Nothing to route on yet" — deliberately NOT "a read is in flight".
      // A cached offline mirror is sufficient to decide where a signed-in
      // user belongs, so the background refresh must not hold the boot gate:
      // waiting on it bought nothing and cost an unbounded spinner offline.
      // A read failure is not pending either; AuthGate fails open on it.
      isLoading:
        userId !== null && visibleLoadError === null && visibleState === null,
      loadError: visibleLoadError,
      retryLoad,
      goBack,
      completePage,
      skipPage,
      dismissJourney,
      completeJourney,
      setPath,
      setIntentChoice,
      track,
    };
  }, [
    state,
    loadFailure,
    retryLoad,
    userId,
    goBack,
    completePage,
    skipPage,
    dismissJourney,
    completeJourney,
    setPath,
    setIntentChoice,
    track,
  ]);

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context)
    throw new Error("useOnboarding must be used within OnboardingProvider");
  return context;
}

export function useOptionalOnboarding(): OnboardingContextValue | null {
  return useContext(OnboardingContext);
}
