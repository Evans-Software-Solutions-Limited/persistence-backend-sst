/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import {
  TogetherJournal,
  TogetherJournalDatabase,
} from "../../storage/togetherJournal";
import { TogetherLocalStore, LocalCommand } from "../localStore";
import { TogetherLocalLobby, LocalJoinRequest } from "../localLobby";
import {
  TogetherLanSession,
  LanSessionEvent,
  LanSessionOptions,
} from "../lanSession";
import { LocalSecureChannel } from "../security/channel";
import { commandFromEnvelope, OwnerCommand } from "../localCommand";
import {
  signPayload,
  publicKeyPem,
  Credential,
  JoinConsent,
} from "../security/identity";
import type {
  TogetherLanNative,
  TogetherLanEvent,
} from "../../../../modules/together-lan";
const id = (n: number) =>
  `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const time = 1700000000000;
const authority = new Uint8Array(32).fill(77);
const trusted = { v1: publicKeyPem(authority) };
const pin = { sessionId: id(100), hostUserId: id(1), hostDeviceId: id(11) };
function person(n: number) {
  const seed = new Uint8Array(32).fill(n);
  const credential = signPayload<Credential>(
    {
      kind: "together-device-v1",
      keyId: "v1",
      userId: id(n),
      deviceId: id(n + 10),
      publicKey: publicKeyPem(seed),
      issuedAt: time - 10,
      expiresAt: time + 1000,
    },
    authority,
  );
  const consent = signPayload<JoinConsent>(
    {
      kind: "together-consent-v1",
      ...pin,
      userId: id(n),
      deviceId: id(n + 10),
      executionId: id(n + 20),
      nonce: id(n + 30),
      consentVersion: "together-v1",
      consentAccepted: true,
    },
    seed,
  );
  return { seed, credential, consent };
}
function request(n = 2, friends = false): LocalJoinRequest {
  const { credential, consent } = person(n);
  return {
    credential,
    consent,
    ...(friends
      ? {
          friendship: signPayload(
            {
              kind: "together-friendship-v1" as const,
              keyId: "v1",
              users: [id(1), id(n)] as [string, string],
              issuedAt: time - 10,
              expiresAt: time + 1000,
            },
            authority,
          ),
        }
      : {}),
  };
}
function adapter(db: DatabaseSync): TogetherJournalDatabase {
  return {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, p) => db.prepare(sql).run(...p),
    getFirstSync: <T>(sql: string, p: (string | number | null)[]) =>
      (db.prepare(sql).get(...p) as T | undefined) ?? null,
    getAllSync: <T>(sql: string, p: (string | number | null)[]) =>
      db.prepare(sql).all(...p) as T[],
    withTransactionSync(action) {
      db.exec("BEGIN IMMEDIATE");
      try {
        action();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
function command(changes: Partial<OwnerCommand> = {}, n = 2): LocalCommand {
  return commandFromEnvelope(
    signPayload<OwnerCommand>(
      {
        kind: "together-recovery-v1",
        userId: id(n),
        sessionId: pin.sessionId,
        executionId: id(n + 20),
        commandId: id(200),
        planHash: "a".repeat(64),
        startedAt: time,
        expectedVersion: 0,
        operation: { type: "skip", planExerciseId: id(50), skipped: true },
        ...changes,
      },
      person(n).seed,
    ),
  );
}
class Native implements TogetherLanNative {
  listener?: (event: TogetherLanEvent) => void;
  targets = new Map<string, { native: Native; peerId: string }>();
  startHost = jest.fn(async (_id: string) => {});
  startDiscovery = jest.fn(async () => {});
  connect = jest.fn(async (_id: string) => {});
  stop = jest.fn(async () => {});
  disconnect = jest.fn(async (_id: string) => {});
  send = jest.fn(async (peerId: string, frame: string) => {
    const target = this.targets.get(peerId);
    if (target)
      target.native.emit({ type: "frame", peerId: target.peerId, frame });
  });
  addListener = jest.fn(
    (_name: "onEvent", listener: (event: TogetherLanEvent) => void) => {
      this.listener = listener;
      return {
        remove: () => {
          this.listener = undefined;
        },
      };
    },
  );
  emit(event: TogetherLanEvent) {
    this.listener?.(event);
  }
}
const settle = async () => {
  for (let i = 0; i < 200; i++) await Promise.resolve();
};

describe("LAN session lifecycle with actual crypto and SQLite", () => {
  const databases: DatabaseSync[] = [];
  const sessions: TogetherLanSession[] = [];
  function setup(n: number, overrides: Partial<LanSessionOptions> = {}) {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    const storage = adapter(db);
    const who = person(n);
    const lobby = new TogetherLocalLobby(
      new TogetherLocalStore(storage, id(n)),
      {
        ...pin,
        ...who,
        trustedKeys: trusted,
        now: () => time,
        audience: "open",
        invitedUserIds: [],
        deniedPairs: () => [],
      },
    );
    if (n === 1) lobby.start(who.consent);
    const journal = new TogetherJournal(storage, id(n));
    const native = new Native();
    const events: LanSessionEvent[] = [];
    const factory = (role: "host" | "guest") =>
      new LocalSecureChannel({
        role,
        ...pin,
        ...who,
        trustedKeys: trusted,
        randomBytes: (n) => new Uint8Array(randomBytes(n)),
        now: () => time,
      });
    const options: LanSessionOptions = {
      native,
      lobby,
      journal,
      channelFactory: factory,
      enabled: true,
      onEvent: (event) => events.push(event),
      ...overrides,
    };
    const session = new TogetherLanSession(options);
    sessions.push(session);
    return { native, lobby, journal, events, session, options };
  }
  async function wire(
    host: ReturnType<typeof setup>,
    guest: ReturnType<typeof setup>,
    peerId = "peer",
    friends = true,
    n = 2,
  ) {
    host.native.targets.set(peerId, { native: guest.native, peerId });
    guest.native.targets.set(peerId, { native: host.native, peerId });
    guest.native.emit({
      type: "discovered",
      endpointId: peerId,
      lobbyId: pin.sessionId,
    });
    await guest.session.connect(peerId, request(n, friends));
    host.native.emit({ type: "connected", peerId, incoming: true });
    guest.native.emit({ type: "connected", peerId, incoming: false });
    await settle();
  }
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(async () => {
    for (const session of sessions.splice(0))
      await session.stop().catch(() => {});
    for (const db of databases.splice(0)) db.close();
    jest.useRealTimers();
  });

  it.each(["host", "guest"] as const)(
    "ignores a rejected startup from the previous %s lifecycle",
    async (role) => {
      const state = setup(role === "host" ? 1 : 2);
      let reject!: (error: Error) => void;
      const nativeStart =
        role === "host" ? state.native.startHost : state.native.startDiscovery;
      nativeStart.mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, failure) => {
            reject = failure;
          }),
      );
      const start = () =>
        role === "host"
          ? state.session.startHost()
          : state.session.startDiscovery();
      const old = start();
      const failure = expect(old).rejects.toThrow("old startup");
      await state.session.stop();
      await start();
      const activeListener = state.native.listener;
      reject(new Error("old startup"));
      await failure;
      expect(state.native.listener).toBe(activeListener);
      expect(state.native.stop).toHaveBeenCalledTimes(1);
      await expect(start()).rejects.toThrow("lifecycle");
    },
  );

  it("keeps a new connect request and deadline when an old lifecycle's connect rejects", async () => {
    const guest = setup(2);
    await guest.session.startDiscovery();
    guest.native.emit({
      type: "discovered",
      endpointId: "old",
      lobbyId: pin.sessionId,
    });
    let reject!: (error: Error) => void;
    guest.native.connect.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, failure) => {
          reject = failure;
        }),
    );
    const old = guest.session.connect("old", request());
    const failure = expect(old).rejects.toThrow("old connect");
    await guest.session.stop();
    await guest.session.startDiscovery();
    guest.native.emit({
      type: "discovered",
      endpointId: "new",
      lobbyId: pin.sessionId,
    });
    await guest.session.connect("new", request());
    reject(new Error("old connect"));
    await failure;
    await expect(guest.session.connect("new", request())).rejects.toThrow(
      "busy",
    );
    jest.advanceTimersByTime(10_000);
    await settle();
    expect(guest.events).toContainEqual({
      type: "error",
      code: "connect_timeout",
    });
  });

  it("does not disconnect a replacement peer when an old approval send rejects", async () => {
    const host = setup(1),
      guest = setup(2);
    await host.session.startHost();
    await guest.session.startDiscovery();
    await wire(host, guest, "peer", false);
    let reject!: (error: Error) => void;
    host.native.send.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, failure) => {
          reject = failure;
        }),
    );
    const approval = host.session.approve("peer");
    const failure = expect(approval).rejects.toThrow("old approval");
    await settle();
    await host.session.stop();
    await guest.session.stop();
    await host.session.startHost();
    await guest.session.startDiscovery();
    await wire(host, guest, "peer");
    const disconnects = host.native.disconnect.mock.calls.length;
    reject(new Error("old approval"));
    await failure;
    await settle();
    expect(host.native.disconnect).toHaveBeenCalledTimes(disconnects);
    await guest.session.sendOwn(command());
    await settle();
    expect(guest.journal.list(pin.sessionId, id(22))[0].peerReceipts).toEqual([
      id(1),
    ]);
  });

  it("does not publish an old successful approval continuation into a restarted lobby", async () => {
    const host = setup(1),
      guest = setup(2);
    await host.session.startHost();
    await guest.session.startDiscovery();
    await wire(host, guest, "peer", false);
    let release!: () => void;
    const realSend = host.native.send.getMockImplementation()!;
    let sends = 0;
    host.native.send.mockImplementation(async (peerId, frame) => {
      sends++;
      // The final roster write is already handed to native when the lifecycle ends.
      if (sends === 2)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      else await realSend(peerId, frame);
    });
    const approval = host.session.approve("peer");
    await settle();
    await host.session.stop();
    await guest.session.stop();
    host.native.send.mockImplementation(realSend);
    await host.session.startHost();
    await guest.session.startDiscovery();
    await wire(host, guest, "peer");
    const eventCount = host.events.length;
    release();
    await approval;
    await settle();
    expect(host.events).toHaveLength(eventCount);
  });

  it("binds account/options and recovers from listener failure without leaking lifecycle state", async () => {
    const host = setup(1),
      guest = setup(2);
    expect(
      () => new TogetherLanSession({ ...host.options, journal: guest.journal }),
    ).toThrow("account");
    host.options.enabled = false;
    host.options.native = null;
    host.native.addListener.mockImplementationOnce(() => {
      throw new Error("subscription");
    });
    await expect(host.session.startHost()).rejects.toThrow("subscription");
    await host.session.startHost();
    expect(host.native.startHost).toHaveBeenCalledTimes(1);
    const throwingUi = setup(1, {
      onEvent: () => {
        throw new Error("UI");
      },
    });
    await throwingUi.session.startHost();
    throwingUi.native.emit({
      type: "connected",
      peerId: "peer",
      incoming: true,
    });
    await throwingUi.session.stop();
    expect(jest.getTimerCount()).toBe(0);
  });

  it("closes approval, roster fanout and initial-handshake send failures", async () => {
    const host = setup(1),
      guest = setup(2),
      third = setup(3);
    await host.session.startHost();
    await guest.session.startDiscovery();
    await third.session.startDiscovery();
    await wire(host, guest, "pending", false);
    host.native.send.mockRejectedValueOnce(new Error("approval transport"));
    await expect(host.session.approve("pending")).rejects.toThrow(
      "approval transport",
    );
    expect(host.events).toContainEqual({
      type: "error",
      code: "approval_failed",
      peerId: "pending",
    });
    guest.native.emit({ type: "disconnected", peerId: "pending" });
    await wire(host, guest, "live");
    const realSend = host.native.send.getMockImplementation()!;
    host.native.send.mockImplementation(async (peerId, frame) => {
      if (peerId === "live") throw new Error("fanout transport");
      await realSend(peerId, frame);
    });
    await wire(host, third, "third", true, 3);
    expect(host.events).toContainEqual({
      type: "error",
      code: "roster_failed",
      peerId: "live",
    });
    const failing = setup(4);
    await failing.session.startDiscovery();
    failing.native.send.mockRejectedValueOnce(new Error("handshake transport"));
    failing.native.emit({
      type: "discovered",
      endpointId: "fresh",
      lobbyId: pin.sessionId,
    });
    await failing.session.connect("fresh", request(4));
    failing.native.emit({
      type: "connected",
      peerId: "fresh",
      incoming: false,
    });
    await settle();
    expect(failing.events).toContainEqual({
      type: "error",
      code: "handshake_failed",
      peerId: "fresh",
    });
  });

  it("does not reopen during asynchronous stop and handles native failure before connected", async () => {
    const guest = setup(2);
    await guest.session.startDiscovery();
    guest.native.emit({
      type: "discovered",
      endpointId: "peer",
      lobbyId: pin.sessionId,
    });
    await guest.session.connect("peer", request());
    guest.native.emit({
      type: "error",
      code: "connect_failed",
      peerId: "not-yet-connected",
    });
    await guest.session.connect("peer", request());
    let finish!: () => void;
    guest.native.stop.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const stopping = guest.session.stop();
    await expect(guest.session.startDiscovery()).rejects.toThrow("lifecycle");
    finish();
    await stopping;
    expect(jest.getTimerCount()).toBe(0);
  });

  it("requires explicit enablement, compatible native binary and correct role", async () => {
    await expect(
      setup(1, { enabled: undefined }).session.startHost(),
    ).rejects.toThrow("disabled");
    await expect(
      setup(1, { native: null }).session.startHost(),
    ).rejects.toThrow("compatible");
    await expect(setup(2).session.startHost()).rejects.toThrow("lifecycle");
    await expect(setup(1).session.startDiscovery()).rejects.toThrow(
      "lifecycle",
    );
    const host = setup(1);
    await host.session.startHost();
    await expect(host.session.startHost()).rejects.toThrow("lifecycle");
    expect(host.native.startHost).toHaveBeenCalledWith(pin.sessionId);
  });

  it("cleans up listeners when native startup fails", async () => {
    const host = setup(1);
    host.native.startHost.mockRejectedValueOnce(new Error("permission"));
    await expect(host.session.startHost()).rejects.toThrow("permission");
    expect(host.native.listener).toBeUndefined();
    const guest = setup(2);
    guest.native.startDiscovery.mockRejectedValueOnce(new Error("wifi"));
    await expect(guest.session.startDiscovery()).rejects.toThrow("wifi");
    expect(guest.native.stop).toHaveBeenCalledTimes(1);
  });

  it("bounds discovery, pins the session, removes lost endpoints and prevents duplicate connections", async () => {
    const guest = setup(2);
    await guest.session.startDiscovery();
    guest.native.emit({
      type: "discovered",
      endpointId: "wrong",
      lobbyId: id(99),
    });
    for (let i = 0; i < 65; i++)
      guest.native.emit({
        type: "discovered",
        endpointId: String(i),
        lobbyId: pin.sessionId,
      });
    expect(
      guest.events.filter((event) => event.type === "discovered"),
    ).toHaveLength(64);
    guest.native.emit({
      type: "discovered",
      endpointId: "0",
      lobbyId: pin.sessionId,
    });
    guest.native.emit({ type: "lost", endpointId: "0" });
    guest.native.emit({ type: "lost", endpointId: "missing" });
    await expect(guest.session.connect("0", request())).rejects.toThrow(
      "endpoint",
    );
    await expect(guest.session.connect("wrong", request())).rejects.toThrow(
      "endpoint",
    );
    await expect(guest.session.connect("1", request(3))).rejects.toThrow(
      "identity",
    );
    guest.native.connect.mockRejectedValueOnce(new Error("network"));
    await expect(guest.session.connect("1", request())).rejects.toThrow(
      "network",
    );
    await guest.session.connect("1", request());
    await expect(guest.session.connect("2", request())).rejects.toThrow(
      "endpoint",
    );
    jest.advanceTimersByTime(10_000);
    await settle();
    expect(guest.events).toContainEqual({
      type: "error",
      code: "connect_timeout",
    });
    expect(guest.native.stop).toHaveBeenCalledTimes(1);
  });

  it("admits friends, delivers durable receipts, replays after reconnect and heartbeats", async () => {
    const host = setup(1),
      guest = setup(2);
    await host.session.startHost();
    await guest.session.startDiscovery();
    await wire(host, guest);
    expect(guest.events).toContainEqual({ type: "admitted", peerId: "peer" });
    expect(host.events).toContainEqual({ type: "admitted", peerId: "peer" });
    await guest.session.sendOwn(command());
    await settle();
    expect(guest.journal.list(pin.sessionId, id(22))[0].peerReceipts).toEqual([
      id(1),
    ]);
    expect(guest.events).toContainEqual({ type: "receipt", peerId: "peer" });
    expect(host.events).toContainEqual({ type: "command", peerId: "peer" });
    jest.advanceTimersByTime(10_000);
    await settle();
    expect(guest.events.filter((event) => event.type === "error")).toEqual([]);
    host.native.emit({ type: "disconnected", peerId: "peer" });
    guest.native.emit({ type: "disconnected", peerId: "peer" });
    const next = command({ commandId: id(201), expectedVersion: 1 });
    await guest.session.sendOwn(next);
    expect(guest.journal.list(pin.sessionId, id(22))).toHaveLength(2);
    await wire(host, guest, "new");
    expect(guest.journal.list(pin.sessionId, id(22))[1].peerReceipts).toEqual([
      id(1),
    ]);
    expect(guest.native.connect).toHaveBeenCalledTimes(2);
  });

  it("requires explicit stranger approval, exposes a copy and broadcasts the expanded roster", async () => {
    const host = setup(1),
      guest = setup(2),
      third = setup(3);
    await host.session.startHost();
    await guest.session.startDiscovery();
    await third.session.startDiscovery();
    await wire(host, guest);
    await wire(host, third, "third", false, 3);
    expect(host.events).toContainEqual({
      type: "approval-required",
      peerId: "third",
      request: request(3),
    });
    expect(third.events).toContainEqual({
      type: "approval-required",
      peerId: "third",
      request: undefined,
    });
    const copied = host.session.pendingRequest("third")!;
    copied.credential.payload.userId = id(99);
    expect(host.session.pendingRequest("third")).toEqual(request(3));
    expect(host.session.pendingRequest("missing")).toBeUndefined();
    await host.session.approve("third");
    await settle();
    expect(
      guest.lobby.store.current(pin.sessionId)?.payload.members,
    ).toHaveLength(3);
    expect(third.events).toContainEqual({ type: "admitted", peerId: "third" });
    await expect(host.session.approve("third")).rejects.toThrow("No pending");
    await expect(guest.session.approve("peer")).rejects.toThrow("No pending");
  });

  it("disconnects unauthenticated peers and caps links without exposing plaintext", async () => {
    const host = setup(1);
    await host.session.startHost();
    host.native.emit({
      type: "discovered",
      endpointId: "ignore",
      lobbyId: pin.sessionId,
    });
    host.native.emit({ type: "connected", peerId: "wrong", incoming: false });
    for (let i = 0; i < 9; i++)
      host.native.emit({
        type: "connected",
        peerId: String(i),
        incoming: true,
      });
    host.native.emit({ type: "connected", peerId: "0", incoming: true });
    host.native.emit({ type: "frame", peerId: "unknown", frame: "secret" });
    expect(host.native.disconnect).toHaveBeenCalledWith("8");
    expect(host.native.disconnect).toHaveBeenCalledWith("wrong");
    jest.advanceTimersByTime(10_000);
    await settle();
    expect(host.events).toContainEqual({
      type: "error",
      code: "authentication_timeout",
      peerId: "1",
    });
    expect(jest.getTimerCount()).toBe(0);
    const guest = setup(2);
    await guest.session.startDiscovery();
    guest.native.emit({
      type: "connected",
      peerId: "unsolicited",
      incoming: false,
    });
    expect(guest.native.disconnect).toHaveBeenCalledWith("unsolicited");
  });

  it("limits unactioned admission and frame queues", async () => {
    const host = setup(1),
      guest = setup(2);
    await host.session.startHost();
    await guest.session.startDiscovery();
    await wire(host, guest, "pending", false);
    jest.advanceTimersByTime(60_000);
    await settle();
    expect(host.events).toContainEqual({
      type: "error",
      code: "admission_timeout",
      peerId: "pending",
    });
    host.native.emit({ type: "connected", peerId: "flood", incoming: true });
    for (let i = 0; i < 17; i++)
      host.native.emit({ type: "frame", peerId: "flood", frame: "malformed" });
    await settle();
    expect(host.events).toContainEqual({
      type: "error",
      code: "frame_queue_full",
      peerId: "flood",
    });
  });

  it("closes invalid channels and protocol messages, handles native errors and ignores stale callbacks", async () => {
    const invalid = setup(1, {
      channelFactory: () => {
        throw new Error("bad key");
      },
    });
    await invalid.session.startHost();
    invalid.native.emit({ type: "connected", peerId: "bad", incoming: true });
    expect(invalid.events).toContainEqual({
      type: "error",
      code: "channel_failed",
      peerId: "bad",
    });
    const host = setup(1);
    await host.session.startHost();
    host.native.emit({ type: "connected", peerId: "bad", incoming: true });
    host.native.emit({ type: "frame", peerId: "bad", frame: "not-json" });
    await settle();
    expect(host.events).toContainEqual({
      type: "error",
      code: "protocol_failed",
      peerId: "bad",
    });
    host.native.disconnect.mockRejectedValueOnce(new Error("gone"));
    host.native.emit({ type: "error", code: "read_failed", peerId: "unknown" });
    await settle();
    expect(host.events).toContainEqual({
      type: "error",
      code: "disconnect_failed",
      peerId: "unknown",
    });
    const callback = host.native.listener!;
    await host.session.stop();
    const count = host.events.length;
    callback({ type: "connected", peerId: "stale", incoming: true });
    expect(host.events).toHaveLength(count);
    await host.session.stop();
    expect(host.native.stop).toHaveBeenCalledTimes(1);
    const next = setup(2);
    await next.session.startDiscovery();
    next.native.stop.mockRejectedValueOnce(new Error("failed"));
    next.native.emit({ type: "error", code: "wifi_lost" });
    await settle();
    expect(next.events).toContainEqual({ type: "error", code: "stop_failed" });
  });

  it("preserves own journal when sending fails, rejects foreign execution and shuts down failed heartbeats", async () => {
    const host = setup(1),
      guest = setup(2);
    await host.session.startHost();
    await guest.session.startDiscovery();
    await wire(host, guest);
    await expect(guest.session.sendOwn(command({}, 3))).rejects.toThrow();
    await expect(
      guest.session.sendOwn(command({ executionId: id(99) })),
    ).rejects.toThrow("execution");
    guest.native.send.mockRejectedValueOnce(new Error("offline"));
    await expect(guest.session.sendOwn(command())).rejects.toThrow("offline");
    expect(guest.journal.list(pin.sessionId, id(22))).toHaveLength(1);
    host.native.emit({ type: "disconnected", peerId: "peer" });
    await wire(host, guest, "again");
    guest.native.send.mockRejectedValueOnce(new Error("offline"));
    jest.advanceTimersByTime(10_000);
    await settle();
    expect(guest.events).toContainEqual({
      type: "error",
      code: "heartbeat_failed",
      peerId: "again",
    });
  });
});
