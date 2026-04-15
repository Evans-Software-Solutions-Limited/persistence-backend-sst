import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
} from "react-native";
import { View, Text as TamaguiText } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { FadeIn } from "react-native-reanimated";
import type { OAuthProvider } from "@/domain/ports/auth.port";
import { Text, Input, Button, Column, Row, OAuthButton } from "@/ui/components";
import { useStaggeredEntry } from "@/ui/hooks/useStaggeredEntry";

type SignInPresenterProps = {
  email: string;
  password: string;
  onEmailChange: (text: string) => void;
  onPasswordChange: (text: string) => void;
  onSubmit: () => void;
  onOAuth: (provider: OAuthProvider) => void;
  onForgotPassword: () => void;
  onSignUp: () => void;
  isLoading: boolean;
  oauthLoading: OAuthProvider | null;
  error: string | null;
};

export function SignInPresenter({
  email,
  password,
  onEmailChange,
  onPasswordChange,
  onSubmit,
  onOAuth,
  onForgotPassword,
  onSignUp,
  isLoading,
  oauthLoading,
  error,
}: SignInPresenterProps) {
  const isAnyLoading = isLoading || oauthLoading !== null;

  const brandStyle = useStaggeredEntry(0);
  const oauthStyle = useStaggeredEntry(1);
  const dividerStyle = useStaggeredEntry(2);
  const formStyle = useStaggeredEntry(3);
  const ctaStyle = useStaggeredEntry(4);
  const footerStyle = useStaggeredEntry(5);

  return (
    <View flex={1} backgroundColor="$background" testID="sign-in-screen">
      {/* Ambient glow — two-layer for depth */}
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
          {/* Brand mark */}
          <Animated.View style={brandStyle}>
            <View alignItems="center" marginBottom={56}>
              <View
                width={40}
                height={3}
                backgroundColor="$primary"
                borderRadius="$full"
                marginBottom="$md"
                opacity={0.8}
              />
              <TamaguiText
                fontFamily="$heading"
                fontSize={34}
                fontWeight="700"
                color="$color"
                letterSpacing={6}
                testID="brand-title"
              >
                PERSISTENCE
              </TamaguiText>
              <Text
                variant="bodySmall"
                muted
                align="center"
                marginTop="$sm"
                letterSpacing={1.5}
              >
                TRACK. PUSH. REPEAT.
              </Text>
            </View>
          </Animated.View>

          {/* OAuth */}
          <Animated.View style={oauthStyle}>
            <Column gap="base">
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
                  marginTop="md"
                  label="Continue with Apple"
                  onPress={() => onOAuth("apple")}
                  isLoading={oauthLoading === "apple"}
                  isDisabled={isAnyLoading}
                  icon={"\uF8FF"}
                  testID="apple-oauth"
                />
              )}
            </Column>
          </Animated.View>

          {/* Divider */}
          <Animated.View style={dividerStyle}>
            <Row gap="base" marginVertical={28}>
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

          {/* Form */}
          <Animated.View style={formStyle}>
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
                placeholder="Enter your password"
                value={password}
                onChangeText={onPasswordChange}
                secureTextEntry
                autoComplete="password"
                testID="password"
              />
            </Column>

            {/* Forgot password */}
            <View alignItems="flex-end" marginTop="$sm" marginBottom={28}>
              <Pressable
                onPress={onForgotPassword}
                testID="forgot-password-link"
                hitSlop={8}
              >
                <Text variant="caption" color="$primary" fontWeight="500">
                  Forgot password?
                </Text>
              </Pressable>
            </View>
          </Animated.View>

          {/* Sign in */}
          <Animated.View style={ctaStyle}>
            <Button
              label={isLoading ? "Signing in..." : "Sign In"}
              onPress={onSubmit}
              isLoading={isLoading}
              isDisabled={isAnyLoading}
              fullWidth
              size="lg"
              testID="sign-in"
            />
          </Animated.View>

          {/* Sign up link */}
          <Animated.View style={footerStyle}>
            <View alignItems="center" marginTop={36}>
              <Pressable onPress={onSignUp} testID="sign-up-link" hitSlop={8}>
                <Row gap="xs">
                  <Text variant="bodySmall" muted>
                    Don&apos;t have an account?
                  </Text>
                  <Text variant="bodySmall" color="$primary" fontWeight="600">
                    Sign Up
                  </Text>
                </Row>
              </Pressable>
            </View>
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
