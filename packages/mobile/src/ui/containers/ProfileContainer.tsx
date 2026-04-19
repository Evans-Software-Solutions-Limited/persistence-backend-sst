import { useCallback, useRef, useState } from "react";
import { useAuth } from "@/ui/hooks/useAuth";
import { ProfilePresenter } from "@/ui/presenters/ProfilePresenter";

export function ProfileContainer() {
  const { session, signOut } = useAuth();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref-based guard: two taps in the same event-loop turn would both pass a
  // state-based guard because React batches the `setIsSigningOut(true)` call
  // — the closure captured at render time still sees `isSigningOut === false`
  // on the second tap. A ref mutates synchronously, so the second tap returns
  // immediately. Matches the pattern used by `ExerciseListContainer.triggerRefresh`.
  const isSigningOutRef = useRef(false);

  const handleSignOut = useCallback(async () => {
    if (isSigningOutRef.current) return;
    isSigningOutRef.current = true;
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
      isSigningOutRef.current = false;
    }
  }, [signOut]);

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
