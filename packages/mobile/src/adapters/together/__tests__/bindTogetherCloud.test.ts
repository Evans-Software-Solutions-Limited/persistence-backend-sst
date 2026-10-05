import { bindTogetherCloud } from "../bindTogetherCloud";
import type { AuthPort } from "@/domain/ports/auth.port";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function setup(persisted = true) {
  let resolveAuth!: (v: unknown) => void,
    rejectAuth!: (v: unknown) => void,
    resolveOnline!: (v: boolean) => void,
    rejectOnline!: (v: unknown) => void;
  let authEvent!: (...args: any[]) => void,
    netEvent!: (v: boolean) => void,
    appEvent!: (s: string) => void;
  const initial = new Promise((resolve, reject) => {
    resolveAuth = resolve;
    rejectAuth = reject;
  });
  const online = new Promise<boolean>((resolve, reject) => {
    resolveOnline = resolve;
    rejectOnline = reject;
  });
  const unAuth = jest.fn(),
    unNet = jest.fn(),
    unApp = jest.fn();
  const auth = {
    getSession: () => initial,
    ...(persisted ? { getPersistedSession: () => initial } : {}),
    onAuthStateChange: (f: typeof authEvent) => {
      authEvent = f;
      return unAuth;
    },
  } as unknown as AuthPort;
  const net = {
    isConnected: () => online,
    subscribe: (f: typeof netEvent) => {
      netEvent = f;
      return unNet;
    },
  };
  const life = {
    currentState: "active",
    addEventListener: (_: string, f: typeof appEvent) => {
      appEvent = f;
      return { remove: unApp };
    },
  };
  const cloud = {
    setActive: jest.fn(),
    setAccount: jest.fn(),
    retry: jest.fn().mockResolvedValue(undefined),
  };
  const stop = bindTogetherCloud(
    auth,
    net,
    life,
    cloud as unknown as TogetherCloudPort,
  );
  return {
    cloud,
    stop,
    resolveAuth,
    rejectAuth,
    resolveOnline,
    rejectOnline,
    unAuth,
    unNet,
    unApp,
    authEvent: (...a: any[]) => authEvent(...a),
    netEvent: (v: boolean) => netEvent(v),
    appEvent: (v: string) => appEvent(v),
    auth,
    net,
    life,
  };
}
it("is inert when disabled", () => {
  const s = setup();
  bindTogetherCloud(s.auth, s.net, s.life)();
  s.stop();
});
it("logout and live network changes defeat delayed bootstrap/probe", async () => {
  const s = setup();
  s.authEvent(null, "SIGNED_OUT");
  s.netEvent(false);
  s.resolveAuth({ userId: "old" });
  s.resolveOnline(true);
  await flush();
  expect(s.cloud.setAccount).toHaveBeenCalledTimes(1);
  expect(s.cloud.setAccount).toHaveBeenLastCalledWith(null);
  expect(s.cloud.retry).not.toHaveBeenCalled();
  s.stop();
});
it("restores persisted account and retries on foreground/reconnect only", async () => {
  const s = setup();
  s.resolveAuth({ userId: "u" });
  s.resolveOnline(true);
  await flush();
  expect(s.cloud.setAccount).toHaveBeenLastCalledWith("u");
  s.authEvent(null, "TOKEN_REFRESHED");
  expect(s.cloud.setAccount).toHaveBeenCalledTimes(1);
  s.cloud.retry.mockClear();
  s.appEvent("background");
  s.netEvent(true);
  expect(s.cloud.retry).not.toHaveBeenCalled();
  s.appEvent("active");
  expect(s.cloud.retry).toHaveBeenCalledTimes(1);
  s.netEvent(false);
  s.appEvent("active");
  expect(s.cloud.retry).toHaveBeenCalledTimes(1);
  s.cloud.retry.mockRejectedValueOnce(Error("offline"));
  s.netEvent(true);
  await flush();
  s.stop();
});
it.each([true, false])(
  "supports authenticated-session fallback %s",
  async (ok) => {
    const s = setup(false);
    s.resolveAuth({ ok, value: { userId: "u" } });
    s.resolveOnline(false);
    await flush();
    expect(s.cloud.setAccount).toHaveBeenLastCalledWith(ok ? "u" : null);
    s.stop();
  },
);
it("cleanup rejects stale async/events and is idempotent", async () => {
  const s = setup();
  s.stop();
  s.stop();
  s.resolveAuth({ userId: "late" });
  s.resolveOnline(true);
  s.authEvent({ userId: "late" }, "SIGNED_IN");
  s.netEvent(true);
  s.appEvent("active");
  await flush();
  expect(s.cloud.setAccount).toHaveBeenCalledTimes(1);
  expect(s.cloud.setActive).toHaveBeenLastCalledWith(false);
  expect(s.cloud.retry).not.toHaveBeenCalled();
  expect(s.unAuth).toHaveBeenCalledTimes(1);
  expect(s.unNet).toHaveBeenCalledTimes(1);
  expect(s.unApp).toHaveBeenCalledTimes(1);
});
it("isolates bootstrap failures and revokes authority despite cleanup failure", async () => {
  const s = setup();
  s.rejectAuth(Error("auth"));
  s.rejectOnline(Error("net"));
  await flush();
  s.unAuth.mockImplementation(() => {
    throw Error("cleanup");
  });
  expect(() => s.stop()).toThrow("cleanup");
  expect(s.unNet).toHaveBeenCalled();
  expect(s.unApp).toHaveBeenCalled();
  expect(s.cloud.setAccount).toHaveBeenLastCalledWith(null);
  expect(s.cloud.setActive).toHaveBeenLastCalledWith(false);
});
