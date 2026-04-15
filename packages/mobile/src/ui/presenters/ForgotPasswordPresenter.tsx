import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
} from "react-native";
import { View } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import { Text, Input, Button, Column, Row } from "@/ui/components";

type ForgotPasswordPresenterProps = {
  email: string;
  onEmailChange: (text: string) => void;
  onSubmit: () => void;
  onBackToSignIn: () => void;
  isLoading: boolean;
  error: string | null;
  isSuccess: boolean;
};

export function ForgotPasswordPresenter({
  email,
  onEmailChange,
  onSubmit,
  onBackToSignIn,
  isLoading,
  error,
  isSuccess,
}: ForgotPasswordPresenterProps) {
  return (
    <View
      flex={1}
      backgroundColor="$background"
      testID="forgot-password-screen"
    >
      <LinearGradient
        colors={[
          "rgba(0, 212, 255, 0.06)",
          "rgba(0, 212, 255, 0.02)",
          "transparent",
        ]}
        style={styles.topGlow}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View flex={1} justifyContent="center" paddingHorizontal="$xl">
          {/* Header */}
          <View alignItems="center" marginBottom="$2xl">
            <Text variant="h2" align="center" testID="screen-title">
              Reset Password
            </Text>
            <Text variant="bodySmall" muted align="center" marginTop="$sm">
              {isSuccess
                ? "Check your email for a reset link"
                : "Enter your email and we'll send you a reset link"}
            </Text>
          </View>

          {isSuccess ? (
            /* Success state */
            <Column gap="lg" alignItems="center">
              <View
                width={64}
                height={64}
                borderRadius="$full"
                backgroundColor="rgba(34, 197, 94, 0.1)"
                alignItems="center"
                justifyContent="center"
                borderWidth={1}
                borderColor="rgba(34, 197, 94, 0.2)"
              >
                <Text variant="h2" color="$success" testID="success-icon">
                  ✓
                </Text>
              </View>
              <Text
                variant="body"
                muted
                align="center"
                testID="success-message"
              >
                We&apos;ve sent a password reset link to your email address.
              </Text>
              <View width="100%" marginTop="$base">
                <Button
                  label="Back to Sign In"
                  onPress={onBackToSignIn}
                  variant="outline"
                  fullWidth
                  size="lg"
                  testID="back-to-sign-in"
                />
              </View>
            </Column>
          ) : (
            /* Form state */
            <>
              {/* Error */}
              {error && (
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
              )}

              <Input
                label="Email"
                placeholder="your@email.com"
                value={email}
                onChangeText={onEmailChange}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
                testID="email"
              />

              <View height="$lg" />

              <Button
                label={isLoading ? "Sending..." : "Send Reset Link"}
                onPress={onSubmit}
                isLoading={isLoading}
                isDisabled={isLoading}
                fullWidth
                size="lg"
                testID="submit"
              />

              {/* Back to sign in */}
              <View alignItems="center" marginTop="$2xl">
                <Pressable
                  onPress={onBackToSignIn}
                  testID="back-to-sign-in-link"
                  hitSlop={8}
                >
                  <Row gap="xs">
                    <Text variant="bodySmall" color="$primary" fontWeight="500">
                      ← Back to Sign In
                    </Text>
                  </Row>
                </Pressable>
              </View>
            </>
          )}
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
    height: 350,
  },
});
