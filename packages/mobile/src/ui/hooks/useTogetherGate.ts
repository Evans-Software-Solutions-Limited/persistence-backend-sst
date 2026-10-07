import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "expo-router";
import type { TogetherAccessSnapshot } from "@/domain/ports/togetherProvisioning.port";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

const UNAVAILABLE: TogetherAccessSnapshot = {
  accountId: null,
  state: "unavailable",
  expiresAt: null,
  error: "disabled",
};
const noSubscribe = () => () => {};
const unavailable = () => UNAVAILABLE;
const RESOLVE_TIMEOUT_MS = 8000;
const CONNECTIVITY_TIMEOUT_MS = 1500;

/** New sharing only. Personal workout recovery must never depend on this gate. */
export function useTogetherGate() {
  const { togetherProvisioning: provisioning, netInfo } = useAdapters();
  const { session, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const accountId = session?.userId ?? null;
  const subscribe = useCallback(
    (listener: () => void) =>
      provisioning?.subscribeAccess?.(listener) ?? noSubscribe(),
    [provisioning],
  );
  const getSnapshot = useCallback(
    () => provisioning?.getAccessSnapshot?.() ?? unavailable(),
    [provisioning],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, unavailable);
  const matches = accountId !== null && snapshot.accountId === accountId;
  // Each useAuth instance bootstraps independently. A parent's resolved session
  // must not turn this hook's unfinished bootstrap into a sharing denial.
  const projectedState = authLoading
    ? "pending"
    : matches
      ? snapshot.state
      : accountId && provisioning?.getAccessSnapshot
        ? "pending"
        : "unavailable";
  const [stalled, setStalled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retryGeneration = useRef({ value: 0 });
  useEffect(() => {
    const lifecycle = retryGeneration.current;
    return () => {
      lifecycle.value++;
    };
  }, [accountId, provisioning]);
  useEffect(() => {
    setStalled(false);
    if (authLoading || projectedState !== "pending") return;
    const timer = setTimeout(() => setStalled(true), RESOLVE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [authLoading, projectedState, accountId, attempt]);
  const state =
    !authLoading && projectedState === "pending" && stalled
      ? "unavailable"
      : projectedState;
  const retry = useCallback(async () => {
    if (!accountId || !provisioning?.refreshAccess) return;
    const generation = ++retryGeneration.current.value;
    setStalled(false);
    setAttempt((value) => value + 1);
    let online = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      online = await Promise.race([
        netInfo.isConnected(),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), CONNECTIVITY_TIMEOUT_MS);
        }),
      ]);
    } catch {
      // Unknown reachability only validates already-cached proof.
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    if (
      generation !== retryGeneration.current.value ||
      provisioning.getAccessSnapshot?.().accountId !== accountId
    )
      return;
    await provisioning.refreshAccess({ online });
  }, [accountId, provisioning, netInfo]);
  const onUpgrade = useCallback(() => {
    router.push("/(auth)/subscription-selection?tier=premium&cycle=monthly");
  }, [router]);
  return {
    allowed: state === "allowed",
    state,
    error:
      !authLoading && projectedState === "pending" && stalled
        ? ("unavailable" as const)
        : matches
          ? snapshot.error
          : undefined,
    onUpgrade,
    retry,
  };
}
