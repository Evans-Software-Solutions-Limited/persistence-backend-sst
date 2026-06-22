import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiError, Result } from "@/shared/errors";
import type { InviteApiError } from "@/domain/ports/api.port";
import type {
  InviteClientRequest,
  InviteClientResult,
  TrainerInvitation,
} from "@/domain/models/trainerInvitation";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Pending-invitation list (10-trainer-features). Online read from
 * `GET /trainers/me/invitations`; no SQLite cache (the Coach You slice only
 * needs it to refetch after an invite send + drive the AddClient flow). Fetches
 * once on mount per signed-in user; `refresh()` refetches on demand.
 */
export function useGetInvitations(): {
  data: TrainerInvitation[];
  isLoading: boolean;
  error: ApiError | null;
  refresh: () => Promise<void>;
} {
  const { api } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const [data, setData] = useState<TrainerInvitation[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const latestUserRef = useRef<string | null>(userId);
  useEffect(() => {
    latestUserRef.current = userId;
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    setError(null);
    const result = await api.getInvitations();
    // Guard a session flip mid-flight.
    if (latestUserRef.current !== userId) return;
    if (result.ok) {
      setData(result.value);
    } else {
      setError(result.error);
    }
    setIsLoading(false);
  }, [api, userId]);

  const fetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!userId) {
      fetchedFor.current = null;
      setData([]);
      return;
    }
    if (fetchedFor.current === userId) return;
    fetchedFor.current = userId;
    void refresh();
  }, [userId, refresh]);

  return { data, isLoading, error, refresh };
}

/**
 * Invite-client mutation (10-trainer-features). Online POST to
 * `/trainers/me/invitations`. On a domain failure the returned
 * `InviteApiError` carries `inviteCode` (self_invite | no_slots | exists) so
 * the sheet can map to the legacy copy. Mirrors `useUseFreezeToken`.
 */
export function useInviteClient(): {
  mutate: (
    req: InviteClientRequest,
  ) => Promise<Result<InviteClientResult, InviteApiError>>;
  isPending: boolean;
} {
  const { api } = useAdapters();
  const [isPending, setIsPending] = useState(false);

  const mutate = useCallback(
    async (req: InviteClientRequest) => {
      setIsPending(true);
      try {
        return await api.inviteClient(req);
      } finally {
        setIsPending(false);
      }
    },
    [api],
  );

  return { mutate, isPending };
}

/**
 * Cancel-invitation mutation (10-trainer-features). Online DELETE to
 * `/trainers/me/invitations/:id`.
 */
export function useCancelInvitation(): {
  mutate: (id: string) => Promise<Result<{ success: true }, ApiError>>;
  isPending: boolean;
} {
  const { api } = useAdapters();
  const [isPending, setIsPending] = useState(false);

  const mutate = useCallback(
    async (id: string) => {
      setIsPending(true);
      try {
        return await api.cancelInvitation(id);
      } finally {
        setIsPending(false);
      }
    },
    [api],
  );

  return { mutate, isPending };
}
