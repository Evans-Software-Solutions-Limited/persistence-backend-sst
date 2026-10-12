import type { ReactNode } from "react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";

export const BOOTSTRAP_TEST_USER = "u-bootstrap";

/** Signed-in in-memory adapters for the cold-start bootstrap hook tests. */
export function bootstrapAdapters(signedIn = true) {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  const storage = new InMemoryStorageAdapter();
  const netInfo = new InMemoryNetInfoAdapter();
  if (signedIn)
    auth.currentSession = {
      accessToken: "tok",
      refreshToken: "rtok",
      userId: BOOTSTRAP_TEST_USER,
      email: "x@y.com",
      expiresAt: Date.now() + 3_600_000,
    };
  api.profilePage = {
    profile: { id: BOOTSTRAP_TEST_USER, fullName: "Ada", weightUnit: "kg" },
    subscription: null,
    stats: { workoutsCompleted: 1 },
    recentAchievements: [],
    activeTrainers: [],
    pendingTrainerRequests: [],
  } as never;
  api.mySubscription = { tierName: "free", workoutLimit: 3 } as never;
  const adapters: Adapters = {
    api,
    auth,
    storage,
    netInfo,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
  };
  return { api, auth, storage, netInfo, adapters };
}

export function bootstrapWrapper(
  adapters: Adapters,
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  }),
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
      </QueryClientProvider>
    );
  };
}
