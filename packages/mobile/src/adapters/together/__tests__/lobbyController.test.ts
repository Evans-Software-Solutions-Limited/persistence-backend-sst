/** @jest-environment node */
import type { WorkoutSession } from "../../../domain/models/session";
import { TogetherProvisioning } from "../provisioning/togetherProvisioning";
import type {
  TogetherOfflineApi,
  TogetherRecoveryApi,
} from "../../../domain/ports/togetherOfflineApi.port";
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
  function workout(n = 1): WorkoutSession {
    return {
      id: "local-session",
      userId: id(n),
      workoutId: null,
      name: "Strength A",
      status: "in_progress",
      startedAt: new Date(now - 10000).toISOString(),
      completedAt: null,
      notes: "Keep personal",
      exercises: [
        {
          id: "local-exercise",
          sessionId: "local-session",
          exerciseId: id(500),
          exerciseName: "Squat",
          category: "strength",
          sortOrder: 0,
          supersetGroup: null,
          isSubstituted: false,
          originalExerciseId: null,
          notes: null,
          sets: [
            {
              id: "local-set",
              sessionExerciseId: "local-exercise",
              setNumber: 1,
              weightKg: 20,
              reps: 10,
              rpe: null,
              durationSeconds: null,
              distanceMeters: null,
              isCompleted: false,
              completedAt: null,
            },
          ],
        },
      ],
    };
  }
  it("promotes admitted independent own executions and keeps full journals private instead of claiming projection receipts as journal acknowledgements", async () => {
    const host = setup(),
      guest = setup(2);
    await expect(host.controller.workout.promote(workout())).rejects.toThrow(
      "workout-not-admitted",
    );
    await host.controller.host("Strength A");
    await join(host, guest);
    await expect(guest.controller.workout.promote(workout(2))).rejects.toThrow(
      "workout-not-admitted",
    );
    await host.controller.approve(id(12));
    await settle();
    await host.controller.workout.promote(workout());
    await guest.controller.workout.promote(workout(2));
    await settle();
    const hostStatus = host.controller.workout.status(id(1), "local-session")!;
    const guestStatus = guest.controller.workout.status(
      id(2),
      "local-session",
    )!;
    expect(hostStatus).toMatchObject({
      sharing: "active",
      receivedCount: 0,
      pendingCount: 1,
    });
    expect(guestStatus).toMatchObject({
      sharing: "active",
      receivedCount: 0,
      pendingCount: 1,
    });
    expect(hostStatus.sessionId).toBe(guestStatus.sessionId);
    expect(hostStatus.executionId).not.toBe(guestStatus.executionId);
    expect(host.controller.workout.read(id(2), "local-session")).toBeNull();
    guest.native.emit({ type: "disconnected", peerId: "host" });
    host.native.emit({ type: "disconnected", peerId: id(12) });
    let edited = guest.controller.workout.read(id(2), "local-session")!;
    edited.exercises[0].sets[0].reps = 12;
    guest.controller.workout.save(id(2), edited);
    await settle();
    expect(guest.controller.workout.status(id(2), edited.id)).toMatchObject({
      sharing: "reconnecting",
      pendingCount: 2,
      receivedCount: 0,
    });
    await guest.controller.reconnect();
    expect(guest.controller.workout.status(id(2), edited.id)?.sharing).toBe(
      "reconnecting",
    );
    guest.native.emit({
      type: "discovered",
      endpointId: "back",
      lobbyId: guestStatus.sessionId,
    });
    await settle();
    host.native.emit({ type: "connected", peerId: id(12), incoming: true });
    guest.native.emit({ type: "connected", peerId: "host", incoming: false });
    await settle();
    expect(guest.controller.workout.status(id(2), edited.id)).toMatchObject({
      sharing: "active",
      pendingCount: 2,
      receivedCount: 0,
      executionId: guestStatus.executionId,
    });
    const stale = guest.native.listener;
    guest.controller.setActive(false);
    await settle();
    edited = guest.controller.workout.read(id(2), "local-session")!;
    edited.exercises[0].sets[0].reps = 13;
    guest.controller.workout.save(id(2), edited);
    stale?.({ type: "frame", peerId: "host", frame: "late" });
    await settle();
    expect(guest.controller.workout.status(id(2), edited.id)).toMatchObject({
      sharing: "local-only",
      pendingCount: 3,
      receivedCount: 0,
    });
    expect(
      guest.controller.workout.read(id(2), edited.id)?.exercises[0].sets[0]
        .reps,
    ).toBe(13);
    guest.controller.setAccount(id(3));
    expect(guest.controller.workout.read(id(2), edited.id)).toBeNull();
  });
  it("expired authority cannot sign and cancellation during checkpoint notification cannot send", async () => {
    let time = now;
    const host = setup(1, { now: () => time });
    await host.controller.host("Strength A");
    let cancelled = false;
    const cancel = host.controller.workout.subscribe(() => {
      if (cancelled) return;
      cancelled = true;
      void host.controller.cancel();
    });
    await host.controller.workout.promote(workout());
    cancel();
    expect(host.native.send).not.toHaveBeenCalled();
    expect(
      host.controller.workout.status(id(1), "local-session")?.sharing,
    ).toBe("local-only");
    await host.controller.host("Strength A");
    time = now + 60001;
    const source = workout();
    source.id = "other";
    await expect(host.controller.workout.promote(source)).rejects.toThrow(
      "workout-not-admitted",
    );
  });
  beforeEach(() => jest.useFakeTimers());
  afterEach(async () => {
    await Promise.all(controllers.splice(0).map((c) => c.dispose()));
    databases.splice(0).forEach((db) => db.close());
    jest.useRealTimers();
  });
  it.each([
    ["provisioning", false],
    ["provisioning", true],
    ["policy", false],
    ["policy", true],
  ] as const)(
    "blocked host invitation uses unavailable copy (%s, reversed=%s)",
    async (source, reversed) => {
      const pairs = () =>
        [[id(reversed ? 2 : 1), id(reversed ? 1 : 2)]] as const;
      const guest = setup(2, source === "policy" ? { deniedPairs: pairs } : {});
      if (source === "provisioning") guest.provisioning.deniedPairs = pairs;
      await guest.controller.selectInvite(invitation());
      expect(guest.controller.getSnapshot()).toMatchObject({
        phase: "unavailable",
        error: "host-unavailable",
        members: [],
        pending: [],
      });
      expect(guest.controller.getSnapshot().selection).toBeUndefined();
      await guest.controller.join();
      expect(guest.native.startDiscovery).not.toHaveBeenCalled();
      expect(guest.native.connect).not.toHaveBeenCalled();
    },
  );

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
  async function probe(
    host: ReturnType<typeof setup>,
    guest: ReturnType<typeof setup>,
    endpointId = "nearby",
  ) {
    const sessionId = JSON.parse(host.controller.getSnapshot().invitation!)
      .payload.sessionId;
    const peerId = `probe-${endpointId}`;
    host.native.targets.set(peerId, {
      native: guest.native,
      peerId: "probe-host",
    });
    guest.native.targets.set("probe-host", { native: host.native, peerId });
    guest.native.emit({ type: "discovered", endpointId, lobbyId: sessionId });
    await settle();
    host.native.emit({ type: "connected", peerId, incoming: true });
    guest.native.emit({
      type: "connected",
      peerId: "probe-host",
      incoming: false,
    });
    await settle();
    return sessionId;
  }
  it("open browsing authenticates host summaries without sharing visitor identity or recording consent", async () => {
    const host = setup(),
      guest = setup(2);
    await host.controller.host("Open workout", "open");
    await guest.controller.browse();
    const sessionId = await probe(host, guest);
    expect(guest.controller.getSnapshot()).toMatchObject({
      phase: "browsing",
      discovered: [
        {
          sessionId,
          hostUserId: id(1),
          workoutName: "Open workout",
          memberCount: 1,
        },
      ],
    });
    expect(guest.provisioning.friendship).not.toHaveBeenCalled();
    expect(host.controller.getSnapshot().pending).toEqual([]);
    expect(host.controller.getSnapshot().members).toHaveLength(1);
    for (const [, frame] of guest.native.send.mock.calls)
      expect(JSON.parse(frame)).toEqual({
        kind: "together-probe-v1",
        nonce: expect.any(String),
      });
    await guest.controller.selectDiscovered(sessionId);
    expect(guest.controller.getSnapshot().phase).toBe("selected");
    expect(guest.native.stop).toHaveBeenCalled();
    expect(guest.provisioning.friendship).not.toHaveBeenCalled();
    await guest.controller.join();
    const peerId = guest.identity.deviceId;
    host.native.targets.set(peerId, { native: guest.native, peerId: "host" });
    guest.native.targets.set("host", { native: host.native, peerId });
    guest.native.emit({
      type: "discovered",
      endpointId: "real",
      lobbyId: sessionId,
    });
    await settle();
    host.native.emit({ type: "connected", peerId, incoming: true });
    guest.native.emit({ type: "connected", peerId: "host", incoming: false });
    await settle();
    expect(guest.controller.getSnapshot().phase).toBe("pending-approval");
    await host.controller.approve(peerId);
    await settle();
    expect(guest.controller.getSnapshot().phase).toBe("joined");
  });
  it("private hosts never disclose summary; their invite token admits only through normal approval", async () => {
    const host = setup(),
      guest = setup(2);
    await host.controller.host("Private");
    const invite = JSON.parse(
      host.controller.getSnapshot().invitation!,
    ).payload;
    expect(invite).toMatchObject({
      kind: "together-invitation-v2",
      audience: "invite-only",
      invitationToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    await guest.controller.browse();
    await probe(host, guest);
    expect(guest.controller.getSnapshot().discovered).toEqual([]);
    expect(host.native.send).not.toHaveBeenCalled();
    await guest.controller.cancel();
    guest.native.startDiscovery.mockClear();
    await join(host, guest);
    expect(guest.controller.getSnapshot().phase).toBe("pending-approval");
  });
  it("forged summaries and replayed nonces never reach discovery UI", async () => {
    const host = setup(),
      guest = setup(2);
    await host.controller.host("Open", "open");
    await guest.controller.browse();
    const sessionId = await probe(host, guest);
    const frame = host.native.send.mock.calls[0][1];
    await guest.controller.browse();
    guest.native.emit({
      type: "discovered",
      endpointId: "evil",
      lobbyId: sessionId,
    });
    guest.native.emit({ type: "connected", peerId: "evil", incoming: false });
    guest.native.emit({ type: "frame", peerId: "evil", frame });
    await settle();
    expect(guest.controller.getSnapshot().discovered).toEqual([]);
    guest.native.emit({
      type: "discovered",
      endpointId: "forged",
      lobbyId: sessionId,
    });
    guest.native.emit({ type: "connected", peerId: "forged", incoming: false });
    const envelope = JSON.parse(frame);
    envelope.payload.nonce = JSON.parse(
      guest.native.send.mock.calls.at(-1)![1],
    ).nonce;
    envelope.payload.workoutName = "forged";
    guest.native.emit({
      type: "frame",
      peerId: "forged",
      frame: JSON.stringify(envelope),
    });
    await settle();
    expect(guest.controller.getSnapshot().discovered).toEqual([]);
  });
  it("filters known denied host pairs and removes lost or expired summaries", async () => {
    let clock = now;
    const host = setup(),
      guest = setup(2, { now: () => clock });
    await host.controller.host("Open", "open");
    await guest.controller.browse();
    await probe(host, guest);
    expect(guest.controller.getSnapshot().discovered).toHaveLength(1);
    guest.native.emit({ type: "lost", endpointId: "nearby" });
    expect(guest.controller.getSnapshot().discovered).toHaveLength(0);
    await probe(host, guest, "another");
    clock += 16000;
    jest.advanceTimersByTime(1000);
    expect(guest.controller.getSnapshot().discovered).toHaveLength(0);
    const denied = setup(3, { deniedPairs: () => [[id(1), id(3)]] });
    await denied.controller.browse();
    await probe(host, denied, "denied");
    expect(denied.controller.getSnapshot().discovered).toEqual([]);
  });
  it("ends a timed-out browse generation before a late connection can be attributed to another endpoint", async () => {
    const guest = setup(2);
    await guest.controller.browse();
    const stale = guest.native.listener!;
    guest.native.emit({
      type: "discovered",
      endpointId: "first",
      lobbyId: id(100),
    });
    guest.native.emit({
      type: "discovered",
      endpointId: "second",
      lobbyId: id(101),
    });
    expect(guest.native.connect).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(5000);
    await settle();
    stale({ type: "connected", peerId: "late", incoming: false });
    expect(guest.native.send).not.toHaveBeenCalled();
    expect(guest.controller.getSnapshot()).toMatchObject({
      phase: "unavailable",
      error: "unreachable-host",
    });
    expect(guest.native.connect).toHaveBeenCalledTimes(1);
  });
  it.each(["cancel", "background", "account"])(
    "invalidates browse callbacks on %s",
    async (reason) => {
      const guest = setup(2);
      await guest.controller.browse();
      const stale = guest.native.listener!;
      if (reason === "cancel") await guest.controller.cancel();
      else if (reason === "background") guest.controller.setActive(false);
      else guest.controller.setAccount(id(3));
      await settle();
      stale({ type: "discovered", endpointId: "late", lobbyId: id(100) });
      expect(guest.native.connect).not.toHaveBeenCalled();
      expect(guest.controller.getSnapshot().phase).toBe("idle");
    },
  );
  it("browse preparation obeys disabled, unavailable identity and missing native states", async () => {
    const disabled = setup(2, { enabled: false });
    await disabled.controller.browse();
    expect(disabled.provisioning.prepare).not.toHaveBeenCalled();
    const failed = setup(3);
    jest
      .mocked(failed.provisioning.prepare)
      .mockResolvedValueOnce(
        fail({ kind: "together-provisioning", code: "offline-unprepared" }),
      );
    await failed.controller.browse();
    expect(failed.native.startDiscovery).not.toHaveBeenCalled();
    const absent = setup(4, { native: null });
    await absent.controller.browse();
    expect(absent.controller.getSnapshot().phase).toBe("unavailable");
  });
  it("cancellation or expiry while selecting a verified summary cannot retain a stale pin", async () => {
    let clock = now;
    const host = setup(),
      guest = setup(2, { now: () => clock });
    await host.controller.host("Open", "open");
    await guest.controller.browse();
    const session = await probe(host, guest);
    await guest.controller.selectDiscovered("missing");
    expect(guest.controller.getSnapshot().phase).toBe("browsing");
    const stopping = deferred<void>();
    guest.native.stop.mockImplementationOnce(() => stopping.promise);
    const selection = guest.controller.selectDiscovered(session);
    await settle();
    clock += 16000;
    stopping.resolve();
    await selection;
    expect(guest.controller.getSnapshot()).toMatchObject({
      phase: "unavailable",
      error: "discovery-expired",
    });
    clock = now;
    await guest.controller.browse();
    await probe(host, guest, "again");
    const second = deferred<void>();
    guest.native.stop.mockImplementationOnce(() => second.promise);
    const cancelled = guest.controller.selectDiscovered(session);
    await settle();
    const cleanup = guest.controller.cancel();
    second.resolve();
    await Promise.all([cancelled, cleanup]);
    expect(guest.controller.getSnapshot().phase).toBe("idle");
  });
  it("verified selection remains readable beyond listing freshness while Join reauthenticates the host", async () => {
    let clock = now;
    const host = setup(),
      guest = setup(2, { now: () => clock });
    await host.controller.host("Open", "open");
    await guest.controller.browse();
    const session = await probe(host, guest);
    await guest.controller.selectDiscovered(session);
    clock += 16000;
    jest.advanceTimersByTime(16000);
    expect(guest.controller.getSnapshot().phase).toBe("selected");
    await guest.controller.join();
    expect(guest.controller.getSnapshot().phase).toBe("searching");
  });
  async function sharedPair() {
    const host = setup(),
      guest = setup(2);
    await host.controller.host("Strength A");
    await join(host, guest, true);
    await host.controller.workout.promote(workout());
    await guest.controller.workout.promote(workout(2));
    await settle();
    await host.controller.shared.publishPlan(
      host.controller.workout.getPlan(id(1), "local-session")!,
    );
    await settle();
    return { host, guest };
  }
  it("composes named profiles, independent plans and projection receipts without journal acknowledgement", async () => {
    const { host, guest } = await sharedPair();
    await host.controller.shared.publishProfile("Brad");
    await guest.controller.shared.publishProfile("Sam");
    await settle();
    expect(host.controller.shared.getSnapshot().profiles[id(2)]).toBe("Sam");
    expect(guest.controller.shared.getSnapshot().profiles[id(1)]).toBe("Brad");
    expect(
      guest.controller.shared
        .getSnapshot()
        .athletes.some((a) => a.userId === id(1)),
    ).toBe(false);
    await host.controller.shared.setConsent(id(2), {
      numbers: true,
      prev: false,
      logging: false,
    });
    await settle();
    expect(
      guest.controller.shared
        .getSnapshot()
        .athletes.some((a) => a.userId === id(1)),
    ).toBe(true);
    expect(host.controller.shared.getSnapshot().deliveries[0].state).toBe(
      "received",
    );
    expect(
      host.controller.workout.status(id(1), "local-session")!.receivedCount,
    ).toBe(0);
    host.controller.setActive(false);
    await settle();
    expect(host.controller.shared.getSnapshot().athletes).toEqual([]);
    expect(host.controller.workout.getActive(id(1))?.notes).toBe(
      "Keep personal",
    );
    expect(() => host.controller.shared.publishProfile("Late")).toThrow();
  });
  it("host removal becomes terminal sharing loss while both athletes retain personal results", async () => {
    const { host, guest } = await sharedPair();
    await host.controller.shared.setConsent(id(2), {
      numbers: true,
      prev: false,
      logging: false,
    });
    await settle();
    await expect(guest.controller.removeParticipant(id(1))).rejects.toThrow(
      "host-required",
    );
    await host.controller.removeParticipant(id(2));
    await settle();
    expect(host.controller.getSnapshot().members.map((m) => m.userId)).toEqual([
      id(1),
    ]);
    expect(guest.controller.getSnapshot()).toMatchObject({
      phase: "unavailable",
      error: "removed-from-session",
    });
    expect(guest.controller.shared.getSnapshot().grants).toEqual([]);
    expect(
      guest.controller.workout.status(id(2), "local-session")?.sharing,
    ).toBe("local-only");
    const personal = guest.controller.workout.read(id(2), "local-session")!;
    personal.exercises[0].sets[0].reps = 14;
    guest.controller.workout.save(id(2), personal);
    await settle();
    expect(
      guest.controller.workout.read(id(2), "local-session")?.exercises[0]
        .sets[0].reps,
    ).toBe(14);
    expect(
      host.controller.workout.status(id(1), "local-session")?.sharing,
    ).toBe("active");
  });
  it("applies explicit delegated edits once and rejects an unseen owner revision", async () => {
    const { host, guest } = await sharedPair();
    await host.controller.shared.setConsent(id(2), {
      numbers: true,
      prev: false,
      logging: true,
    });
    await settle();
    const projection = guest.controller.shared
      .getSnapshot()
      .athletes.find((a) => a.userId === id(1))!;
    const operation = {
      type: "upsertSet",
      planExerciseId: Object.keys(projection.exercises)[0],
      set: { setId: randomUUID(), reps: 7, weightKg: 30, completed: true },
    };
    await expect(
      guest.controller.shared.requestDelegatedSet(
        id(1),
        operation,
        projection.revision - 1,
      ),
    ).rejects.toThrow();
    await guest.controller.shared.requestDelegatedSet(
      id(1),
      operation,
      projection.revision,
    );
    await settle();
    expect(
      host.controller.workout.read(id(1), "local-session")!.exercises[0].sets,
    ).toHaveLength(2);
    expect(host.controller.shared.getSnapshot().delegated).toEqual([]);
    expect(host.controller.getSnapshot().error).toBeUndefined();
    await expect(
      guest.controller.shared.requestDelegatedSet(
        id(1),
        operation,
        projection.revision,
      ),
    ).rejects.toThrow();
  });
  it("an account switch during delegated consumption cannot write the old or new account", async () => {
    const { host, guest } = await sharedPair();
    await host.controller.shared.setConsent(id(2), {
      numbers: true,
      prev: false,
      logging: true,
    });
    await settle();
    const projection = guest.controller.shared
      .getSnapshot()
      .athletes.find((a) => a.userId === id(1))!;
    let armed = true;
    const unsubscribe = host.controller.subscribe(() => {
      if (armed) {
        armed = false;
        host.controller.setAccount(id(3));
      }
    });
    await guest.controller.shared.requestDelegatedSet(
      id(1),
      {
        type: "upsertSet",
        planExerciseId: Object.keys(projection.exercises)[0],
        set: { setId: randomUUID(), reps: 99, weightKg: 99, completed: true },
      },
      projection.revision,
    );
    await settle();
    unsubscribe();
    expect(host.controller.workout.getActive(id(3))).toBeNull();
    expect(host.controller.workout.read(id(1), "local-session")).toBeNull();
    host.controller.setAccount(id(1));
    expect(
      host.controller.workout.read(id(1), "local-session")!.exercises[0].sets,
    ).toHaveLength(1);
    expect(host.controller.getSnapshot().phase).toBe("idle");
  });
  it.each(["lan", "nearby", "hotspot-owner"] as const)(
    "selects only installed %s transport while idle",
    async (transport) => {
      const nearby = new Native(),
        hotspotOwner = new Native();
      const value = setup(1, { nearby, hotspotOwner });
      expect(value.controller.transports).toEqual([
        "lan",
        "nearby",
        "hotspot-owner",
      ]);
      value.controller.selectTransport(transport);
      await value.controller.host("A");
      expect(
        (transport === "lan"
          ? value.native
          : transport === "nearby"
            ? nearby
            : hotspotOwner
        ).startHost,
      ).toHaveBeenCalled();
      expect(() => value.controller.selectTransport("lan")).toThrow(
        "transport-unavailable",
      );
      const minimal = setup(2);
      expect(minimal.controller.transports).toEqual(["lan"]);
      expect(() => minimal.controller.selectTransport("nearby")).toThrow();
    },
  );
  it.each(["finish_all", "save_own", "leave"] as const)(
    "signed %s immediately makes own logging local-only",
    async (mode) => {
      const { host, guest } = await sharedPair();
      const target = mode === "leave" ? guest : host;
      const user = mode === "leave" ? id(2) : id(1);
      const plan = target.controller.workout.getPlan(user, "local-session")!;
      target.controller.shared.setOwnPlan(plan);
      const observe = jest.fn(() => {
        throw Error("observer");
      });
      const unsubscribe = target.controller.shared.subscribe(observe);
      await target.controller.shared.setConsent(
        mode === "leave" ? id(1) : id(2),
        { numbers: false, prev: true, logging: false },
      );
      await target.controller.shared.publishPrevious(
        mode === "leave" ? id(1) : id(2),
        [],
        now,
      );
      await settle();
      expect(() =>
        target.controller.shared.consumeDelegated("missing"),
      ).toThrow();
      await target.controller.shared.close(mode);
      await settle();
      expect(
        target.controller.workout.status(user, "local-session")?.sharing,
      ).toBe("local-only");
      expect(target.controller.workout.read(user, "local-session")?.notes).toBe(
        "Keep personal",
      );
      expect(observe).toHaveBeenCalled();
      unsubscribe();
      if (mode !== "leave")
        expect(
          guest.controller.workout.status(id(2), "local-session")?.sharing,
        ).toBe("local-only");
    },
  );
  it.each(["success", "missing", "denied"] as const)(
    "expired own logging uses original recovery signer (%s), never reprovisioning",
    async (outcome) => {
      let clock = now;
      const upload = jest
        .fn()
        .mockResolvedValue(
          fail({ kind: "api", code: "network", message: "offline" }),
        );
      const recovery = { upload } as unknown as TogetherRecoveryApi;
      const owner = setup(1, { recovery, now: () => clock });
      await owner.controller.host("A");
      await owner.controller.workout.promote(workout());
      await settle();
      clock += 61000;
      const draft = owner.controller.workout.read(id(1), "local-session")!;
      draft.exercises[0].sets[0].reps = 19;
      owner.controller.workout.save(id(1), draft);
      await settle();
      const signer = jest.fn<
        ReturnType<NonNullable<TogetherProvisioningPort["signRecovery"]>>,
        Parameters<NonNullable<TogetherProvisioningPort["signRecovery"]>>
      >(async (_credential, commands) =>
        outcome === "denied"
          ? fail({ kind: "together-provisioning", code: "key-unavailable" })
          : ok(commands.map((c) => signPayload(c, person(1).seed))),
      );
      if (outcome !== "missing") owner.provisioning.signRecovery = signer;
      await expect(
        owner.controller.workout.review(id(1), "local-session"),
      ).rejects.toThrow(outcome === "success" ? "network" : "key-unavailable");
      expect(owner.provisioning.prepare).toHaveBeenCalledTimes(1);
      expect(
        owner.controller.workout.read(id(1), "local-session")!.exercises[0]
          .sets[0].reps,
      ).toBe(19);
      expect(
        owner.controller.workout.status(id(1), "local-session")?.sharing,
      ).toBe("local-only");
      expect(upload).toHaveBeenCalledTimes(outcome === "success" ? 1 : 0);
    },
  );
  it.each([false, true])(
    "new denial before selected host stop (%s) invalidates the verified selection",
    async (duringStop) => {
      let blocked = false;
      const host = setup(),
        guest = setup(2, {
          deniedPairs: () => (blocked ? [[id(1), id(2)]] : []),
        });
      await host.controller.host("Open", "open");
      await guest.controller.browse();
      const session = await probe(host, guest);
      if (duringStop)
        guest.native.stop.mockImplementationOnce(async () => {
          blocked = true;
        });
      else blocked = true;
      await guest.controller.selectDiscovered(session);
      expect(guest.controller.getSnapshot()).toMatchObject({
        phase: "unavailable",
        error: "host-unavailable",
      });
    },
  );

  it("an owner edit while delegated bytes are delayed produces a conflict without replacing own values", async () => {
    const { host, guest } = await sharedPair();
    await host.controller.shared.setConsent(id(2), {
      numbers: true,
      prev: false,
      logging: true,
    });
    await settle();
    const projection = guest.controller.shared
      .getSnapshot()
      .athletes.find((a) => a.userId === id(1))!;
    const held = deferred<void>();
    let deliver!: () => void;
    guest.native.send.mockImplementationOnce(async (peerId, frame) => {
      deliver = () => {
        const target = guest.native.targets.get(peerId)!;
        target.native.emit({ type: "frame", peerId: target.peerId, frame });
      };
      await held.promise;
      deliver();
    });
    const request = guest.controller.shared.requestDelegatedSet(
      id(1),
      {
        type: "upsertSet",
        planExerciseId: Object.keys(projection.exercises)[0],
        set: { setId: randomUUID(), reps: 99, weightKg: 99, completed: true },
      },
      projection.revision,
    );
    await settle();
    const own = host.controller.workout.read(id(1), "local-session")!;
    own.exercises[0].sets[0].reps = 15;
    host.controller.workout.save(id(1), own);
    await settle();
    held.resolve();
    await request;
    await settle();
    expect(host.controller.getSnapshot().error).toBe("delegation-conflict");
    const saved = host.controller.workout.read(id(1), "local-session")!;
    expect(saved.exercises[0].sets).toHaveLength(1);
    expect(saved.exercises[0].sets[0].reps).toBe(15);
  });
});
