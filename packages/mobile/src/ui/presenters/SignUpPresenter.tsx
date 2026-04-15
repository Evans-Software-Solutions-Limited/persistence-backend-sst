import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  ScrollView,
} from "react-native";
import { View, Text as TamaguiText } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import type { OAuthProvider } from "@/domain/ports/auth.port";
import { Text, Input, Button, Column, Row, OAuthButton } from "@/ui/components";

type SignUpPresenterProps = {
  email: string;
  password: string;
  confirmPassword: string;
  onEmailChange: (text: string) => void;
  onPasswordChange: (text: string) => void;
  onConfirmPasswordChange: (text: string) => void;
  onSubmit: () => void;
  onOAuth: (provider: OAuthProvider) => void;
  onSignIn: () => void;
  isLoading: boolean;
  oauthLoading: OAuthProvider | null;
  error: string | null;
  confirmationSent: boolean;
};

export function SignUpPresenter({
  email,
  password,
  confirmPassword,
  onEmailChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
  onOAuth,
  onSignIn,
  isLoading,
  oauthLoading,
  error,
  confirmationSent,
}: SignUpPresenterProps) {
  const isAnyLoading = isLoading || oauthLoading !== null;

  return (
    <View flex={1} backgroundColor="$background" testID="sign-up-screen">
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
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View flex={1} justifyContent="center" paddingHorizontal="$xl">
            {/* Brand mark */}
            <View alignItems="center" marginBottom="$2xl">
              <TamaguiText
                fontFamily="$heading"
                fontSize={34}
                fontWeight="700"
                color="$color"
                letterSpacing={6}
              >
                PERSISTENCE
              </TamaguiText>
              <Text
                variant="h3"
                align="center"
                marginTop="$lg"
                testID="screen-title"
              >
                Create Account
              </Text>
              <Text variant="bodySmall" muted align="center" marginTop="$xs">
                Start tracking your progress
              </Text>
            </View>

            {confirmationSent ? (
              /* Email confirmation success state */
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
                  testID="confirmation-message"
                >
                  Check your email to confirm your account, then sign in.
                </Text>
                <View width="100%" marginTop="$base">
                  <Button
                    label="Back to Sign In"
                    onPress={onSignIn}
                    variant="outline"
                    fullWidth
                    size="lg"
                    testID="back-to-sign-in"
                  />
                </View>
              </Column>
            ) : (
              <>
                {/* OAuth */}
                <Column gap="md">
                  <OAuthButton
                    label="Continue with Google"
                    onPress={() => onOAuth("google")}
                    isLoading={oauthLoading === "google"}
                    isDisabled={isAnyLoading}
                    icon="G"
                    testID="google-oauth"
                  />
                  {Platform.OS === "ios" && (
                    <OAuthButton
                      label="Continue with Apple"
                      onPress={() => onOAuth("apple")}
                      isLoading={oauthLoading === "apple"}
                      isDisabled={isAnyLoading}
                      icon={"\uF8FF"}
                      testID="apple-oauth"
                    />
                  )}
                </Column>

                {/* Divider */}
                <Row gap="base" marginVertical="$xl">
                  <View
                    flex={1}
                    height={1}
                    backgroundColor="$borderColor"
                    opacity={0.3}
                  />
                  <TamaguiText
                    fontFamily="$body"
                    fontSize={11}
                    color="$colorMuted"
                    textTransform="uppercase"
                    letterSpacing={3}
                    fontWeight="500"
                  >
                    or
                  </TamaguiText>
                  <View
                    flex={1}
                    height={1}
                    backgroundColor="$borderColor"
                    opacity={0.3}
                  />
                </Row>

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

                {/* Form */}
                <Column gap="base">
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
                  <Input
                    label="Password"
                    placeholder="Create a password"
                    value={password}
                    onChangeText={onPasswordChange}
                    secureTextEntry
                    autoComplete="new-password"
                    testID="password"
                  />
                  <Input
                    label="Confirm Password"
                    placeholder="Confirm your password"
                    value={confirmPassword}
                    onChangeText={onConfirmPasswordChange}
                    secureTextEntry
                    autoComplete="new-password"
                    testID="confirm-password"
                  />
                </Column>

                <View height="$lg" />

                <Button
                  label={isLoading ? "Creating account..." : "Create Account"}
                  onPress={onSubmit}
                  isLoading={isLoading}
                  isDisabled={isAnyLoading}
                  fullWidth
                  size="lg"
                  testID="sign-up"
                />

                {/* Sign in link */}
                <View alignItems="center" marginTop="$2xl">
                  <Pressable
                    onPress={onSignIn}
                    testID="sign-in-link"
                    hitSlop={8}
                  >
                    <Row gap="xs">
                      <Text variant="bodySmall" muted>
                        Already have an account?
                      </Text>
                      <Text
                        variant="bodySmall"
                        color="$primary"
                        fontWeight="600"
                      >
                        Sign In
                      </Text>
                    </Row>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  topGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 350,
  },
});
