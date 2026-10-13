/**
 * The bootstrap gate.
 *
 * Home's hooks mount in the same commit as the app layout, so without a gate
 * their mount-time fetches race the single bootstrap request. A hook that
 * auto-fetches on mount awaits `bootstrapSettled(userId)` first and then
 * re-checks staleness. When no bootstrap is pending for that user the
 * promise is already resolved, so every other path behaves as before.
 */
const pending = new Map<
  string,
  { promise: Promise<void>; settle: () => void }
>();
const listeners = new Set<() => void>();
/**
 * Set from the app shell's very first render, before any auth instance has
 * resolved, so hooks that fetch without a user (the tier catalog) wait too.
 * Cleared when auth resolves signed out or when the user's bootstrap settles.
 */
let coldStart: { promise: Promise<void>; end: () => void } | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

/** Marks a bootstrap as pending for `userId`. Idempotent; returns `settle`. */
export function beginBootstrap(userId: string): () => void {
  const existing = pending.get(userId);
  if (existing) return existing.settle;
  let settle!: () => void;
  const promise = new Promise<void>((resolve) => {
    settle = () => {
      if (pending.get(userId)?.settle === settle) pending.delete(userId);
      resolve();
      notify();
    };
  });
  pending.set(userId, { promise, settle });
  notify();
  return settle;
}

/** Marks the process as cold-starting until auth is known. Idempotent. */
export function beginColdStart(): void {
  if (coldStart) return;
  let end!: () => void;
  const promise = new Promise<void>((resolve) => {
    end = () => {
      if (coldStart?.end === end) coldStart = null;
      resolve();
      notify();
    };
  });
  coldStart = { promise, end };
  notify();
}

export function endColdStart(): void {
  coldStart?.end();
}

export function isBootstrapPending(userId: string | null): boolean {
  return coldStart !== null || (userId !== null && pending.has(userId));
}

/** Upper bound on how long a mount-time fetch waits for the bootstrap. */
export const BOOTSTRAP_WAIT_MS = 10_000;

/**
 * Resolves when the pending bootstrap for `userId` settles, at once when none
 * is pending, and after `BOOTSTRAP_WAIT_MS` at the latest so a stalled run
 * can never hold a screen's own fetch hostage.
 */
export function bootstrapSettled(userId: string | null): Promise<void> {
  const waits: Promise<void>[] = [];
  if (coldStart) waits.push(coldStart.promise);
  const entry = userId === null ? undefined : pending.get(userId);
  if (entry) waits.push(entry.promise);
  if (waits.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, BOOTSTRAP_WAIT_MS);
    void Promise.all(waits).then(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function subscribeBootstrapGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
