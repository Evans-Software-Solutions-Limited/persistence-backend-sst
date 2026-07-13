import { ActivityIndicator, TextInput } from "react-native";
import * as Linking from "expo-linking";
import { Text, View } from "@tamagui/core";
import QRCode from "react-native-qrcode-svg";
import {
  BottomSheet,
  Btn,
  IconBtn,
  Segmented,
} from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconCheck, IconClipboard } from "@/ui/components/icons";
import type { TrainerInviteCode } from "@/domain/models/trainerInviteCode";

/**
 * <AddClientSheetPresenter> — pure UI for the coach "Add client" flow
 * (10-trainer-features + Coach Mode Phase 8 — invite/QR). Two modes behind a
 * top `Segmented` toggle:
 *
 *  - "By email" (default) — the original per-email invite form, ported from
 *    the legacy `InviteClientModal` 1:1 (title, subtitle, email + reason
 *    fields, Send Invitation / Cancel).
 *  - "Share code" — Phase 8 net-new: mint a reusable 6-char code + QR
 *    (a `Linking.createURL("/accept-invite", {code})` deep link). Tap-to-copy via
 *    `expo-clipboard` (`Clipboard.setStringAsync`, called by the container's
 *    `onCopyCode`) AND native `Share` (the container's `onShareCode`) are
 *    both offered — the code also renders large + `selectable` so it can
 *    still be copied via the OS text-selection menu as a fallback.
 *
 * V2-new surface (no legacy/prototype for the code/QR view) — built strictly
 * within the existing design system: `Segmented`/`BottomSheet`/`Btn`/`IconBtn`
 * foundation primitives, `tone="trainer"`, `$text`/`$text2` tokens. The
 * bottom sheet is bumped to `height="tall"` (vs the original `"peek"`) so the
 * QR clears the fold on both modes.
 *
 * Validation + submit + code-minting + clipboard/share side effects all live
 * in the container; this presenter only renders state + raises callbacks.
 */

export type AddClientSheetMode = "email" | "code";

export type AddClientSheetPresenterProps = {
  visible: boolean;
  mode: AddClientSheetMode;
  onModeChange: (mode: AddClientSheetMode) => void;

  // "By email" mode.
  email: string;
  reason: string;
  emailError: string;
  isLoading: boolean;
  onEmailChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onInvite: () => void;

  // "Share code" mode (Phase 8).
  inviteCode: TrainerInviteCode | null;
  isGeneratingCode: boolean;
  isOnline: boolean;
  onGenerateCode: () => void;
  onShareCode: () => void;
  /** Copy the code to the clipboard (`expo-clipboard`). */
  onCopyCode: () => void;
  /** True for a brief window right after a successful copy — shows "Copied". */
  justCopied: boolean;

  onClose: () => void;
};

const ERROR_HEX = toneHex("error").base;
/** Raw white — a QR's quiet zone must stay light regardless of app theme, so
 * this is a concrete (non-tokenisable) colour, not a themeable one. Named per
 * the `*Color` convention the design-system lint rule exempts. */
const qrBackgroundColor = "#FFFFFF";
const qrForegroundColor = "#0B0B12";

/** Scheme deep link a redeeming athlete's scan/tap resolves. Built via
 * `Linking.createURL` so the prefix is correct across environments (custom
 * scheme in standalone/dev-client, `exp://…/--/` under Expo Go); the OS
 * linking pipeline routes it via `app/+native-intent.ts`, which reuses
 * `SCHEME_HOSTS["accept-invite"]` in `application/notifications/deep-link.ts`. */
export function buildAcceptInviteDeepLink(code: string): string {
  return Linking.createURL("/accept-invite", { queryParams: { code } });
}

/**
 * "Expires in Nh" (or "Expires in Nm" under an hour, or "Expired") from the
 * code's `expiresAt` ISO timestamp. Exported for unit testing without
 * mounting the presenter.
 */
