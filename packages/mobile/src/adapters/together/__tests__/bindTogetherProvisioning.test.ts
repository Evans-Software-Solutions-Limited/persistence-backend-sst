/** @jest-environment node */
import { bindTogetherProvisioning } from "../bindTogetherProvisioning";
import type {
  AuthPort,
  AuthSession,
  AuthChangeEvent,
} from "@/domain/ports/auth.port";
import type {
  TogetherProvisioningPort,
  ReadyIdentity,
} from "@/domain/ports/togetherProvisioning.port";
import { ok, fail } from "@/shared/errors";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const session = (userId: string): AuthSession => ({
  userId,
  email: "athlete@example.com",
  accessToken: "token",
  refreshToken: "refresh",
  expiresAt: 1234,
});
const tick = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
function harness() {
  const persisted = deferred<AuthSession | null>();
  let authCallback!: (s: AuthSession | null, e: AuthChangeEvent) => void;
  let networkCallback!: (online: boolean) => void;
  const unAuth = jest.fn(),
    unNetwork = jest.fn();
  const auth: Pick<
    AuthPort,
    "getPersistedSession" | "getSession" | "onAuthStateChange"
  > = {
    getPersistedSession: jest.fn(() => persisted.promise),
    getSession: jest.fn(async () => ok(session("live"))),
    onAuthStateChange: jest.fn((callback) => {
      authCallback = callback;
      return unAuth;
    }),
  };
  const netInfo = {
    isConnected: jest.fn(async () => true),
    subscribe: jest.fn((callback: (online: boolean) => void) => {
      networkCallback = callback;
      return unNetwork;
    }),
  };
  const provisioning: TogetherProvisioningPort = {
    setAccount: jest.fn(),
    prepare: jest.fn(async () =>
      fail({
        kind: "together-provisioning" as const,
        code: "offline-unprepared" as const,
      }),
    ),
    friendship: jest.fn(),
    dispose: jest.fn(),
  };
  return {
    auth,
    netInfo,
    provisioning,
    persisted,
    unAuth,
    unNetwork,
    event: (s: AuthSession | null, e: AuthChangeEvent) => authCallback(s, e),
    network: (online: boolean) => networkCallback(online),
    start: () => bindTogetherProvisioning(auth, netInfo, provisioning),
  };
}

