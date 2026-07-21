import { useCallback, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { useClientRelationships } from "@/ui/hooks/useClientRelationships";
import { CONSENT_VERSION } from "@/domain/models/consent";
import { RequestsPresenter } from "@/ui/presenters/RequestsPresenter";

/**
 * <RequestsContainer> — wires `useClientRelationships("pending")` into
 * <RequestsPresenter>. Accept/decline call through to
 * POST /clients/me/relationships/:id/respond; the hook removes the row on
 * success. Reached via the notification deeplink → /(app)/requests.
 *
 * Coach Mode Phase 8 (invite/QR): a `pending` row can now be CLIENT-
 * initiated (the athlete redeemed a coach's invite code — the COACH accepts,
 * not the athlete). The backend already 404s a client-side accept on those
 * rows, but this screen filters them out client-side too so they never show
 * as "acceptable" here — only TRAINER-initiated pendings (email invite /
 * unredeemed code) are the athlete's to review.
 *
 * 26-coach-data-sharing-consent: accepting is the client's UK GDPR Art 9(2)(a)
 * explicit-consent moment. Tapping "Accept" no longer calls `respond`
 * directly — it opens `<DataSharingConsentSheet>` (via `consentTarget`); only
 * confirming the sheet's affirmative, never-pre-ticked checkbox calls
 * `respond(id, "accept", true, CONSENT_VERSION)`. Dismissing the sheet
 * without ticking leaves the request untouched (still pending).
 */
export function RequestsContainer() {
  const router = useRouter();
  const { data, isLoading, isRefreshing, error, refresh, respond, pendingIds } =
    useClientRelationships("pending");
  // Only TRAINER-initiated pendings are the athlete's to accept. Match on
  // `!== "client"` (not `=== "trainer"`) so a payload MISSING `initiatedBy`
  // (e.g. a backend that hasn't shipped the field yet) still shows the request
  // as acceptable — the pre-Phase-8 behaviour — rather than silently dropping
  // every pending request (Inspector Brad — deploy-ordering safety).
  const requests = useMemo(
    () => data.filter((r) => r.initiatedBy !== "client"),
    [data],
  );

  // The relationshipId awaiting the client's consent confirmation — non-null
  // is the sheet's `visible` signal. `isConfirming` drives the sheet's
  // confirm-button busy state independently of `pendingIds` (which the hook
  // only populates once the actual `respond` call starts).
  const [consentTarget, setConsentTarget] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const onBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/you");
  }, [router]);

  const onAccept = useCallback((id: string) => {
    setConsentTarget(id);
  }, []);
  const onDecline = useCallback(
    (id: string) => {
      void respond(id, "decline");
    },
    [respond],
  );

  const onConsentClose = useCallback(() => {
    setConsentTarget(null);
  }, []);
  const onConsentConfirm = useCallback(async () => {
    if (consentTarget === null) return;
    setIsConfirming(true);
    try {
      await respond(consentTarget, "accept", true, CONSENT_VERSION);
    } finally {
      setIsConfirming(false);
      setConsentTarget(null);
    }
  }, [consentTarget, respond]);

  return (
    <RequestsPresenter
      requests={requests}
      pendingIds={pendingIds}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      error={error}
      onRefresh={refresh}
      onBack={onBack}
      onAccept={onAccept}
      onDecline={onDecline}
      consentVisible={consentTarget !== null}
      onConsentClose={onConsentClose}
      onConsentConfirm={onConsentConfirm}
      isConsentSubmitting={isConfirming}
    />
  );
}
