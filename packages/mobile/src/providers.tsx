import { type ReactNode, useEffect, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SSTApiAdapter } from "@/adapters/api";
import { SupabaseAuthAdapter } from "@/adapters/auth";
import { createHealthAdapter } from "@/adapters/health";
import { RNNetInfoAdapter } from "@/adapters/netInfo";
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
 * 4. Health (HealthKit / Health Connect)
 * 5. Notifications (Expo)
 * 6. Payments (Stripe Apple Pay — M10)
 * 7. NetInfo (RN community netinfo — M10.5)
 *
 * Also mounts a Tanstack Query client at the root for the M10
 * subscription hooks (useSubscriptionTiers / useMySubscription /
 * useCreateSubscription / useCancelSubscription). The rest of the app
 * still uses the bespoke cache-and-subscribe hooks (useDashboard,
 * useWorkouts, etc.) backed by SQLite — those don't touch the
 * QueryClient. Tanstack is scoped to the subscription surface; if it
 * proves useful, follow-up milestones can migrate other reads onto it.
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
      netInfo: new RNNetInfoAdapter(),
    };
  }, []);

  // QueryClient lives at the root — one per app lifetime. Defaults
  // match the design.md § Subscription state (mobile) stale-times:
  // 10 min for tier catalog, 2 min for current sub. Per-hook
  // staleTime overrides those defaults; we set conservative defaults
  // here so any future hook gets safe behaviour without thought.
  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2 * 60 * 1000,
            // Disable refetch-on-window-focus — Expo / RN doesn't
            // surface that event reliably and we drive refetch from
            // mutation invalidations instead. Mirrors the legacy
            // query-client config.
            refetchOnWindowFocus: false,
            // One automatic retry on failure; production paths surface
            // errors to the UI rather than spinning forever.
            retry: 1,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
    [],
  );

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
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>{children}</ThemeProvider>
      </QueryClientProvider>
    </AdapterProvider>
  );
}
