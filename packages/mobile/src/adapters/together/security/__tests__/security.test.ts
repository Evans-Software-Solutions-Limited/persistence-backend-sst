/** @jest-environment node */
import { randomBytes, createPublicKey, verify } from "node:crypto";
import vector from "./offline-wire-vector.json";
import {
  publicKeyPem,
  signPayload,
  verifySignature,
  signatureBytes,
  verifyCredential,
  verifyRoster,
  requestHash,
  Signed,
  Credential,
  OfflineRoster,
  RosterMember,
} from "../identity";
import { LocalSecureChannel, ChannelOptions } from "../channel";
import { encode64, decode64 } from "../encoding";
import { loadOrCreateDeviceSeed } from "../secureSeed";
const id = (n: number) =>
  `${n.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`;
const authority = new Uint8Array(32).fill(91);
const trusted = { v1: publicKeyPem(authority) };
const now = 1700000000000;
function person(n: number) {
  const seed = new Uint8Array(32).fill(n);
  const credential = signPayload<Credential>(
    {
      kind: "together-device-v1",
      keyId: "v1",
      userId: id(n),
      deviceId: id(n + 10),
      publicKey: publicKeyPem(seed),
      issuedAt: now - 10,
      expiresAt: now + 1000,
    },
    authority,
  );
  return { seed, credential };
}
function options(
  role: "host" | "guest",
  n = role === "host" ? 1 : 2,
): ChannelOptions {
  return {
    role,
    ...person(n),
    sessionId: id(100),
    hostUserId: id(1),
    hostDeviceId: id(11),
    trustedKeys: trusted,
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
    now: () => now,
  };
}
function pair() {
  const host = new LocalSecureChannel(options("host"));
  const guest = new LocalSecureChannel(options("guest"));
  const hello = guest.start();
  const response = host.receiveHandshake(hello)!;
  const finish = guest.receiveHandshake(response)!;
  host.receiveHandshake(finish);
  return { host, guest, hello, response, finish };
}
function member(n: number, admission: RosterMember["admission"]): RosterMember {
  const p = person(n);
  return {
    credential: p.credential,
    admission,
    consent: signPayload(
      {
        kind: "together-consent-v1",
        sessionId: id(100),
        hostUserId: id(1),
        hostDeviceId: id(11),
        userId: id(n),
        deviceId: id(n + 10),
        executionId: id(n + 20),
        nonce: id(n + 30),
        consentVersion: "together-v1",
        consentAccepted: true,
      },
      p.seed,
    ),
  };
}
function roster(
  members = [member(1, "host")],
  previous: Signed<OfflineRoster> | null = null,
) {
  return signPayload<OfflineRoster>(
    {
      kind: "together-roster-v1",
      sessionId: id(100),
      hostUserId: id(1),
      hostDeviceId: id(11),
      revision: previous ? previous.payload.revision + 1 : 1,
      previousHash: previous ? requestHash(previous.payload) : null,
      members,
    },
    person(1).seed,
  );
}
describe("portable offline identity", () => {
  it("matches the checked-in backend Node Ed25519 wire vector byte for byte", () => {
    // Fixture copied from core/application/together/__tests__/offline-wire-vector.json.
    const seed = new Uint8Array(32).fill(0x11);
    expect(publicKeyPem(seed)).toBe(vector.publicKey);
    expect(
      new TextDecoder().decode(signatureBytes(vector.envelope.payload)),
    ).toBe(vector.preimage);
    expect(signPayload(vector.envelope.payload, seed)).toEqual(vector.envelope);
    expect(verifySignature(vector.envelope, vector.publicKey)).toEqual(
      vector.envelope.payload,
    );
    expect(
      verify(
        null,
        signatureBytes(vector.envelope.payload),
        createPublicKey(vector.publicKey),
        Buffer.from(vector.envelope.signature, "base64url"),
      ),
    ).toBe(true);
  });
  it("canonicalises recursively and rejects malformed public keys/signatures/encoding", () => {
    expect(requestHash({ z: [{ b: 2, a: 1 }], a: null })).toBe(
      requestHash({ a: null, z: [{ a: 1, b: 2 }] }),
    );
    for (const key of ["bad", vector.publicKey.replace("MCow", "AAAA")])
      expect(() => verifySignature(vector.envelope, key)).toThrow();
    expect(() =>
      verifySignature({ ...vector.envelope, signature: "x" }, vector.publicKey),
    ).toThrow();
    expect(() =>
      verifySignature({ ...vector.envelope, payload: {} }, vector.publicKey),
    ).toThrow();
    expect(() => decode64("AQ", false)).toThrow();
    expect(() => decode64("A".repeat(60001))).toThrow();
  });
  it("requires strict signed issuer credentials and freshness", () => {
    const c = person(1).credential;
    expect(verifyCredential(c, trusted, now)).toEqual(c.payload);
    for (const changes of [
      { kind: "wrong" },
      { userId: "wrong" },
      { issuedAt: -1 },
      { issuedAt: now + 1 },
      { expiresAt: now },
      { expiresAt: now + 86400001 },
      { extra: true },
      { publicKey: "" },
      { keyId: "!" },
    ])
      expect(() =>
        verifyCredential(
          signPayload(
            { ...c.payload, ...changes },
            authority,
          ) as Signed<Credential>,
          trusted,
          now,
        ),
      ).toThrow();
    expect(() => verifyCredential(c, {}, now)).toThrow();
    expect(() =>
      verifyCredential(
        { ...c, extra: true } as Signed<Credential>,
        trusted,
        now,
      ),
    ).toThrow();
  });
  it("validates append-only signed rosters, consent, friend proof and all member blocks", () => {
    const first = roster();
    expect(verifyRoster(first, trusted, null, [], now).revision).toBe(1);
    const friend = member(2, "friend");
    friend.friendship = signPayload(
      {
        kind: "together-friendship-v1",
        keyId: "v1",
        users: [id(1), id(2)],
        issuedAt: now - 10,
        expiresAt: now + 1000,
      },
      authority,
    );
    const second = roster([first.payload.members[0], friend], first);
    expect(verifyRoster(second, trusted, first, [], now).userIds).toEqual([
      id(1),
      id(2),
    ]);
    const third = roster(
      [...second.payload.members, member(3, "approved")],
      second,
    );
    expect(verifyRoster(third, trusted, second, [], now).revision).toBe(3);
    expect(() =>
      verifyRoster(third, trusted, second, [[id(2), id(3)]], now),
    ).toThrow("FORBIDDEN");
    expect(() => verifyRoster(second, trusted, null, [], now)).toThrow();
    for (const changed of [
      roster([member(1, "approved")]),
      roster([member(1, "host"), member(1, "approved")]),
      roster([member(1, "host"), member(2, "friend")]),
      roster([member(1, "host"), member(2, "host")]),
      roster([], null),
    ])
      expect(() => verifyRoster(changed, trusted, null, [], now)).toThrow();
    const badFriend = {
      ...friend,
      friendship: signPayload(
        {
          ...friend.friendship.payload,
          users: [id(2), id(3)] as [string, string],
        },
        authority,
      ),
    };
    expect(() =>
      verifyRoster(
        roster([member(1, "host"), badFriend]),
        trusted,
        null,
        [],
        now,
      ),
    ).toThrow();
    const changedMember = member(1, "host");
    changedMember.consent = signPayload(
      { ...changedMember.consent.payload, nonce: id(90) },
      person(1).seed,
    );
    expect(() =>
      verifyRoster(
        roster([changedMember, friend], first),
        trusted,
        first,
        [],
        now,
      ),
    ).toThrow();
    expect(() =>
      verifyRoster(roster([member(1, "host")], first), trusted, first, [], now),
    ).toThrow();
    const badConsent = member(2, "approved");
    badConsent.consent = signPayload(
      { ...badConsent.consent.payload, sessionId: id(99) },
      person(2).seed,
    );
    expect(() =>
      verifyRoster(
        roster([member(1, "host"), badConsent]),
        trusted,
        null,
        [],
        now,
      ),
    ).toThrow();
  });
});
describe("authenticated encrypted local channel", () => {
  it("mutually authenticates and exchanges encrypted directional frames, preserving unicode", () => {
    const { host, guest } = pair();
    expect(host.ready && guest.ready).toBe(true);
    expect(host.role).toBe("host");
    expect(host.sessionId).toBe(id(100));
    expect(host.hostUserId).toBe(id(1));
    expect(host.hostDeviceId).toBe(id(11));
    const own = host.ownCredential;
    own.payload.userId = id(99);
    expect(host.ownCredential).toEqual(person(1).credential);
    expect(host.peerCredential).toEqual(person(2).credential);
    const copy = host.peerCredential!;
    copy.payload.userId = id(99);
    expect(host.peerCredential!.payload.userId).toBe(id(2));
    const wire = guest.encrypt("private 🏋️ data");
    expect(wire).not.toContain("private");
    expect(host.decrypt(wire)).toBe("private 🏋️ data");
    expect(guest.decrypt(host.encrypt("reply"))).toBe("reply");
    expect(host.decrypt(guest.encrypt("second"))).toBe("second");
  });
  it("does not allow data before proof of both fresh challenges", () => {
    const host = new LocalSecureChannel(options("host"));
    expect(host.peerCredential).toBeUndefined();
    expect(() => host.encrypt("x")).toThrow();
    expect(() => host.start()).toThrow("CLOSED");
    const guest = new LocalSecureChannel(options("guest"));
    expect(() => guest.decrypt("{}")).toThrow();
    const h = new LocalSecureChannel(options("host"));
    const g = new LocalSecureChannel(options("guest"));
    h.receiveHandshake(g.start());
    expect(h.ready).toBe(false);
    expect(() => h.decrypt("{}")).toThrow();
  });
  it("rejects wrong credentials, host/session pinning, reflected roles and altered handshakes", () => {
    expect(
      () =>
        new LocalSecureChannel({ ...options("host"), seed: person(2).seed }),
    ).toThrow();
    expect(
      () => new LocalSecureChannel({ ...options("guest"), sessionId: "bad" }),
    ).toThrow();
    expect(() => new LocalSecureChannel(options("host", 2))).toThrow();
    expect(() => new LocalSecureChannel(options("guest", 1))).toThrow();
    const { hello, response, finish } = pair();
    for (const wire of [response, finish, "{}", "{", "x".repeat(12001)]) {
      const h = new LocalSecureChannel(options("host"));
      expect(() => h.receiveHandshake(wire)).toThrow();
      expect(h.ready).toBe(false);
    }
    const other = new LocalSecureChannel({
      ...options("host"),
      sessionId: id(101),
    });
    expect(() => other.receiveHandshake(hello)).toThrow();
    const altered = JSON.parse(hello);
    altered.payload.nonce = encode64(new Uint8Array(32), true);
    expect(() =>
      new LocalSecureChannel(options("host")).receiveHandshake(
        JSON.stringify(altered),
      ),
    ).toThrow();
    const attacker = new LocalSecureChannel({
      ...options("guest"),
      hostUserId: id(3),
      hostDeviceId: id(13),
    });
    expect(() => attacker.receiveHandshake(response)).toThrow();
  });
  it("rejects a valid third-party credential impersonating the pinned host", () => {
    const host = new LocalSecureChannel(options("host"));
    const guest = new LocalSecureChannel(options("guest"));
    const response = JSON.parse(host.receiveHandshake(guest.start())!);
    const attacker = person(3);
    const forged = signPayload(
      { ...response.payload, credential: attacker.credential },
      attacker.seed,
    );
    expect(() => guest.receiveHandshake(JSON.stringify(forged))).toThrow(
      "WRONG_PEER",
    );
  });
  it("bounds recursive canonical input before a deep payload can exhaust the stack", () => {
    let payload: unknown = null;
    for (let i = 0; i < 40; i++) payload = { value: payload };
    expect(() => requestHash(payload)).toThrow("INVALID_PAYLOAD_DEPTH");
  });
  it("fresh connection challenges reject replayed response and finish", () => {
    const old = pair();
    const h = new LocalSecureChannel(options("host"));
    const g = new LocalSecureChannel(options("guest"));
    h.receiveHandshake(g.start());
    expect(() => g.receiveHandshake(old.response)).toThrow();
    expect(() => h.receiveHandshake(old.finish)).toThrow();
  });
  it.each([
    "replay",
    "out-of-order",
    "tamper",
    "reflection",
    "cross-connection",
    "extra",
    "malformed",
    "oversize",
  ])("rejects %s and permanently closes", (attack) => {
    const { host, guest } = pair();
    let wire = guest.encrypt("one");
    if (attack === "replay") host.decrypt(wire);
    if (attack === "out-of-order") wire = guest.encrypt("two");
    if (attack === "tamper") {
      const frame = JSON.parse(wire);
      frame.ciphertext = encode64(new Uint8Array(20), true);
      wire = JSON.stringify(frame);
    }
    if (attack === "reflection") wire = host.encrypt("one");
    if (attack === "cross-connection") wire = pair().guest.encrypt("one");
    if (attack === "extra")
      wire = JSON.stringify({ ...JSON.parse(wire), extra: 1 });
    if (attack === "malformed") wire = "{";
    if (attack === "oversize") wire = "x".repeat(60001);
    expect(() => host.decrypt(wire)).toThrow();
    expect(host.ready).toBe(false);
    expect(() => host.encrypt("later")).toThrow();
  });
  it("expires existing channels and bounds cleartext UTF8 bytes", () => {
    let clock = now;
    const h = new LocalSecureChannel({ ...options("host"), now: () => clock });
    const g = new LocalSecureChannel(options("guest"));
    h.receiveHandshake(g.receiveHandshake(h.receiveHandshake(g.start())!)!);
    clock = now + 1000;
    expect(() => h.decrypt(g.encrypt("x"))).toThrow();
    expect(() => pair().guest.encrypt("🏋".repeat(10001))).toThrow();
    expect(() =>
      new LocalSecureChannel({
        ...options("guest"),
        randomBytes: () => new Uint8Array(1),
      }).start(),
    ).toThrow();
  });
});
describe("account/device secure seeds", () => {
  it("serializes creation, reopens same identity, and never silently rotates a missing key", async () => {
    let saved: string | null = null;
    const store = {
      getItemAsync: jest.fn(async () => saved),
      setItemAsync: jest.fn(async (_k: string, v: string) => {
        saved = v;
      }),
    };
    const rng = jest.fn(() => new Uint8Array(32).fill(4));
    await expect(
      loadOrCreateDeviceSeed(id(1), id(11), store, rng),
    ).rejects.toThrow("MISSING");
    const [a, b] = await Promise.all([
      loadOrCreateDeviceSeed(id(1), id(11), store, rng, true),
      loadOrCreateDeviceSeed(id(1), id(11), store, rng, true),
    ]);
    expect(a).toEqual(b);
    expect(store.setItemAsync).toHaveBeenCalledTimes(1);
    a.fill(0);
    expect(b[0]).toBe(4);
    expect(await loadOrCreateDeviceSeed(id(1), id(11), store, rng)).toEqual(b);
    expect(rng).toHaveBeenCalledTimes(1);
    await expect(
      loadOrCreateDeviceSeed(id(2), id(11), store, rng),
    ).rejects.toThrow();
    await expect(
      loadOrCreateDeviceSeed("bad", id(11), store, rng),
    ).rejects.toThrow();
  });
  it.each([
    "{",
    "x".repeat(513),
    JSON.stringify({
      accountId: id(1),
      deviceId: id(11),
      seed: encode64(new Uint8Array(1), true),
    }),
    JSON.stringify({ accountId: id(1), deviceId: id(11), seed: "!" }),
  ])("fails closed on corrupt persisted value", async (saved) => {
    const store = { getItemAsync: async () => saved, setItemAsync: jest.fn() };
    await expect(
      loadOrCreateDeviceSeed(id(1), id(11), store, randomBytes, true),
    ).rejects.toThrow();
    expect(store.setItemAsync).not.toHaveBeenCalled();
  });
  it("propagates storage failures and rejects invalid entropy", async () => {
    await expect(
      loadOrCreateDeviceSeed(
        id(1),
        id(11),
        { getItemAsync: async () => null, setItemAsync: async () => {} },
        () => new Uint8Array(2),
        true,
      ),
    ).rejects.toThrow();
    await expect(
      loadOrCreateDeviceSeed(
        id(1),
        id(11),
        {
          getItemAsync: async () => null,
          setItemAsync: async () => {
            throw new Error("locked");
          },
        },
        randomBytes,
        true,
      ),
    ).rejects.toThrow("locked");
  });
});
