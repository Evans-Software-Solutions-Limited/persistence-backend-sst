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
  isLoading: boolean;
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
  if (identityRef.current.userId !== userId) {
    identityRef.current = {
      userId,
      epoch: identityRef.current.epoch + 1,
    };
  }
  userIdRef.current = userId;
  const [state, setState] = useState<OnboardingState | null>(null);
  const stateRef = useRef<OnboardingState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
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
      setState(null);
      setIsLoading(false);
      return () => {
        active = false;
      };
    }

    setIsLoading(true);
    const cached = storage.getCachedOnboarding(userId);
    if (cached) setState(cached);

    void (async () => {
      const remote = await api.getOnboarding();
      if (!active) return;
      const serverState = normalizeRemoteState(
        userId,
        remote.ok ? remote.value : null,
      );
      const next =
        serverState &&
        (!cached ||
          Date.parse(serverState.updatedAt) >= Date.parse(cached.updatedAt))
          ? serverState
          : (cached ?? makeInitialState(userId));
      setState(next);
      storage.cacheOnboarding(userId, next);
      setIsLoading(false);

      // A newer offline mirror wins and is reconciled server-side. Terminal
      // server states cannot be reverted, so never upload over one.
      if (
        cached &&
        (!serverState ||
          (serverState.status === "in_progress" &&
            Date.parse(cached.updatedAt) > Date.parse(serverState.updatedAt)))
      ) {
        void enqueueUpdate(
          withoutServerFields(cached),
          userId,
          identityRef.current.epoch,
        );
      }
    })();

    return () => {
      active = false;
    };
  }, [api, enqueueUpdate, storage, userId]);

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

  const value = useMemo<OnboardingContextValue>(
    () => ({
      // Never expose another account's cached state during the passive-effect
      // window after an auth identity changes.
      state: state?.userId === userId ? state : null,
      isLoading: userId !== null && (isLoading || state?.userId !== userId),
      goBack,
      completePage,
      skipPage,
      dismissJourney,
      completeJourney,
      setPath,
      setIntentChoice,
      track,
    }),
    [
      state,
      isLoading,
      userId,
      goBack,
      completePage,
      skipPage,
      dismissJourney,
      completeJourney,
      setPath,
      setIntentChoice,
      track,
    ],
  );

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
