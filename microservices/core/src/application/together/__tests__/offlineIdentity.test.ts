import vector from "./offline-wire-vector.json";
import {
  generateKeyPairSync,
  randomUUID,
  createPublicKey,
  verify,
} from "node:crypto";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  signPayload,
  verifyCredential,
  verifyRoster,
  signatureBytes,
  verifySignature,
  offlineAuthority,
  OFFLINE_CREDENTIAL_TTL_MS,
  type Credential,
  type RosterMember,
  type OfflineRoster,
  type FriendshipEvidence,
  type Signed,
} from "../offlineIdentity";
import { requestHash } from "../shared";
const keypair = () => {
  const pair = generateKeyPairSync("ed25519");
  return {
    privateKey: pair.privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
    publicKey: pair.publicKey
      .export({ format: "pem", type: "spki" })
      .toString(),
  };
};
const issuer = keypair(),
  trusted = { test: issuer.publicKey };
const now = 1700000000000;
function fixture() {
  const sessionId = randomUUID(),
    hostUserId = randomUUID(),
    hostDeviceId = randomUUID();
  const keys = [keypair(), keypair(), keypair(), keypair(), keypair()];
  const users = [hostUserId, ...keys.slice(1).map(() => randomUUID())];
  const members = keys.map((key, i): RosterMember => {
    const deviceId = i === 0 ? hostDeviceId : randomUUID();
    return {
      credential: signPayload<Credential>(
        {
          kind: "together-device-v1",
          keyId: "test",
          userId: users[i],
          deviceId,
          publicKey: key.publicKey,
          issuedAt: now - 1,
          expiresAt: now + 1000,
        },
        issuer.privateKey,
      ),
      consent: signPayload(
        {
          kind: "together-consent-v1",
          sessionId,
          hostUserId,
          hostDeviceId,
          userId: users[i],
          deviceId,
          executionId: randomUUID(),
          nonce: randomUUID(),
          consentVersion: "together-v1",
          consentAccepted: true,
        },
        key.privateKey,
      ),
      admission: i === 0 ? "host" : "approved",
    };
  });
  const roster = (
    size: number,
    previous: Signed<OfflineRoster> | null = null,
  ) =>
    signPayload<OfflineRoster>(
      {
        kind: "together-roster-v1",
        sessionId,
        hostUserId,
        hostDeviceId,
        revision: previous ? previous.payload.revision + 1 : 1,
        previousHash: previous ? requestHash(previous.payload) : null,
        members: members.slice(0, size),
      },
      keys[0].privateKey,
    );
  return { sessionId, users, keys, members, roster };
}
afterEach(() => vi.unstubAllEnvs());
describe("offline publicly verifiable identity", () => {
  it("matches a deterministic native interoperability vector with independent Node verification", () => {
    expect(signatureBytes(vector.envelope.payload).toString()).toBe(
      vector.preimage,
    );
    expect(
      verify(
        null,
        Buffer.from(vector.preimage),
        createPublicKey(vector.publicKey),
        Buffer.from(vector.envelope.signature, "base64url"),
      ),
    ).toBe(true);
    expect(verifySignature(vector.envelope, vector.publicKey)).toEqual(
      vector.envelope.payload,
    );
  });
  it("verifies signed credentials without secrets and fails closed for malformed/untrusted/expired claims", () => {
    const f = fixture(),
      credential = f.members[0].credential;
    expect(verifyCredential(credential, trusted, now).userId).toBe(f.users[0]);
    expect(
      verify(
        null,
        signatureBytes(credential.payload),
        createPublicKey(issuer.publicKey),
        Buffer.from(credential.signature, "base64url"),
      ),
    ).toBe(true);
    expect(() => verifyCredential(credential, {}, now)).toThrow();
    expect(() => verifyCredential(credential, trusted, now + 1000)).toThrow();
    expect(() => verifyCredential(credential, trusted, now - 2)).toThrow();
    expect(() =>
      verifyCredential(
        {
          ...credential,
          payload: { ...credential.payload, userId: randomUUID() },
        },
        trusted,
        now,
      ),
    ).toThrow();
    expect(() => verifyCredential(null as never, trusted, now)).toThrowError(
      "Request cannot be completed",
    );
    const long = signPayload(
      { ...credential.payload, expiresAt: now + OFFLINE_CREDENTIAL_TTL_MS },
      issuer.privateKey,
    );
    expect(() => verifyCredential(long, trusted, now)).toThrow();
    expect(() => verifySignature(credential, "bad-key")).toThrow();
  });
  it("validates configured authority and returns no private material in trusted verification keys", () => {
    expect(() => offlineAuthority()).toThrow();
    vi.stubEnv(
      "TOGETHER_OFFLINE_AUTHORITY",
      JSON.stringify({
        keyId: "test",
        privateKey: issuer.privateKey,
        publicKeys: trusted,
      }),
    );
    expect(offlineAuthority().publicKeys).toEqual(trusted);
    vi.stubEnv(
      "TOGETHER_OFFLINE_AUTHORITY",
      JSON.stringify({
        keyId: "wrong",
        privateKey: issuer.privateKey,
        publicKeys: trusted,
      }),
    );
    expect(() => offlineAuthority()).toThrow();
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() =>
      signPayload(
        {},
        rsa.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      ),
    ).toThrow();
  });
  it("admits four with a signed append-only host roster and fresh pair evidence for automatic friends", () => {
    const f = fixture();
    f.members[1].admission = "friend";
    f.members[1].friendship = signPayload<FriendshipEvidence>(
      {
        kind: "together-friendship-v1",
        keyId: "test",
        users: [f.users[0], f.users[1]],
        issuedAt: now - 1,
        expiresAt: now + 1000,
      },
      issuer.privateKey,
    );
    let previous: Signed<OfflineRoster> | null = null;
    for (let size = 1; size <= 4; size++) {
      const next = f.roster(size, previous);
      expect(
        verifyRoster(next, trusted, previous, [], now).userIds,
      ).toHaveLength(size);
      previous = next;
    }
    expect(() =>
      verifyRoster(f.roster(5, previous), trusted, previous, [], now),
    ).toThrow();
    expect(() => verifyRoster(previous!, trusted, previous, [], now)).toThrow();
  });
  it("rejects forged consent, wrong pair, duplicate identities, locally blocked guest pairs and malformed peer data", () => {
    const f = fixture();
    const roster = f.roster(3);
    expect(() =>
      verifyRoster(roster, trusted, null, [[f.users[2], f.users[1]]], now),
    ).toThrow();
    f.members[1].consent.payload.sessionId = randomUUID();
    expect(() => verifyRoster(f.roster(2), trusted, null, [], now)).toThrow();
    expect(() =>
      verifyRoster({ payload: null } as never, trusted, null, [], now),
    ).toThrowError("Request cannot be completed");
    const g = fixture();
    g.members[1].admission = "friend";
    expect(() => verifyRoster(g.roster(2), trusted, null, [], now)).toThrow();
    g.members[1].friendship = signPayload<FriendshipEvidence>(
      {
        kind: "together-friendship-v1",
        keyId: "test",
        users: [g.users[0], g.users[2]],
        issuedAt: now - 1,
        expiresAt: now + 1000,
      },
      issuer.privateKey,
    );
    expect(() => verifyRoster(g.roster(2), trusted, null, [], now)).toThrow();
    const h = fixture();
    h.members[1] = h.members[0];
    expect(() => verifyRoster(h.roster(2), trusted, null, [], now)).toThrow();
  });
  it("rejects roster history replacement and stale peer proof even with a host signature", () => {
    const f = fixture(),
      previous = f.roster(1);
    const next = f.roster(2, previous);
    next.payload.members[0] = {
      ...next.payload.members[0],
      admission: "approved",
    };
    expect(() =>
      verifyRoster(
        signPayload(next.payload, f.keys[0].privateKey),
        trusted,
        previous,
        [],
        now,
      ),
    ).toThrow();
    const g = fixture(),
      before = g.roster(2),
      after = g.roster(3, before);
    after.payload.members[1].admission = "friend";
    after.payload.members[1].friendship = signPayload<FriendshipEvidence>(
      {
        kind: "together-friendship-v1",
        keyId: "test",
        users: [g.users[0], g.users[1]],
        issuedAt: now - 2,
        expiresAt: now - 1,
      },
      issuer.privateKey,
    );
    expect(() =>
      verifyRoster(
        signPayload(after.payload, g.keys[0].privateKey),
        trusted,
        before,
        [],
        now,
      ),
    ).toThrow();
    expect(() =>
      verifyRoster(g.roster(4, before), trusted, before, [], now),
    ).toThrow();
  });
  it("accepts one host-signed removal without permitting replacement, reorder, host removal or replay", () => {
    const f = fixture(),
      previous = f.roster(3);
    const payload = {
      ...previous.payload,
      revision: previous.payload.revision + 1,
      previousHash: requestHash(previous.payload),
      members: [f.members[0], f.members[2]],
    };
    const removed = signPayload(payload, f.keys[0].privateKey);
    expect(verifyRoster(removed, trusted, previous, [], now).userIds).toEqual([
      f.users[0],
      f.users[2],
    ]);
    for (const members of [
      [f.members[0]],
      [f.members[1], f.members[2]],
      [f.members[0], f.members[3]],
      [f.members[2], f.members[0]],
    ])
      expect(() =>
        verifyRoster(
          signPayload({ ...payload, members }, f.keys[0].privateKey),
          trusted,
          previous,
          [],
          now,
        ),
      ).toThrow();
    expect(() => verifyRoster(removed, trusted, removed, [], now)).toThrow();
    expect(() =>
      verifyRoster(
        signPayload(payload, f.keys[1].privateKey),
        trusted,
        previous,
        [],
        now,
      ),
    ).toThrow();
  });
});
