import { useCallback, useEffect, useState } from "react";
import type { AuthSession } from "@/domain/ports/auth.port";
import { useAdapters } from "./useAdapters";

export type AuthState = {
  session: AuthSession | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

/**
 * Hook for auth state management. Wraps the AuthPort adapter
 * to provide reactive session state and auth actions.
 */
export function useAuth(): AuthState {
  const { auth } = useAdapters();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Bootstrap: get existing session
    auth.getSession().then((result) => {
      if (result.ok) {
        setSession(result.value);
      }
      setIsLoading(false);
    });

    // Listen for auth changes
    const unsubscribe = auth.onAuthStateChange((s) => {
      setSession(s);
    });

    return unsubscribe;
  }, [auth]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await auth.signInWithEmail(email, password);
      if (!result.ok) {
        throw new Error(result.error.message);
      }
    },
    [auth],
  );

  const signOut = useCallback(async () => {
    const result = await auth.signOut();
    if (!result.ok) {
      throw new Error(result.error.message);
    }
  }, [auth]);

  return { session, isLoading, signIn, signOut };
}