export function formatCodeExpiry(
  expiresAt: string,
  now: number = Date.now(),
): string {
  const expiryMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiryMs)) return "";
  const diffMs = expiryMs - now;
  if (diffMs <= 0) return "Expired";
  const totalMinutes = Math.max(1, Math.ceil(diffMs / (60 * 1000)));
  if (totalMinutes < 60) return `Expires in ${totalMinutes}m`;
  const hours = Math.ceil(diffMs / (60 * 60 * 1000));
  return `Expires in ${hours}h`;
}

function EmailForm({
  email,
  reason,
  emailError,
  isLoading,
  onEmailChange,
  onReasonChange,
}: Pick<
  AddClientSheetPresenterProps,
  | "email"
  | "reason"
  | "emailError"
  | "isLoading"
  | "onEmailChange"
  | "onReasonChange"
>) {
  return (
    <View gap={16}>
      <View gap={6}>
        <TextInput
          value={email}
          onChangeText={onEmailChange}
          placeholder="Client email address"
          placeholderTextColor="#8A8A98"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isLoading}
          accessibilityLabel="Client email address"
          testID="add-client-email-input"
          style={{
            height: 48,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: emailError ? ERROR_HEX : "#232735",
            backgroundColor: "#181B26",
            paddingHorizontal: 14,
            color: "#F4F4F8",
            fontFamily: "Geist",
            fontSize: 15,
          }}
        />
        {emailError ? (
          <Text
            fontFamily="$body"
            fontSize={12}
            color="$error"
            testID="add-client-email-error"
          >
            {emailError}
          </Text>
        ) : null}
      </View>

      <TextInput
        value={reason}
        onChangeText={onReasonChange}
        placeholder="Reason for training (optional)"
        placeholderTextColor="#8A8A98"
        multiline
        numberOfLines={4}
        editable={!isLoading}
        accessibilityLabel="Reason for training (optional)"
        testID="add-client-reason-input"
        style={{
          height: 100,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "#232735",
          backgroundColor: "#181B26",
          paddingHorizontal: 14,
          paddingTop: 12,
          textAlignVertical: "top",
          color: "#F4F4F8",
          fontFamily: "Geist",
          fontSize: 15,
        }}
      />
    </View>
  );
}

function CodeView({
  inviteCode,
  isGeneratingCode,
  isOnline,
  onGenerateCode,
  onShareCode,
  onCopyCode,
  justCopied,
}: Pick<
  AddClientSheetPresenterProps,
  | "inviteCode"
  | "isGeneratingCode"
  | "isOnline"
  | "onGenerateCode"
  | "onShareCode"
  | "onCopyCode"
  | "justCopied"
>) {
  if (!inviteCode) {
    return (
      <View gap={14} alignItems="center" paddingVertical={8}>
        <Text
          fontFamily="$body"
          fontSize={13}
          color="$text2"
          textAlign="center"
        >
          Generate a code your client can enter, or scan the QR, to start
          training together.
        </Text>
        {!isOnline ? (
          <Text
            fontFamily="$body"
            fontSize={12.5}
            color="$text3"
            testID="add-client-code-offline"
          >
            You&apos;re offline — connect to generate a code.
          </Text>
        ) : null}
        <Btn
          variant="filled"
          tone="trainer"
          full
          onPress={onGenerateCode}
          disabled={!isOnline || isGeneratingCode}
          icon={
            isGeneratingCode ? (
              <ActivityIndicator size="small" color={toneHex("trainer").ink} />
            ) : undefined
          }
          testID="add-client-generate-code"
        >
          Generate invite code
        </Btn>
      </View>
    );
  }

  const deepLink = buildAcceptInviteDeepLink(inviteCode.code);

  return (
    <View gap={16} alignItems="center">
      <View flexDirection="row" alignItems="center" gap={10}>
        {/* The code renders large + `selectable` so the OS text-selection
            menu is a fallback copy path even without the button below. */}
        <Text
          selectable
          fontFamily="$mono"
          fontWeight="700"
          fontSize={36}
          letterSpacing={8}
          color="$text"
          testID="add-client-code-value"
          accessibilityLabel={`Invite code ${inviteCode.code}`}
        >
          {inviteCode.code}
        </Text>
        <IconBtn
          icon={
            justCopied ? <IconCheck size={16} /> : <IconClipboard size={16} />
          }
          tone="trainer"
          onPress={onCopyCode}
          accessibilityLabel="Copy code"
          testID="add-client-copy-code"
        />
      </View>
      {justCopied ? (
        <Text
          fontFamily="$body"
          fontSize={12}
          color="$success"
          testID="add-client-copied"
        >
          Copied
        </Text>
      ) : null}

      <View
        padding={16}
        borderRadius={16}
        testID="add-client-code-qr"
        style={{ backgroundColor: qrBackgroundColor }}
      >
        <QRCode
          value={deepLink}
          size={180}
          color={qrForegroundColor}
          backgroundColor={qrBackgroundColor}
        />
      </View>

      <Text
        fontFamily="$body"
        fontSize={12.5}
        color="$text3"
        testID="add-client-code-expiry"
      >
        {formatCodeExpiry(inviteCode.expiresAt)}
      </Text>

      <Btn
        variant="filled"
        tone="trainer"
        full
        onPress={onShareCode}
        testID="add-client-share-code"
      >
        Share
      </Btn>
    </View>
  );
}

