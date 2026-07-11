import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Share } from "react-native";
import * as Clipboard from "expo-clipboard";
import { useAddClientSheet } from "@/state/add-client-sheet";
import {
  useInviteClient,
  useGetInvitations,
} from "@/ui/hooks/useTrainerInvitations";
import { useCreateInviteCode } from "@/ui/hooks/useTrainerInviteCodes";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import type { TrainerInviteCode } from "@/domain/models/trainerInviteCode";
import {
  AddClientSheetPresenter,
  buildAcceptInviteDeepLink,
  type AddClientSheetMode,
} from "@/ui/presenters/AddClientSheetPresenter";

/**
 * <AddClientSheetContainer> — coach "Add client" flow controller
 * (10-trainer-features + Coach Mode Phase 8 — invite/QR). Ports the legacy
 * `InviteClientModal` container behaviour 1:1 for the email path (validation
 * regex + copy + error mapping). Root-mounted in app/(app)/_layout.tsx;
 * driven by `useAddClientSheet().open`.
 *
 * By-email: on success it refetches the pending-invitation list AND invokes
 * the opener's registered `onInvited` (CoachYouContainer refreshes the
 * overview), then closes the sheet. Domain failures are mapped from the
 * backend's invite `code` (self_invite | no_slots | exists) to the legacy
 * copy.
 *
 * Share-code (Phase 8, net-new): mints a reusable invite code via
 * `useCreateInviteCode`, disabled while offline (`useOnlineStatus`). The 402
 * client-seat-cap denial reuses the EXACT alert copy as the email path's 402
 * branch below — same underlying cap, same user-facing message. Copy-to-
 * clipboard uses `expo-clipboard` (a native module — device verify needs a
 * fresh EAS dev build); Share goes through the RN core `Share` module.
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
  const createCode = useCreateInviteCode();
  const isOnline = useOnlineStatus();

  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [emailError, setEmailError] = useState("");
  const [mode, setMode] = useState<AddClientSheetMode>("email");
  const [inviteCode, setInviteCode] = useState<TrainerInviteCode | null>(null);
  const [justCopied, setJustCopied] = useState(false);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset the form whenever the sheet closes (mirrors the legacy effect) —
  // Phase 8 extends this to also reset the mode toggle + generated code so
  // re-opening the sheet always starts fresh on "By email".
  useEffect(() => {
    if (!open) {
      setEmail("");
      setReason("");
      setEmailError("");
      setMode("email");
      setInviteCode(null);
      setJustCopied(false);
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    }
  }, [open]);

  // Clear the "Copied" reset timer on unmount so it never fires against an
  // unmounted component.
  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

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

  const handleGenerateCode = useCallback(async () => {
    const result = await createCode.mutate();
    if (result.ok) {
      setInviteCode(result.value);
      return;
    }
    // Same client-slot cap backstop as the email path — one underlying cap,
    // one user-facing message.
    if (result.error.code === "entitlement_denied") {
      Alert.alert(
        "No client seats available",
        "Remove a client or change your subscription to invite more.",
      );
      return;
    }
    Alert.alert(
      "Error",
      result.error.message ||
        "Failed to generate an invite code. Please try again.",
    );
  }, [createCode]);

  const handleShareCode = useCallback(() => {
    if (!inviteCode) return;
    const link = buildAcceptInviteDeepLink(inviteCode.code);
    // Share.share rejects on a real share error (user-cancel resolves) — swallow
    // it so it never surfaces as an unhandled promise rejection.
    Share.share({
      message: `Join me on Persistence — use code ${inviteCode.code} or tap: ${link}`,
    }).catch(() => {});
  }, [inviteCode]);

  const handleCopyCode = useCallback(async () => {
    if (!inviteCode) return;
    await Clipboard.setStringAsync(inviteCode.code);
    setJustCopied(true);
    if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    // Brief "Copied" feedback, then reset — lightweight transient state
    // rather than a toast component (mirrors the design system's preference
    // for inline copy over a new primitive for a one-shot confirmation).
    copiedTimeoutRef.current = setTimeout(() => setJustCopied(false), 1800);
  }, [inviteCode]);

  return (
    <AddClientSheetPresenter
      visible={open}
      mode={mode}
      onModeChange={setMode}
      email={email}
      reason={reason}
      emailError={emailError}
      isLoading={invite.isPending}
      onEmailChange={setEmail}
      onReasonChange={setReason}
      onInvite={handleInvite}
      inviteCode={inviteCode}
      isGeneratingCode={createCode.isPending}
      isOnline={isOnline}
      onGenerateCode={handleGenerateCode}
      onShareCode={handleShareCode}
      onCopyCode={handleCopyCode}
      justCopied={justCopied}
      onClose={closeSheet}
    />
  );
}
