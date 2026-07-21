import { useCallback, useState } from "react";
import type { ApiError, Result } from "@/shared/errors";
import type {
  AcceptInviteCodeApiError,
  AcceptInviteCodeResult,
  TrainerInviteCode,
} from "@/domain/models/trainerInviteCode";
import type {
  RelationshipResponseAction,
  RespondToClientRequestResult,
} from "@/domain/models/clientRelationship";
import { useAdapters } from "./useAdapters";

/**
 * Trainer invite-code / QR mutations (Coach Mode Phase 8 — 10-trainer-
 * features). Mirrors `useInviteClient`'s `mutate`/`isPending` shape —
 * these are the reusable-code counterparts of the per-email invite flow
 * in `useTrainerInvitations.ts`.
 */

/**
 * Mint (or re-fetch a still-live) invite code for the current trainer
 * (`POST /trainers/me/invite-codes`). On a 402 the returned `ApiError` has
 * `code === "entitlement_denied"` with the `entitlement` payload populated
 * (the trainer is at their client-seat cap) — callers reuse the same
 * handling as `AddClientSheetContainer`'s `inviteClient` 402 branch.
 */
export function useCreateInviteCode(): {
  mutate: () => Promise<Result<TrainerInviteCode, ApiError>>;
  isPending: boolean;
} {
  const { api } = useAdapters();
  const [isPending, setIsPending] = useState(false);

  const mutate = useCallback(async () => {
    setIsPending(true);
    try {
      return await api.createTrainerInviteCode();
    } finally {
      setIsPending(false);
    }
  }, [api]);

  return { mutate, isPending };
}

/**
 * Redeem a trainer's invite code as the current (client) user
 * (`POST /trainers/accept-invite-code`). On a domain failure the returned
 * `AcceptInviteCodeApiError` carries `acceptCode` (invalid_code |
 * self_invite | exists | code_already_used | coach_client_limit_reached |
 * consent_required) so the redeem screen can map it to copy without
 * string-matching.
 *
 * 26-coach-data-sharing-consent: `consent`/`consentVersion` are REQUIRED —
 * the caller (`AcceptInviteContainer`) must route through
 * `<DataSharingConsentSheet>`'s affirmative checkbox before calling
 * `mutate`.
 */
export function useAcceptInviteCode(): {
  mutate: (
    code: string,
    consent: boolean,
    consentVersion: string,
  ) => Promise<Result<AcceptInviteCodeResult, AcceptInviteCodeApiError>>;
  isPending: boolean;
} {
  const { api } = useAdapters();
  const [isPending, setIsPending] = useState(false);

  const mutate = useCallback(
    async (code: string, consent: boolean, consentVersion: string) => {
      setIsPending(true);
      try {
        return await api.acceptTrainerInviteCode(code, consent, consentVersion);
      } finally {
        setIsPending(false);
      }
    },
    [api],
  );

  return { mutate, isPending };
}

/**
 * The TRAINER's side of the Phase 8 handshake — accept or decline a client
 * who joined via invite code
 * (`POST /trainers/me/relationships/:relationshipId/respond`). Accepting
 * can 402 `entitlement_denied` when the trainer is at their client-seat cap.
 *
 * NOTE: this codebase has no react-query / shared cache to invalidate by
 * key — `useGetTrainerClients` is a standalone `useCachedResource` instance
 * per mount, not a keyed query cache. So there's nothing for this hook to
 * invalidate directly. On a successful accept the roster has changed (a
 * pending client became active), so the caller should hold its own
 * `useGetTrainerClients()` instance and call `.refresh()` after a
 * successful `mutate()` — the same pattern `AddClientSheetContainer` uses
 * for `refreshInvitations()` after a successful `inviteClient`.
 */
export function useRespondToClientRequest(): {
  mutate: (
    relationshipId: string,
    action: RelationshipResponseAction,
  ) => Promise<Result<RespondToClientRequestResult, ApiError>>;
  isPending: boolean;
} {
  const { api } = useAdapters();
  const [isPending, setIsPending] = useState(false);

  const mutate = useCallback(
    async (relationshipId: string, action: RelationshipResponseAction) => {
      setIsPending(true);
      try {
        return await api.respondToClientRelationship(relationshipId, action);
      } finally {
        setIsPending(false);
      }
    },
    [api],
  );

  return { mutate, isPending };
}
