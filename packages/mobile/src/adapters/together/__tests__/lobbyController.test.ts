/** @jest-environment node */
import { TogetherProvisioning } from "../provisioning/togetherProvisioning";
import type { TogetherOfflineApi } from "../../../domain/ports/togetherOfflineApi.port";
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import {
  TogetherLobbyController,
  type TogetherLobbyControllerOptions,
} from "../lobbyController";
import { createLobbyInvitation, readLobbyInvitation } from "../lobbyInvitation";
import type { TogetherJournalDatabase } from "../../storage/togetherJournal";
import type {
  TogetherLanNative,
  TogetherLanEvent,
} from "../../../../modules/together-lan";
import type {
  ReadyIdentity,
  TogetherProvisioningPort,
} from "../../../domain/ports/togetherProvisioning.port";
import {
  publicKeyPem,
  signPayload,
  type Credential,
} from "../security/identity";
import { ok, fail } from "../../../shared/errors/result";
const id = (n: number) =>
  `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const now = 1700000000000;
const authority = new Uint8Array(32).fill(77);
const trusted = { v1: publicKeyPem(authority) };
function person(n: number): ReadyIdentity {
  const seed = new Uint8Array(32).fill(n);
  return {
    seed,
    trustedKeys: trusted,
    deviceId: id(n + 10),
    credential: signPayload<Credential>(
      {
        kind: "together-device-v1",
        keyId: "v1",
        userId: id(n),
        deviceId: id(n + 10),
        publicKey: publicKeyPem(seed),
        issuedAt: now - 100,
        expiresAt: now + 60000,
      },
      authority,
    ),
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
    target?.native.emit({ type: "frame", peerId: target.peerId, frame });
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
  for (let i = 0; i < 400; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
describe("reviewed lobby coordinator, real cryptography and SQLite, simulated native LAN", () => {
  const databases: DatabaseSync[] = [];
  const controllers: TogetherLobbyController[] = [];
  function setup(
    n = 1,
    overrides: Partial<TogetherLobbyControllerOptions> = {},
  ) {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    const native = new Native();
    const identity = person(n);
    const provisioning: TogetherProvisioningPort = {
      setAccount: jest.fn(),
      dispose: jest.fn(),
      prepare: jest.fn(async () =>
        ok({ ...identity, seed: identity.seed.slice() }),
      ),
      friendship: jest.fn(async () => ok(null)),
    };
    const controller = new TogetherLobbyController({
      enabled: true,
      provisioning,
      native,
      database: adapter(db),
      randomBytes,
      randomUUID,
      now: () => now,
      ...overrides,
    });
    controllers.push(controller);
    controller.setAccount(id(n));
    return { controller, native, provisioning, db, identity };
  }
  const invitation = (n = 1) => {
    const identity = person(n);
    return createLobbyInvitation(
      {
        sessionId: id(100),
        hostUserId: id(n),
        hostDeviceId: identity.deviceId,
      },
      "Strength A",
      identity.credential,
      identity.seed,
    );
  };
  function friendship(n: number) {
    return signPayload(
      {
        kind: "together-friendship-v1" as const,
        keyId: "v1",
        users: [id(1), id(n)] as [string, string],
        issuedAt: now - 100,
        expiresAt: now + 60000,
      },
      authority,
    );
  }
  async function join(
    host: ReturnType<typeof setup>,
    guest: ReturnType<typeof setup>,
    friend = false,
  ) {
    if (friend)
      jest
        .mocked(guest.provisioning.friendship)
        .mockResolvedValue(
          ok(
            friendship(
              Number.parseInt(
                guest.identity.credential.payload.userId.slice(0, 8),
                16,
              ),
            ),
          ),
        );
    await guest.controller.selectInvite(
      host.controller.getSnapshot().invitation!,
    );
    expect(guest.native.startDiscovery).not.toHaveBeenCalled();
    await guest.controller.join();
    const sessionId = JSON.parse(host.controller.getSnapshot().invitation!)
      .payload.sessionId;
    const peerId = guest.identity.deviceId;
    host.native.targets.set(peerId, { native: guest.native, peerId: "host" });
    guest.native.targets.set("host", { native: host.native, peerId });
    guest.native.emit({
      type: "discovered",
      endpointId: "nearby",
      lobbyId: sessionId,
    });
    await settle();
    host.native.emit({ type: "connected", peerId, incoming: true });
    guest.native.emit({ type: "connected", peerId: "host", incoming: false });
    await settle();
  }
  beforeEach(() => jest.useFakeTimers());
  afterEach(async () => {
    await Promise.all(controllers.splice(0).map((c) => c.dispose()));
    databases.splice(0).forEach((db) => db.close());
    jest.useRealTimers();
  });
  it("friend explicitly joins offline and both rosters reflect independent verified athletes", async () => {
    const host = setup(),
      guest = setup(2);
    await host.controller.host("Strength A");
    await join(host, guest, true);
    expect(guest.controller.getSnapshot()).toMatchObject({
      phase: "joined",
      members: [
        { userId: id(1), host: true },
        { userId: id(2), host: false },
      ],
    });
    expect(host.controller.getSnapshot().pending).toEqual([]);
    expect(guest.provisioning.prepare).toHaveBeenCalledWith({ online: false });
    expect(guest.provisioning.friendship).toHaveBeenCalledWith(id(1), {
      online: false,
    });
    expect(JSON.stringify(guest.controller.getSnapshot())).not.toContain(
      "seed",
    );
  });
  it("strangers remain pending until actual host approval and decline is authenticated", async () => {
    const host = setup(),
      guest = setup(2);
    await host.controller.host("Strength A");
    await join(host, guest);
    expect(guest.controller.getSnapshot().phase).toBe("pending-approval");
    expect(host.controller.getSnapshot().members).toHaveLength(1);
    expect(host.controller.getSnapshot().pending).toEqual([
      { peerId: id(12), userId: id(2) },
    ]);
    await host.controller.approve(id(12));
    await settle();
    expect(guest.controller.getSnapshot().phase).toBe("joined");
    expect(host.controller.getSnapshot().pending).toEqual([]);
    const stranger = setup(3);
    await join(host, stranger);
    await host.controller.decline(id(13));
    await settle();
    expect(stranger.controller.getSnapshot()).toMatchObject({
      phase: "unavailable",
      error: "declined",
    });
  });
  it("enforces four actual athletes and reports authenticated full without stopping host", async () => {
    const host = setup();
    await host.controller.host("Strength A");
    for (let n = 2; n <= 4; n++) {
      const guest = setup(n);
      await join(host, guest, true);
      expect(guest.controller.getSnapshot().phase).toBe("joined");
    }
    const fifth = setup(5);
    await join(host, fifth, true);
    expect(fifth.controller.getSnapshot()).toMatchObject({
      phase: "full",
      error: "full",
    });
    expect(host.controller.getSnapshot()).toMatchObject({
      phase: "hosting",
      members: expect.any(Array),
    });
    expect(host.controller.getSnapshot().members).toHaveLength(4);
  });
  it("approval racing with a final friend admission rejects only the pending peer", async () => {
    const host = setup();
    await host.controller.host("Strength A");
    await join(host, setup(2), true);
    await join(host, setup(3), true);
    const pending = setup(4);
    await join(host, pending);
    await join(host, setup(5), true);
    await host.controller.approve(id(14));
    await settle();
    expect(pending.controller.getSnapshot().phase).toBe("full");
    expect(host.controller.getSnapshot().phase).toBe("hosting");
  });
  it("reconnects using same signed consent and journal after native disconnect", async () => {
    const host = setup(),
      guest = setup(2);
    await host.controller.host("Strength A");
    await join(host, guest, true);
    host.native.emit({ type: "disconnected", peerId: id(12) });
    guest.native.emit({ type: "disconnected", peerId: "host" });
    expect(guest.controller.getSnapshot().phase).toBe("reconnecting");
    await guest.controller.reconnect();
    const sessionId = JSON.parse(host.controller.getSnapshot().invitation!)
      .payload.sessionId;
    guest.native.emit({
      type: "discovered",
      endpointId: "nearby",
      lobbyId: sessionId,
    });
    await settle();
    host.native.emit({ type: "connected", peerId: id(12), incoming: true });
    guest.native.emit({ type: "connected", peerId: "host", incoming: false });
    await settle();
    expect(guest.controller.getSnapshot().phase).toBe("joined");
    expect(guest.controller.getSnapshot().members).toHaveLength(2);
    expect(guest.native.stop).toHaveBeenCalledTimes(1);
  });
  it("discovery session names cannot select or replace a signed host", async () => {
    const guest = setup(2);
    await guest.controller.selectInvite(invitation());
    await guest.controller.join();
    guest.native.emit({
      type: "discovered",
      endpointId: "attacker",
      lobbyId: id(999),
    });
    expect(guest.native.connect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(10001);
    await settle();
    expect(guest.controller.getSnapshot()).toMatchObject({
      phase: "unavailable",
      error: "unreachable-host",
    });
  });
  it.each([
    "expired",
    "offline-unprepared",
    "unauthorized",
    "key-unavailable",
  ] as const)(
    "represents provisioning %s without starting native",
    async (code) => {
      const value = setup();
      jest
        .mocked(value.provisioning.prepare)
        .mockResolvedValue(fail({ kind: "together-provisioning", code }));
      await value.controller.host("A");
      expect(value.controller.getSnapshot()).toMatchObject({
        phase: "unavailable",
        error: code,
      });
      expect(value.native.startHost).not.toHaveBeenCalled();
    },
  );
  it("clears credentials and native resources on expiry, background and account changes", async () => {
    const value = setup();
    const issued = person(1);
    jest.mocked(value.provisioning.prepare).mockResolvedValue(ok(issued));
    await value.controller.host("A");
    value.controller.setActive(false);
    await settle();
    expect(issued.seed.every((n) => n === 0)).toBe(true);
    expect(value.native.stop).toHaveBeenCalledTimes(1);
    expect(value.controller.getSnapshot().phase).toBe("idle");
    value.controller.setActive(true);
    jest.mocked(value.provisioning.prepare).mockResolvedValue(ok(person(1)));
    await value.controller.host("A");
    value.controller.setAccount(id(2));
    await settle();
    expect(value.controller.getSnapshot().members).toEqual([]);
    expect(value.provisioning.setAccount).not.toHaveBeenCalled();
    await value.controller.host("A");
    expect(value.controller.getSnapshot().error).toBe("signed-out");
    value.controller.setAccount(id(1));
    jest.mocked(value.provisioning.prepare).mockResolvedValue(ok(person(1)));
    await value.controller.host("A");
    jest.advanceTimersByTime(60001);
    await settle();
    expect(value.controller.getSnapshot().error).toBe("expired");
  });
  it("zeroes late provisioning results after cancellation and ignores late friendship", async () => {
    const guest = setup(2);
    const pending = deferred<ReturnType<typeof ok<ReadyIdentity>>>();
    jest.mocked(guest.provisioning.prepare).mockReturnValue(pending.promise);
    const selected = guest.controller.selectInvite(invitation());
    await settle();
    await guest.controller.cancel();
    const identity = person(2);
    pending.resolve(ok(identity));
    await selected;
    expect(identity.seed.every((n) => n === 0)).toBe(true);
    expect(guest.controller.getSnapshot().phase).toBe("idle");
    jest.mocked(guest.provisioning.prepare).mockResolvedValue(ok(person(2)));
    await guest.controller.selectInvite(invitation());
    const proof = deferred<ReturnType<typeof ok<null>>>();
    jest.mocked(guest.provisioning.friendship).mockReturnValue(proof.promise);
    const joining = guest.controller.join();
    await guest.controller.cancel();
    proof.resolve(ok(null));
    await joining;
    expect(guest.native.startDiscovery).not.toHaveBeenCalled();
  });
  it("serializes deferred native start, cancellation, then replacement without stale stop", async () => {
    const value = setup();
    const started = deferred<void>();
    value.native.startHost.mockImplementationOnce(() => started.promise);
    const first = value.controller.host("A");
    await settle();
    const cancelled = value.controller.cancel();
    const replacement = value.controller.host("B");
    await settle();
    expect(value.native.stop).not.toHaveBeenCalled();
    expect(value.native.startHost).toHaveBeenCalledTimes(1);
    started.resolve();
    await Promise.all([first, cancelled, replacement]);
    expect(value.controller.getSnapshot()).toMatchObject({
      phase: "hosting",
      selection: { workoutName: "B" },
    });
    expect(value.native.stop).toHaveBeenCalledTimes(1);
    expect(value.native.startHost).toHaveBeenCalledTimes(2);
  });
  it("guards disabled, signed-out and simultaneous user actions", async () => {
    const disabled = setup(1, { enabled: false });
    await disabled.controller.host("A");
    expect(disabled.controller.getSnapshot().phase).toBe("disabled");
    expect(disabled.provisioning.prepare).not.toHaveBeenCalled();
    const value = setup();
    value.controller.setAccount(null);
    await value.controller.host("A");
    expect(value.native.startHost).not.toHaveBeenCalled();
    value.controller.setAccount(id(1));
    await Promise.all([value.controller.host("A"), value.controller.host("B")]);
    expect(value.native.startHost).toHaveBeenCalledTimes(1);
    expect(value.controller.getSnapshot().selection?.workoutName).toBe("B");
    await value.controller.join();
    await value.controller.reconnect();
    await value.controller.dispose();
    await value.controller.host("C");
    expect(value.native.startHost).toHaveBeenCalledTimes(1);
  });
  it("returns honest permission/native/connection errors and isolates observer failures", async () => {
    const value = setup();
    const listener = jest.fn(() => {
      throw new Error("render");
    });
    const unsubscribe = value.controller.subscribe(listener);
    value.native.startHost.mockRejectedValueOnce(
      new Error("permission_denied"),
    );
    await value.controller.host("A");
    expect(value.controller.getSnapshot().error).toBe("permission_denied");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    await value.controller.host("");
    expect(value.controller.getSnapshot().error).toBe("invalid-workout-name");
    const missing = setup(2, { native: null });
    await missing.controller.selectInvite(invitation());
    await missing.controller.join();
    expect(missing.controller.getSnapshot().phase).toBe("unavailable");
    const guest = setup(3);
    await guest.controller.selectInvite(invitation());
    guest.native.connect.mockRejectedValueOnce(new Error("host_unreachable"));
    await guest.controller.join();
    guest.native.emit({
      type: "discovered",
      endpointId: "host",
      lobbyId: id(100),
    });
    await settle();
    expect(guest.controller.getSnapshot().error).toBe("host_unreachable");
  });
  it("rejects invalid friendship authorization and own invitations before sharing", async () => {
    const guest = setup(2);
    await guest.controller.selectInvite(invitation(2));
    expect(guest.controller.getSnapshot().error).toBe("own-invitation");
    await guest.controller.selectInvite(invitation());
    jest
      .mocked(guest.provisioning.friendship)
      .mockResolvedValue(
        fail({ kind: "together-provisioning", code: "invalid-proof" }),
      );
    await guest.controller.join();
    expect(guest.controller.getSnapshot().error).toBe("invalid-proof");
  });
  it("validates invitation signature, bounded summary, strict schema and local trust roots", () => {
    const text = invitation();
    expect(readLobbyInvitation(text, trusted, now).workoutName).toBe(
      "Strength A",
    );
    const changed = JSON.parse(text);
    changed.payload.workoutName = "Fake";
    expect(() =>
      readLobbyInvitation(JSON.stringify(changed), trusted, now),
    ).toThrow("INVALID_PROOF");
    expect(() => readLobbyInvitation(text, {}, now)).toThrow();
    expect(() => readLobbyInvitation(text, trusted, now + 60000)).toThrow(
      "CREDENTIAL_EXPIRED",
    );
    for (const invalid of [
      "x".repeat(6001),
      "{}",
      JSON.stringify({ payload: {}, signature: "" }),
      JSON.stringify({ ...JSON.parse(text), trustedKeys: trusted }),
    ])
      expect(() => readLobbyInvitation(invalid, trusted, now)).toThrow();
    for (const patch of [
      { kind: "wrong" },
      { sessionId: "bad" },
      { workoutName: "" },
      { workoutName: "x".repeat(101) },
      { workoutName: 12 },
      { hostUserId: id(9) },
      { hostDeviceId: id(99) },
    ])
      expect(() =>
        readLobbyInvitation(
          JSON.stringify({
            ...JSON.parse(text),
            payload: { ...JSON.parse(text).payload, ...patch },
          }),
          trusted,
          now,
        ),
      ).toThrow();
    const own = person(1);
    expect(() =>
      createLobbyInvitation(
        { sessionId: id(100), hostUserId: id(1), hostDeviceId: id(11) },
        "x".repeat(101),
        own.credential,
        own.seed,
      ),
    ).toThrow();
  });
  it("known authorization loss immediately clears roster and signing material", async () => {
    const value = setup();
    await value.controller.host("A");
    value.controller.invalidateAuthorization("unauthorized");
    await settle();
    expect(value.controller.getSnapshot()).toMatchObject({
      phase: "unavailable",
      error: "unauthorized",
      members: [],
    });
    expect(value.native.stop).toHaveBeenCalledTimes(1);
    value.controller.setAccount(id(1));
    value.controller.setActive(true);
    value.controller.setOnline(true);
    await value.controller.host("B");
    expect(value.provisioning.prepare).toHaveBeenLastCalledWith({
      online: true,
    });
    value.native.emit({ type: "error", code: "permission_denied" });
    await settle();
    expect(value.controller.getSnapshot().error).toBe("permission_denied");
    const disabled = setup(2, { enabled: undefined });
    disabled.controller.invalidateAuthorization("unauthorized");
    await disabled.controller.selectInvite(invitation());
    expect(disabled.controller.getSnapshot().phase).toBe("disabled");
  });
  it("stale host actions and malformed peers do not destroy other athletes' lobby", async () => {
    const host = setup();
    await host.controller.host("A");
    const guest = setup(2);
    await join(host, guest);
    host.native.emit({
      type: "error",
      peerId: id(12),
      code: "protocol_failed",
    });
    await settle();
    expect(host.controller.getSnapshot().pending).toEqual([]);
    await host.controller.approve(id(12));
    expect(host.controller.getSnapshot()).toMatchObject({
      phase: "hosting",
      error: "approval-failed",
    });
    await host.controller.decline(id(12));
    expect(host.controller.getSnapshot()).toMatchObject({
      phase: "hosting",
      error: "decline-failed",
    });
    const idle = setup(3);
    await idle.controller.approve("missing");
    await idle.controller.decline("missing");
    await idle.controller.reconnect();
    expect(idle.controller.getSnapshot().phase).toBe("idle");
  });
  it("reports transport stop failure, storage close failure and thrown provisioning errors", async () => {
    const stopped = setup();
    await stopped.controller.host("A");
    stopped.native.stop.mockRejectedValueOnce(new Error("native broken"));
    await stopped.controller.cancel();
    expect(stopped.controller.getSnapshot().error).toBe("stop-failed");
    const value = setup();
    await value.controller.host("A");
    value.db.exec("DROP TABLE together_local_closed");
    await value.controller.cancel();
    expect(value.controller.getSnapshot().error).toBe("storage");
    jest.mocked(value.provisioning.prepare).mockRejectedValueOnce("unexpected");
    await value.controller.host("A");
    expect(value.controller.getSnapshot().error).toBe("unavailable");
    jest
      .mocked(value.provisioning.prepare)
      .mockResolvedValueOnce(
        fail({ kind: "together-provisioning", code: "unavailable" }),
      );
    await value.controller.selectInvite(invitation());
    expect(value.controller.getSnapshot().error).toBe("unavailable");
  });
  it("expiry between selection and join stops discovery; selected idle also expires", async () => {
    let time = now;
    const guest = setup(2, { now: () => time });
    await guest.controller.selectInvite(invitation());
    time = now + 60001;
    await guest.controller.join();
    expect(guest.controller.getSnapshot().error).toBe("expired");
    time = now;
    await guest.controller.selectInvite(invitation());
    jest.advanceTimersByTime(60001);
    await settle();
    expect(guest.controller.getSnapshot().error).toBe("expired");
  });
  it("late native failure and rejected late preparation cannot replace fresh state", async () => {
    const host = setup();
    const first = deferred<ReturnType<typeof fail>>();
    jest
      .mocked(host.provisioning.prepare)
      .mockReturnValueOnce(
        first.promise as ReturnType<TogetherProvisioningPort["prepare"]>,
      );
    const abandoned = host.controller.host("A");
    await settle();
    await host.controller.host("B");
    first.resolve(
      fail({ kind: "together-provisioning", code: "unauthorized" }),
    );
    await abandoned;
    expect(host.controller.getSnapshot().selection?.workoutName).toBe("B");
    const oldListener = host.native.listener;
    await host.controller.host("C");
    oldListener?.({ type: "error", code: "native failed" });
    expect(host.controller.getSnapshot().selection?.workoutName).toBe("C");
  });
  it("retries a never-admitted unreachable host and retains owner journal after admitted exit", async () => {
    const host = setup(),
      guest = setup(2);
    await host.controller.host("A");
    await guest.controller.selectInvite(
      host.controller.getSnapshot().invitation!,
    );
    await guest.controller.join();
    jest.advanceTimersByTime(10001);
    await settle();
    expect(guest.controller.getSnapshot().error).toBe("unreachable-host");
    guest.native.startDiscovery.mockClear();
    await join(host, guest, true);
    expect(guest.controller.getSnapshot().phase).toBe("joined");
    guest.db
      .prepare(
        "INSERT INTO together_owner_journal(account_id,command_id,session_id,execution_id,payload) VALUES(?,?,?,?,?)",
      )
      .run(id(2), id(999), id(100), id(200), '{"own":"work"}');
    await guest.controller.cancel();
    expect(
      guest.db
        .prepare(
          "SELECT payload FROM together_owner_journal WHERE account_id=?",
        )
        .get(id(2)),
    ).toEqual({ payload: '{"own":"work"}' });
    expect(
      guest.db
        .prepare(
          "SELECT count(*) AS total FROM together_local_closed WHERE account_id=?",
        )
        .get(id(2)),
    ).toEqual({ total: 1 });
  });
  it.each(["FRIENDSHIP_NOT_ACCEPTED", "network"])(
    "real provisioning translates %s into explicit host approval, never friend admission",
    async (code) => {
      const db = new DatabaseSync(":memory:");
      databases.push(db);
      const storage = adapter(db);
      const secrets = new Map<string, string>();
      const api: TogetherOfflineApi = {
        trust: async () =>
          ok({ publicKeys: trusted, maxCredentialAgeMs: 86400000 }),
        register: async (proof) =>
          ok(
            signPayload(
              {
                kind: "together-device-v1",
                keyId: "v1",
                userId: proof.payload.userId,
                deviceId: proof.payload.deviceId,
                publicKey: proof.payload.publicKey,
                issuedAt: now,
                expiresAt: now + 600000,
              },
              authority,
            ),
          ),
        friendship: async () =>
          code === "network"
            ? fail({ kind: "api", code: "network", message: "offline" })
            : fail({
                kind: "api",
                code: "unknown",
                status: 403,
                togetherCode: code,
                message: "No accepted friendship",
              }),
      };
      const provisioning = new TogetherProvisioning({
        api,
        db: storage,
        secrets: {
          getItemAsync: async (key) => secrets.get(key) ?? null,
          setItemAsync: async (key, value) => {
            secrets.set(key, value);
          },
        },
        environment: "https://api.test",
        randomBytes: (n) => new Uint8Array(randomBytes(n)),
        now: () => now,
        enabled: true,
      });
      provisioning.setAccount(id(2));
      const host = setup(),
        guest = setup(2, { provisioning, database: storage });
      guest.controller.setOnline(true);
      await host.controller.host("A");
      await join(host, guest);
      expect(guest.controller.getSnapshot()).toMatchObject({
        phase: "pending-approval",
        error: undefined,
      });
      expect(host.controller.getSnapshot().members).toHaveLength(1);
      await host.controller.approve(id(12));
      await settle();
      expect(guest.controller.getSnapshot().phase).toBe("joined");
      await guest.controller.cancel();
      provisioning.dispose();
    },
  );
  it("host reuses a previously learned persistent block to refuse admission and preserves its journal", async () => {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    const storage = adapter(db),
      secrets = new Map<string, string>();
    const api: TogetherOfflineApi = {
      trust: async () =>
        ok({ publicKeys: trusted, maxCredentialAgeMs: 86400000 }),
      register: async (proof) =>
        ok(
          signPayload(
            {
              kind: "together-device-v1",
              keyId: "v1",
              userId: proof.payload.userId,
              deviceId: proof.payload.deviceId,
              publicKey: proof.payload.publicKey,
              issuedAt: now,
              expiresAt: now + 600000,
            },
            authority,
          ),
        ),
      friendship: async () =>
        fail({
          kind: "api",
          code: "unknown",
          status: 403,
          togetherCode: "FORBIDDEN",
          message: "Blocked",
        }),
    };
    const provisioning = new TogetherProvisioning({
      api,
      db: storage,
      secrets: {
        getItemAsync: async (key) => secrets.get(key) ?? null,
        setItemAsync: async (key, value) => {
          secrets.set(key, value);
        },
      },
      environment: "https://api.test",
      randomBytes: (n) => new Uint8Array(randomBytes(n)),
      now: () => now,
      enabled: true,
    });
    provisioning.setAccount(id(1));
    expect(
      await provisioning.friendship(id(2), { online: true }),
    ).toMatchObject({ error: { code: "unauthorized" } });
    const host = setup(1, { provisioning, database: storage }),
      guest = setup(2);
    await host.controller.host("A");
    db.prepare(
      "INSERT INTO together_owner_journal(account_id,command_id,session_id,execution_id,payload) VALUES(?,?,?,?,?)",
    ).run(id(1), id(999), id(100), id(200), '{"own":"work"}');
    await join(host, guest, true);
    expect(host.controller.getSnapshot().members).toEqual([
      { userId: id(1), host: true },
    ]);
    expect(host.controller.getSnapshot().pending).toEqual([]);
    expect(guest.controller.getSnapshot().phase).not.toBe("joined");
    expect(host.native.disconnect).toHaveBeenCalledWith(id(12));
    await host.controller.cancel();
    expect(
      db
        .prepare(
          "SELECT payload FROM together_owner_journal WHERE account_id=?",
        )
        .get(id(1)),
    ).toEqual({ payload: '{"own":"work"}' });
    provisioning.dispose();
  });
});
