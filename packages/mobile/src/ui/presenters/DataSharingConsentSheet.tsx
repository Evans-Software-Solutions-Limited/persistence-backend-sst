import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconCheck } from "@/ui/components/icons";
import { PRIVACY_POLICY_URL } from "@/domain/models/consent";

/**
 * <DataSharingConsentSheet> — the shared UK GDPR Art 9(2)(a) explicit-consent
 * step (26-coach-data-sharing-consent), reused verbatim by both places a
 * client can start sharing data with a coach:
 *
 *   - <RequestsPresenter> — accepting a trainer-initiated pending request.
 *   - <AcceptInvitePresenter> — redeeming a coach's invite code.
 *
 * Pure presentational (mirrors every other foundation-built sheet in this
 * codebase, e.g. `AddClientSheetPresenter`): the caller owns the
 * open/close/submit state and passes it in as props. The one piece of local
 * state is the checkbox tick — it is NEVER pre-ticked, and is reset to
 * unticked every time the sheet transitions to visible, so a dismiss-and-
 * reopen (or a fresh accept/redeem attempt) always starts from an
 * affirmative-consent-required baseline.
 *
 * `onConfirm` is only reachable once the checkbox is ticked (the button is
 * disabled otherwise) — the caller does not need to re-check `checked`
 * itself.
 */

export type DataSharingConsentSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Fires only when the checkbox is ticked — see the confirm-button gate below. */
  onConfirm: () => void;
  isSubmitting: boolean;
  /** e.g. "Accept" (Requests) / "Join" (AcceptInvite) — matches the calling flow's own CTA copy. */
  confirmLabel: string;
  /** Distinguishes testIDs between the two call sites (e.g. "requests" / "accept-invite"). */
  testIDPrefix: string;
};

export function DataSharingConsentSheet({
  visible,
  onClose,
  onConfirm,
  isSubmitting,
  confirmLabel,
  testIDPrefix,
}: DataSharingConsentSheetProps) {
  const [checked, setChecked] = useState(false);

  // Never pre-ticked: every time the sheet (re)opens, start from unticked —
  // whether this is the first open or a re-open after a prior dismiss.
  useEffect(() => {
    if (visible) setChecked(false);
  }, [visible]);

  const toggleChecked = useCallback(() => setChecked((v) => !v), []);

  const openPrivacyPolicy = useCallback(() => {
    // Best-effort: a Linking failure must not block the consent flow itself.
    Linking.openURL(PRIVACY_POLICY_URL).catch(() => {});
  }, []);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      eyebrow="COACHING"
      title="Share your data with your coach"
      accent="trainer"
      testID={`${testIDPrefix}-consent-sheet`}
    >
      <View gap={14}>
        <Text fontFamily="$body" fontSize={13.5} color="$text2" lineHeight={19}>
          To coach you, your coach will be able to see the fitness and health
          data you record in Persistence: your body measurements (like weight
          and body fat), your workout sessions and personal records, your
          nutrition totals, and your goals and habits.
        </Text>

        <Text fontFamily="$body" fontSize={13} color="$text3" lineHeight={18}>
          Your raw Apple Health data — sleep, heart rate, steps — is never
          shared. Only the coaching metrics above.
        </Text>

        <Text fontFamily="$body" fontSize={13} color="$text3" lineHeight={18}>
          You can stop sharing at any time by leaving your coach, which
          immediately ends all data sharing.
        </Text>

        <Pressable
          onPress={toggleChecked}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          accessibilityLabel="I agree to share the data above with my coach."
          testID={`${testIDPrefix}-consent-checkbox`}
        >
          <View flexDirection="row" alignItems="center" gap={10}>
            <View
              width={22}
              height={22}
              borderRadius={6}
              borderWidth={1.5}
              borderColor={checked ? toneHex("trainer").base : "$border"}
              backgroundColor={
                checked ? toneHex("trainer").base : "transparent"
              }
              alignItems="center"
              justifyContent="center"
            >
              {checked ? (
                <IconCheck size={14} color={toneHex("trainer").ink} />
              ) : null}
            </View>
            <Text
              flex={1}
              fontFamily="$body"
              fontSize={13.5}
              fontWeight="600"
              color="$text"
            >
              I agree to share the data above with my coach.
            </Text>
          </View>
        </Pressable>

        <Pressable
          onPress={openPrivacyPolicy}
          testID={`${testIDPrefix}-privacy-link`}
          accessibilityRole="link"
        >
          <Text
            fontFamily="$body"
            fontSize={13}
            fontWeight="600"
            color={toneHex("trainer").base}
            textDecorationLine="underline"
          >
            Read our Privacy Policy
          </Text>
        </Pressable>

        <Btn
          variant="filled"
          tone="trainer"
          full
          disabled={!checked || isSubmitting}
          onPress={onConfirm}
          testID={`${testIDPrefix}-consent-confirm`}
        >
          {confirmLabel}
        </Btn>
      </View>
    </BottomSheet>
  );
}
