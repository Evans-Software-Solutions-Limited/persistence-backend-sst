import { useState, useCallback } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import type { OAuthProvider } from "@/domain/ports/auth.port";
import { useAuth } from "@/ui/hooks/useAuth";
import { SignInPresenter } from "@/ui/presenters/SignInPresenter";

export function SignInContainer() {
  const router = useRouter();
  const { signIn, signInWithOAuth, signInWithApple } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError("Please enter email and password");
      return;
    }

    setIsLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setIsLoading(false);
    }
  }, [email, password, signIn]);

  const handleOAuth = useCallback(
    async (provider: OAuthProvider) => {
      setError(null);
      setOauthLoading(provider);
      try {
        // On iOS, Apple goes through the native Sign in with Apple sheet
        // (App Store requirement); everything else uses the web OAuth flow.
        if (provider === "apple" && Platform.OS === "ios") {
          await signInWithApple();
        } else {
          await signInWithOAuth(provider);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign in failed");
      } finally {
        setOauthLoading(null);
      }
    },
    [signInWithOAuth, signInWithApple],
  );

  const handleForgotPassword = useCallback(() => {
    router.push("/(auth)/forgot-password");
  }, [router]);

  const handleSignUp = useCallback(() => {
    router.push("/(auth)/sign-up");
  }, [router]);

  return (
    <SignInPresenter
      email={email}
      password={password}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={handleSubmit}
      onOAuth={handleOAuth}
      onForgotPassword={handleForgotPassword}
      onSignUp={handleSignUp}
      isLoading={isLoading}
      oauthLoading={oauthLoading}
      error={error}
    />
  );
}
