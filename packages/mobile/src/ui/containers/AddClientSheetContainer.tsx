import { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { useAddClientSheet } from "@/state/add-client-sheet";
import {
  useInviteClient,
  useGetInvitations,
} from "@/ui/hooks/useTrainerInvitations";
import { AddClientSheetPresenter } from "@/ui/presenters/AddClientSheetPresenter";

/**
 * <AddClientSheetContainer> — invite-client flow controller (10-trainer-
 * features). Ports the legacy `InviteClientModal` container behaviour 1:1
 * (validation regex + copy + error mapping). Root-mounted in
 * app/(app)/_layout.tsx; driven by `useAddClientSheet().open`.
 *
 * On success it refetches the pending-invitation list AND invokes the opener's
 * registered `onInvited` (CoachYouContainer refreshes the overview), then
 * closes the sheet. Domain failures are mapped from the backend's invite
 * `code` (self_invite | no_slots | exists) to the legacy copy.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a raw email input (mirrors the legacy InviteClientModal). Returns
 * the error copy, or null when valid. Exported pure for unit testing — the
 * Send button is also disabled on empty input, so the empty branch is otherwise
 * unreachable via the UI.
 */
export function validateInviteEmail(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return "Email is required";
  if (!EMAIL_REGEX.test(trimmed)) return "Please enter a valid email address";
  return null;
}

export function AddClientSheetContainer() {
  const open = useAddClientSheet((s) => s.open);
  const onInvited = useAddClientSheet((s) => s.onInvited);
  const closeSheet = useAddClientSheet((s) => s.closeSheet);

  const invite = useInviteClient();
  const invitations = useGetInvitations();

  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [emailError, setEmailError] = useState("");

  // Reset the form whenever the sheet closes (mirrors the legacy effect).
  useEffect(() => {
    if (!open) {
      setEmail("");
      setReason("");
      setEmailError("");
    }
  }, [open]);

  const refreshInvitations = invitations.refresh;
  const handleInvite = useCallback(async () => {
    setEmailError("");

    const trimmed = email.trim();
    const validationError = validateInviteEmail(email);
    if (validationError !== null) {
      setEmailError(validationError);
      return;
    }

    const result = await invite.mutate({
      clientEmail: trimmed,
      relationshipReason: reason.trim() === "" ? undefined : reason.trim(),
    });

    if (result.ok) {
      const data = result.value;
      const onOk = () => {
        void refreshInvitations();
        onInvited?.();
        closeSheet();
      };
      if (data.action === "relationship_created") {
        Alert.alert(
          "Invitation Sent",
          data.clientName
            ? `Training request sent to ${data.clientName}`
            : `Training request sent to ${data.clientEmail ?? trimmed}`,
          [{ text: "OK", onPress: onOk }],
        );
      } else {
        Alert.alert(
          "Invitation Created",
          `Invitation will be sent when ${data.clientEmail ?? trimmed} signs up`,
          [{ text: "OK", onPress: onOk }],
        );
      }
      return;
    }

    // Client-slot cap backstop: the backend now returns 402 EntitlementError
    // when the trainer is at their committed-seat cap (the Clients screen
    // pre-empts this by disabling the invite, but the sheet is also reachable
    // from Coach You, and the cap can be hit between mount and send).
    if (result.error.code === "entitlement_denied") {
      Alert.alert(
        "No client seats available",
        "Remove a client or change your subscription to invite more.",
      );
      return;
    }

    // Domain failure — map the backend invite code to the legacy copy.
    switch (result.error.inviteCode) {
      case "exists":
        setEmailError("A relationship with this client already exists");
        break;
      case "no_slots":
        Alert.alert(
          "No Available Slots",
          "You have reached your client limit. Please upgrade your subscription.",
        );
        break;
      case "self_invite":
        setEmailError("You cannot invite yourself");
        break;
      default:
        Alert.alert(
          "Error",
          result.error.message ||
            "Failed to send invitation. Please try again.",
        );
    }
  }, [email, reason, invite, refreshInvitations, onInvited, closeSheet]);

  return (
    <AddClientSheetPresenter
      visible={open}
      email={email}
      reason={reason}
      emailError={emailError}
      isLoading={invite.isPending}
      onEmailChange={setEmail}
      onReasonChange={setReason}
      onInvite={handleInvite}
      onClose={closeSheet}
    />
  );
}
