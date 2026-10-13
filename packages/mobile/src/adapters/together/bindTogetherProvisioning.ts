import type { AuthPort, AuthSession } from "@/domain/ports/auth.port";
import type { NetInfoPort } from "@/domain/ports/netInfo.port";
import type { TogetherProvisioningPort } from "@/domain/ports/togetherProvisioning.port";

type ProvisioningAuth = Pick<
  AuthPort,
  "getPersistedSession" | "getSession" | "onAuthStateChange"
>;

/** Delay before the single automatic retry of a transient readiness failure. */
export const TRANSIENT_RETRY_MS = 4_000;

/** Account lifecycle only; internet reachability never gates a LAN connection. */
export function bindTogetherProvisioning(
  auth: ProvisioningAuth,
  netInfo: NetInfoPort,
  provisioning: TogetherProvisioningPort | undefined,
  onAuthorizationUnavailable?: (code: string) => void,
  /** Resolves when the app shell's cold-start work for the account is done. */
  ready: (account: string) => Promise<void> = async () => {},
): () => void {
  if (!provisioning) return () => {};
  let stopped = false;
  let account: string | null = null;
  let accountGeneration = 0;
  let authRevision = 0;
  let networkRevision = 0;
  let retried = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const prepare = async (online: boolean, generation: number) => {
    if (stopped || !account || generation !== accountGeneration) return;
    try {
      const result = await provisioning.prepare({ online });
      // Bootstrap only prepares durable evidence. A future join obtains its own
      // defensive key copy; secrets must never land in React/query state.
      if (result.ok) result.value.seed.fill(0);
      else if (
        result.error.code === "unavailable" &&
        online &&
        !retried &&
        !stopped &&
        generation === accountGeneration
      ) {
        // A cold start fires many requests at once and the API edge answers the
        // overflow with 503. One bounded retry per account; the user's explicit
        // "Retry access check" remains the path after that.
        retried = true;
        clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          if (!stopped && generation === accountGeneration)
            void prepare(true, generation);
        }, TRANSIENT_RETRY_MS);
      } else if (
        !stopped &&
        generation === accountGeneration &&
        [
          "unauthorized",
          "paid-required",
          "authentication-required",
          "service-unavailable",
          "device-revoked",
          "registration-conflict",
          "registration-invalid",
          "disabled",
          "signed-out",
          "expired",
          "invalid-proof",
          "key-unavailable",
          "storage",
          "offline-unprepared",
        ].includes(result.error.code)
      )
        onAuthorizationUnavailable?.(result.error.code);
    } catch {
      // Readiness is obtained from the same adapter by the eventual join flow.
      // A native/storage failure must not interrupt ordinary auth or workouts.
    }
  };
  const probe = async () => {
    const generation = accountGeneration;
    const revision = networkRevision;
    try {
      // Off the cold-start critical path: the bootstrap request goes first.
      await ready(account!);
      if (stopped || generation !== accountGeneration) return;
      const online = await netInfo.isConnected();
      if (revision === networkRevision) await prepare(online, generation);
    } catch {
      // Unknown reachability permits only validation of already-cached proof.
      if (revision === networkRevision) await prepare(false, generation);
    }
  };
  const activate = (userId: string | null) => {
    if (stopped) return;
    if (account !== userId) {
      accountGeneration++;
      account = null;
      retried = false;
      clearTimeout(retryTimer);
      retryTimer = undefined;
      try {
        provisioning.setAccount(userId);
        account = userId;
      } catch {
        return;
      }
    }
    if (account) void probe();
  };

  // Capture before subscribing: a synchronous authoritative event supersedes
  // the persisted bootstrap read just as an asynchronous event does.
  const bootstrapRevision = authRevision;
  const unsubscribeAuth = auth.onAuthStateChange((session, event) => {
    if (stopped) return;
    if (session || event === "SIGNED_OUT") {
      authRevision++;
      activate(session?.userId ?? null);
    }
    // Supabase emits transient null sessions during an offline token refresh.
  });
  const unsubscribeNetwork = netInfo.subscribe((online) => {
    networkRevision++;
    void prepare(online, accountGeneration);
  });
  const initial: Promise<AuthSession | null> = auth.getPersistedSession
    ? Promise.resolve().then(() => auth.getPersistedSession!())
    : Promise.resolve().then(async () => {
        const result = await auth.getSession();
        return result.ok ? result.value : null;
      });
  void initial
    .then((session) => {
      if (authRevision === bootstrapRevision) activate(session?.userId ?? null);
    })
    .catch(() => {});

  return () => {
    stopped = true;
    accountGeneration++;
    clearTimeout(retryTimer);
    retryTimer = undefined;
    unsubscribeAuth();
    unsubscribeNetwork();
    // Cancel stale completions but permit React StrictMode to bind again to the
    // same adapter. Signing keys and owner recovery journals remain intact.
    try {
      provisioning.setAccount(null);
    } catch {
      /* Already fail-closed. */
    }
  };
}
