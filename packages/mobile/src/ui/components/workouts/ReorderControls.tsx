import { StyleSheet, Text, View } from "react-native";

import { Btn } from "@/ui/components/foundation/Btn";
import { IconCheck, IconGrip } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

/**
 * The way into and out of reorder mode (PER-67, Brad 10 Nov 2026): a Reorder
 * button above the exercises, and a bar with Done while reordering. The
 * active session, the workout editor and the workout creator share both.
 */
export function ReorderButton({
  onPress,
  testID = "reorder-exercises",
}: {
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Btn
      variant="ghost"
      tone="primary"
      size="sm"
      icon={<IconGrip size={15} color={color.$primary} />}
      onPress={onPress}
      accessibilityLabel="Reorder exercises"
      testID={testID}
    >
      Reorder
    </Btn>
  );
}

export function ReorderModeBar({
  onDone,
  testID = "reorder-mode-bar",
}: {
  onDone: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.bar} testID={testID}>
      <View style={styles.text}>
        <Text style={styles.title} accessibilityRole="header">
          Reorder exercises
        </Text>
        <Text style={styles.hint}>Hold a handle and drag</Text>
      </View>
      <Btn
        variant="filled"
        tone="primary"
        size="sm"
        icon={<IconCheck size={14} color={color.$primaryInk} />}
        onPress={onDone}
        accessibilityLabel="Done reordering"
        testID={`${testID}-done`}
      >
        Done
      </Btn>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    color: color.$text,
    fontFamily: "Geist",
    fontSize: 16,
    fontWeight: "600",
  },
  hint: {
    color: color.$text3,
    fontFamily: "Geist",
    fontSize: 12,
  },
});
