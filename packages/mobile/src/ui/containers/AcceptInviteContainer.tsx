import { useCallback, useEffect, useState } from "react";
import { Alert, Linking } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAcceptInviteCode } from "@/ui/hooks/useTrainerInviteCodes";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useMyCoaches } from "@/ui/hooks/useMyCoaches";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { usePendingInvite } from "@/state/pending-invite";
import { CONSENT_VERSION, PRIVACY_POLICY_URL } from "@/domain/models/consent";
import {
  firstName,
  readyLine,
  type InvitePreview,
} from "@/domain/models/myCoaching";
import type { AcceptInviteCodeApiError } from "@/domain/models/trainerInviteCode";
import { AcceptInvitePresenter } from "@/ui/presenters/AcceptInvitePresenter";
import { InvitePreviewPresenter } from "@/ui/presenters/InvitePreviewPresenter";
import { coachInitials } from "@/ui/presenters/coaching/coachingKit";

/**
 * <AcceptInviteContainer> — the athlete's invite flow (PER-126, APP-A3):
 *
 *   enter code → preview (C11j: who, what's ready, what they'll see,
 *   one consent tick) → accept.
 *
 * Reached from You → "Have a coach's code?" or a
 * `persistencemobile://accept-invite?code=…` deep link (`?code=` pre-fills).
 *
 * Looking a code up and accepting it both need a connection; offline the
 * screens say so and the buttons are disabled. With a personal code the
 * relationship is active straight away (`relationshipStatus: "active"`), so
 * the athlete is told "You're connected with <coach>" and lands on the Coach
 * tab (C11k). A general code still creates a request the coach accepts.
 *
 * 28-coach-data-sharing-consent: accepting is the explicit-consent moment.
 * The C11j tick is never pre-ticked and resets for every preview.
 */
export function AcceptInviteContainer() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const accept = useAcceptInviteCode();
  const online = useOnlineStatus();
  // Only refreshed by hand after a personal accept, so the Coach tab is there
  // when we land on it; no fetch on mount.
  const myCoaches = useMyCoaches({ enabled: false });

  const [code, setCode] = useState(() => (params.code ?? "").toUpperCase());
  const [errorMessage, setErrorMessage] = useState("");
  const [isLooking, setIsLooking] = useState(false);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [acceptError, setAcceptError] = useState("");
  const [expired, setExpired] = useState(false);

  // We've arrived on the redeem screen (the code, if any, is now in the URL) —
  // clear the auth-flow stash so it can't resurface on a later sign-in.
  useEffect(() => {
    usePendingInvite.getState().clearPendingCode();
  }, []);

  const onBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/you");
  }, [router]);

  const handleSubmit = useCallback(async () => {
    const trimmed = code.trim();
    if (trimmed === "" || !online) return;
    setErrorMessage("");
    setIsLooking(true);
    const result = await api.getInvitePreview(trimmed);
    setIsLooking(false);
    if (result.ok) {
      setPreview(result.value);
      setAgreed(false);
      setAcceptError("");
      setExpired(false);
      return;
    }
    setErrorMessage(previewErrorCopy(result.error));
  }, [api, code, online]);

  const onCancelPreview = useCallback(() => {
    setPreview(null);
    onBack();
  }, [onBack]);

  const onToggleAgree = useCallback(() => setAgreed((v) => !v), []);

  const onOpenPrivacyPolicy = useCallback(() => {
    // Best-effort: a Linking failure must not block the consent flow.
    Linking.openURL(PRIVACY_POLICY_URL).catch(() => {});
  }, []);

  const handleAccept = useCallback(async () => {
    if (!preview || !agreed || !online) return;
    if (isPastExpiry(preview)) {
      setExpired(true);
      return;
    }
    setAcceptError("");
    const result = await accept.mutate(code.trim(), true, CONSENT_VERSION);

    if (result.ok) {
      const data = result.value;
      if (data.relationshipStatus === "active") {
        // Personal code: connected now. Load the coach before landing on the
        // Coach tab, which only shows while someone coaches you.
        await myCoaches.refresh({ silent: true });
        // The Coach tab exists only once the coach is cached (every
        // `useMyCoaches` re-reads synchronously on write). If that read
        // failed, land on You rather than be bounced Home by the tab guard.
        const userId = session?.userId;
        const cached = userId ? storage.getCachedMyCoaches(userId) : null;
        const hasCoach =
          cached?.coaches.some(
            (c) => c.relationshipId === data.relationshipId,
          ) ?? false;
        router.replace(hasCoach ? "/(app)/(tabs)/coach" : "/(app)/(tabs)/you");
        Alert.alert(`You're connected with ${data.trainerName}`);
        return;
      }
      // General code (or a backend without `relationshipStatus`): the coach
      // still has to accept.
      Alert.alert(
        "Request sent",
        `Request sent to ${data.trainerName} — awaiting their acceptance.`,
        [{ text: "OK", onPress: onBack }],
      );
      return;
    }

    if (result.error.acceptCode === "invalid_code" && isPastExpiry(preview)) {
      setExpired(true);
      return;
    }
    setAcceptError(
      acceptErrorCopy(result.error, firstName(preview.coach.name)),
    );
  }, [
    preview,
    agreed,
    online,
    accept,
    code,
    myCoaches,
    router,
    onBack,
    session,
    storage,
  ]);

  if (preview) {
    const name = preview.coach.name;
    return (
      <InvitePreviewPresenter
        coachName={name}
        coachFirstName={firstName(name)}
        initials={coachInitials(name) || "?"}
        readyLine={readyLine(preview.ready)}
        agreed={agreed}
        isSubmitting={accept.isPending}
        isOffline={!online}
        isExpired={expired}
        errorMessage={acceptError}
        onToggleAgree={onToggleAgree}
        onAccept={() => void handleAccept()}
        onCancel={onCancelPreview}
        onOpenPrivacyPolicy={onOpenPrivacyPolicy}
      />
    );
  }

  return (
    <AcceptInvitePresenter
      code={code}
      onCodeChange={setCode}
      isSubmitting={isLooking}
      errorMessage={errorMessage}
      onSubmit={() => void handleSubmit()}
      onBack={onBack}
      isOffline={!online}
    />
  );
}

