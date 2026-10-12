/**
 * The bootstrap gate.
 *
 * Home's hooks mount in the same commit as the app layout, so without a gate
 * their mount-time fetches race the single bootstrap request. A hook that
 * auto-fetches on mount awaits `bootstrapSettled(userId)` first and then
 * re-checks staleness. When no bootstrap is pending for that user the
 * promise is already resolved, so every other path behaves as before.
 */
const pending = new Map<string, { promise: Promise<void>; settle: () => void }>();
const listeners = new Set<() => void>();

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

export function isBootstrapPending(userId: string | null): boolean {
  return userId !== null && pending.has(userId);
}

/** Resolves when the pending bootstrap for `userId` settles, or at once. */
export function bootstrapSettled(userId: string | null): Promise<void> {
  if (userId === null) return Promise.resolve();
  return pending.get(userId)?.promise ?? Promise.resolve();
}

export function subscribeBootstrapGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
