import { useEffect, useRef, useState } from "react";
import { Text, View } from "@tamagui/core";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  TextInput,
  View as RNView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Btn, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { IconBack, iconDefaults } from "@/ui/components/icons";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import type {
  ProfileGender,
  ProfilePageHeightUnit,
  ProfilePageWeightUnit,
} from "@/domain/models/profilePage";

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

/**
 * Sex options for the TDEE calculator. Framed as a metabolic input, not a
 * gender-identity statement — "Prefer not to say" persists as `other`, which
 * the calculator maps to the midpoint BMR baseline (nutrition.service).
 */
const GENDER_OPTIONS: { value: ProfileGender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Prefer not to say" },
];

const CM_PER_INCH = 2.54;

function cmToFeetInches(cmValue: number): { feet: number; inches: number } {
  const totalInches = cmValue / CM_PER_INCH;
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches - feet * 12;
  return { feet, inches };
}

function feetInchesToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * CM_PER_INCH;
}

function capitalize(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export type EditProfilePresenterProps = {
  fullName: string;
  fitnessLevel: EditProfileFitnessLevel;
  /** ISO date string (YYYY-MM-DD) or "" when unset. */
  dateOfBirth: string;
  /** Sex for the TDEE calc; null when never set (no chip selected). */
  gender: ProfileGender | null;
  /** Height in cm, as the raw text-field string; "" when unset. */
  heightCm: string;
  /** Persisted display-unit preference for the weigh-in sheet's weight
   *  toggle. Independent of `heightUnit` — users routinely mix units. */
  weightUnit: ProfilePageWeightUnit;
  /** Persisted display-unit preference for the height field below — this
   *  directly controls which input(s) render (cm vs ft+in), not just a
   *  seed for local state. */
  heightUnit: ProfilePageHeightUnit;
  isProfilePublic: boolean;
  isSaving: boolean;
  isLoadingInitial: boolean;
  errorMessage: string | null;

  onFullNameChange: (value: string) => void;
  onFitnessLevelChange: (value: EditProfileFitnessLevel) => void;
  onDateOfBirthChange: (value: string) => void;
  onGenderChange: (value: ProfileGender) => void;
  onHeightCmChange: (value: string) => void;
  onWeightUnitChange: (value: ProfilePageWeightUnit) => void;
  onHeightUnitChange: (value: ProfilePageHeightUnit) => void;
  onIsProfilePublicChange: (value: boolean) => void;
  onSave: () => void;
  onBack: () => void;
  /** Current avatar URL (null when no avatar set). */
  avatarUrl?: string | null;
  /** Cache-bust key for the avatar image. */
  avatarCacheKey?: number;
  /** True while the avatar picker/upload is in flight. */
  isAvatarWorking?: boolean;
  /** Opens the avatar picker sheet (Camera / Library / Remove / Cancel). */
  onSelectAvatar?: () => void;
};

export function EditProfilePresenter({
  fullName,
  fitnessLevel,
  dateOfBirth,
  gender,
  heightCm,
  weightUnit,
  heightUnit,
  isProfilePublic,
  isSaving,
  isLoadingInitial,
  errorMessage,
  avatarUrl,
  avatarCacheKey = 0,
  isAvatarWorking = false,
  onSelectAvatar,
  onFullNameChange,
  onFitnessLevelChange,
  onDateOfBirthChange,
  onGenderChange,
  onHeightCmChange,
  onWeightUnitChange,
  onHeightUnitChange,
  onIsProfilePublicChange,
  onSave,
  onBack,
}: EditProfilePresenterProps) {
  const insets = useSafeAreaInsets();

  // Raw text backing the feet/inches inputs when `heightUnit === "ftin"`.
  // Canonical value is always cm (matches the `heightCm` prop/DB column);
  // these are a display convenience derived from it, never a second source
  // of truth. `heightUnit` itself is a controlled prop (persisted from the
  // profile) — no local mirror/seed-effect needed for the toggle itself,
  // only for re-deriving feet/inches text whenever we (re-)enter ft/in mode
  // from cm mode or from first mount.
  const [feetText, setFeetText] = useState("");
  const [inchesText, setInchesText] = useState("");

  const seedFeetInchesFromCm = (cmString: string) => {
    const cmNum = parseFloat(cmString);
    if (Number.isNaN(cmNum)) {
      setFeetText("");
      setInchesText("");
    } else {
      const { feet, inches } = cmToFeetInches(cmNum);
      setFeetText(String(feet));
      setInchesText(inches.toFixed(1));
    }
  };

  const prevHeightUnitRef = useRef<ProfilePageHeightUnit | null>(null);
  useEffect(() => {
    if (isLoadingInitial) return;
    if (heightUnit === "ftin" && prevHeightUnitRef.current !== "ftin") {
      seedFeetInchesFromCm(heightCm);
    }
    prevHeightUnitRef.current = heightUnit;
    // `heightCm` deliberately omitted — this re-derives feet/inches only on
    // an ftin-mode ENTRY (mount-while-ftin, or a cm→ftin toggle), not on
    // every cm change, so it doesn't fight the ft/in fields' own typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingInitial, heightUnit]);

  const commitFeetInches = (feetStr: string, inchesStr: string) => {
    const trimmedFeet = feetStr.trim();
    const trimmedInches = inchesStr.trim();
    if (trimmedFeet === "" && trimmedInches === "") {
      onHeightCmChange("");
      return;
    }
    const feet = trimmedFeet === "" ? 0 : parseFloat(trimmedFeet);
    const inches = trimmedInches === "" ? 0 : parseFloat(trimmedInches);
    if (Number.isNaN(feet) || Number.isNaN(inches)) return;
    onHeightCmChange(feetInchesToCm(feet, inches).toFixed(1));
  };
  const onFeetChange = (text: string) => {
    setFeetText(text);
    commitFeetInches(text, inchesText);
  };
  const onInchesChange = (text: string) => {
    setInchesText(text);
    commitFeetInches(feetText, text);
  };

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

          {/* Avatar */}
          {onSelectAvatar ? (
            <Pressable
              onPress={onSelectAvatar}
              disabled={isAvatarWorking || isSaving}
              accessibilityRole="button"
              accessibilityLabel="Change profile picture"
              testID="edit-profile-avatar"
              style={({ pressed }) => ({
                opacity: pressed ? 0.8 : 1,
                alignItems: "center",
                marginBottom: 24,
              })}
            >
              <RNView
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 9999,
                  backgroundColor: "#171922",
                  borderWidth: 2,
                  borderColor: "#23252F",
                  alignItems: "center",
                  justifyContent: "center",
                  overflow: "hidden",
                }}
              >
                {avatarUrl ? (
                  <Image
                    key={`${avatarUrl}-${avatarCacheKey}`}
                    source={{
                      uri: `${avatarUrl}${avatarUrl.includes("?") ? "&" : "?"}_cb=${avatarCacheKey}`,
                    }}
                    style={{ width: 76, height: 76, borderRadius: 9999 }}
                    resizeMode="cover"
                    testID="edit-profile-avatar-image"
                  />
                ) : (
                  <Text
                    fontFamily="$display"
                    fontWeight="700"
                    fontSize={28}
                    color="$text3"
                  >
                    {fullName.trim().charAt(0).toUpperCase() || "–"}
                  </Text>
                )}
              </RNView>
              <Text
                fontFamily="$body"
                fontSize={12}
                color="$primary"
                marginTop={8}
              >
                {isAvatarWorking ? "Uploading…" : "Change photo"}
              </Text>
            </Pressable>
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
            <Text fontFamily="$body" fontSize={11} color="$text3" marginTop={4}>
              Used to show your age on your profile.
            </Text>
          </View>

          {/* Sex — TDEE calculator input (M9). Framed as a metabolic input. */}
          <View marginBottom={20}>
            <FieldLabel>Sex</FieldLabel>
            <View flexDirection="row" flexWrap="wrap" gap={8}>
              {GENDER_OPTIONS.map((option) => {
                const selected = option.value === gender;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => onGenderChange(option.value)}
                    disabled={isSaving}
                    testID={`edit-profile-gender-${option.value}`}
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
                        {option.label}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Text fontFamily="$body" fontSize={11} color="$text3" marginTop={4}>
              Used only to estimate your daily calorie targets.
            </Text>
          </View>

          {/* Height — TDEE calculator input (M9). Canonical value is always
              cm (matches the `heightCm` prop/DB column); ft+in is a display
              convenience converted at the toggle boundary. */}
          <View marginBottom={20}>
            <View
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              marginBottom={8}
            >
              <FieldLabel>Height</FieldLabel>
              <View
                flexDirection="row"
                gap={4}
                backgroundColor="$surface3"
                borderRadius={999}
                padding={3}
              >
                {(["cm", "ftin"] as const).map((u) => {
                  const on = heightUnit === u;
                  return (
                    <Pressable
                      key={u}
                      onPress={() => onHeightUnitChange(u)}
                      disabled={isSaving}
                      testID={`edit-profile-height-unit-${u}`}
                      accessibilityLabel={u === "cm" ? "Use cm" : "Use ft/in"}
                    >
                      <View
                        paddingVertical={6}
                        paddingHorizontal={12}
                        borderRadius={999}
                        backgroundColor={on ? "$primary" : "transparent"}
                      >
                        <Text
                          fontWeight="700"
                          fontSize={11.5}
                          color={on ? "$primaryInk" : "$text3"}
                        >
                          {u === "cm" ? "CM" : "FT/IN"}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {heightUnit === "cm" ? (
              <TextInput
                style={inputStyle}
                value={heightCm}
                onChangeText={onHeightCmChange}
                placeholder="e.g. 178"
                placeholderTextColor="#8A8A98"
                keyboardType="number-pad"
                editable={!isSaving}
                testID="edit-profile-height"
              />
            ) : (
              <View flexDirection="row" gap={10}>
                <View flex={1}>
                  <TextInput
                    style={inputStyle}
                    value={feetText}
                    onChangeText={onFeetChange}
                    placeholder="ft"
                    placeholderTextColor="#8A8A98"
                    keyboardType="number-pad"
                    editable={!isSaving}
                    testID="edit-profile-height-feet"
                  />
                </View>
                <View flex={1}>
                  <TextInput
                    style={inputStyle}
                    value={inchesText}
                    onChangeText={onInchesChange}
                    placeholder="in"
                    placeholderTextColor="#8A8A98"
                    keyboardType="decimal-pad"
                    editable={!isSaving}
                    testID="edit-profile-height-inches"
                  />
                </View>
              </View>
            )}
            <Text fontFamily="$body" fontSize={11} color="$text3" marginTop={4}>
              Used only to estimate your daily calorie targets.
            </Text>
          </View>

          {/* Weight unit — persisted preference for the weigh-in sheet's
              kg/lb toggle. Independent of height's unit below: users
              routinely mix units (e.g. kg + ft/in). */}
          <View marginBottom={20}>
            <FieldLabel>Weight Unit</FieldLabel>
            <View flexDirection="row" flexWrap="wrap" gap={8}>
              {[
                { value: "kg" as const, label: "Kilograms (kg)" },
                { value: "lb" as const, label: "Pounds (lb)" },
              ].map((option) => {
                const selected = option.value === weightUnit;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => onWeightUnitChange(option.value)}
                    disabled={isSaving}
                    testID={`edit-profile-weight-unit-${option.value}`}
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
                        {option.label}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
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