function isPastExpiry(p: InvitePreview): boolean {
  return new Date(p.expiresAt).getTime() <= Date.now();
}

const OFFLINE_LOOKUP = "You're offline. Entering a code needs a connection.";
const OFFLINE_ACCEPT = "You're offline. Accepting needs a connection.";
const RATE_LIMITED = "Too many tries. Wait a while, then try again.";

function isConnectionError(e: AcceptInviteCodeApiError): boolean {
  return e.code === "network" || e.code === "timeout";
}

/** Inline copy for a failed code lookup. */
export function previewErrorCopy(e: AcceptInviteCodeApiError): string {
  if (isConnectionError(e)) return OFFLINE_LOOKUP;
  switch (e.acceptCode) {
    case "invalid_code":
      return "Invalid or expired code. Ask your coach for a new one.";
    case "rate_limited":
      return RATE_LIMITED;
    default:
      return e.message || "Couldn't check the code. Please try again.";
  }
}

/** Inline copy for a failed accept, on the C11j screen. */
export function acceptErrorCopy(
  e: AcceptInviteCodeApiError,
  coachFirstName: string,
): string {
  if (isConnectionError(e)) return OFFLINE_ACCEPT;
  switch (e.acceptCode) {
    case "invalid_code":
      return `This code no longer works. Ask ${coachFirstName} for a new one.`;
    case "coach_client_limit_reached":
      return "This coach's client list is full.";
    case "exists":
      return "You're already connected to this coach.";
    case "code_already_used":
      return "This code has already been used.";
    case "self_invite":
      return "You can't use your own code.";
    case "rate_limited":
      return RATE_LIMITED;
    case "consent_required":
      // Unreachable from this screen (Accept needs the tick), typed defensively.
      return "Please confirm you agree to share your data.";
    default:
      return e.message || "Couldn't accept the invite. Please try again.";
  }
}
