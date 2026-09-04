import { useQuery } from "@tanstack/react-query";
import type { AppliedReferral } from "@/domain/models/referral";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";

export const REFERRAL_QUERY_KEY_PREFIX = "referral" as const;

export function referralQueryKey(userId: string) {
  return [REFERRAL_QUERY_KEY_PREFIX, userId] as const;
}

export function useAppliedReferral() {
  const { api } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  return useQuery<AppliedReferral | null, ApiError>({
    queryKey: userId
      ? referralQueryKey(userId)
      : [REFERRAL_QUERY_KEY_PREFIX, "anonymous"],
    enabled: userId !== null,
    queryFn: async () => {
      const result = await api.getAppliedReferral();
      if (!result.ok) throw result.error;
      return result.value;
    },
  });
}
