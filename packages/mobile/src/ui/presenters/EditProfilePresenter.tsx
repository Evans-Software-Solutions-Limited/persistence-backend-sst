import { Text, View } from "@tamagui/core";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Btn, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { IconBack, iconDefaults } from "@/ui/components/icons";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";

/**
 * Edit Profile screen — pure presenter. Shell-refreshed for 08-profile-
 * settings (STORY-008 AC 8.1): new <HeaderBar> + <Btn> + design tokens
 * replace the legacy Ionicons/StyleSheet chrome. Behaviour unchanged from
 * the M6 port (fullName + fitnessLevel + isProfilePublic), plus the new DOB
 * field (STORY-010 AC 10.3 — store DOB, derive age elsewhere).
 *
 * insets.top is applied to the header so content clears the notch (the
 * (tabs) layout's headerShown:false removed the native top inset — see
 * 14-navigation/SMOKE_TEST.md top-inset known-issue).
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
  /** ISO date string (YYYY-MM-DD) or "" when unset. */
  dateOfBirth: string;
  isProfilePublic: boolean;
  isSaving: boolean;
  isLoadingInitial: boolean;
  errorMessage: string | null;

  onFullNameChange: (value: string) => void;
  onFitnessLevelChange: (value: EditProfileFitnessLevel) => void;
  onDateOfBirthChange: (value: string) => void;
  onIsProfilePublicChange: (value: boolean) => void;
  onSave: () => void;
  onBack: () => void;
};

export function EditProfilePresenter({
  fullName,
  fitnessLevel,
  dateOfBirth,
  isProfilePublic,
  isSaving,
  isLoadingInitial,
  errorMessage,
  onFullNameChange,
  onFitnessLevelChange,
  onDateOfBirthChange,
  onIsProfilePublicChange,
  onSave,
  onBack,
}: EditProfilePresenterProps) {
  const insets = useSafeAreaInsets();

  if (isLoadingInitial) {
    return (
      <View
        flex={1}
        backgroundColor="$bg"
        alignItems="center"
        justifyContent="center"
        paddingTop={insets.top}
        testID="edit-profile-screen"
      >
        <PLogoDrawLoader />
      </View>
    );
  }

  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="edit-profile-screen"
    >
      <HeaderBar
        title="Edit Profile"
        leading={
          <IconBtn
            icon={<IconBack {...iconDefaults({ size: 20 })} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Go back"
            testID="edit-profile-back"
          />
        }
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingTop: 12,
            paddingBottom: 40 + insets.bottom,
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {errorMessage ? (
            <View
              marginBottom={16}
              paddingHorizontal={14}
              paddingVertical={10}
              borderRadius={12}
              backgroundColor="$errorDim"
              borderWidth={1}
              borderColor="$error"
              testID="edit-profile-error"
            >
              <Text
                fontFamily="$body"
                fontSize={13}
                color="$error"
                textAlign="center"
              >
                {errorMessage}
              </Text>
            </View>
          ) : null}

          {/* Full Name */}
          <View marginBottom={20}>
            <FieldLabel>Full Name</FieldLabel>
            <TextInput
              style={inputStyle}
              value={fullName}
              onChangeText={onFullNameChange}
              placeholder="Enter your full name"
              placeholderTextColor="#8A8A98"
              autoCapitalize="words"
              autoCorrect={false}
              editable={!isSaving}
              testID="edit-profile-full-name"
            />
          </View>

          {/* Date of Birth (STORY-010) */}
          <View marginBottom={20}>
            <FieldLabel>Date of Birth</FieldLabel>
            <TextInput
              style={inputStyle}
              value={dateOfBirth}
              onChangeText={onDateOfBirthChange}
              placeholder="YYYY-MM-DD"
              placeholderTextColor="#8A8A98"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
              editable={!isSaving}
              testID="edit-profile-dob"
            />
            <Text
              fontFamily="$body"
              fontSize={11}
              color="$text3"
              marginTop={4}
            >
              Used to show your age on your profile.
            </Text>
          </View>

          {/* Fitness Level */}
          <View marginBottom={20}>
            <FieldLabel>Fitness Level</FieldLabel>
            <View flexDirection="row" flexWrap="wrap" gap={8}>
              {FITNESS_LEVELS.map((level) => {
                const selected = level === fitnessLevel;
                return (
                  <Pressable
                    key={level}
                    onPress={() => onFitnessLevelChange(level)}
                    disabled={isSaving}
                    testID={`edit-profile-fitness-${level}`}
                    style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
                  >
                    <View
                      paddingHorizontal={16}
                      paddingVertical={10}
                      borderRadius={12}
                      backgroundColor={selected ? "$primaryDim" : "$surface2"}
                      borderWidth={1}
                      borderColor={selected ? "$primary" : "$border"}
                    >
                      <Text
                        fontFamily="$display"
                        fontSize={13}
                        fontWeight={selected ? "700" : "400"}
                        color={selected ? "$primary" : "$text2"}
                      >
                        {capitalize(level)}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Public Profile */}
          <View marginBottom={20}>
            <View flexDirection="row" alignItems="center" gap={14}>
              <View flex={1}>
                <FieldLabel>Public Profile</FieldLabel>
                <Text fontFamily="$body" fontSize={12} color="$text3">
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

          <View marginTop={8}>
            <Btn
              variant="filled"
              tone="primary"
              size="lg"
              full
              onPress={onSave}
              disabled={isSaving}
              testID="edit-profile-save"
            >
              {isSaving ? "Saving…" : "Save Changes"}
            </Btn>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function FieldLabel({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$display"
      fontWeight="600"
      fontSize={14}
      color="$text"
      marginBottom={8}
    >
      {children}
    </Text>
  );
}

const inputStyle = {
  backgroundColor: "#171922",
  borderRadius: 12,
  paddingHorizontal: 14,
  paddingVertical: 12,
  fontSize: 15,
  color: "#F4F4F6",
  borderWidth: 1,
  borderColor: "#23252F",
} as const;
