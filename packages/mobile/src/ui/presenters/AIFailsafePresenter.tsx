import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { color } from "@/ui/theme/tokens";

export function AIFailsafePresenter({
  onDismiss,
  onBuildManually,
}: {
  onDismiss: () => void;
  onBuildManually: () => void;
}) {
  return (
    <SafeAreaView style={styles.safeArea} testID="ai-failsafe">
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="pause" size={30} color={color.$primaryBright} />
        </View>
        <Text style={styles.title}>AI is taking a short break</Text>
        <Text style={styles.body}>
          To keep suggestions fast and reliable, Persistence briefly pauses AI
          features after a busy stretch. It comes back on its own in a little
          while — nothing you need to do.
        </Text>
        <View style={styles.fact}>
          <Ionicons name="checkmark" size={16} color={color.$primary} />
          <Text style={styles.factText}>
            Your workouts, logs and history are untouched
          </Text>
        </View>
        <View style={styles.fact}>
          <Ionicons name="swap-horizontal" size={16} color={color.$primary} />
          <Text style={styles.factText}>
            You can still build and log everything manually
          </Text>
        </View>
      </View>
      <View style={styles.footer}>
        <TouchableOpacity style={styles.primary} onPress={onDismiss}>
          <Text style={styles.primaryText}>Got it</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.secondary} onPress={onBuildManually}>
          <Text style={styles.secondaryText}>Build a workout myself</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: color.$bg },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  iconWrap: {
    width: 76,
    height: 76,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: color.$border2,
    borderRadius: 23,
    backgroundColor: color.$surface2,
  },
  title: {
    marginTop: 24,
    color: color.$text,
    fontSize: 27,
    fontWeight: "800",
    textAlign: "center",
  },
  body: {
    maxWidth: 320,
    marginTop: 12,
    color: color.$text2,
    fontSize: 14,
    lineHeight: 22,
    textAlign: "center",
  },
  fact: {
    width: "100%",
    maxWidth: 340,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 12,
    padding: 13,
    borderWidth: 1,
    borderColor: color.$border,
    borderRadius: 13,
    backgroundColor: color.$surface,
  },
  factText: { flex: 1, color: color.$text2, fontSize: 12.5 },
  footer: {
    gap: 8,
    padding: 18,
    borderTopWidth: 1,
    borderTopColor: color.$border,
    backgroundColor: color.$surface,
  },
  primary: {
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: color.$primary,
  },
  primaryText: { color: color.$primaryInk, fontSize: 15, fontWeight: "700" },
  secondary: { height: 44, alignItems: "center", justifyContent: "center" },
  secondaryText: { color: color.$primary, fontSize: 13.5, fontWeight: "600" },
});
