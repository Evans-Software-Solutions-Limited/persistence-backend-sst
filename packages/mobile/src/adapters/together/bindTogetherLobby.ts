import type { AuthPort } from "@/domain/ports/auth.port";
import type { NetInfoPort } from "@/domain/ports/netInfo.port";
import type { TogetherLobbyPort } from "@/domain/ports/togetherLobby.port";

type Lifecycle = {
  currentState: string | null;
  addEventListener(
    type: "change",
    callback: (state: string) => void,
  ): { remove(): void };
};

/** Auth and foreground invalidation; internet is a refresh hint, never a LAN gate. */
export function bindTogetherLobby(
  auth: Pick<
    AuthPort,
    "getPersistedSession" | "getSession" | "onAuthStateChange"
  >,
  network: NetInfoPort,
  lifecycle: Lifecycle,
  lobby: TogetherLobbyPort | undefined,
): () => void {
  if (!lobby) return () => {};
  let stopped = false;
  let authRevision = 0;
  let networkRevision = 0;
  lobby.setActive(lifecycle.currentState === "active");
  const initialRevision = authRevision;
  const unsubscribeAuth = auth.onAuthStateChange((session, event) => {
    if (stopped || (!session && event !== "SIGNED_OUT")) return;
    authRevision++;
    lobby.setAccount(session?.userId ?? null);
  });
  const unsubscribeNetwork = network.subscribe((online) => {
    if (stopped) return;
    networkRevision++;
    lobby.setOnline(online);
  });
  const app = lifecycle.addEventListener("change", (state) => {
    if (!stopped) lobby.setActive(state === "active");
  });
  const probeRevision = networkRevision;
  void network
    .isConnected()
    .then((online) => {
      if (!stopped && probeRevision === networkRevision)
        lobby.setOnline(online);
    })
    .catch(() => {});
  void Promise.resolve()
    .then(async () => {
      if (auth.getPersistedSession) return auth.getPersistedSession();
      const result = await auth.getSession();
      return result.ok ? result.value : null;
    })
    .then((session) => {
      if (!stopped && authRevision === initialRevision)
        lobby.setAccount(session?.userId ?? null);
    })
    .catch(() => {});
  return () => {
    stopped = true;
    unsubscribeAuth();
    unsubscribeNetwork();
    app.remove();
    // Reusable after React StrictMode cleanup; disposal belongs to the factory owner.
    lobby.setAccount(null);
    lobby.setActive(false);
  };
}
