import { useCallback, useState } from "react";
import { useAuth } from "@/ui/hooks/useAuth";
import { ProfilePresenter } from "@/ui/presenters/ProfilePresenter";

export function ProfileContainer() {
  const { session, signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = useCallback(async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    setError(null);
    try {
      await signOut();
      // Post-sign-out the AuthGate in the root layout redirects to /(auth)/sign-in,
      // so no explicit navigation is needed here.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign out failed");
    } finally {
      setIsSigningOut(false);
    }
  }, [isSigningOut, signOut]);

  return (
    <ProfilePresenter
      email={session?.email ?? null}
      displayName={null}
      avatarUrl={null}
      isSigningOut={isSigningOut}
      error={error}
      onSignOut={handleSignOut}
    />
  );
}
