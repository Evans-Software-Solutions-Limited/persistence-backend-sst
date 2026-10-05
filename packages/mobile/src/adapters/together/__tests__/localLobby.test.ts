/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TogetherJournalDatabase } from "../../storage/togetherJournal";
import { TogetherLocalStore, LocalCommand } from "../localStore";
import {
  TogetherLocalLobby,
  LobbyOptions,
  LocalJoinRequest,
} from "../localLobby";
import {
  signPayload,
  publicKeyPem,
  Credential,
  JoinConsent,
  OfflineRoster,
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
function friend(n: number): LocalJoinRequest {
  return {
    ...person(n),
    friendship: signPayload(
      {
        kind: "together-friendship-v1",
        keyId: "v1",
        users: [id(1), id(n)],
        issuedAt: time - 10,
        expiresAt: time + 1000,
      },
      authority,
    ),
  };
}
const command: LocalCommand = {
  commandId: id(200),
  sessionId: pin.sessionId,
  executionId: id(22),
  payload: JSON.stringify({ signed: "opaque immutable test command" }),
};
describe("local lobby and inbox with real SQLite", () => {
  let directory: string,
    path: string,
    db: DatabaseSync,
    store: TogetherLocalStore,
    host: TogetherLocalLobby,
    clock: number,
    denied: [string, string][];
  const options = (
    n = 1,
    changes: Partial<LobbyOptions> = {},
  ): LobbyOptions => ({
    ...pin,
    ...person(n),
    trustedKeys: trusted,
    deniedPairs: () => denied,
    now: () => clock,
    audience: "open",
    invitedUserIds: [],
    ...changes,
  });
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "together-local-"));
    path = join(directory, "local.db");
    db = new DatabaseSync(path);
    clock = time;
    denied = [];
    store = new TogetherLocalStore(adapter(db), id(1));
    host = new TogetherLocalLobby(store, options());
  });
  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  it("persists a host roster and policy across reopen; exact start retry is immutable", () => {
    const roster = host.start(person(1).consent);
    expect(host.start(person(1).consent)).toEqual(roster);
    expect(host.pin).toEqual(pin);
    expect(host.isHost).toBe(true);
    db.close();
    db = new DatabaseSync(path);
    store = new TogetherLocalStore(adapter(db), id(1));
    host = new TogetherLocalLobby(store, options());
    expect(host.start(person(1).consent)).toEqual(roster);
    expect(
      () =>
        new TogetherLocalLobby(store, options(1, { audience: "invite-only" })),
    ).toThrow("policy changed");
    const changed = signPayload(
      { ...person(1).consent.payload, nonce: id(99) },
      person(1).seed,
    );
    expect(() => host.start(changed)).toThrow("consent changed");
    const copy = host.ownCredential;
    copy.payload.userId = id(99);
    expect(host.ownCredential).toEqual(person(1).credential);
  });
  it("requires stranger approval but automatically admits verified friends, with four total seats", () => {
    host.start(person(1).consent);
    expect(host.admit(person(2), person(2).credential)).toEqual({
      status: "approval-required",
    });
    expect(store.current(pin.sessionId)!.payload.members).toHaveLength(1);
    expect(host.admit(person(2), person(2).credential, true).status).toBe(
      "admitted",
    );
    expect(host.admit(friend(3), person(3).credential).status).toBe("admitted");
    expect(host.admit(person(4), person(4).credential, true).status).toBe(
      "admitted",
    );
    expect(
      store.current(pin.sessionId)!.payload.members.map((m) => m.admission),
    ).toEqual(["host", "approved", "friend", "approved"]);
    expect(() => host.admit(person(5), person(5).credential, true)).toThrow();
    expect(store.current(pin.sessionId)!.payload.members).toHaveLength(4);
    expect(host.admit(person(2), person(2).credential)).toEqual({
      status: "admitted",
      roster: store.current(pin.sessionId),
    });
  });
  it("requires explicit invitation even for friends in an invite-only lobby", () => {
    const otherStore = new TogetherLocalStore(adapter(db), id(2));
    const otherPin = {
      ...pin,
      sessionId: id(101),
      hostUserId: id(2),
      hostDeviceId: id(12),
    };
    const privateHost = new TogetherLocalLobby(otherStore, {
      ...options(2, {
        audience: "invite-only",
        invitedUserIds: [id(3), id(3)],
      }),
      ...otherPin,
    });
    const consent = signPayload(
      { ...person(2).consent.payload, ...otherPin },
      person(2).seed,
    );
    privateHost.start(consent);
    expect(() =>
      privateHost.admit(person(4), person(4).credential, true),
    ).toThrow("Invitation required");
    const invited = {
      ...person(3),
      consent: signPayload(
        { ...person(3).consent.payload, ...otherPin },
        person(3).seed,
      ),
    };
    expect(privateHost.admit(invited, invited.credential).status).toBe(
      "approval-required",
    );
    expect(privateHost.admit(invited, invited.credential, true).status).toBe(
      "admitted",
    );
  });
  it("rejects wrong local identity, guest host-actions and unopened lobby admission", () => {
    expect(() => new TogetherLocalStore(adapter(db), "")).toThrow();
    expect(() => new TogetherLocalLobby(store, options(2))).toThrow(
      "Wrong local identity",
    );
    expect(
      () =>
        new TogetherLocalLobby(store, { ...options(), seed: person(2).seed }),
    ).toThrow("Wrong local identity");
    expect(() => host.admit(person(2), person(2).credential, true)).toThrow(
      "not started",
    );
    const guest = new TogetherLocalLobby(
      new TogetherLocalStore(adapter(db), id(2)),
      options(2),
    );
    expect(guest.isHost).toBe(false);
    expect(() => guest.start(person(2).consent)).toThrow("Only the host");
    expect(() => guest.admit(person(3), person(3).credential)).toThrow(
      "Only the host",
    );
    expect(() => guest.member(person(1).credential)).toThrow(
      "No admitted roster",
    );
  });
  it("validates consent, channel identity and pairwise blocks before asking for approval", () => {
    host.start(person(1).consent);
    expect(() => host.admit(person(2), person(3).credential)).toThrow(
      "Wrong joining device",
    );
    const changed = {
      ...person(2),
      consent: signPayload(
        { ...person(2).consent.payload, hostDeviceId: id(99) },
        person(2).seed,
      ),
    };
    expect(() => host.admit(changed, changed.credential)).toThrow();
    host.admit(person(2), person(2).credential, true);
    denied = [[id(2), id(3)]];
    expect(() => host.admit(person(3), person(3).credential)).toThrow(
      "FORBIDDEN",
    );
    expect(store.current(pin.sessionId)!.payload.members).toHaveLength(2);
    const switched = {
      ...person(2),
      consent: signPayload(
        { ...person(2).consent.payload, executionId: id(99) },
        person(2).seed,
      ),
    };
    expect(() => host.admit(switched, switched.credential, true)).toThrow(
      "identity changed",
    );
  });
  it("checks expiry and newly-known blocks even for retries and admitted members", () => {
    const first = host.start(person(1).consent);
    host.admit(friend(2), person(2).credential);
    expect(host.member(person(2).credential).consent).toEqual(
      person(2).consent,
    );
    expect(() => host.member(person(3).credential)).toThrow("not admitted");
    denied = [[id(1), id(2)]];
    expect(() => host.member(person(2).credential)).toThrow("FORBIDDEN");
    expect(() => host.admit(friend(2), person(2).credential)).toThrow(
      "FORBIDDEN",
    );
    denied = [];
    clock = time + 1000;
    expect(() => host.member(person(2).credential)).toThrow(
      "CREDENTIAL_EXPIRED",
    );
    expect(() => host.accept(first)).toThrow("CREDENTIAL_EXPIRED");
  });
  it("guest persists exact roster chain but rejects forged authority, skipped revisions and forks", () => {
    const first = host.start(person(1).consent);
    host.admit(person(2), person(2).credential, true);
    const second = store.current(pin.sessionId)!;
    const guestStore = new TogetherLocalStore(adapter(db), id(2));
    const guest = new TogetherLocalLobby(guestStore, options(2));
    expect(() => guest.accept(second)).toThrow("VERSION_CONFLICT");
    guest.accept(first);
    guest.accept(second);
    guest.accept(first);
    expect(guestStore.current(pin.sessionId)).toEqual(second);
    expect(guest.member(person(1).credential).admission).toBe("host");
    const fork = signPayload(
      {
        ...second.payload,
        members: [
          first.payload.members[0],
          {
            credential: person(3).credential,
            consent: person(3).consent,
            admission: "approved" as const,
          },
        ],
      },
      person(1).seed,
    );
    expect(() => guest.accept(fork)).toThrow("Conflicting roster");
    for (const change of [
      { sessionId: id(99) },
      { hostUserId: id(99) },
      { hostDeviceId: id(99) },
    ])
      expect(() =>
        guest.accept(
          signPayload({ ...first.payload, ...change }, person(1).seed),
        ),
      ).toThrow("Wrong lobby authority");
    const stranger = new TogetherLocalLobby(
      new TogetherLocalStore(adapter(db), id(3)),
      options(3),
    );
    stranger.accept(first);
    expect(() => stranger.member(person(1).credential)).toThrow("not admitted");
  });
  it("local exit remains terminal after reopen and cannot be bypassed by exact retries", () => {
    host.start(person(1).consent);
    store.close(pin.sessionId);
    store.close(pin.sessionId);
    expect(() => host.start(person(1).consent)).toThrow("closed");
    expect(() => store.receive(id(2), command)).toThrow("closed");
    db.close();
    db = new DatabaseSync(path);
    store = new TogetherLocalStore(adapter(db), id(1));
    expect(() => store.assertOpen(pin.sessionId)).toThrow("closed");
    expect(() =>
      new TogetherLocalStore(adapter(db), id(2)).assertOpen(pin.sessionId),
    ).not.toThrow();
  });
  it("reopens immutable peer commands without duplicate effects and isolates account/session/owner", () => {
    store.receive(id(2), command);
    store.receive(id(2), command);
    expect(store.received(id(2), pin.sessionId)).toEqual([command]);
    expect(() =>
      store.receive(id(2), { ...command, payload: "changed" }),
    ).toThrow("Conflicting peer command");
    expect(() =>
      store.receive(id(2), { ...command, executionId: id(99) }),
    ).toThrow("Conflicting peer command");
    expect(store.received(id(3), pin.sessionId)).toEqual([]);
    expect(store.received(id(2), id(99))).toEqual([]);
    expect(
      new TogetherLocalStore(adapter(db), id(3)).received(id(2), pin.sessionId),
    ).toEqual([]);
    db.close();
    db = new DatabaseSync(path);
    store = new TogetherLocalStore(adapter(db), id(1));
    expect(store.received(id(2), pin.sessionId)).toEqual([command]);
    store.receive(id(2), command);
    expect(store.received(id(2), pin.sessionId)).toHaveLength(1);
  });
  it("caps peer inbox storage yet accepts an exact retry at capacity", () => {
    for (let n = 0; n < 4096; n++)
      store.receive(id(2), { ...command, commandId: id(1000 + n) });
    expect(() => store.receive(id(2), command)).toThrow("inbox full");
    expect(() =>
      store.receive(id(2), { ...command, commandId: id(1000) }),
    ).not.toThrow();
    expect(store.received(id(2), pin.sessionId)).toHaveLength(4096);
  });
  it("rolls back failed durable inserts so callers cannot emit a successful receipt", () => {
    const real = adapter(db);
    let fail = false;
    const failing = {
      ...real,
      runSync: (sql: string, params: (string | number | null)[]) => {
        real.runSync(sql, params);
        if (fail) throw new Error("disk full");
      },
    };
    const brokenStore = new TogetherLocalStore(failing, id(1));
    fail = true;
    expect(() => brokenStore.receive(id(2), command)).toThrow("disk full");
    expect(brokenStore.received(id(2), pin.sessionId)).toEqual([]);
    const envelope = signPayload<OfflineRoster>(
      {
        kind: "together-roster-v1",
        ...pin,
        revision: 1,
        previousHash: null,
        members: [
          {
            credential: person(1).credential,
            consent: person(1).consent,
            admission: "host",
          },
        ],
      },
      person(1).seed,
    );
    expect(() =>
      brokenStore.commitRoster(envelope, pin, trusted, [], time),
    ).toThrow("disk full");
    expect(brokenStore.current(pin.sessionId)).toBeNull();
    fail = false;
    brokenStore.commitRoster(envelope, pin, trusted, [], time);
    expect(requestHash(brokenStore.current(pin.sessionId))).toBe(
      requestHash(envelope),
    );
  });
  it("bearer eligibility is secret-bound, stored only as hash, immutable and never skips stranger approval", () => {
    const privatePin = { ...pin, sessionId: id(300) };
    const token = "a".repeat(43);
    const privateOptions = options(1, {
      ...privatePin,
      audience: "invite-only",
      invitationTokenHash: requestHash(token),
    });
    const privateHost = new TogetherLocalLobby(store, privateOptions);
    const consent = (n: number) =>
      signPayload(
        { ...person(n).consent.payload, ...privatePin },
        person(n).seed,
      );
    privateHost.start(consent(1));
    const request = { credential: person(2).credential, consent: consent(2) };
    for (const invitationToken of [undefined, "bad", "b".repeat(43)])
      expect(() =>
        privateHost.admit({ ...request, invitationToken }, request.credential),
      ).toThrow("Invitation required");
    expect(
      privateHost.admit(
        { ...request, invitationToken: token },
        request.credential,
      ),
    ).toEqual({ status: "approval-required" });
    expect(
      privateHost.admit(
        { ...request, invitationToken: token },
        request.credential,
        true,
      ).status,
    ).toBe("admitted");
    expect(
      () =>
        new TogetherLocalLobby(store, { ...privateOptions, audience: "open" }),
    ).toThrow("policy changed");
    expect(
      () =>
        new TogetherLocalLobby(store, {
          ...privateOptions,
          invitationTokenHash: undefined,
        }),
    ).toThrow("policy changed");
    expect(
      () =>
        new TogetherLocalLobby(store, {
          ...privateOptions,
          invitationTokenHash: requestHash("b".repeat(43)),
        }),
    ).toThrow("policy changed");
    const persisted = JSON.stringify(
      db.prepare("SELECT * FROM together_local_policy").all(),
    );
    expect(persisted).not.toContain(token);
  });
  it("removes exactly one athlete with signed monotonic authority and requires fresh host approval to rejoin", () => {
    host.start(person(1).consent);
    host.admit(friend(2), person(2).credential);
    host.admit(friend(3), person(3).credential);
    const before = store.current(pin.sessionId)!;
    const removed = host.removeParticipant(id(2));
    expect(removed.payload.revision).toBe(before.payload.revision + 1);
    expect(
      removed.payload.members.map((m) => m.credential.payload.userId),
    ).toEqual([id(1), id(3)]);
    expect(() => host.member(person(2).credential)).toThrow();
    expect(() => host.member(person(3).credential)).not.toThrow();
    host.accept(before);
    expect(store.current(pin.sessionId)).toEqual(removed);
    expect(host.admit(friend(2), person(2).credential).status).toBe(
      "approval-required",
    );
    expect(host.admit(friend(2), person(2).credential, true).status).toBe(
      "admitted",
    );
    expect(() => host.removeParticipant(id(1))).toThrow();
    expect(() => host.removeParticipant(id(9))).toThrow();
  });
});
