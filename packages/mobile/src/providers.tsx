import { type ReactNode, useEffect, useMemo } from "react";
import { SSTApiAdapter } from "@/adapters/api";
import { SupabaseAuthAdapter } from "@/adapters/auth";
import { createHealthAdapter } from "@/adapters/health";
import { ExpoNotificationsAdapter } from "@/adapters/notifications";
import { StripeApplePayAdapter } from "@/adapters/payments";
import { SQLiteStorageAdapter } from "@/adapters/storage";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { ThemeProvider } from "@/ui/theme";

/**
 * Root provider that wires together all adapters:
 * 1. Auth (Supabase session management)
 * 2. API client (SST, with auth token injection)
 * 3. Storage (SQLite, offline-first)
 * 4. Stubs for health/notifications/payments (future milestones)
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const adapters = useMemo<Adapters & { _auth: SupabaseAuthAdapter }>(() => {
    const auth = new SupabaseAuthAdapter();
    const api = new SSTApiAdapter();
    const storage = new SQLiteStorageAdapter();

    // Wire auth token into API client
    api.setTokenProvider(() => auth.getAccessToken());

    return {
      _auth: auth,
      api,
      auth,
      storage,
      health: createHealthAdapter(),
      notifications: new ExpoNotificationsAdapter(),
      payments: new StripeApplePayAdapter(),
    };
  }, []);

  useEffect(() => {
    // Initialize offline database on mount (async to avoid blocking JS thread)
    adapters.storage.initialize().catch((err) => {
      console.error("[AppProviders] Storage init failed:", err);
    });

    // Cleanup AppState listener when provider unmounts (hot reload, strict mode)
    return () => {
      adapters._auth.destroy();
    };
  }, [adapters]);

  return (
    <AdapterProvider adapters={adapters}>
      <ThemeProvider>{children}</ThemeProvider>
    </AdapterProvider>
  );
}
