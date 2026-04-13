import { type ReactNode, useEffect, useMemo } from "react";
import { SSTApiAdapter } from "@/adapters/api";
import { SupabaseAuthAdapter } from "@/adapters/auth";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { StubPaymentsAdapter } from "@/adapters/payments";
import { SQLiteStorageAdapter } from "@/adapters/storage";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";

/**
 * Root provider that wires together all adapters:
 * 1. Auth (Supabase session management)
 * 2. API client (SST, with auth token injection)
 * 3. Storage (SQLite, offline-first)
 * 4. Stubs for health/notifications/payments (future milestones)
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const adapters = useMemo<Adapters>(() => {
    const auth = new SupabaseAuthAdapter();
    const api = new SSTApiAdapter();
    const storage = new SQLiteStorageAdapter();

    // Wire auth token into API client
    api.setTokenProvider(() => auth.getAccessToken());

    return {
      api,
      auth,
      storage,
      health: new StubHealthAdapter(),
      notifications: new StubNotificationsAdapter(),
      payments: new StubPaymentsAdapter(),
    };
  }, []);

  useEffect(() => {
    // Initialize offline database on mount
    adapters.storage.initialize();
  }, [adapters]);

  return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
}
