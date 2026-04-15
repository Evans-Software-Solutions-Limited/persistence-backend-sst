import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
} from "react-native";
import { View, Text as TamaguiText } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import type { OAuthProvider } from "@/domain/ports/auth.port";
import { Text, Input, Button, Column, Row } from "@/ui/components";

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

  return (
    <View flex={1} backgroundColor="$background" testID="sign-in-screen">
      {/* Ambient glow */}
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
          {/* Brand mark */}
          <View alignItems="center" marginBottom="$3xl">
            <View
              width={40}
              height={3}
              backgroundColor="$primary"
              borderRadius="$full"
              marginBottom="$base"
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
              placeholder="Enter your password"
              value={password}
              onChangeText={onPasswordChange}
              secureTextEntry
              autoComplete="password"
              testID="password"
            />
          </Column>

          {/* Forgot password */}
          <View alignItems="flex-end" marginTop="$sm" marginBottom="$lg">
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

          {/* Sign in */}
          <Button
            label={isLoading ? "Signing in..." : "Sign In"}
            onPress={onSubmit}
            isLoading={isLoading}
            isDisabled={isAnyLoading}
            fullWidth
            size="lg"
            testID="sign-in"
          />

          {/* Sign up link */}
          <View alignItems="center" marginTop="$2xl">
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
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function OAuthButton({
  label,
  onPress,
  isLoading,
  isDisabled,
  icon,
  testID,
}: {
  label: string;
  onPress: () => void;
  isLoading: boolean;
  isDisabled: boolean;
  icon: string;
  testID: string;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      justifyContent="center"
      height={52}
      borderRadius="$lg"
      borderWidth={1}
      borderColor="$borderColor"
      backgroundColor="$surface"
      opacity={isDisabled ? 0.5 : 1}
      pressStyle={{ opacity: 0.7, scale: 0.98 }}
      onPress={isDisabled ? undefined : onPress}
      testID={testID}
      gap="$md"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {isLoading ? (
        <TamaguiText
          fontFamily="$body"
          fontSize={15}
          color="$colorSecondary"
          fontWeight="500"
        >
          Connecting...
        </TamaguiText>
      ) : (
        <>
          <TamaguiText
            fontFamily="$body"
            fontSize={18}
            fontWeight="700"
            color="$color"
          >
            {icon}
          </TamaguiText>
          <TamaguiText
            fontFamily="$body"
            fontSize={15}
            color="$color"
            fontWeight="500"
          >
            {label}
          </TamaguiText>
        </>
      )}
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
