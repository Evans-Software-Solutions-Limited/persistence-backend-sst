import { bindTogetherLobby } from "../bindTogetherLobby";
import type { TogetherLobbyPort } from "@/domain/ports/togetherLobby.port";
import type { AuthPort } from "@/domain/ports/auth.port";
import type { NetInfoPort } from "@/domain/ports/netInfo.port";

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
function setup(persisted = true) {
  let resolveAuth!: (value: unknown) => void;
  let resolveOnline!: (value: boolean) => void;
  let authEvent!: (...args: any[]) => void;
  let networkEvent!: (value: boolean) => void;
  let appEvent!: (value: string) => void;
  const initial = new Promise((resolve) => {
    resolveAuth = resolve;
  });
  const online = new Promise<boolean>((resolve) => {
    resolveOnline = resolve;
  });
  const auth = {
    getSession: jest.fn(() => initial),
    ...(persisted ? { getPersistedSession: jest.fn(() => initial) } : {}),
    onAuthStateChange: jest.fn((listener) => {
      authEvent = listener;
      return jest.fn();
    }),
  } as unknown as AuthPort;
  const net = {
    isConnected: () => online,
    subscribe: (listener: typeof networkEvent) => {
      networkEvent = listener;
      return jest.fn();
    },
  } as NetInfoPort;
  const lifecycle = {
    currentState: "active",
    addEventListener: (_: string, listener: typeof appEvent) => {
      appEvent = listener;
      return { remove: jest.fn() };
    },
  };
  const lobby = {
    setActive: jest.fn(),
    setAccount: jest.fn(),
    setOnline: jest.fn(),
  } as unknown as TogetherLobbyPort;
  const stop = bindTogetherLobby(auth, net, lifecycle, lobby);
  return {
    lobby,
    stop,
    resolveAuth,
    resolveOnline,
    authEvent: (...args: any[]) => authEvent(...args),
    networkEvent: (v: boolean) => networkEvent(v),
    appEvent: (v: string) => appEvent(v),
  };
}
it("authoritative logout wins over delayed persisted account and late internet probe", async () => {
  const s = setup();
  s.authEvent(null, "SIGNED_OUT");
  s.networkEvent(false);
  s.resolveAuth({ userId: "old-account" });
  s.resolveOnline(true);
  await flush();
  expect(s.lobby.setAccount).toHaveBeenCalledTimes(1);
  expect(s.lobby.setAccount).toHaveBeenLastCalledWith(null);
  expect(s.lobby.setOnline).toHaveBeenCalledTimes(1);
  expect(s.lobby.setOnline).toHaveBeenLastCalledWith(false);
  s.stop();
});
it("boots persisted offline identity, ignores transient refresh null, stops background access", async () => {
  const s = setup();
  s.resolveAuth({ userId: "owner" });
  s.resolveOnline(false);
  await flush();
  expect(s.lobby.setAccount).toHaveBeenLastCalledWith("owner");
  s.authEvent(null, "TOKEN_REFRESHED");
  expect(s.lobby.setAccount).toHaveBeenCalledTimes(1);
  s.appEvent("background");
  expect(s.lobby.setActive).toHaveBeenLastCalledWith(false);
  s.appEvent("active");
  expect(s.lobby.setActive).toHaveBeenLastCalledWith(true);
  s.stop();
  expect(s.lobby.setAccount).toHaveBeenLastCalledWith(null);
  s.authEvent({ userId: "late" }, "SIGNED_IN");
  s.networkEvent(true);
  s.appEvent("active");
  expect(s.lobby.setAccount).toHaveBeenLastCalledWith(null);
  expect(s.lobby.setOnline).toHaveBeenLastCalledWith(false);
  expect(s.lobby.setActive).toHaveBeenLastCalledWith(false);
});
it.each([true, false])(
  "supports authenticated-session fallback (%s)",
  async (ok) => {
    const s = setup(false);
    s.resolveAuth({ ok, value: { userId: "owner" } });
    s.resolveOnline(true);
    await flush();
    expect(s.lobby.setAccount).toHaveBeenLastCalledWith(ok ? "owner" : null);
    s.stop();
  },
);
it("does not apply delayed bootstrap after cleanup", async () => {
  const s = setup();
  s.stop();
  s.resolveAuth(null);
  s.resolveOnline(true);
  await flush();
  expect(s.lobby.setAccount).toHaveBeenCalledTimes(1);
  expect(s.lobby.setOnline).not.toHaveBeenCalled();
});
it("does nothing without the release-gated capability", () => {
  expect(
    bindTogetherLobby(
      {} as AuthPort,
      {} as NetInfoPort,
      {} as any,
      undefined,
    )(),
  ).toBeUndefined();
});
it("failed bootstrap/network probes do not overwrite later lifecycle events", async () => {
  const lobby = {
    setActive: jest.fn(),
    setAccount: jest.fn(),
    setOnline: jest.fn(),
  } as unknown as TogetherLobbyPort;
  const stop = bindTogetherLobby(
    {
      getPersistedSession: async () => {
        throw Error("unavailable");
      },
      getSession: jest.fn(),
      onAuthStateChange: () => () => {},
    },
    {
      isConnected: async () => {
        throw Error("network");
      },
      subscribe: () => () => {},
    },
    { currentState: null, addEventListener: () => ({ remove: () => {} }) },
    lobby,
  );
  await flush();
  expect(lobby.setAccount).not.toHaveBeenCalled();
  expect(lobby.setOnline).not.toHaveBeenCalled();
  stop();
});
