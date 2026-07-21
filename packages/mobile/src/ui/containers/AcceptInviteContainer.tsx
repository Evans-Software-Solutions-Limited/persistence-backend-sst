import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAcceptInviteCode } from "@/ui/hooks/useTrainerInviteCodes";
import { usePendingInvite } from "@/state/pending-invite";
import { CONSENT_VERSION } from "@/domain/models/consent";
import { AcceptInvitePresenter } from "@/ui/presenters/AcceptInvitePresenter";

/**
 * <AcceptInviteContainer> — the athlete's invite-code redeem flow controller
 * (Coach Mode Phase 8 — invite/QR, 10-trainer-features). Reached from the
 * You screen's always-available "Have a coach's code?" entry, or from a
 * `persistencemobile://accept-invite?code=…` deep link (`?code=` pre-fills
 * the field via `useLocalSearchParams`).
 *
 * On success this creates a CLIENT-initiated pending relationship the COACH
 * must still accept — the athlete does NOT accept anything after redeeming.
 * We surface that with a one-shot confirmation alert, then navigate back to
 * You. Domain failures map the backend's `acceptCode` to inline copy
 * (NOT a paywall/upsell — `coach_client_limit_reached` is a plain client-
 * facing message, mirroring the backend's own framing).
 *
 * 26-coach-data-sharing-consent: redemption is the client's own action AND
 * the point their data starts flowing to the coach (once accepted) — so it's
 * the UK GDPR Art 9(2)(a) explicit-consent moment for this whole flow (the
 * later coach accept needs no consent of its own). Tapping "Join" no longer
 * redeems directly — it opens `<DataSharingConsentSheet>`; only confirming
 * the sheet's affirmative, never-pre-ticked checkbox actually calls
 * `accept.mutate`.
 */
export function AcceptInviteContainer() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const accept = useAcceptInviteCode();

  const [code, setCode] = useState(() => (params.code ?? "").toUpperCase());
  const [errorMessage, setErrorMessage] = useState("");
  const [consentVisible, setConsentVisible] = useState(false);

  // We've arrived on the redeem screen (the code, if any, is now in the URL) —
  // clear the auth-flow stash so it can't resurface on a later sign-in
  // (device-QA #2 follow-up; the stash is the carry-through-signup mechanism).
  useEffect(() => {
    usePendingInvite.getState().clearPendingCode();
  }, []);

  const onBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/you");
  }, [router]);

  // "Join" opens the consent sheet — it does NOT redeem the code itself.
  const handleSubmit = useCallback(() => {
    setErrorMessage("");
    if (code.trim() === "") return;
    setConsentVisible(true);
  }, [code]);

  const onConsentClose = useCallback(() => {
    setConsentVisible(false);
  }, []);

  const handleConsentConfirm = useCallback(async () => {
    const trimmed = code.trim();
    if (trimmed === "") return;

    const result = await accept.mutate(trimmed, true, CONSENT_VERSION);
    setConsentVisible(false);

    if (result.ok) {
      const data = result.value;
      Alert.alert(
        "Request sent",
        `Request sent to ${data.trainerName} — awaiting their acceptance.`,
        [{ text: "OK", onPress: onBack }],
      );
      return;
    }

    // Map the backend's domain code to inline copy — every one of these is a
    // plain client-facing message, NOT a paywall/upsell (coordinator brief
    // is explicit that `coach_client_limit_reached` stays inline here, unlike
    // the coach-side 402 entitlement path elsewhere).
    switch (result.error.acceptCode) {
      case "invalid_code":
        setErrorMessage(
          "Invalid or expired code. Ask your coach for a new one.",
        );
        break;
      case "self_invite":
        setErrorMessage("You can't use your own code.");
        break;
      case "exists":
        setErrorMessage("You're already connected to this coach.");
        break;
      case "code_already_used":
        setErrorMessage("This code has already been used.");
        break;
      case "coach_client_limit_reached":
        setErrorMessage("This coach's client list is full.");
        break;
      case "consent_required":
        // Should be unreachable — the sheet only confirms with consent:true —
        // but typed defensively for a client/backend version mismatch.
        setErrorMessage("Please confirm you agree to share your data.");
        break;
      default:
        setErrorMessage(
          result.error.message ||
            "Failed to redeem the code. Please try again.",
        );
    }
  }, [code, accept, onBack]);

  return (
    <AcceptInvitePresenter
      code={code}
      onCodeChange={setCode}
      isSubmitting={accept.isPending}
      errorMessage={errorMessage}
      onSubmit={handleSubmit}
      onBack={onBack}
      consentVisible={consentVisible}
      onConsentClose={onConsentClose}
      onConsentConfirm={handleConsentConfirm}
    />
  );
}
