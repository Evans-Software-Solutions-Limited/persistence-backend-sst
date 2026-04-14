import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from "react-native";
import { View, Text as TamaguiText } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import type { OAuthProvider } from "../../src/domain/ports/auth.port";
import { useAuth } from "../../src/ui/hooks/useAuth";
import { Text, Input, Button, Column } from "../../src/ui/components";

export default function SignIn() {
  const { signIn, signInWithOAuth } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);

  const handleSignIn = async () => {
    if (!email || !password) {
      Alert.alert("Error", "Please enter email and password");
      return;
    }

    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign in failed";
      Alert.alert("Error", message);
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = async (provider: OAuthProvider) => {
    setOauthLoading(provider);
    try {
      await signInWithOAuth(provider);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign in failed";
      Alert.alert("Error", message);
    } finally {
      setOauthLoading(null);
    }
  };

  const isAnyLoading = loading || oauthLoading !== null;

  return (
    <View flex={1} backgroundColor="$background">
      {/* Subtle gradient glow at top */}
      <LinearGradient
        colors={["rgba(0, 212, 255, 0.08)", "transparent"]}
        style={styles.topGlow}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View flex={1} justifyContent="center" paddingHorizontal="$xl">
          {/* Branding */}
          <View alignItems="center" marginBottom="$3xl">
            {/* Accent line */}
            <View
              width={48}
              height={3}
              backgroundColor="$primary"
              borderRadius="$full"
              marginBottom="$lg"
            />
            <TamaguiText
              fontFamily="$heading"
              fontSize={36}
              fontWeight="700"
              color="$color"
              letterSpacing={-1}
            >
              PERSISTENCE
            </TamaguiText>
            <Text variant="body" muted align="center" marginTop="$sm">
              Track. Push. Repeat.
            </Text>
          </View>

          {/* OAuth buttons */}
          <Column gap="md">
            <OAuthButton
              label="Continue with Google"
              onPress={() => handleOAuth("google")}
              isLoading={oauthLoading === "google"}
              isDisabled={isAnyLoading}
              icon="G"
              testID="google-oauth"
            />
            {Platform.OS === "ios" && (
              <OAuthButton
                label="Continue with Apple"
                onPress={() => handleOAuth("apple")}
                isLoading={oauthLoading === "apple"}
                isDisabled={isAnyLoading}
                icon={"\uF8FF"}
                testID="apple-oauth"
              />
            )}
          </Column>

          {/* Divider */}
          <View
            flexDirection="row"
            alignItems="center"
            marginVertical="$xl"
            gap="$base"
          >
            <View
              flex={1}
              height={1}
              backgroundColor="$borderColor"
              opacity={0.5}
            />
            <TamaguiText
              fontFamily="$body"
              fontSize={12}
              color="$colorMuted"
              textTransform="uppercase"
              letterSpacing={2}
            >
              or
            </TamaguiText>
            <View
              flex={1}
              height={1}
              backgroundColor="$borderColor"
              opacity={0.5}
            />
          </View>

          {/* Email/password form */}
          <Column gap="md">
            <Input
              label="Email"
              placeholder="your@email.com"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              testID="email"
            />
            <Input
              label="Password"
              placeholder="Enter your password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              testID="password"
            />
          </Column>

          <View height="$lg" />

          <Button
            label={loading ? "Signing in..." : "Sign In"}
            onPress={handleSignIn}
            isLoading={loading}
            isDisabled={isAnyLoading}
            fullWidth
            size="lg"
            testID="sign-in"
          />

          {/* Footer link */}
          <View alignItems="center" marginTop="$xl">
            <Text variant="caption" muted>
              {"Don't have an account? "}
              <TamaguiText
                fontFamily="$body"
                fontSize={12}
                color="$primary"
                fontWeight="600"
              >
                Sign Up
              </TamaguiText>
            </Text>
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
      borderRadius="$md"
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
          fontSize={16}
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
            fontSize={16}
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
    height: 300,
  },
});
