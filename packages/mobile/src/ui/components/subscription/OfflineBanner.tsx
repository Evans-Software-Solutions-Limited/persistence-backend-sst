import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { color } from "@/ui/theme/tokens";

/**
 * Single-line "You're offline" banner shown above the subscription
 * screens' main content when `useOnlineStatus()` reports `false`.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Offline UX on
 *       subscription screens
 * Satisfies: requirements.md AC 11.1
 *
 * Visual: a warning-tinted strip with a small cloud-offline icon —
 * minimal, doesn't push the tier cards off-screen, doesn't disable any
 * interactions (the container's pre-flight check handles that path
 * separately). Matches the legacy gym-app aesthetic used by the
 * subscription screens already (warning chip tone, same Spacing/Radius
 * tokens).
 */
export function OfflineBanner() {
  return (
    <View style={styles.banner} testID="subscription-offline-banner">
      <Ionicons name="cloud-offline-outline" size={16} color={color.$warning} />
      <Text style={styles.text}>You&apos;re offline</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: color.$warning + "1A",
    borderWidth: 1,
    borderColor: color.$warning + "40",
    borderRadius: 12,
    marginHorizontal: 24,
    marginTop: 8,
  },
  text: {
    fontSize: 13,
    fontWeight: "600",
    color: color.$warning,
  },
});
