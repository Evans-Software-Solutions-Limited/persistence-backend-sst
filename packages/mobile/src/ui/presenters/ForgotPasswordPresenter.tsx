import { useEffect } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
} from "react-native";
import { View } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withDelay,
  Easing,
  FadeIn,
} from "react-native-reanimated";
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

const STAGGER = 70;
const ENTER_DURATION = 420;
const ENTER_EASING = Easing.out(Easing.cubic);

function useStaggeredEntry(index: number) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(18);

  useEffect(() => {
    const delay = index * STAGGER;
    opacity.value = withDelay(
      delay,
      withTiming(1, { duration: ENTER_DURATION, easing: ENTER_EASING }),
    );
    translateY.value = withDelay(
      delay,
      withTiming(0, { duration: ENTER_DURATION, easing: ENTER_EASING }),
    );
  }, [index, opacity, translateY]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));
}

export function ForgotPasswordPresenter({
  email,
  onEmailChange,
  onSubmit,
  onBackToSignIn,
  isLoading,
  error,
  isSuccess,
}: ForgotPasswordPresenterProps) {
  const headerStyle = useStaggeredEntry(0);
  const formStyle = useStaggeredEntry(1);
  const ctaStyle = useStaggeredEntry(2);
  const footerStyle = useStaggeredEntry(3);

  return (
    <View
      flex={1}
      backgroundColor="$background"
      testID="forgot-password-screen"
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
                Reset Password
              </Text>
              <Text variant="bodySmall" muted align="center" marginTop="$sm">
                {isSuccess
                  ? "Check your email for a reset link"
                  : "Enter your email and we\u2019ll send you a reset link"}
              </Text>
            </View>
          </Animated.View>

          {isSuccess ? (
            /* Success state */
            <Animated.View entering={FadeIn.duration(300)}>
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
            </Animated.View>
          ) : (
            /* Form state */
            <>
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
              </Animated.View>

              <View height={28} />

              <Animated.View style={ctaStyle}>
                <Button
                  label={isLoading ? "Sending..." : "Send Reset Link"}
                  onPress={onSubmit}
                  isLoading={isLoading}
                  isDisabled={isLoading}
                  fullWidth
                  size="lg"
                  testID="submit"
                />
              </Animated.View>

              {/* Back to sign in */}
              <Animated.View style={footerStyle}>
                <View alignItems="center" marginTop={36}>
                  <Pressable
                    onPress={onBackToSignIn}
                    testID="back-to-sign-in-link"
                    hitSlop={8}
                  >
                    <Row gap="xs">
                      <Text
                        variant="bodySmall"
                        color="$primary"
                        fontWeight="500"
                      >
                        ← Back to Sign In
                      </Text>
                    </Row>
                  </Pressable>
                </View>
              </Animated.View>
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
