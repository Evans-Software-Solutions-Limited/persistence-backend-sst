import { useCallback, useSyncExternalStore } from "react";
import {
  isBootstrapPending,
  subscribeBootstrapGate,
} from "@/application/bootstrap/gate";

/** True once no cold-start bootstrap is pending for `userId` (or no user). */
export function useBootstrapSettled(userId: string | null): boolean {
  const getSnapshot = useCallback(() => !isBootstrapPending(userId), [userId]);
  return useSyncExternalStore(subscribeBootstrapGate, getSnapshot, getSnapshot);
}
