import { Text, View } from "@tamagui/core";
import { Modal, Pressable } from "react-native";

import { Btn } from "@/ui/components/foundation";

/**
 * <SignOutConfirmDialog> — centred confirm modal for the ProfileDrawer's
 * sign-out CTA. Spec-local (08-profile-settings/design.md §
 * <SignOutConfirmDialog>); same shape as the 05 EndConfirmDialog / the
 * subscription CancelSubscriptionModal, restyled with new tokens + <Btn>.
 *
 * Spec: specs/08-profile-settings/requirements.md STORY-007 (AC 7.2, 7.3)
 *
 * Pure presenter — the parent mounts/unmounts it. Backdrop tap cancels;
 * the inner card swallows the tap so it doesn't bubble to the backdrop.
 * `isProcessing` disables both CTAs while sign-out is in flight.
 */

export type SignOutConfirmDialogProps = {
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  isProcessing?: boolean;
  testID?: string;
};

export function SignOutConfirmDialog({
  onCancel,
  onConfirm,
  isProcessing = false,
  testID = "sign-out-confirm",
}: SignOutConfirmDialogProps) {
  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      testID={testID}
    >
      <Pressable
        onPress={isProcessing ? undefined : onCancel}
        accessibilityLabel="Dismiss sign-out confirmation"
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.7)",
          justifyContent: "center",
          alignItems: "center",
          padding: 24,
        }}
        testID={`${testID}-backdrop`}
      >
        {/* Inner card swallows the press so a tap inside doesn't cancel. */}
        <Pressable onPress={() => undefined} style={{ width: "100%", maxWidth: 400 }}>
          <View
            backgroundColor="$surface"
            borderColor="$border2"
            borderWidth={1}
            borderRadius={16}
            padding={20}
          >
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={20}
              letterSpacing={-0.4}
              color="$text"
              marginBottom={8}
            >
              Sign out?
            </Text>
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$text2"
              marginBottom={16}
            >
              You&apos;ll need to sign back in to access your workouts.
            </Text>
            <View flexDirection="row" gap={10}>
              <View flex={1}>
                <Btn
                  variant="outline"
                  tone="primary"
                  size="md"
                  full
                  onPress={onCancel}
                  disabled={isProcessing}
                  testID={`${testID}-cancel`}
                >
                  Cancel
                </Btn>
              </View>
              <View flex={1}>
                <Btn
                  variant="filled"
                  tone="error"
                  size="md"
                  full
                  onPress={onConfirm}
                  disabled={isProcessing}
                  testID={`${testID}-confirm`}
                >
                  {isProcessing ? "Signing out…" : "Sign out"}
                </Btn>
              </View>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
