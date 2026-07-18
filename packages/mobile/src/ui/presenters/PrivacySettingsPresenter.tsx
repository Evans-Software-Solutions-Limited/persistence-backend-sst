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
import { IconBack, IconChevronR, iconDefaults } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

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
 * v1 launch: the "Profile Visibility" section is NOT rendered — the only
 * choice it offered was public discoverability, which ships no discovery UI
 * or moderation yet (Apple Guideline 1.2 de-risk). With "public" gone the
 * lone "Private" option is not a real choice, so the whole section is hidden
 * rather than left as a single always-selected row. The container wiring
 * (`isProfilePublic` / `onUpdateVisibility`) is intentionally kept so it can
 * be reintroduced WITH moderation later without re-threading props.
 *
 * PORT-GAP (retained note): legacy stored `profile_visibility` ∈
 * {private, friends, public}. V2's `ApiProfile.isProfilePublic` is a boolean
 * — see `packages/mobile/src/domain/ports/api.port.ts:373`.
 */

export type PrivacyVisibility = "private" | "public";

export type PrivacySettingsPresenterProps = {
  isLoading: boolean;
  /**
   * Retained but unrendered for v1 (see the module header) — the Profile
   * Visibility section is hidden, so these are passed by the container but
   * not consumed here until a moderated re-launch.
   */
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
  // `isProfilePublic` / `onUpdateVisibility` are intentionally not
  // destructured for v1 — the Profile Visibility section is hidden. See the
  // module header.
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

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <PrivacySettingsHeader onBack={onBack} />

      <ScrollView style={styles.content} testID="privacy-settings-scroll">
        {/* Profile Visibility section HIDDEN for v1 launch — its only choice
            was public discoverability (no discovery UI / moderation yet;
            Apple Guideline 1.2 de-risk), leaving no real Private-vs-Public
            choice. Container wiring retained; see the module header. */}

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
              color={color.$error}
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
    backgroundColor: color.$bg,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "600" as const,
    lineHeight: 28,
    color: color.$text,
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    fontWeight: "400" as const,
    lineHeight: 20,
    marginBottom: 16,
    color: color.$text2,
  },
  option: {
    backgroundColor: color.$surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  dangerOption: {
    borderWidth: 1,
    borderColor: color.$error,
  },
  dangerTitle: {
    color: color.$error,
  },
  optionContent: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: "600" as const,
    lineHeight: 24,
    color: color.$text,
    marginBottom: 4,
  },
});
