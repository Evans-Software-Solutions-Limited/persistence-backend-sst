import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * Restore-account mutation (Cluster 2b — account-deletion soft-delete).
 *
 * Wraps `POST /account/restore`, cancelling a pending soft-deletion for the
 * authenticated caller. A 409 (`err.status === 409`) means the account
 * wasn't actually soft-deleted — `RestoreAccountContainer` treats that as
 * "nothing to restore" rather than a hard failure.
 *
 * Invalidates the same legacy-parity profile cache keys the other
 * account-mutation hooks touch (`useCancelSubscription`,
 * `useCreateSubscription`, `useRestorePurchases`) for consistency. Those
 * keys aren't consumed by `useProfilePage` (which is cache-first over
 * StoragePort, not TanStack Query) — the container additionally calls
 * `useProfilePage().refresh()` directly so the `AuthGate` soft-delete gate
 * re-evaluates with the cleared `deletedAt`.
 */
export function useRestoreAccount() {
  const { api } = useAdapters();
  const queryClient = useQueryClient();

  return useMutation<{ restored: true }, ApiError, void>({
    mutationFn: async () => {
      const result = await api.restoreAccount();
      if (!result.ok) throw result.error;
      return result.value;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      queryClient.invalidateQueries({ queryKey: ["profile-data"] });
    },
  });
}
