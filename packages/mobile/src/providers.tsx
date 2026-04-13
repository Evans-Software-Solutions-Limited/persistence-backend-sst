import { type ReactNode, useEffect } from "react";
import { setTokenProvider } from "./api/client";
import { AuthProvider } from "./auth/provider";
import { getAccessToken } from "./auth/supabase";
import { initializeLocalDb } from "./offline/database";

/**
 * Root provider that wires together:
 * 1. Auth (Supabase session management)
 * 2. API client (token injection from auth)
 * 3. Offline database (SQLite initialization)
 */
export function AppProviders({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Wire auth token into API client
    setTokenProvider(getAccessToken);

    // Initialize offline database
    initializeLocalDb();
  }, []);

  return <AuthProvider>{children}</AuthProvider>;
}
