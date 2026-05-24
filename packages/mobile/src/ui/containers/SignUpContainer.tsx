import { useState, useCallback } from "react";
import { useRouter } from "expo-router";
import type { OAuthProvider } from "@/domain/ports/auth.port";
import { useAuth } from "@/ui/hooks/useAuth";
import { SignUpPresenter } from "@/ui/presenters/SignUpPresenter";

export function SignUpContainer() {
  const router = useRouter();
  const { signUp, signInWithOAuth } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState<OAuthProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!email.trim() || !password.trim() || !confirmPassword.trim()) {
      setError("Please fill in all fields");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }

    setIsLoading(true);
    try {
      const { confirmationRequired } = await signUp(email, password);
      if (confirmationRequired) {
        setConfirmationSent(true);
      } else {
        // M10: post-sign-up routes through Subscription Selection so
        // the user picks a tier before landing in the app. AuthGate
        // whitelists this route for signed-in users.
        router.push("/(auth)/subscription-selection");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setIsLoading(false);
    }
  }, [email, password, confirmPassword, signUp, router]);

  const handleOAuth = useCallback(
    async (provider: OAuthProvider) => {
      setError(null);
      setOauthLoading(provider);
      try {
        await signInWithOAuth(provider);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Sign in failed");
      } finally {
        setOauthLoading(null);
      }
    },
    [signInWithOAuth],
  );

  const handleSignIn = useCallback(() => {
    router.push("/(auth)/sign-in");
  }, [router]);

  return (
    <SignUpPresenter
      email={email}
      password={password}
      confirmPassword={confirmPassword}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onConfirmPasswordChange={setConfirmPassword}
      onSubmit={handleSubmit}
      onOAuth={handleOAuth}
      onSignIn={handleSignIn}
      isLoading={isLoading}
      oauthLoading={oauthLoading}
      error={error}
      confirmationSent={confirmationSent}
    />
  );
}
