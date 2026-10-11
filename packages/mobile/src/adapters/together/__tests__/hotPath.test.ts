/** @jest-environment node */
import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import type { TogetherJournalDatabase } from "../../storage/togetherJournal";
import { TogetherLocalStore } from "../localStore";
import { TogetherLocalLobby, type LocalJoinRequest } from "../localLobby";
import { TogetherSharedSession } from "../sharedSession";
import * as identity from "../security/identity";
import { nobleCryptoBackend } from "../security/cryptoBackend";
import {
  signPayload,
  publicKeyPem,
  type Credential,
  type JoinConsent,
  type Signed,
} from "../security/identity";

const id = (n: number) =>
  `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const time = 1700000000000;
const authority = new Uint8Array(32).fill(77);
const trusted = { v1: publicKeyPem(authority) };
const pin = { sessionId: id(100), hostUserId: id(1), hostDeviceId: id(11) };
function person(n: number, expiresAt = time + 1000) {
  const seed = new Uint8Array(32).fill(n);
  const credential = signPayload<Credential>(
    {
      kind: "together-device-v1",
      keyId: "v1",
      userId: id(n),
      deviceId: id(n + 10),
      publicKey: publicKeyPem(seed),
      issuedAt: time - 10,
      expiresAt,
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
function counting(db: DatabaseSync) {
  const counts = { reads: 0, writes: 0 };
  const adapter: TogetherJournalDatabase = {
    execSync: (sql) => db.exec(sql),
    runSync: (sql, p) => {
      counts.writes++;
      return db.prepare(sql).run(...p);
    },
    getFirstSync: <T>(sql: string, p: (string | number | null)[]) => {
      counts.reads++;
      return (db.prepare(sql).get(...p) as T | undefined) ?? null;
    },
    getAllSync: <T>(sql: string, p: (string | number | null)[]) => {
      counts.reads++;
      return db.prepare(sql).all(...p) as T[];
    },
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
  return { adapter, counts };
}
function request(n: number): LocalJoinRequest {
  const { credential, consent } = person(n);
  return { credential, consent };
}
function hostLobby(
  db: DatabaseSync,
  options: {
    deniedPairs?: () => (readonly [string, string])[];
    now?: () => number;
  } = {},
) {
  const { adapter, counts } = counting(db);
  const store = new TogetherLocalStore(adapter, id(1));
  const host = person(1);
  const lobby = new TogetherLocalLobby(store, {
    ...pin,
    credential: host.credential,
    seed: host.seed,
    trustedKeys: trusted,
    deniedPairs: options.deniedPairs ?? (() => []),
    now: options.now ?? (() => time),
    audience: "open",
    invitedUserIds: [],
  });
  lobby.start(host.consent);
  return { store, lobby, host, counts };
}

let verifySpy: jest.SpyInstance;
beforeEach(() => {
  verifySpy = jest.spyOn(identity, "verifyRoster");
});
afterEach(() => jest.restoreAllMocks());

describe("D16 F1 — roster chain and closure caches in the local store", () => {
  it("returns one frozen parsed chain per session until this instance commits, and caches the open flag", () => {
    const db = new DatabaseSync(":memory:");
    const { store, lobby, counts } = hostLobby(db);
    const first = store.rosters(pin.sessionId);
    const readsAfterFirst = counts.reads;
    expect(store.rosters(pin.sessionId)).toBe(first);
    expect(store.current(pin.sessionId)).toBe(first[0]);
    expect(counts.reads).toBe(readsAfterFirst);
    expect(Object.isFrozen(first[0])).toBe(true);
    expect(Object.isFrozen(first[0].payload.members[0].credential)).toBe(true);
    // The RN Babel preset compiles without "use strict": writes to frozen
    // objects are silent no-ops, so prove the value is unchanged instead.
    (first[0].payload as { revision: number }).revision = 9;
    expect(first[0].payload.revision).toBe(1);
    store.assertOpen(pin.sessionId);
    const readsAfterOpen = counts.reads;
    for (let i = 0; i < 10; i++) store.assertOpen(pin.sessionId);
    expect(counts.reads).toBe(readsAfterOpen);

    const admitted = lobby.admit(request(2), request(2).credential, true);
    expect(admitted.status).toBe("admitted");
    const second = store.rosters(pin.sessionId);
    expect(second).not.toBe(first);
    expect(second).toHaveLength(2);
    expect(store.rosters(pin.sessionId)).toBe(second);

    store.close(pin.sessionId);
    expect(() => store.assertOpen(pin.sessionId)).toThrow(
      "Local sharing closed",
    );
    // A fresh instance over the same database (restart) reads the durable state.
    const reopened = new TogetherLocalStore(counting(db).adapter, id(1));
    expect(() => reopened.assertOpen(pin.sessionId)).toThrow(
      "Local sharing closed",
    );
    expect(reopened.rosters(pin.sessionId)).toHaveLength(2);
    db.close();
  });
});

describe("D16 F1 — lobby.member verifies once per revision, denied set and validity window", () => {
  it("verifies once for repeated sends/reads with no SQL, then re-verifies on a new revision", () => {
    const db = new DatabaseSync(":memory:");
    const { store, lobby, host, counts } = hostLobby(db);
    const guest = request(2);
    lobby.admit(guest, guest.credential, true);
    // First read after a commit refills the parsed chain once; then nothing.
    lobby.member(guest.credential);
    verifySpy.mockClear();
    const reads = counts.reads;
    const own = lobby.ownCredential;
    for (let i = 0; i < 50; i++) {
      expect(lobby.member(guest.credential).admission).toBe("approved");
      expect(lobby.member(host.credential).admission).toBe("host");
      expect(lobby.member(own).admission).toBe("host");
      expect(lobby.member(lobby.ownCredential).admission).toBe("host");
    }
    expect(verifySpy).not.toHaveBeenCalled();
    expect(counts.reads).toBe(reads);

    const third = request(3);
    lobby.admit(third, third.credential, true);
    verifySpy.mockClear();
    expect(lobby.member(third.credential).admission).toBe("approved");
    expect(lobby.member(guest.credential).admission).toBe("approved");
    expect(verifySpy).toHaveBeenCalledTimes(1);
    expect(store.rosters(pin.sessionId)).toHaveLength(3);
    db.close();
  });

  it("re-verifies when a denied pair appears, when the validity window is left, and after dispose; closure needs no verification", () => {
    const db = new DatabaseSync(":memory:");
    let denied: (readonly [string, string])[] = [];
    let now = time;
    const { lobby } = hostLobby(db, {
      deniedPairs: () => denied,
      now: () => now,
    });
    const guest = request(2);
    lobby.admit(guest, guest.credential, true);
    verifySpy.mockClear();
    lobby.member(guest.credential);
    expect(verifySpy).toHaveBeenCalledTimes(1);

    denied = [[id(1), id(2)]];
    expect(() => lobby.member(guest.credential)).toThrow("FORBIDDEN");
    expect(verifySpy).toHaveBeenCalledTimes(2);
    denied = [[id(2), id(1)]];
    expect(() => lobby.member(guest.credential)).toThrow("FORBIDDEN");
    // A failed verification never replaces the last good entry, so returning to the previously verified denied set reuses it.
    denied = [];
    lobby.member(guest.credential);
    lobby.member(guest.credential);
    expect(verifySpy).toHaveBeenCalledTimes(3);

    now = time + 999;
    lobby.member(guest.credential);
    expect(verifySpy).toHaveBeenCalledTimes(3);
    now = time + 1000;
    expect(() => lobby.member(guest.credential)).toThrow("CREDENTIAL_EXPIRED");
    expect(verifySpy).toHaveBeenCalledTimes(4);
    now = time - 11;
    expect(() => lobby.member(guest.credential)).toThrow("CREDENTIAL_EXPIRED");
    now = time;
    lobby.member(guest.credential);
    const verified = verifySpy.mock.calls.length;

    // Dispose forgets the verification; the next read verifies the chain again.
    lobby.dispose();
    lobby.member(guest.credential);
    expect(verifySpy.mock.calls.length).toBe(verified + 1);

    // Closure is observed through the same store instance that wrote it.
    const { lobby: fresh, store: freshStore } = hostLobby(db, {
      now: () => now,
    });
    fresh.member(guest.credential);
    verifySpy.mockClear();
    freshStore.close(pin.sessionId);
    expect(() => fresh.member(guest.credential)).toThrow(
      "Local sharing closed",
    );
    expect(verifySpy).not.toHaveBeenCalled();
    db.close();
  });

  it("rejects a device that is not in the verified roster without re-verifying the chain", () => {
    const db = new DatabaseSync(":memory:");
    const { lobby } = hostLobby(db);
    const guest = request(2);
    lobby.admit(guest, guest.credential, true);
    verifySpy.mockClear();
    lobby.member(guest.credential);
    expect(() => lobby.member(request(3).credential)).toThrow(
      "Device not admitted",
    );
    expect(verifySpy).toHaveBeenCalledTimes(1);
    db.close();
  });
});

describe("D16 F1 — shared session reads and per-peer key cache", () => {
  function shared(db: DatabaseSync) {
    const { store, lobby, host, counts } = hostLobby(db);
    const guest = request(2);
    lobby.admit(guest, guest.credential, true);
    const session = new TogetherSharedSession({
      lobby,
      seed: host.seed,
      randomBytes: (n) => new Uint8Array(randomBytes(n)),
      randomUUID,
      now: () => time,
      send: async () => {},
    });
    return { store, lobby, session, counts, guest };
  }

  it("getSnapshot() with no change performs no SQL and no roster verification", () => {
    const db = new DatabaseSync(":memory:");
    const { session, counts } = shared(db);
    session.getSnapshot();
    verifySpy.mockClear();
    const reads = counts.reads;
    const writes = counts.writes;
    for (let i = 0; i < 25; i++) session.getSnapshot();
    expect(counts.reads).toBe(reads);
    expect(counts.writes).toBe(writes);
    expect(verifySpy).not.toHaveBeenCalled();
    db.close();
  });

  it("derives each peer's shared secret once, hands out copies, and zeroes the cache on roster change and dispose", () => {
    const db = new DatabaseSync(":memory:");
    const { session, lobby } = shared(db);
    const agreement = jest.spyOn(nobleCryptoBackend, "x25519SharedSecret");
    const internal = session as unknown as {
      key(peerId: string): Uint8Array;
      keys: Map<string, Uint8Array>;
    };
    const first = internal.key(id(2));
    const second = internal.key(id(2));
    expect(agreement).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);
    expect(Array.from(second)).toEqual(Array.from(first));
    expect(first).toHaveLength(32);
    first.fill(0);
    expect(Array.from(internal.key(id(2)))).toEqual(Array.from(second));
    expect(agreement).toHaveBeenCalledTimes(1);
    const stored = internal.keys.get(
      lobby.member(id2Credential(lobby)).credential.payload.publicKey,
    )!;
    expect(stored).toBeDefined();

    session.rosterChanged();
    expect(internal.keys.size).toBe(0);
    expect(stored.every((v) => v === 0)).toBe(true);
    internal.key(id(2));
    expect(agreement).toHaveBeenCalledTimes(2);
    const again = internal.keys.values().next().value as Uint8Array;
    session.dispose();
    expect(internal.keys.size).toBe(0);
    expect(again.every((v) => v === 0)).toBe(true);
    db.close();
  });
});

function id2Credential(lobby: TogetherLocalLobby): Signed<Credential> {
  return lobby.store
    .current(pin.sessionId)!
    .payload.members.find((m) => m.credential.payload.userId === id(2))!
    .credential;
}
