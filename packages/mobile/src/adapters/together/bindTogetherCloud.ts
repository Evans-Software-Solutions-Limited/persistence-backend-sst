import type { AuthPort } from "@/domain/ports/auth.port";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";
import type { NetInfoPort } from "@/domain/ports/netInfo.port";
type Lifecycle = {
  currentState: string | null;
  addEventListener(
    type: "change",
    callback: (state: string) => void,
  ): { remove(): void };
};
export function bindTogetherCloud(
  auth: Pick<
    AuthPort,
    "onAuthStateChange" | "getPersistedSession" | "getSession"
  >,
  network: NetInfoPort,
  lifecycle: Lifecycle,
  cloud?: TogetherCloudPort,
): () => void {
  if (!cloud) return () => {};
  let stopped = false,
    revision = 0,
    networkRevision = 0;
  let active = lifecycle.currentState === "active",
    online = false;
  const retry = () => {
    if (!stopped && active && online) void cloud.retry().catch(() => {});
  };
  const account = (userId: string | null) => {
    cloud.setAccount(userId);
    if (userId) retry();
  };
  cloud.setActive(active);
  const initial = revision;
  const unsub = auth.onAuthStateChange((session, event) => {
    if (stopped || (!session && event !== "SIGNED_OUT")) return;
    revision++;
    account(session?.userId ?? null);
  });
  const net = network.subscribe((value) => {
    if (stopped) return;
    networkRevision++;
    online = value;
    retry();
  });
  const app = lifecycle.addEventListener("change", (state) => {
    if (stopped) return;
    active = state === "active";
    cloud.setActive(active);
    retry();
  });
  const initialNetwork = networkRevision;
  void network
    .isConnected()
    .then((value) => {
      if (stopped || networkRevision !== initialNetwork) return;
      online = value;
      retry();
    })
    .catch(() => {});
  void Promise.resolve()
    .then(async () => {
      if (auth.getPersistedSession) return auth.getPersistedSession();
      const result = await auth.getSession();
      return result.ok ? result.value : null;
    })
    .then((session) => {
      if (!stopped && revision === initial) account(session?.userId ?? null);
    })
    .catch(() => {});
  return () => {
    if (stopped) return;
    stopped = true;
    try {
      unsub();
    } finally {
      try {
        net();
      } finally {
        try {
          app.remove();
        } finally {
          try {
            cloud.setAccount(null);
          } finally {
            cloud.setActive(false);
          }
        }
      }
    }
  };
}
