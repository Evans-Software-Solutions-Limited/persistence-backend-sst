/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  TogetherJournal,
  TogetherJournalDatabase,
} from "../../storage/togetherJournal";
import { TogetherLocalStore, LocalCommand } from "../localStore";
import { TogetherLocalLobby, LocalJoinRequest } from "../localLobby";
import { TogetherLocalLink } from "../localLink";
import {
  readOwnerCommand,
  commandFromEnvelope,
  OwnerCommand,
} from "../localCommand";
import { LocalSecureChannel } from "../security/channel";
import {
  signPayload,
  publicKeyPem,
  Credential,
  JoinConsent,
  requestHash,
} from "../security/identity";
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
describe("owner recovery command wire", () => {
  const valid = [
    {
      type: "upsertSet",
      planExerciseId: id(50),
      set: { setId: id(51), reps: 10, weightKg: 42.5, completed: true },
    },
    { type: "removeSet", planExerciseId: id(50), setId: id(51) },
    { type: "substitute", planExerciseId: id(50), exerciseId: id(52) },
    { type: "substitute", planExerciseId: id(50), exerciseId: null },
    { type: "skip", planExerciseId: id(50), skipped: false },
    { type: "rest", endsAt: null },
    { type: "rest", endsAt: "2026-10-01T10:00:00.000Z" },
  ];
  it.each(valid)("accepts server-recovery operation %j", (operation) => {
    expect(
      readOwnerCommand(command({ operation }), person(2).credential).operation,
    ).toEqual(operation);
  });
  const invalid: unknown[] = [
    null,
    {},
    { type: "replacePlan" },
    {
      type: "upsertSet",
      planExerciseId: id(50),
      set: { setId: id(51), reps: 10001, weightKg: 1, completed: true },
    },
    {
      type: "upsertSet",
      planExerciseId: id(50),
      set: { setId: id(51), reps: 1, weightKg: -1, completed: true },
    },
    { type: "removeSet", planExerciseId: id(50), setId: "bad" },
    { type: "substitute", planExerciseId: id(50), exerciseId: "bad" },
    { type: "skip", planExerciseId: id(50), skipped: 1 },
    { type: "rest", endsAt: "yesterday" },
    { type: "rest", endsAt: "2026-99-99T00:00:00Z" },
  ];
  it.each(invalid)(
    "rejects invalid or nonpersonal operation %j",
    (operation) => {
      expect(() =>
        readOwnerCommand(
          command({ operation: operation as Record<string, unknown> }),
          person(2).credential,
        ),
      ).toThrow();
    },
  );
  it.each([
    "2024-02-29T23:59:59Z",
    "2000-02-29T00:00:00.123456+01:30",
    "2026-04-30T10:20:30-05:00",
  ])("accepts real calendar dates and offsets %s", (endsAt) => {
    expect(
      readOwnerCommand(
        command({ operation: { type: "rest", endsAt } }),
        person(2).credential,
      ).operation,
    ).toEqual({ type: "rest", endsAt });
  });
  it.each([
    "2026-02-30T10:00:00Z",
    "2025-02-29T00:00:00Z",
    "1900-02-29T00:00:00Z",
    "2026-04-31T00:00:00Z",
    "2026-00-01T00:00:00Z",
    "2026-13-01T00:00:00Z",
    "2026-01-00T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T00:60:00Z",
    "2026-01-01T00:00:60Z",
    "2026-01-01T00:00:00+24:00",
    "2026-01-01T00:00:00-01:60",
    "2026-01-01T00:00:00",
    123,
  ])("rejects calendar/timezone invalid timestamp %s", (endsAt) => {
    expect(() =>
      readOwnerCommand(
        command({ operation: { type: "rest", endsAt } }),
        person(2).credential,
      ),
    ).toThrow("Invalid owner operation");
  });
  it("rejects identifiers, bounds, envelope extras, owner mismatch and signatures", () => {
    const c = command();
    for (const changed of [
      null,
      { ...c, extra: true },
      { ...c, commandId: "bad" },
      { ...c, payload: "x".repeat(16001) },
      { ...c, payload: "{" },
      { ...c, payload: "{}" },
      { ...c, sessionId: id(99) },
    ])
      expect(() => readOwnerCommand(changed, person(2).credential)).toThrow();
    for (const changes of [
      { kind: "wrong" },
      { userId: id(3) },
      { planHash: "bad" },
      { startedAt: -1 },
      { expectedVersion: 0.5 },
    ])
      expect(() =>
        readOwnerCommand(
          command(changes as Partial<OwnerCommand>),
          person(2).credential,
        ),
      ).toThrow();
    const forged = JSON.parse(c.payload);
    forged.payload.operation.skipped = false;
    expect(() =>
      readOwnerCommand(
        { ...c, payload: JSON.stringify(forged) },
        person(2).credential,
      ),
    ).toThrow("INVALID_PROOF");
  });
});
describe("encrypted local link over real durable SQLite", () => {
  let directory: string, path: string, db: DatabaseSync;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "together-link-"));
    path = join(directory, "local.db");
    db = new DatabaseSync(path);
  });
  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  function setup() {
    const frames: { to: "host" | "guest"; wire: string }[] = [];
    const sentTimes: { to: "host" | "guest"; at: number }[] = [];
    let failHost = false,
      failGuest = false;
    const build = (n: number) => {
      const a = adapter(db);
      const store = new TogetherLocalStore(a, id(n));
      const journal = new TogetherJournal(a, id(n));
      const opts = {
        ...pin,
        ...person(n),
        trustedKeys: trusted,
        now: () => time,
      };
      const lobby = new TogetherLocalLobby(store, {
        ...opts,
        deniedPairs: () => [],
        audience: "open",
        invitedUserIds: [],
      });
      const channel = new LocalSecureChannel({
        ...opts,
        role: n === 1 ? "host" : "guest",
        randomBytes: (n) => new Uint8Array(randomBytes(n)),
      });
      const link = new TogetherLocalLink(
        channel,
        lobby,
        journal,
        async (wire) => {
          if (n === 1 ? failHost : failGuest)
            throw new Error("native send failed");
          frames.push({ to: n === 1 ? "guest" : "host", wire });
          sentTimes.push({ to: n === 1 ? "guest" : "host", at: Date.now() });
        },
      );
      return { store, journal, lobby, channel, link };
    };
    const host = build(1),
      guest = build(2);
    async function pump() {
      const events: string[] = [];
      while (frames.length) {
        const frame = frames.shift()!;
        events.push(
          await (frame.to === "host" ? host : guest).link.receive(frame.wire),
        );
      }
      return events;
    }
    async function handshake() {
      host.lobby.start(person(1).consent);
      await guest.link.start();
      await pump();
    }
    async function admit(friends = true) {
      await handshake();
      await guest.link.join(request(2, friends));
      await pump();
      if (!friends) {
        await host.link.approve(request());
        await pump();
      }
    }
    return {
      host,
      guest,
      frames,
      sentTimes,
      pump,
      handshake,
      admit,
      setFailure: (side: "host" | "guest") => {
        if (side === "host") failHost = true;
        else failGuest = true;
      },
    };
  }
  it("rejects a journal belonging to a different signed-in account", () => {
    const s = setup();
    expect(
      () =>
        new TogetherLocalLink(
          s.host.channel,
          s.host.lobby,
          s.guest.journal,
          async () => {},
        ),
    ).toThrow("Wrong channel composition");
  });
  it("authenticates, auto-admits friends and durably acknowledges owner commands without server acceptance", async () => {
    const s = setup();
    await s.admit();
    await s.guest.link.sendOwn(command());
    const events = await s.pump();
    expect(events).toEqual(["command", "receipt"]);
    expect(s.host.store.received(id(2), pin.sessionId)).toEqual([command()]);
    expect(s.guest.journal.list(pin.sessionId, id(22))).toEqual([
      expect.objectContaining({ peerReceipts: [id(1)], serverOutcome: null }),
    ]);
    await s.guest.link.resendOwn();
    expect(s.frames).toHaveLength(0);
    await s.host.link.sendOwn(command({}, 1));
    await s.pump();
    expect(s.guest.store.received(id(1), pin.sessionId)).toEqual([
      command({}, 1),
    ]);
  });
  it("emits approval-required for strangers and only host approval creates membership", async () => {
    const s = setup();
    await s.handshake();
    await s.guest.link.join(request());
    expect(await s.pump()).toEqual(["approval-required", "approval-required"]);
    expect(s.host.store.current(pin.sessionId)!.payload.members).toHaveLength(
      1,
    );
    await s.host.link.approve(request());
    await s.pump();
    expect(s.guest.store.current(pin.sessionId)!.payload.members).toHaveLength(
      2,
    );
    await s.host.link.syncRoster();
    await s.pump();
    expect(s.guest.store.rosters(pin.sessionId)).toHaveLength(2);
  });
  it("keeps authenticated heartbeats encrypted and exposes defensive pending consent", async () => {
    const s = setup();
    expect(s.host.link.ready).toBe(false);
    expect(s.host.link.pendingRequest).toBeUndefined();
    await s.handshake();
    expect(s.host.link.ready).toBe(true);
    await s.guest.link.heartbeat();
    expect(await s.pump()).toEqual(["heartbeat", "heartbeat"]);
    await s.guest.link.join(request());
    await s.pump();
    const pending = s.host.link.pendingRequest!;
    expect(pending).toEqual(request());
    pending.credential.payload.userId = id(99);
    expect(s.host.link.pendingRequest).toEqual(request());
    await s.host.link.approve(request());
    await s.pump();
    expect(s.host.link.pendingRequest).toBeUndefined();
  });
  it.each(["read", "write"])(
    "bounds the %s queue and permanently closes on overflow",
    async (side) => {
      const s = setup();
      await s.handshake();
      const pending: Promise<unknown>[] = [];
      for (let i = 0; i < 17; i++)
        pending.push(
          side === "read"
            ? s.host.link.receive(
                s.guest.channel.encrypt(JSON.stringify({ kind: "ping" })),
              )
            : s.guest.link.heartbeat(),
        );
      const results = await Promise.allSettled(pending);
      expect(results[16]).toEqual({
        status: "rejected",
        reason: expect.objectContaining({
          message: side === "read" ? "Read queue full" : "Write queue full",
        }),
      });
      expect((side === "read" ? s.host : s.guest).link.ready).toBe(false);
    },
  );
  it("recovers a lost receipt after process restart using exact command bytes and IDs", async () => {
    let s = setup();
    await s.admit();
    await s.guest.link.sendOwn(command());
    await s.host.link.receive(s.frames.shift()!.wire);
    expect(s.frames).toHaveLength(1);
    s.frames.length = 0;
    expect(s.guest.journal.list(pin.sessionId, id(22))[0].peerReceipts).toEqual(
      [],
    );
    s.host.link.close();
    s.guest.link.close();
    db.close();
    db = new DatabaseSync(path);
    s = setup();
    await s.admit();
    await s.guest.link.resendOwn();
    await s.pump();
    expect(s.host.store.received(id(2), pin.sessionId)).toEqual([command()]);
    expect(s.guest.journal.list(pin.sessionId, id(22))[0]).toEqual(
      expect.objectContaining({ peerReceipts: [id(1)], serverOutcome: null }),
    );
  });
  it("drains 45 offline commands in each direction after reopen without flooding either peer", async () => {
    jest.useFakeTimers();
    try {
      let s = setup();
      for (let i = 0; i < 45; i++) {
        s.host.journal.append(
          command({ commandId: id(1000 + i), expectedVersion: i }, 1),
        );
        s.guest.journal.append(
          command({ commandId: id(2000 + i), expectedVersion: i }),
        );
      }
      s.host.link.close();
      s.guest.link.close();
      db.close();
      db = new DatabaseSync(path);
      s = setup();
      await s.admit();
      s.sentTimes.length = 0;
      await Promise.all([s.host.link.resendOwn(), s.guest.link.resendOwn()]);
      // Both callbacks returned without waiting for receipt processing.
      expect(s.frames).toHaveLength(2);
      let peak = s.frames.length;
      for (let i = 0; i < 46; i++) {
        peak = Math.max(peak, s.frames.length);
        await s.pump();
        await jest.advanceTimersByTimeAsync(100);
      }
      await s.pump();
      expect(peak).toBeLessThanOrEqual(2);
      expect(s.host.store.received(id(2), pin.sessionId)).toHaveLength(45);
      expect(s.guest.store.received(id(1), pin.sessionId)).toHaveLength(45);
      for (const [athlete, execution] of [
        [s.host, id(21)],
        [s.guest, id(22)],
      ] as const) {
        const entries = athlete.journal.list(pin.sessionId, execution);
        expect(entries).toHaveLength(45);
        expect(
          entries.every(
            (e) => e.peerReceipts.length === 1 && e.serverOutcome === null,
          ),
        ).toBe(true);
      }
      for (const sent of s.sentTimes)
        expect(
          s.sentTimes.filter(
            (other) =>
              other.to === sent.to &&
              other.at >= sent.at &&
              other.at < sent.at + 1000,
          ).length,
        ).toBeLessThanOrEqual(20);
      expect(s.host.link.ready && s.guest.link.ready).toBe(true);
      s.host.link.close();
      s.guest.link.close();
    } finally {
      jest.useRealTimers();
    }
  });
  it("keeps one command in flight, paces retries and ignores duplicate receipts for the previous command", async () => {
    jest.useFakeTimers();
    try {
      const s = setup();
      await s.admit();
      const first = command(),
        second = command({ commandId: id(201), expectedVersion: 1 }),
        third = command({ commandId: id(202), expectedVersion: 2 });
      await s.guest.link.sendOwn(first);
      await s.guest.link.sendOwn(second);
      await s.guest.link.sendOwn(third);
      expect(s.frames).toHaveLength(1);
      await s.guest.link.resendOwn();
      await s.guest.link.resendOwn();
      expect(s.frames).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(100);
      expect(s.frames).toHaveLength(2);
      await s.pump();
      expect(s.host.store.received(id(2), pin.sessionId)).toEqual([first]);
      await jest.advanceTimersByTimeAsync(100);
      expect(s.frames).toHaveLength(1);
      const duplicate = s.host.channel.encrypt(
        JSON.stringify({
          kind: "receipt",
          sessionId: pin.sessionId,
          executionId: id(22),
          commandId: first.commandId,
          commandHash: requestHash(first),
        }),
      );
      await s.guest.link.receive(duplicate);
      expect(s.frames).toHaveLength(1); // Second still outstanding: third cannot pass it.
      await s.pump();
      await jest.advanceTimersByTimeAsync(100);
      await s.pump();
      expect(s.host.store.received(id(2), pin.sessionId)).toEqual([
        first,
        second,
        third,
      ]);
      s.guest.link.close();
      await expect(s.guest.link.resendOwn()).rejects.toThrow("Link closed");
      s.host.link.close();
    } finally {
      jest.useRealTimers();
    }
  });
  it("continues paced replay after the wall clock moves backwards", async () => {
    jest.useFakeTimers();
    try {
      const s = setup();
      await s.admit();
      await s.guest.link.sendOwn(command());
      await s.pump();
      jest.setSystemTime(Date.now() - 60 * 60 * 1000);
      await s.guest.link.sendOwn(
        command({ commandId: id(201), expectedVersion: 1 }),
      );
      expect(s.frames).toHaveLength(0);
      await jest.advanceTimersByTimeAsync(100);
      expect(s.frames).toHaveLength(1);
      await s.pump();
      expect(s.host.store.received(id(2), pin.sessionId)).toHaveLength(2);
      s.host.link.close();
      s.guest.link.close();
    } finally {
      jest.useRealTimers();
    }
  });
  it("cancels delayed delivery on close and closes if a scheduled send fails", async () => {
    jest.useFakeTimers();
    try {
      const s = setup();
      await s.admit();
      await s.guest.link.sendOwn(command());
      await s.guest.link.sendOwn(command({ commandId: id(201) }));
      await s.pump();
      s.setFailure("guest");
      await jest.advanceTimersByTimeAsync(100);
      expect(s.guest.link.ready).toBe(false);
      expect(s.guest.journal.list(pin.sessionId, id(22))).toHaveLength(2);
      s.host.link.close();
      const again = setup();
      await again.admit();
      await again.guest.link.resendOwn();
      await again.guest.link.resendOwn();
      again.guest.link.close();
      again.frames.length = 0;
      await jest.advanceTimersByTimeAsync(100);
      expect(again.frames).toHaveLength(0);
      again.host.link.close();
    } finally {
      jest.useRealTimers();
    }
  });
  it("rejects wrong channel composition, wrong join identity and unauthenticated controls", async () => {
    const s = setup();
    expect(
      () =>
        new TogetherLocalLink(
          s.host.channel,
          s.guest.lobby,
          s.host.journal,
          async () => {},
        ),
    ).toThrow("composition");
    expect(() => s.host.link.join(request(1))).toThrow("Wrong join identity");
    expect(() => s.guest.link.join(request(3))).toThrow("Wrong join identity");
    await expect(s.host.link.approve(request())).rejects.toThrow(
      "Not authenticated",
    );
    await expect(s.host.link.syncRoster()).rejects.toThrow(
      "Host connection required",
    );
    await expect(s.guest.link.syncRoster()).rejects.toThrow(
      "Host connection required",
    );
  });
  it("rejects peer commands before admission without saving or receipt", async () => {
    const s = setup();
    await s.handshake();
    const wire = s.guest.channel.encrypt(
      JSON.stringify({ kind: "command", command: command() }),
    );
    await expect(s.host.link.receive(wire)).rejects.toThrow("not admitted");
    expect(s.host.store.received(id(2), pin.sessionId)).toEqual([]);
    expect(s.frames).toHaveLength(0);
  });
  it.each([{ executionId: id(99) }, { sessionId: id(99) }])(
    "rejects wrong execution/session on owner and receiving peer %j",
    async (changes) => {
      const s = setup();
      await s.admit();
      await expect(s.guest.link.sendOwn(command(changes))).rejects.toThrow(
        "Wrong owner execution",
      );
      expect(s.guest.journal.list(pin.sessionId, id(22))).toEqual([]);
      const wire = s.guest.channel.encrypt(
        JSON.stringify({ kind: "command", command: command(changes) }),
      );
      await expect(s.host.link.receive(wire)).rejects.toThrow(
        "Wrong peer execution",
      );
      expect(s.host.store.received(id(2), pin.sessionId)).toEqual([]);
    },
  );
  it.each(["wrong-execution", "unknown", "hash", "extra"])(
    "rejects forged receipt %s without marking peer or server success",
    async (mode) => {
      const s = setup();
      await s.admit();
      s.guest.journal.append(command());
      const receipt = {
        kind: "receipt",
        sessionId: pin.sessionId,
        executionId: id(22),
        commandId: id(200),
        commandHash: requestHash(command()),
      };
      if (mode === "wrong-execution") receipt.executionId = id(99);
      if (mode === "unknown") receipt.commandId = id(201);
      if (mode === "hash") receipt.commandHash = "b".repeat(64);
      const wire = s.host.channel.encrypt(
        JSON.stringify(
          mode === "extra" ? { ...receipt, extra: true } : receipt,
        ),
      );
      await expect(s.guest.link.receive(wire)).rejects.toThrow();
      expect(s.guest.journal.list(pin.sessionId, id(22))[0]).toEqual(
        expect.objectContaining({ peerReceipts: [], serverOutcome: null }),
      );
    },
  );
  it("does not acknowledge failed receiver persistence and retains the owner's retry", async () => {
    const s = setup();
    await s.admit();
    db.exec(
      "CREATE TRIGGER fail_inbox BEFORE INSERT ON together_local_inbox BEGIN SELECT RAISE(ABORT, 'disk failure'); END",
    );
    await s.guest.link.sendOwn(command());
    await expect(s.host.link.receive(s.frames.shift()!.wire)).rejects.toThrow(
      "disk failure",
    );
    expect(s.frames).toHaveLength(0);
    expect(s.host.store.received(id(2), pin.sessionId)).toEqual([]);
    expect(s.guest.journal.list(pin.sessionId, id(22))[0].peerReceipts).toEqual(
      [],
    );
  });
  it("closes on native send failure while keeping the owner's durable command", async () => {
    const s = setup();
    await s.admit();
    s.setFailure("guest");
    await expect(s.guest.link.sendOwn(command())).rejects.toThrow(
      "native send failed",
    );
    expect(s.guest.channel.ready).toBe(false);
    expect(s.guest.journal.list(pin.sessionId, id(22))).toHaveLength(1);
    await expect(s.guest.link.receive("{}")).rejects.toThrow("Link closed");
  });
  it("queued writes do not escape after close", async () => {
    const s = setup();
    await s.handshake();
    const pending = s.guest.link.join(request());
    s.guest.link.close();
    await expect(pending).rejects.toThrow("Link closed");
    expect(s.frames).toHaveLength(0);
  });
  it.each([
    null,
    {},
    { kind: "join", request: {} },
    { kind: "no-such-message" },
    { kind: "approval-required", extra: true },
  ])("closes malformed application message %j", async (message) => {
    const s = setup();
    await s.admit();
    await expect(
      s.host.link.receive(s.guest.channel.encrypt(JSON.stringify(message))),
    ).rejects.toThrow();
    expect(s.host.channel.ready).toBe(false);
  });
  it("closes on ciphertext tamper and on terminal local sharing exit", async () => {
    const s = setup();
    await s.admit();
    const frame = JSON.parse(
      s.guest.channel.encrypt(
        JSON.stringify({ kind: "command", command: command() }),
      ),
    );
    frame.ciphertext = "A".repeat(32);
    await expect(s.host.link.receive(JSON.stringify(frame))).rejects.toThrow();
    expect(s.host.store.received(id(2), pin.sessionId)).toEqual([]);
    s.guest.store.close(pin.sessionId);
    await expect(s.guest.link.sendOwn(command())).rejects.toThrow("closed");
  });
});
