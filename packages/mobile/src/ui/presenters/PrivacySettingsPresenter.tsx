import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { IconBack, IconCheck } from "@/ui/components/icons";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/profileLegacyTheme";

// [01-design-system adoption sweep 2026-05-29]
// Foundation primitive shells swapped in: <Icon*> (Ionicons -> Lucide).
// checkmark-circle -> IconCheck (circle nuance dropped; same glyph intent).
// Composite primitives + layout-shape changes deferred to owning spec.

/**
 * Privacy Settings — pure presenter. Visibility picker ported from
 * `persistence-mobile/app/privacy-settings.tsx`.
 *
 * PORT-GAP: legacy stored `profile_visibility` ∈ {private, friends, public}.
 * V2's `ApiProfile.isProfilePublic` is a boolean — see
 * `packages/mobile/src/domain/ports/api.port.ts:373`. Until a backend field
 * add is specced, M12 ships only the Private + Public options and maps
 * 1:1 to the boolean. The "Friends Only" middle option is intentionally
 * dropped. Same StyleSheet, same row affordance, same Data & Privacy
 * footer copy.
 */

export type PrivacyVisibility = "private" | "public";

export type PrivacySettingsPresenterProps = {
  isLoading: boolean;
  isProfilePublic: boolean;
  onUpdateVisibility: (next: PrivacyVisibility) => void;
  onBack: () => void;
};

export function PrivacySettingsPresenter({
  isLoading,
  isProfilePublic,
  onUpdateVisibility,
  onBack,
}: PrivacySettingsPresenterProps) {
  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={["top"]}>
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={onBack}
              testID="privacy-settings-back"
              hitSlop={8}
            >
              <IconBack size={24} color={Colors.text.primary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Privacy Settings</Text>
            <View style={styles.headerSpacer} />
          </View>
          <View
            style={styles.loadingContainer}
            testID="privacy-settings-loader"
          >
            <PLogoDrawLoader />
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const currentVisibility: PrivacyVisibility = isProfilePublic
    ? "public"
    : "private";

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={onBack}
            testID="privacy-settings-back"
            hitSlop={8}
          >
            <IconBack size={24} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Privacy Settings</Text>
          <View style={styles.headerSpacer} />
        </View>

        <ScrollView style={styles.content} testID="privacy-settings-scroll">
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Profile Visibility</Text>
            <Text style={styles.sectionDescription}>
              Control who can see your profile and workout data
            </Text>

            <TouchableOpacity
              style={[
                styles.option,
                currentVisibility === "private" && styles.optionSelected,
              ]}
              onPress={() => onUpdateVisibility("private")}
              testID="privacy-settings-option-private"
            >
              <View style={styles.optionContent}>
                <Text style={styles.optionTitle}>Private</Text>
                <Text style={styles.optionDescription}>
                  Only you can see your profile and workouts
                </Text>
              </View>
              {currentVisibility === "private" && (
                <IconCheck
                  size={24}
                  color={Colors.primary.DEFAULT}
                  testID="privacy-settings-check-private"
                />
              )}
            </TouchableOpacity>

            {/* PORT-GAP: legacy "Friends Only" option dropped — V2 backend
                exposes `isProfilePublic` boolean only. See module header. */}

            <TouchableOpacity
              style={[
                styles.option,
                currentVisibility === "public" && styles.optionSelected,
              ]}
              onPress={() => onUpdateVisibility("public")}
              testID="privacy-settings-option-public"
            >
              <View style={styles.optionContent}>
                <Text style={styles.optionTitle}>Public</Text>
                <Text style={styles.optionDescription}>
                  Everyone can see your profile and workouts
                </Text>
              </View>
              {currentVisibility === "public" && (
                <IconCheck
                  size={24}
                  color={Colors.primary.DEFAULT}
                  testID="privacy-settings-check-public"
                />
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Data &amp; Privacy</Text>
            <Text style={styles.sectionDescription}>
              Your data is stored securely and used only to provide the service.
              You can request data export or account deletion at any time by
              contacting support.
            </Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  headerTitle: {
    ...Typography.h3,
  },
  headerSpacer: {
    width: 24,
  },
  content: {
    flex: 1,
    padding: Spacing.md,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    ...Typography.h3,
    marginBottom: Spacing.sm,
  },
  sectionDescription: {
    ...Typography.body2,
    marginBottom: Spacing.md,
    color: Colors.text.secondary,
  },
  option: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    ...Shadows.small,
  },
  optionSelected: {
    borderWidth: 2,
    borderColor: Colors.primary.DEFAULT,
  },
  optionContent: {
    flex: 1,
  },
  optionTitle: {
    ...Typography.body1,
    fontWeight: "600",
    marginBottom: 4,
  },
  optionDescription: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
});
