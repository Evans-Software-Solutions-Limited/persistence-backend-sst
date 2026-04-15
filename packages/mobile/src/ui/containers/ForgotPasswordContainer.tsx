import { useState, useCallback } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "@/ui/hooks/useAuth";
import { ForgotPasswordPresenter } from "@/ui/presenters/ForgotPasswordPresenter";

export function ForgotPasswordContainer() {
  const router = useRouter();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!email.trim()) {
      setError("Please enter your email address");
      return;
    }

    setIsLoading(true);
    try {
      await resetPassword(email);
      setIsSuccess(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send reset link",
      );
    } finally {
      setIsLoading(false);
    }
  }, [email, resetPassword]);

  const handleBackToSignIn = useCallback(() => {
    router.push("/(auth)/sign-in");
  }, [router]);

  return (
    <ForgotPasswordPresenter
      email={email}
      onEmailChange={setEmail}
      onSubmit={handleSubmit}
      onBackToSignIn={handleBackToSignIn}
      isLoading={isLoading}
      error={error}
      isSuccess={isSuccess}
    />
  );
}
