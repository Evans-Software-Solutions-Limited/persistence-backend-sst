import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  FoundingClaimChallenge,
  FoundingClaimResult,
} from "@/domain/models/foundingClaim";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "@/ui/hooks/useAdapters";

export function useFoundingClaim() {
  const { api } = useAdapters();
  const queryClient = useQueryClient();
  const request = useMutation<FoundingClaimChallenge, ApiError, string>({
    mutationFn: async (email) => {
      const result = await api.requestFoundingClaim(email.trim().toLowerCase());
      if (!result.ok) throw result.error;
      return result.value;
    },
  });
  const verify = useMutation<
    FoundingClaimResult,
    ApiError,
    { challengeId: string; code: string }
  >({
    mutationFn: async (input) => {
      const result = await api.verifyFoundingClaim(input);
      if (!result.ok) throw result.error;
      return result.value;
    },
    onSuccess: async () => {
      await Promise.all(
        ["user-subscription", "user-profile", "profile-data"].map((key) =>
          queryClient.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });
  return { request, verify };
}
