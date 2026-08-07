import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SSTApiAdapter } from "@/adapters/api";
import { SupabaseAuthAdapter } from "@/adapters/auth";
import { createHealthAdapter } from "@/adapters/health";
import { RNNetInfoAdapter } from "@/adapters/netInfo";
import { ExpoNotificationsAdapter } from "@/adapters/notifications";
import { RevenueCatPurchasesAdapter } from "@/adapters/purchases";
import { SQLiteStorageAdapter } from "@/adapters/storage";
import type { PurchasesPort } from "@/domain/ports/purchases.port";
import type { ApiError } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { captureStorageInitFailure } from "@/lib/sentry";
import { AdapterProvider, type StorageStatus } from "@/ui/hooks/useAdapters";
import { ThemeProvider } from "@/ui/theme";

/**
 * True when `error` is a client (4xx) failure that will never self-heal on
 * retry — an unauthorized/not-found/entitlement-denied/validation response is
 * exactly as wrong the second time. `mapHttpErrorToApiError`
 * (adapters/api/sst-api.adapter.ts) stamps the real HTTP `status` onto every
 * `ApiError` it produces from an actual response, including the codes it
 * doesn't have a dedicated name for (400/403/422/429/etc. all come through as
 * `code: "server"` but keep their true `status`) — so `status` is the
 * reliable signal, not `code`. A "network"/"timeout" failure never reached a
 * server, so `mapHttpErrorToApiError` never ran and there IS no `status` —
 * those fall through to `false` (retryable), which is the whole point of the
 * one retry: a cold Lambda or a network blip is worth a second attempt.
 *
 * Deliberately defensive about the input shape: `queryFn` rejections aren't
 * type-checked, so a thrown non-`ApiError` (a bug, a raw `TypeError`, …)
 * must not crash the retry predicate itself — treat anything that doesn't
 * look like our `ApiError` shape as retryable rather than throwing.
 */
export function isNonRetryableClientError(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    (error as { kind?: unknown }).kind !== "api"
  ) {
    return false;
  }
  const status = (error as ApiError).status;
  return typeof status === "number" && status >= 400 && status < 500;
}

/**
 * The QueryClient default `retry` predicate: at most one retry, skipped
 * entirely for a non-retryable 4xx (see `isNonRetryableClientError`).
 * Exported (rather than inlined below) so it's unit-testable without
 * standing up a full QueryClient + fetch round-trip.
 */
export function defaultQueryRetry(
  failureCount: number,
  error: unknown,
): boolean {
  return failureCount < 1 && !isNonRetryableClientError(error);
}

/**
 * Build the native RevenueCat purchases adapter for App Store / Play Billing.
 * Configured eagerly with the platform's **public** SDK key (client-safe); an absent
 * key leaves the adapter unconfigured so the store paywall degrades to its
 * inline "unavailable" state rather than throwing on the first SDK call.
 */
export function createPurchasesAdapter(): PurchasesPort | undefined {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return undefined;
  const adapter = new RevenueCatPurchasesAdapter();
  const keyName =
    Platform.OS === "android" ? "revenueCatAndroidKey" : "revenueCatIosKey";
  const configKey = Constants.expoConfig?.extra?.[keyName] as
    | string
    | undefined;
  const envKey =
    Platform.OS === "android"
      ? process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
      : process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  const publicSdkKey = configKey?.trim() ? configKey : (envKey ?? "");
  adapter.configure(publicSdkKey);
  return adapter;
}

/**
 * Root provider that wires together all adapters:
 * 1. Auth (Supabase session management)
 * 2. API client (SST, with auth token injection)
 * 3. Storage (SQLite, offline-first)
 * 4. Health (HealthKit / Health Connect)
 * 5. Notifications (Expo)
 * 6. NetInfo (RN community netinfo — M10.5)
 * 7. Purchases (RevenueCat native App Store / Play Billing)
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
      netInfo: new RNNetInfoAdapter(),
      purchases: createPurchasesAdapter(),
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
            // At most one automatic retry, and ONLY for a failure that might
            // self-heal (network blip, timeout, a cold Lambda's 5xx) — a 4xx
            // (unauthorized, not-found, entitlement-denied, validation) is
            // exactly as wrong on the second attempt, so retrying it only
            // delays the correct error state reaching the UI and adds a
            // needless request against the launch-time concurrency budget
            // (launch fan-out reduction). See `defaultQueryRetry` above.
            retry: defaultQueryRetry,
          },
          mutations: {
            retry: 0,
          },
        },
      }),
    [],
  );

  // Storage readiness. `settled: false` withholds the tree until
  // `initialize()` resolves — see AdapterProvider's docstring for why that
  // ordering has to be structural rather than incidental.
  const [storageStatus, setStorageStatus] = useState<StorageStatus>({
    settled: false,
    error: null,
  });

  useEffect(() => {
    // Initialize offline database on mount (async to avoid blocking JS thread).
    // `supabaseFingerprint` identifies which backend this build talks to (the
    // same compiled Supabase URL the auth adapter reads) — the storage layer
    // stamps the cache with it and wipes on first-launch-post-upgrade /
    // genuine backend change (see storage.port.ts). When the cache wiped,
    // the lingering local session belongs to the OLD backend project, so it
    // must be cleared too (local-only — no network revoke against a project
    // that session doesn't belong to).
    const supabaseFingerprint =
      Constants.expoConfig?.extra?.supabaseUrl ??
      process.env.EXPO_PUBLIC_SUPABASE_URL ??
      "";
    let cancelled = false;
    adapters.storage
      .initialize(supabaseFingerprint)
      .then(() => {
        if (adapters.storage.backendChanged()) {
          return adapters._auth.clearLocalSession();
        }
      })
      .then(() => {
        if (!cancelled) setStorageStatus({ settled: true, error: null });
      })
      .catch((err) => {
        // A storage-init failure means the local tables may not exist, so every
        // cached read will throw `no such table` from inside a render — which
        // surfaces as an ErrorBoundary report against an arbitrary screen with
        // no trace of the real cause. Report the root cause explicitly, and
        // still settle so the tree renders (withholding it forever would give a
        // permanently blank app; the ErrorBoundary is the better failure mode,
        // and now Sentry has the actual reason).
        console.error("[AppProviders] Storage init failed:", err);
        captureStorageInitFailure(err);
        if (!cancelled) {
          setStorageStatus({
            settled: true,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      });

    // Cleanup AppState listener when provider unmounts (hot reload, strict mode)
    return () => {
      cancelled = true;
      adapters._auth.destroy();
    };
  }, [adapters]);

  return (
    <AdapterProvider adapters={adapters} storageStatus={storageStatus}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>{children}</ThemeProvider>
      </QueryClientProvider>
    </AdapterProvider>
  );
}
