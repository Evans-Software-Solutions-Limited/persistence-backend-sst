import { useCallback, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AppliedReferral } from "@/domain/models/referral";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import {
  REFERRAL_QUERY_KEY_PREFIX,
  referralQueryKey,
} from "@/ui/hooks/useAppliedReferral";

export function useClaimReferral() {
  const { api } = useAdapters();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const activeController = useRef<AbortController | null>(null);

  const mutation = useMutation<AppliedReferral, ApiError, string>({
    mutationFn: async (code) => {
      const controller = new AbortController();
      activeController.current = controller;
      const result = await api.claimReferral(code, controller.signal);
      if (!result.ok) throw result.error;
      return result.value;
    },
    onSuccess: (applied) => {
      if (session?.userId) {
        queryClient.setQueryData(referralQueryKey(session.userId), applied);
      }
      void queryClient.invalidateQueries({
        queryKey: [REFERRAL_QUERY_KEY_PREFIX],
      });
    },
    onSettled: () => {
      activeController.current = null;
    },
  });

  const reset = mutation.reset;
  const cancel = useCallback(() => {
    activeController.current?.abort();
    activeController.current = null;
    reset();
  }, [reset]);

  return { ...mutation, cancel };
}
