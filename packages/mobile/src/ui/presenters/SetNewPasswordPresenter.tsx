import { KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { View } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn } from "react-native-reanimated";
import { Text, Input, Button, Column } from "@/ui/components";
import { useStaggeredEntry } from "@/ui/hooks/useStaggeredEntry";

type SetNewPasswordPresenterProps = {
  password: string;
  confirmPassword: string;
  onPasswordChange: (text: string) => void;
  onConfirmPasswordChange: (text: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  error: string | null;
  isSuccess: boolean;
};

/**
 * Set-new-password screen — shown after a recovery link establishes a session
 * (see [[password-recovery]]). Mirrors the ForgotPassword auth-screen design
 * (glow backdrop, staggered entry, shared Input/Button) since the legacy app
 * had no equivalent screen to port.
 */
export function SetNewPasswordPresenter({
  password,
  confirmPassword,
  onPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
  isLoading,
  error,
  isSuccess,
}: SetNewPasswordPresenterProps) {
  const headerStyle = useStaggeredEntry(0);
  const formStyle = useStaggeredEntry(1);
  const ctaStyle = useStaggeredEntry(2);

  return (
    <View
      flex={1}
      backgroundColor="$background"
      testID="set-new-password-screen"
    >
      <LinearGradient
        colors={[
          "rgba(0, 212, 255, 0.08)",
          "rgba(0, 212, 255, 0.03)",
          "transparent",
        ]}
        style={styles.topGlow}
      />
      <LinearGradient
        colors={["rgba(0, 212, 255, 0.04)", "transparent"]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.secondaryGlow}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View flex={1} justifyContent="center" paddingHorizontal="$xl">
          {/* Header */}
          <Animated.View style={headerStyle}>
            <View alignItems="center" marginBottom={40}>
              <Text variant="h2" align="center" testID="screen-title">
                Set a New Password
              </Text>
              <Text variant="bodySmall" muted align="center" marginTop="$sm">
                {isSuccess
                  ? "Password updated — signing you in"
                  : "Choose a new password for your account"}
              </Text>
            </View>
          </Animated.View>

          {/* Error */}
          {error && (
            <Animated.View entering={FadeIn.duration(200)}>
              <View
                backgroundColor="rgba(239, 68, 68, 0.1)"
                borderRadius="$md"
                paddingHorizontal="$base"
                paddingVertical="$md"
                marginBottom="$base"
                borderWidth={1}
                borderColor="rgba(239, 68, 68, 0.2)"
              >
                <Text
                  variant="bodySmall"
                  color="$error"
                  align="center"
                  testID="error-message"
                >
                  {error}
                </Text>
              </View>
            </Animated.View>
          )}

          <Animated.View style={formStyle}>
            <Column gap="base">
              <Input
                label="New password"
                placeholder="Enter a new password"
                value={password}
                onChangeText={onPasswordChange}
                secureTextEntry
                autoComplete="password-new"
                testID="password"
              />
              <Input
                label="Confirm password"
                placeholder="Re-enter your new password"
                value={confirmPassword}
                onChangeText={onConfirmPasswordChange}
                secureTextEntry
                autoComplete="password-new"
                testID="confirm-password"
              />
            </Column>
          </Animated.View>

          <View height={28} />

          <Animated.View style={ctaStyle}>
            <Button
              label={isLoading ? "Saving..." : "Save Password"}
              onPress={onSubmit}
              isLoading={isLoading}
              isDisabled={isLoading}
              fullWidth
              size="lg"
              testID="submit"
            />
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  topGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 400,
  },
  secondaryGlow: {
    position: "absolute",
    top: 0,
    left: "20%",
    right: "20%",
    height: 250,
    borderRadius: 200,
    opacity: 0.5,
  },
});
