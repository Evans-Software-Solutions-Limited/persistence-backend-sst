import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateSubscriptionInput } from "@/domain/ports/api.port";
import type { CreateSubscriptionResult } from "@/domain/models/subscription";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * Create a Stripe subscription via `ApiPort.createSubscription` (wraps
 * `POST /subscriptions`). Mirrors the M10 dispatch precedence on the
 * backend — new / reinstate / upgrade / downgrade / cycle-change.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Subscription state
 *       (mobile) > Hooks
 * Satisfies: requirements.md AC 2.3, 2.4, 3.3, 3.4, 3.6, 3.9, 5.6
 *
 * On success the hook invalidates three query keys per design.md:
 *   - `['user-subscription']` (prefix match — any signed-in user)
 *   - `['user-profile']` (legacy parity for downstream consumers)
 *   - `['profile-data']` (legacy parity)
 *
 * Containers consume the mutation via `mutate()` / `mutateAsync()`.
 * Async callers should `await` the returned promise and check
 * `result.requiresAction` to decide the next step.
 *
 * ⚠ CURRENTLY UNWIRED — no container calls this. Its only consumer was the
 * Stripe Apple Pay card rail on `SubscriptionSelectionContainer`, removed in
 * full under App Review Guideline 2.1 (the Stripe SDK linked PassKit into the
 * binary while the flow was unreachable on iOS). iOS purchases go through
 * RevenueCat / Apple IAP (`usePurchasePackage`).
 *
 * Deliberately kept rather than deleted: `POST /subscriptions` still exists and
 * still works server-side, and this is its typed client. It is the natural
 * re-entry point when a non-Apple rail returns (Android via Play billing, or
 * web). Do NOT re-wire it into an iOS surface — that would be a §3.1.1
 * violation. Any 3DS handling it once drove is gone with the SDK; a future rail
 * must supply its own confirmation step.
 */
export function useCreateSubscription() {
  const { api } = useAdapters();
  const queryClient = useQueryClient();

  return useMutation<
    CreateSubscriptionResult,
    ApiError,
    CreateSubscriptionInput
  >({
    mutationFn: async (input) => {
      const result = await api.createSubscription(input);
      if (!result.ok) throw result.error;
      return result.value;
    },
    onSuccess: () => {
      // Prefix invalidation hits every user-keyed sub query. The other
      // two keys are legacy-parity invalidations — any future hook that
      // reads `['user-profile']` or `['profile-data']` from Tanstack
      // will see fresh data after a subscription change too.
      queryClient.invalidateQueries({ queryKey: ["user-subscription"] });
      queryClient.invalidateQueries({ queryKey: ["user-profile"] });
      queryClient.invalidateQueries({ queryKey: ["profile-data"] });
    },
  });
}
