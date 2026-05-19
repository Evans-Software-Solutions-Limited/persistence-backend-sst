import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/profileLegacyTheme";

/**
 * Edit Profile screen — pure presenter. Layout ported from legacy
 * `persistence-mobile/app/edit-profile.tsx` (header row + scrollable
 * sectioned form + bottom Save button) and extended with an
 * `isProfilePublic` switch section.
 *
 * 3 fields: fullName, fitnessLevel, isProfilePublic. Confirmed scope —
 * the wider M6 field set (username / height / weight / preferred units)
 * defers to a later milestone where the UX has its own pass.
 */

export type EditProfileFitnessLevel =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "elite";

const FITNESS_LEVELS: EditProfileFitnessLevel[] = [
  "beginner",
  "intermediate",
  "advanced",
  "elite",
];

function capitalize(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export type EditProfilePresenterProps = {
  fullName: string;
  fitnessLevel: EditProfileFitnessLevel;
  isProfilePublic: boolean;
  isSaving: boolean;
  isLoadingInitial: boolean;
  errorMessage: string | null;

  onFullNameChange: (value: string) => void;
  onFitnessLevelChange: (value: EditProfileFitnessLevel) => void;
  onIsProfilePublicChange: (value: boolean) => void;
  onSave: () => void;
  onBack: () => void;
};

export function EditProfilePresenter({
  fullName,
  fitnessLevel,
  isProfilePublic,
  isSaving,
  isLoadingInitial,
  errorMessage,
  onFullNameChange,
  onFitnessLevelChange,
  onIsProfilePublicChange,
  onSave,
  onBack,
}: EditProfilePresenterProps) {
  if (isLoadingInitial) {
    return (
      <SafeAreaView style={styles.container} testID="edit-profile-screen">
        <View style={styles.loadingContainer}>
          <PLogoDrawLoader />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} testID="edit-profile-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.headerButton}
          testID="edit-profile-back"
          hitSlop={8}
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <View style={styles.headerButton} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentInner}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {errorMessage ? (
            <View style={styles.errorBanner} testID="edit-profile-error">
              <Text style={styles.errorBannerText}>{errorMessage}</Text>
            </View>
          ) : null}

          {/* Full Name */}
          <View style={styles.section}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={onFullNameChange}
              placeholder="Enter your full name"
              placeholderTextColor={Colors.text.tertiary}
              autoCapitalize="words"
              autoCorrect={false}
              editable={!isSaving}
              testID="edit-profile-full-name"
            />
          </View>

          {/* Fitness Level */}
          <View style={styles.section}>
            <Text style={styles.label}>Fitness Level</Text>
            <View style={styles.optionsRow}>
              {FITNESS_LEVELS.map((level) => {
                const selected = level === fitnessLevel;
                return (
                  <TouchableOpacity
                    key={level}
                    style={[styles.option, selected && styles.optionSelected]}
                    onPress={() => onFitnessLevelChange(level)}
                    disabled={isSaving}
                    testID={`edit-profile-fitness-${level}`}
                  >
                    <Text
                      style={[
                        styles.optionText,
                        selected && styles.optionTextSelected,
                      ]}
                    >
                      {capitalize(level)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Public Profile */}
          <View style={styles.section}>
            <View style={styles.switchRow}>
              <View style={styles.switchTextWrap}>
                <Text style={styles.label}>Public Profile</Text>
                <Text style={styles.helpText}>
                  Allow other users to discover your profile and view your
                  public workouts.
                </Text>
              </View>
              <Switch
                value={isProfilePublic}
                onValueChange={onIsProfilePublicChange}
                disabled={isSaving}
                testID="edit-profile-public-switch"
              />
            </View>
          </View>

          <TouchableOpacity
            style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
            onPress={onSave}
            disabled={isSaving}
            testID="edit-profile-save"
          >
            {isSaving ? (
              <PLogoDrawLoader size={24} />
            ) : (
              <Text style={styles.saveButtonText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    ...Typography.h3,
    flex: 1,
    textAlign: "center",
  },
  content: {
    flex: 1,
  },
  contentInner: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  section: {
    marginBottom: Spacing.lg,
  },
  label: {
    ...Typography.body1,
    fontWeight: "600",
    marginBottom: Spacing.sm,
  },
  helpText: {
    ...Typography.body2,
    color: Colors.text.secondary,
    marginTop: 4,
  },
  input: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    ...Typography.body1,
    color: Colors.text.primary,
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  optionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  option: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface.primary,
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  optionSelected: {
    backgroundColor: Colors.primary.DEFAULT,
    borderColor: Colors.primary.DEFAULT,
  },
  optionText: {
    ...Typography.body2,
    color: Colors.text.primary,
  },
  optionTextSelected: {
    color: Colors.text.primary,
    fontWeight: "600",
  },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  switchTextWrap: {
    flex: 1,
  },
  errorBanner: {
    marginBottom: Spacing.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.error.dark + "33",
    borderWidth: 1,
    borderColor: Colors.error.DEFAULT + "55",
  },
  errorBannerText: {
    ...Typography.body2,
    color: Colors.error.DEFAULT,
    textAlign: "center",
  },
  saveButton: {
    backgroundColor: Colors.primary.DEFAULT,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    alignItems: "center",
    marginTop: Spacing.lg,
    ...Shadows.medium,
  },
  saveButtonDisabled: {
    opacity: 0.7,
  },
  saveButtonText: {
    ...Typography.body1,
    fontWeight: "700",
    color: Colors.text.primary,
  },
});