describe("Together provisioning auth/network lifecycle", () => {
  it("does nothing when the release-gated adapter is absent", () => {
    const h = harness();
    bindTogetherProvisioning(h.auth, h.netInfo, undefined)();
    expect(h.auth.onAuthStateChange).not.toHaveBeenCalled();
    expect(h.netInfo.subscribe).not.toHaveBeenCalled();
    expect(h.auth.getPersistedSession).not.toHaveBeenCalled();
  });
  it("prepares persisted accounts, refreshes on connectivity, and preserves transient null auth", async () => {
    const h = harness();
    const stop = h.start();
    h.persisted.resolve(session("A"));
    await tick();
    expect(h.provisioning.setAccount).toHaveBeenCalledWith("A");
    expect(h.provisioning.prepare).toHaveBeenLastCalledWith({ online: true });
    h.event(null, "TOKEN_REFRESHED");
    h.network(false);
    await tick();
    expect(h.provisioning.setAccount).not.toHaveBeenCalledWith(null);
    expect(h.provisioning.prepare).toHaveBeenLastCalledWith({ online: false });
    h.network(true);
    await tick();
    expect(h.provisioning.prepare).toHaveBeenLastCalledWith({ online: true });
    h.event(session("A"), "TOKEN_REFRESHED");
    await tick();
    expect(h.provisioning.setAccount).toHaveBeenCalledTimes(1);
    stop();
    expect(h.unAuth).toHaveBeenCalledTimes(1);
    expect(h.unNetwork).toHaveBeenCalledTimes(1);
    expect(h.provisioning.setAccount).toHaveBeenLastCalledWith(null);
    expect(h.provisioning.dispose).not.toHaveBeenCalled();
  });
  it("a transient null before persisted bootstrap cannot hide an offline account", async () => {
    const h = harness();
    const stop = h.start();
    h.event(null, "INITIAL_SESSION");
    h.event(null, "TOKEN_REFRESHED");
    h.persisted.resolve(session("A"));
    await tick();
    expect(h.provisioning.setAccount).toHaveBeenCalledWith("A");
    stop();
  });
  it.each(["SIGNED_OUT", "SIGNED_IN"] as const)(
    "ignores stale persisted data after authoritative %s",
    async (event) => {
      const h = harness();
      const stop = h.start();
      h.event(event === "SIGNED_OUT" ? null : session("B"), event);
      h.persisted.resolve(session("A"));
      await tick();
      expect(h.provisioning.setAccount).not.toHaveBeenCalledWith("A");
      if (event === "SIGNED_IN")
        expect(h.provisioning.setAccount).toHaveBeenCalledWith("B");
      else expect(h.provisioning.prepare).not.toHaveBeenCalled();
      stop();
    },
  );
  it("an immediate auth event wins over initial storage read", async () => {
    const h = harness();
    h.auth.onAuthStateChange = jest.fn((callback) => {
      callback(session("B"), "SIGNED_IN");
      return h.unAuth;
    });
    const stop = h.start();
    h.persisted.resolve(session("A"));
    await tick();
    expect(h.provisioning.setAccount).toHaveBeenCalledTimes(1);
    expect(h.provisioning.setAccount).toHaveBeenCalledWith("B");
    stop();
  });
  it("drops slow connectivity probes after an account switch or logout", async () => {
    const h = harness();
    const probe = deferred<boolean>();
    h.netInfo.isConnected.mockReturnValueOnce(probe.promise);
    const stop = h.start();
    h.persisted.resolve(session("A"));
    await tick();
    h.event(session("B"), "SIGNED_IN");
    await tick();
    expect(h.provisioning.setAccount).toHaveBeenLastCalledWith("B");
    const count = (h.provisioning.prepare as jest.Mock).mock.calls.length;
    probe.resolve(false);
    await tick();
    expect(h.provisioning.prepare).toHaveBeenCalledTimes(count);
    h.event(null, "SIGNED_OUT");
    h.network(true);
    await tick();
    expect(h.provisioning.setAccount).toHaveBeenLastCalledWith(null);
    expect(h.provisioning.prepare).toHaveBeenCalledTimes(count);
    stop();
  });
  it.each([false, true])(
    "a stale network probe cannot override a newer event (reject=%s)",
    async (reject) => {
      const h = harness();
      const probe = deferred<boolean>();
      h.netInfo.isConnected.mockReturnValueOnce(probe.promise);
      const stop = h.start();
      h.persisted.resolve(session("A"));
      await tick();
      h.network(false);
      await tick();
      if (reject) probe.reject(new Error("offline"));
      else probe.resolve(true);
      await tick();
      expect(h.provisioning.prepare).toHaveBeenCalledTimes(1);
      expect(h.provisioning.prepare).toHaveBeenCalledWith({ online: false });
      stop();
    },
  );
  it("falls back to cached validation when reachability fails", async () => {
    const h = harness();
    h.netInfo.isConnected.mockRejectedValue(new Error("native unavailable"));
    const stop = h.start();
    h.persisted.resolve(session("A"));
    await tick();
    expect(h.provisioning.prepare).toHaveBeenCalledWith({ online: false });
    stop();
  });
  it("wipes the unused returned key copy, including after logout", async () => {
    const h = harness();
    const result = deferred<ReturnType<typeof ok<ReadyIdentity>>>();
    (h.provisioning.prepare as jest.Mock).mockReturnValue(result.promise);
    const stop = h.start();
    h.persisted.resolve(session("A"));
    await tick();
    h.event(null, "SIGNED_OUT");
    const seed = new Uint8Array(32).fill(7);
    result.resolve(ok({ seed } as ReadyIdentity));
    await tick();
    expect(seed.every((b) => b === 0)).toBe(true);
    stop();
  });
  it("native readiness exceptions do not affect ordinary authentication", async () => {
    const h = harness();
    (h.provisioning.prepare as jest.Mock).mockRejectedValue(
      new Error("native failure"),
    );
    const stop = h.start();
    h.persisted.resolve(session("A"));
    await tick();
    expect(h.provisioning.setAccount).toHaveBeenCalledWith("A");
    h.event(null, "SIGNED_OUT");
    expect(h.provisioning.setAccount).toHaveBeenLastCalledWith(null);
    stop();
  });
  it("does not prepare after an account invalidation failure and cleanup cannot throw", async () => {
    const h = harness();
    (h.provisioning.setAccount as jest.Mock).mockImplementation(() => {
      throw new Error("disk");
    });
    const stop = h.start();
    h.persisted.resolve(session("A"));
    await tick();
    expect(h.provisioning.prepare).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
  it("cleanup invalidates delayed bootstrap, connectivity and auth events", async () => {
    const h = harness();
    const stop = h.start();
    stop();
    h.persisted.resolve(session("A"));
    h.event(session("B"), "SIGNED_IN");
    h.network(true);
    await tick();
    expect(h.provisioning.setAccount).toHaveBeenCalledTimes(1);
    expect(h.provisioning.prepare).not.toHaveBeenCalled();
  });
  it.each(["success", "failure", "throws", "empty"])(
    "uses a live-session fallback when persisted reader is absent: %s",
    async (outcome) => {
      const h = harness();
      delete h.auth.getPersistedSession;
      h.auth.getSession = jest.fn(async () => {
        if (outcome === "throws") throw new Error("network");
        if (outcome === "failure")
          return fail({
            kind: "auth" as const,
            code: "token_expired" as const,
            message: "offline",
          });
        return ok(outcome === "empty" ? null : session("live"));
      });
      const stop = h.start();
      await tick();
      expect(h.auth.getSession).toHaveBeenCalledTimes(1);
      if (outcome === "success")
        expect(h.provisioning.setAccount).toHaveBeenCalledWith("live");
      else expect(h.provisioning.prepare).not.toHaveBeenCalled();
      stop();
    },
  );
});

it("propagates definitive refresh denial to active sharing but ignores stale account replies", async () => {
  const h = harness();
  const denied = jest.fn();
  const pending =
    deferred<Awaited<ReturnType<TogetherProvisioningPort["prepare"]>>>();
  jest.mocked(h.provisioning.prepare).mockReturnValueOnce(pending.promise);
  const stop = bindTogetherProvisioning(
    h.auth,
    h.netInfo,
    h.provisioning,
    denied,
  );
  h.persisted.resolve(session("A"));
  await tick();
  h.event(session("B"), "SIGNED_IN");
  await tick();
  denied.mockClear();
  pending.resolve(
    fail({ kind: "together-provisioning", code: "unauthorized" }),
  );
  await tick();
  expect(denied).not.toHaveBeenCalled();
  jest
    .mocked(h.provisioning.prepare)
    .mockResolvedValueOnce(
      fail({ kind: "together-provisioning", code: "unauthorized" }),
    );
  h.network(true);
  await tick();
  expect(denied).toHaveBeenCalledWith("unauthorized");
  denied.mockClear();
  jest
    .mocked(h.provisioning.prepare)
    .mockResolvedValueOnce(
      fail({ kind: "together-provisioning", code: "unavailable" }),
    );
  h.network(true);
  await tick();
  expect(denied).not.toHaveBeenCalled();
  stop();
});