export function AddClientSheetPresenter({
  visible,
  mode,
  onModeChange,
  email,
  reason,
  emailError,
  isLoading,
  onEmailChange,
  onReasonChange,
  onInvite,
  inviteCode,
  isGeneratingCode,
  isOnline,
  onGenerateCode,
  onShareCode,
  onCopyCode,
  justCopied,
  onClose,
}: AddClientSheetPresenterProps) {
  const sendDisabled = email.trim() === "" || isLoading;
  const subtitle =
    mode === "email"
      ? "Send an invitation to a client by email"
      : "Share a code or QR the client can scan to connect";

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accent="trainer"
      height="tall"
      testID="add-client-sheet"
    >
      <View gap={16}>
        <View>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={20}
            letterSpacing={-0.4}
            color="$text"
          >
            Invite New Client
          </Text>
          <Text fontFamily="$body" fontSize={13} color="$text2" marginTop={4}>
            {subtitle}
          </Text>
        </View>

        <Segmented
          options={[
            { value: "email", label: "By email" },
            { value: "code", label: "Share code" },
          ]}
          value={mode}
          onChange={(v) => onModeChange(v as AddClientSheetMode)}
          accent="trainer"
          testID="add-client-mode-toggle"
        />

        {mode === "email" ? (
          <EmailForm
            email={email}
            reason={reason}
            emailError={emailError}
            isLoading={isLoading}
            onEmailChange={onEmailChange}
            onReasonChange={onReasonChange}
          />
        ) : (
          <CodeView
            inviteCode={inviteCode}
            isGeneratingCode={isGeneratingCode}
            isOnline={isOnline}
            onCopyCode={onCopyCode}
            justCopied={justCopied}
            onGenerateCode={onGenerateCode}
            onShareCode={onShareCode}
          />
        )}

        <View flexDirection="row" gap={12}>
          <View flex={1}>
            <Btn
              variant="outline"
              tone="primary"
              full
              onPress={onClose}
              disabled={mode === "email" && isLoading}
              testID="add-client-cancel"
            >
              Cancel
            </Btn>
          </View>
          {mode === "email" ? (
            <View flex={1}>
              <Btn
                variant="filled"
                tone="trainer"
                full
                onPress={onInvite}
                disabled={sendDisabled}
                icon={
                  isLoading ? (
                    <ActivityIndicator
                      size="small"
                      color={toneHex("trainer").ink}
                    />
                  ) : undefined
                }
                testID="add-client-send"
              >
                Send Invitation
              </Btn>
            </View>
          ) : null}
        </View>
      </View>
    </BottomSheet>
  );
}
