import { useCallback, useState } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "@/ui/hooks/useAuth";
import { usePasswordRecovery } from "@/state/password-recovery";
import { SetNewPasswordPresenter } from "@/ui/presenters/SetNewPasswordPresenter";

/**
 * <SetNewPasswordContainer> — completes a password recovery. Reached only via
 * AuthGate once a recovery link has established a session and flagged
 * [[password-recovery]] (see AuthCallbackContainer). Validates the new
 * password (mirrors sign-up: both fields, match, min 6), calls
 * `updatePassword`, then clears the recovery flag and enters the app.
 *
 * The legacy app had no equivalent screen (its reset link pointed at a
 * non-existent `persistencemobile://reset-password` route), so the UI follows
 * the existing ForgotPassword auth-screen design rather than a 1:1 port.
 */
export function SetNewPasswordContainer() {
  const router = useRouter();
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!password.trim() || !confirmPassword.trim()) {
      setError("Please fill in both fields");
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
      await updatePassword(password);
      setIsSuccess(true);
      // Recovery complete — drop the flag so AuthGate stops diverting here,
      // then enter the app (the session is already live from the reset link).
      usePasswordRecovery.getState().clear();
      router.replace("/(app)/(tabs)");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to set new password",
      );
    } finally {
      setIsLoading(false);
    }
  }, [password, confirmPassword, updatePassword, router]);

  return (
    <SetNewPasswordPresenter
      password={password}
      confirmPassword={confirmPassword}
      onPasswordChange={setPassword}
      onConfirmPasswordChange={setConfirmPassword}
      onSubmit={handleSubmit}
      isLoading={isLoading}
      error={error}
      isSuccess={isSuccess}
    />
  );
}
