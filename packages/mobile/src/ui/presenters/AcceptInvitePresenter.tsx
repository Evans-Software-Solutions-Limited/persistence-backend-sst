import { ActivityIndicator, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { Btn, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconBack } from "@/ui/components/icons";
import { DataSharingConsentSheet } from "@/ui/presenters/DataSharingConsentSheet";

/**
 * <AcceptInvitePresenter> — the athlete's invite-code redeem screen (Coach
 * Mode Phase 8 — invite/QR, 10-trainer-features). V2-new surface (no
 * legacy/prototype) — mirrors `RequestsPresenter`'s HeaderBar + layout shape
 * within the existing design system (`Btn tone="trainer"`, `$text`/`$text2`
 * tokens). Reached either from the "Have a coach's code?" entry on the You
 * screen, or from a `persistencemobile://accept-invite?code=…` deep link
 * (the code arrives pre-filled via the container's `useLocalSearchParams`).
 *
 * Submission result (success alert / inline domain-error copy) is handled by
 * the container — this presenter only renders the code field + error state
 * + raises `onSubmit`.
 */

export type AcceptInvitePresenterProps = {
  code: string;
  onCodeChange: (value: string) => void;
  isSubmitting: boolean;
  /** Inline domain-error copy (empty string = no error shown). */
  errorMessage: string;
  /** Opens the consent sheet — does NOT redeem the code itself (see `onConsentConfirm`). */
  onSubmit: () => void;
  onBack: () => void;
  /** 26-coach-data-sharing-consent: drives <DataSharingConsentSheet>, opened by `onSubmit`. */
  consentVisible: boolean;
  onConsentClose: () => void;
  /** Only this actually redeems the code — see `AcceptInviteContainer`. */
  onConsentConfirm: () => void;
};

export function AcceptInvitePresenter({
  code,
  onCodeChange,
  isSubmitting,
  errorMessage,
  onSubmit,
  onBack,
  consentVisible,
  onConsentClose,
  onConsentConfirm,
}: AcceptInvitePresenterProps) {
  const insets = useSafeAreaInsets();
  const submitDisabled = code.trim() === "" || isSubmitting;

  return (
    <View flex={1} paddingTop={insets.top}>
      <HeaderBar
        eyebrow="COACHING"
        title="Enter code"
        leading={
          <IconBtn
            icon={<IconBack size={20} />}
            tone="neutral"
            onPress={onBack}
            accessibilityLabel="Back"
          />
        }
      />
      <View paddingHorizontal={20} gap={16}>
        <Text fontFamily="$body" fontSize={13} color="$text2">
          Enter the code your coach shared, or open the link they sent, to start
          training together.
        </Text>

        <View gap={6}>
          <TextInput
            value={code}
            onChangeText={(v) => onCodeChange(v.toUpperCase())}
            placeholder="ABCD12"
            placeholderTextColor="#8A8A98"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            editable={!isSubmitting}
            accessibilityLabel="Coach's invite code"
            testID="accept-invite-code-input"
            style={{
              height: 56,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: errorMessage ? toneHex("error").base : "#232735",
              backgroundColor: "#181B26",
              paddingHorizontal: 14,
              color: "#F4F4F8",
              fontFamily: "Geist Mono",
              fontSize: 22,
              fontWeight: "700",
              letterSpacing: 4,
              textAlign: "center",
            }}
          />
          {errorMessage ? (
            <Text
              fontFamily="$body"
              fontSize={12}
              color="$error"
              testID="accept-invite-error"
            >
              {errorMessage}
            </Text>
          ) : null}
        </View>

        <Btn
          variant="filled"
          tone="trainer"
          full
          onPress={onSubmit}
          disabled={submitDisabled}
          icon={
            isSubmitting ? (
              <ActivityIndicator size="small" color={toneHex("trainer").ink} />
            ) : undefined
          }
          testID="accept-invite-submit"
        >
          Join
        </Btn>
      </View>
      <DataSharingConsentSheet
        visible={consentVisible}
        onClose={onConsentClose}
        onConfirm={onConsentConfirm}
        isSubmitting={isSubmitting}
        confirmLabel="Join"
        testIDPrefix="accept-invite"
      />
    </View>
  );
}
