/**
 * <EndConfirmDialogPresenter> — centred "End workout?" confirmation.
 *
 * Ports `~/Downloads/handoff/design-source/screens/active-workout.jsx:115–136`.
 * A centred modal card over a dimmed full-screen backdrop. Replaces the legacy
 * `Alert.alert` end-confirmation at both call sites (the session header "End"
 * pill and the minimised-bar long-press). Pure presenter — the caller owns
 * visibility and the elapsed string.
 *
 * Backdrop tap dismisses (→ onKeepGoing, STORY-005 AC 5.4). "Keep going"
 * (outline/primary) and "End" (filled/error) are the two CTAs (AC 5.3).
 *
 * NOTE: the prototype's `backdropFilter: blur(6px)` is omitted — React Native
 * has no built-in backdrop blur and `expo-blur` is not a project dependency.
 * A solid `rgba(0,0,0,0.65)` scrim (the same base colour) stands in; adding the
 * blur would need a native dep + rebuild (flagged for sign-off).
 *
 * Spec: specs/05-active-session/design.md § <EndConfirmDialogPresenter>
 *       specs/05-active-session/requirements.md STORY-005 (AC 5.2–5.5)
 */

import { Text, View } from "@tamagui/core";
import { Pressable, StyleSheet } from "react-native";
import { Btn } from "@/ui/components/foundation/Btn";
import { color } from "@/ui/theme/tokens";

export type EndConfirmDialogPresenterProps = {
  /** Formatted elapsed string shown in the body, e.g. "12:30". */
  elapsed: string;
  /** Dismiss without ending (backdrop tap + "Keep going"). */
  onKeepGoing: () => void;
  /** Confirm ending the session without saving. */
  onEnd: () => void;
  testID?: string;
};

export function EndConfirmDialogPresenter({
  elapsed,
  onKeepGoing,
  onEnd,
  testID = "end-confirm-dialog",
}: EndConfirmDialogPresenterProps) {
  return (
    <Pressable
      style={styles.backdrop}
      onPress={onKeepGoing}
      testID={`${testID}-backdrop`}
      accessibilityLabel="Dismiss end-workout dialog"
    >
      {/* Swallow touches on the card so they don't reach the backdrop. */}
      <View
        style={styles.card}
        onStartShouldSetResponder={() => true}
        testID={testID}
      >
        <Text color="$text" fontSize={20} fontWeight="700" marginBottom={8}>
          End workout?
        </Text>
        <Text color="$text2" fontSize={13} marginBottom={16}>
          {`Your progress so far (${elapsed}) won't be saved as a completed workout.`}
        </Text>
        <View flexDirection="row" gap={10}>
          <View flex={1}>
            <Btn
              full
              variant="outline"
              tone="primary"
              size="md"
              onPress={onKeepGoing}
              testID={`${testID}-keep-going`}
            >
              Keep going
            </Btn>
          </View>
          <View flex={1}>
            <Btn
              full
              variant="filled"
              tone="error"
              size="md"
              onPress={onEnd}
              testID={`${testID}-end`}
            >
              End
            </Btn>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.65)",
    zIndex: 90, // $modal
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: color.$surface,
    borderWidth: 1,
    borderColor: color.$border2,
    borderRadius: 20,
    padding: 22,
    maxWidth: 320,
    width: "100%",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.6,
    shadowRadius: 30,
    elevation: 24,
  },
});
