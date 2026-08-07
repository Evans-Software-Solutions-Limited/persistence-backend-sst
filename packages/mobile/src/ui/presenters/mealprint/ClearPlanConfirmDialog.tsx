import { Text, View } from "@tamagui/core";
import { Modal, Pressable } from "react-native";
import { Btn } from "@/ui/components/foundation";

/**
 * <ClearPlanConfirmDialog> — confirm-before-clear for the Fuel page's "Clear
 * plan" action (spec-26 amendment 2026-08-fuel-plan-surfacing § B). Same
 * centred-Modal shape as `SignOutConfirmDialog`/`PlanTodayPresenter`'s own
 * delete icon, but THAT icon has no confirm step — this is the one the
 * amendment specifically calls for ("Confirm-before-clear in the UI").
 *
 * Copy is explicit that clearing removes the PLAN, not anything already
 * logged — `loggedEntryId` is `ON DELETE SET NULL` server-side, so a cleared
 * plan never erases eaten food (amendment § B).
 */

export type ClearPlanConfirmDialogProps = {
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  isProcessing?: boolean;
  testID?: string;
};

export function ClearPlanConfirmDialog({
  onCancel,
  onConfirm,
  isProcessing = false,
  testID = "clear-plan-confirm",
}: ClearPlanConfirmDialogProps) {
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
        accessibilityLabel="Dismiss clear-plan confirmation"
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
        <Pressable
          onPress={() => undefined}
          style={{ width: "100%", maxWidth: 400 }}
        >
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
              Clear today&apos;s plan?
            </Text>
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$text2"
              marginBottom={16}
              lineHeight={18}
            >
              This removes the plan and its unlogged meals. Anything you&apos;ve
              already logged today stays in your diary.
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
                  {isProcessing ? "Clearing…" : "Clear plan"}
                </Btn>
              </View>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
