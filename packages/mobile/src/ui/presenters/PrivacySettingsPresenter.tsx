import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { HeaderBar, IconBtn } from "@/ui/components/foundation";
import {
  IconBack,
  IconCheck,
  IconChevronR,
  iconDefaults,
} from "@/ui/components/icons";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/profileLegacyTheme";

// [08-profile-settings shell refresh 2026]
// Header chrome moved to <HeaderBar> + <IconBtn> foundation primitives and
// the top safe-area inset is applied to a plain container (replacing the
// SafeAreaView top edge). Body list/scroll content kept on its StyleSheet
// per the cosmetic-refresh scope. Behaviour, props + testIDs unchanged.
// [01-design-system adoption sweep 2026-05-29]
// Foundation primitive shells swapped in: <Icon*> (Ionicons -> Lucide).
// checkmark-circle -> IconCheck (circle nuance dropped; same glyph intent).

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
  onOpenPrivacyPolicy: () => void;
  onOpenTerms: () => void;
  onDeleteAccount: () => void;
};

function PrivacySettingsHeader({ onBack }: { onBack: () => void }) {
  return (
    <HeaderBar
      title="Privacy Settings"
      leading={
        <IconBtn
          icon={<IconBack {...iconDefaults({ size: 20 })} />}
          tone="ghost"
          onPress={onBack}
          accessibilityLabel="Go back"
          testID="privacy-settings-back"
        />
      }
    />
  );
}

export function PrivacySettingsPresenter({
  isLoading,
  isProfilePublic,
  onUpdateVisibility,
  onBack,
  onOpenPrivacyPolicy,
  onOpenTerms,
  onDeleteAccount,
}: PrivacySettingsPresenterProps) {
  const insets = useSafeAreaInsets();

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <PrivacySettingsHeader onBack={onBack} />
        <View style={styles.loadingContainer} testID="privacy-settings-loader">
          <PLogoDrawLoader />
        </View>
      </View>
    );
  }

  const currentVisibility: PrivacyVisibility = isProfilePublic
    ? "public"
    : "private";

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PrivacySettingsHeader onBack={onBack} />

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
            Contact support to request a copy of your data.
          </Text>
        </View>

        {/* Legal — the Privacy Policy + Terms live here now that the drawer's
            row points at this settings screen rather than straight at the
            policy. Keeps the (App Store–required) policy reachable. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Legal</Text>
          <TouchableOpacity
            style={styles.option}
            onPress={onOpenPrivacyPolicy}
            testID="privacy-settings-policy"
          >
            <View style={styles.optionContent}>
              <Text style={styles.optionTitle}>Privacy Policy</Text>
            </View>
            <IconChevronR {...iconDefaults({ size: 16 })} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.option}
            onPress={onOpenTerms}
            testID="privacy-settings-terms"
          >
            <View style={styles.optionContent}>
              <Text style={styles.optionTitle}>Terms of Service</Text>
            </View>
            <IconChevronR {...iconDefaults({ size: 16 })} />
          </TouchableOpacity>
        </View>

        {/* Account deletion — App Store Guideline 5.1.1(v). Destructive,
            irreversible; the container gates it behind a double-confirm. */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Delete Account</Text>
          <Text style={styles.sectionDescription}>
            Permanently delete your account and all associated data — profile,
            workouts, sessions, nutrition, measurements, and goals. This cannot
            be undone.
          </Text>
          <TouchableOpacity
            style={[styles.option, styles.dangerOption]}
            onPress={onDeleteAccount}
            testID="privacy-settings-delete-account"
            accessibilityRole="button"
            accessibilityLabel="Delete account"
          >
            <View style={styles.optionContent}>
              <Text style={[styles.optionTitle, styles.dangerTitle]}>
                Delete Account
              </Text>
            </View>
            <IconChevronR
              {...iconDefaults({ size: 16 })}
              color={Colors.error.DEFAULT}
            />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
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
  dangerOption: {
    borderWidth: 1,
    borderColor: Colors.error.DEFAULT,
  },
  dangerTitle: {
    color: Colors.error.DEFAULT,
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
