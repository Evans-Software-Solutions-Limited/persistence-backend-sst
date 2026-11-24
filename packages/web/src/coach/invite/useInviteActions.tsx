import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isCoachApiError, newIdempotencyKey } from "../api/coachApi";
import type { IssuedInvite } from "../api/types";
import {
  COACH_NETWORK_MODE,
  coachKeys,
  useCoachApi,
  useOnline,
} from "../hooks/coachQueries";
import {
  DECLARATION_VERSION,
  declarationTextHash,
  needsDeclaration,
} from "../lib/declaration";
import { DeclarationDialog } from "./DeclarationDialog";

/**
 * Issue, resend and cancel a personal invite (design A D3: online only), with
 * the coach declaration asked first when it isn't accepted (D6b). Shared by
 * the invite step (C11c), the invited client page (C11d) and the Clients
 * list's Resend (C11e).
 */

export const OFFLINE_INVITE =
  "You're offline. Sending an invite needs a connection.";

export function inviteErrorMessage(e: unknown): string {
  if (isCoachApiError(e)) {
    if (e.offline) return OFFLINE_INVITE;
    if (e.code === "profile_not_editable") {
      return "This client has already accepted or the invite was cancelled.";
    }
    return e.message;
  }
  return "Something went wrong. Try again.";
}

export function useInviteActions(
  onIssued?: (profileId: string, invite: IssuedInvite) => void,
) {
  const api = useCoachApi();
  const queryClient = useQueryClient();
  const online = useOnline();
  const keys = useRef(new Map<string, string>());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declarationFor, setDeclarationFor] = useState<string | null>(null);
  const [declarationBusy, setDeclarationBusy] = useState(false);
  const [declarationError, setDeclarationError] = useState<string | null>(null);

  const refresh = (profileId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: coachKeys.roster }),
      queryClient.invalidateQueries({
        queryKey: coachKeys.clientProfile(profileId),
      }),
    ]);

  async function send(profileId: string): Promise<IssuedInvite | null> {
    setBusyId(profileId);
    setError(null);
    try {
      // Reuse the key until a send succeeds, so a retry never makes two codes.
      const key = keys.current.get(profileId) ?? newIdempotencyKey();
      keys.current.set(profileId, key);
      const invite = await api.issueInvite(profileId, key);
      keys.current.delete(profileId);
      await refresh(profileId);
      onIssued?.(profileId, invite);
      return invite;
    } catch (e) {
      if (isCoachApiError(e) && e.code === "declaration_required") {
        setDeclarationFor(profileId);
      } else {
        setError(inviteErrorMessage(e));
      }
      return null;
    } finally {
      setBusyId(null);
    }
  }

  async function issue(profileId: string): Promise<IssuedInvite | null> {
    if (!online) {
      setError(OFFLINE_INVITE);
      return null;
    }
    try {
      const status = await queryClient.fetchQuery({
        queryKey: coachKeys.declaration,
        queryFn: () => api.declaration(),
        staleTime: 60_000,
        networkMode: COACH_NETWORK_MODE,
      });
      if (needsDeclaration(status)) {
        setDeclarationError(null);
        setDeclarationFor(profileId);
        return null;
      }
    } catch {
      // The invite route checks the declaration itself (403 → the dialog).
    }
    return send(profileId);
  }

  async function confirmDeclaration() {
    const profileId = declarationFor;
    if (!profileId) return;
    setDeclarationBusy(true);
    setDeclarationError(null);
    try {
      const status = await api.acceptDeclaration(
        DECLARATION_VERSION,
        await declarationTextHash(),
        newIdempotencyKey(),
      );
      queryClient.setQueryData(coachKeys.declaration, status);
      setDeclarationFor(null);
      await send(profileId);
    } catch (e) {
      setDeclarationError(
        isCoachApiError(e) && e.code === "declaration_version_mismatch"
          ? "The declaration has changed. Reload the page to read the new version."
          : inviteErrorMessage(e),
      );
    } finally {
      setDeclarationBusy(false);
    }
  }

  async function cancel(profileId: string): Promise<boolean> {
    if (!online) {
      setError("You're offline. Cancelling an invite needs a connection.");
      return false;
    }
    setBusyId(profileId);
    setError(null);
    try {
      await api.cancelInvite(profileId);
      await refresh(profileId);
      return true;
    } catch (e) {
      setError(inviteErrorMessage(e));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  const dialog = declarationFor ? (
    <DeclarationDialog
      busy={declarationBusy}
      error={declarationError}
      onConfirm={() => void confirmDeclaration()}
      onClose={() => setDeclarationFor(null)}
    />
  ) : null;

  return {
    issue,
    cancel,
    busyId,
    error,
    clearError: () => setError(null),
    dialog,
    online,
  };
}
