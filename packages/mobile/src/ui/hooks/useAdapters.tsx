import { createContext, useContext, type ReactNode } from "react";
import type { Adapters } from "@/shared/types";

const AdapterContext = createContext<Adapters | null>(null);

/**
 * Outcome of `StoragePort.initialize()`.
 *
 * `settled` is false only for the brief window between mount and the
 * initialize promise resolving. `error` is non-null when initialization threw —
 * in which case the local tables may not exist and every cached read will
 * throw, so a consumer that can degrade gracefully should.
 */
export type StorageStatus = {
  /** True once `initialize()` has resolved or rejected. */
  settled: boolean;
  /** Non-null when `initialize()` rejected. */
  error: Error | null;
};

/**
 * Defaults to already-settled so every existing test harness and any provider
 * that doesn't manage storage lifecycle keeps rendering synchronously. Only
 * `AppProviders` (which owns the real `initialize()` call) overrides it.
 */
const StorageStatusContext = createContext<StorageStatus>({
  settled: true,
  error: null,
});

/**
 * Access the adapter instances (API, storage, health, etc.).
 * Must be used within an AdapterProvider.
 */
export function useAdapters(): Adapters {
  const ctx = useContext(AdapterContext);
  if (!ctx) {
    throw new Error("useAdapters must be used within an AdapterProvider");
  }
  return ctx;
}

/**
 * Observe local-database readiness.
 *
 * Exists because `initialize()` was previously fire-and-forget with a bare
 * `.catch(console.error)`: nothing knew whether the cache was usable, nothing
 * re-rendered when it became usable, and a hard failure was silent. Screens
 * generally do NOT need this — `AdapterProvider` already withholds its children
 * until storage settles — but a surface that wants to explain a degraded cache
 * to the user can read `error` here.
 */
export function useStorageStatus(): StorageStatus {
  return useContext(StorageStatusContext);
}

/**
 * Provides adapter instances to the component tree.
 * Wrap your app root (or test harness) with this.
 *
 * When `storageStatus` is supplied and not yet settled, children are withheld.
 * That is the ordering guarantee the offline layer relied on implicitly and
 * never stated: every cached read is a synchronous `getAllSync`, so a read that
 * runs before `initialize()` has created the tables throws `no such table` out
 * of a render-phase `useMemo` and takes the whole app to the root
 * ErrorBoundary. It happened not to fire because `initialize()`'s body contains
 * no `await`s while session restore does — i.e. it held by coincidence, and one
 * added `await` would have broken it. This makes it structural.
 */
export function AdapterProvider({
  children,
  adapters,
  storageStatus,
}: {
  children: ReactNode;
  adapters: Adapters;
  storageStatus?: StorageStatus;
}) {
  const status = storageStatus ?? { settled: true, error: null };
  return (
    <AdapterContext.Provider value={adapters}>
      <StorageStatusContext.Provider value={status}>
        {/* `null`, not a spinner: on a cold start the native splash screen is
            still up, and initialize() settles within a tick. A spinner here
            would flash. */}
        {status.settled ? children : null}
      </StorageStatusContext.Provider>
    </AdapterContext.Provider>
  );
}
