import type { AuthPort, AuthSession } from "@/domain/ports/auth.port";
import type { NetInfoPort } from "@/domain/ports/netInfo.port";
import type { TogetherProvisioningPort } from "@/domain/ports/togetherProvisioning.port";

type ProvisioningAuth = Pick<
  AuthPort,
  "getPersistedSession" | "getSession" | "onAuthStateChange"
>;

/** Account lifecycle only; internet reachability never gates a LAN connection. */
export function bindTogetherProvisioning(
  auth: ProvisioningAuth,
  netInfo: NetInfoPort,
  provisioning: TogetherProvisioningPort | undefined,
): () => void {
  if (!provisioning) return () => {};
  let stopped = false;
  let account: string | null = null;
  let accountGeneration = 0;
  let authRevision = 0;
  let networkRevision = 0;

  const prepare = async (online: boolean, generation: number) => {
    if (stopped || !account || generation !== accountGeneration) return;
    try {
      const result = await provisioning.prepare({ online });
      // Bootstrap only prepares durable evidence. A future join obtains its own
      // defensive key copy; secrets must never land in React/query state.
      if (result.ok) result.value.seed.fill(0);
    } catch {
      // Readiness is obtained from the same adapter by the eventual join flow.
      // A native/storage failure must not interrupt ordinary auth or workouts.
    }
  };
  const probe = async () => {
    const generation = accountGeneration;
    const revision = networkRevision;
    try {
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
