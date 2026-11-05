/** @jest-environment node */
import { randomBytes } from "node:crypto";
import { FriendsGuestExchange, FriendsHostExchange } from "../friendsDiscovery";
import {
  publicKeyPem,
  signPayload,
  type Credential,
  type FriendshipEvidence,
  type Signed,
} from "../security/identity";
import { encode64 } from "../security/encoding";

const now = 1700000000000;
const id = (n: number) =>
  `${n.toString().padStart(8, "0")}-1111-4111-8111-111111111111`;
const issuer = new Uint8Array(32).fill(7);
const trustedKeys = { issuer: publicKeyPem(issuer) };
const host = id(1),
  guest = id(9),
  session = id(3);
const hostSeed = new Uint8Array(32).fill(3);
function credential(
  userId: string,
  deviceId: string,
  seed: Uint8Array,
  change: Partial<Credential> = {},
  key = issuer,
): Signed<Credential> {
  return signPayload<Credential>(
    {
      kind: "together-device-v1",
      keyId: "issuer",
      userId,
      deviceId,
      publicKey: publicKeyPem(seed),
      issuedAt: now - 1000,
      expiresAt: now + 60000,
      ...change,
    },
    key,
  );
}
const hostCredential = credential(host, id(2), hostSeed);
function friendship(
  users: [string, string] = [host, guest],
  change: Partial<FriendshipEvidence> = {},
  key = issuer,
): Signed<FriendshipEvidence> {
  return signPayload<FriendshipEvidence>(
    {
      kind: "together-friendship-v1",
      keyId: "issuer",
      users,
      issuedAt: now - 100,
      expiresAt: now + 60000,
      ...change,
    },
    key,
  );
}
const SUMMARY = '{"payload":{"workoutName":"Partners"},"signature":"x"}';
function makeHost(
  nonce: string,
  o: Partial<ConstructorParameters<typeof FriendsHostExchange>[0]> = {},
) {
  const summary = jest.fn((_guest: string): string | undefined => SUMMARY);
  const side = new FriendsHostExchange({
    hint: "hint",
    nonce,
    sessionId: session,
    hostUserId: host,
    credential: hostCredential,
    seed: hostSeed,
    trustedKeys,
    randomBytes,
    now: () => now,
    summary,
    ...o,
  });
  return { side, summary };
}
const makeGuest = (nonce: string, friendId = host, sessionId = session) =>
  new FriendsGuestExchange({
    nonce,
    sessionId,
    friendId,
    trustedKeys,
    randomBytes,
    now: () => now,
  });
const fresh = () => encode64(randomBytes(32), true);

describe("Training partners exchange (Inspector Brad, PR #527)", () => {
  it("completes for the partner: the guest's proof and the summary cross only as ciphertext", () => {
    const nonce = fresh();
    const { side, summary } = makeHost(nonce);
    const g = makeGuest(nonce);
    const challenge = g.challenge();
    expect(Object.keys(JSON.parse(challenge)).sort()).toEqual([
      "eph",
      "kind",
      "nonce",
    ]);
    const response = side.receive(challenge)!;
    expect(side.finished).toBe(false);
    // Strangers learn nothing about the host from the response.
    for (const clear of [host, id(2), session, "together-device-v1"])
      expect(response).not.toContain(clear);
    g.accept(response);
    expect(g.hostDeviceId).toBe(id(2));
    const proof = g.proof(friendship());
    for (const clear of [guest, "together-friendship-v1"])
      expect(proof).not.toContain(clear);
    const sealed = side.receive(proof)!;
    expect(side.finished).toBe(true);
    expect(summary).toHaveBeenCalledWith(guest);
    expect(sealed).not.toContain("Partners");
    expect(g.summary(sealed)).toBe(SUMMARY);
    // One exchange per socket.
    expect(side.receive(proof)).toBeUndefined();
    expect(side.receive(challenge)).toBeUndefined();
  });
  it("a response cannot be opened without the host's user id", () => {
    const nonce = fresh();
    const { side } = makeHost(nonce);
    const stranger = makeGuest(nonce, id(5));
    expect(() =>
      stranger.accept(side.receive(stranger.challenge())!),
    ).toThrow();
    expect(() => stranger.proof(friendship())).toThrow();
  });
  it("a relay that sees every frame, even knowing the host's id, opens nothing", () => {
    const nonce = fresh();
    const { side } = makeHost(nonce);
    const g = makeGuest(nonce);
    const response = side.receive(g.challenge())!;
    // The relay's own ephemeral is not the one the host answered.
    const relay = makeGuest(nonce);
    expect(() => relay.accept(response)).toThrow();
    g.accept(response);
    const sealed = side.receive(g.proof(friendship()))!;
    expect(() => relay.summary(sealed)).toThrow();
  });
  it("rejects a host that is not the matched partner, or whose credential or signature does not hold", () => {
    const forgerSeed = new Uint8Array(32).fill(4);
    const cases: Partial<
      ConstructorParameters<typeof FriendsHostExchange>[0]
    >[] = [
      // Another real user's device, keyed with the partner's id.
      { credential: credential(id(5), id(6), forgerSeed), seed: forgerSeed },
      // The partner's credential without its device key.
      { seed: forgerSeed },
      // Expired, or not from the trusted authority.
      { credential: credential(host, id(2), hostSeed, { expiresAt: now }) },
      {
        credential: credential(
          host,
          id(2),
          hostSeed,
          {},
          new Uint8Array(32).fill(8),
        ),
      },
    ];
    for (const o of cases) {
      const nonce = fresh();
      const g = makeGuest(nonce);
      expect(() =>
        g.accept(makeHost(nonce, o).side.receive(g.challenge())!),
      ).toThrow();
      expect(() => g.proof(friendship())).toThrow();
    }
    // Signed for another session, or answering another guest's challenge.
    const nonce = fresh();
    const g = makeGuest(nonce, host, id(4));
    expect(() =>
      g.accept(makeHost(nonce).side.receive(g.challenge())!),
    ).toThrow();
    const other = makeGuest(nonce);
    const g2 = makeGuest(nonce);
    g2.challenge();
    expect(() =>
      g2.accept(makeHost(nonce).side.receive(other.challenge())!),
    ).toThrow();
    // A tampered response.
    const n3 = fresh();
    const g3 = makeGuest(n3);
    const r = JSON.parse(makeHost(n3).side.receive(g3.challenge())!);
    r.sealed = `${r.sealed[0] === "A" ? "B" : "A"}${r.sealed.slice(1)}`;
    expect(() => g3.accept(JSON.stringify(r))).toThrow();
  });
  it("a replayed or bare proof gets no summary, even reusing the guest's nonce and challenge", () => {
    const nonce = fresh();
    const real = makeHost(nonce);
    const g = makeGuest(nonce);
    const challenge = g.challenge();
    g.accept(real.side.receive(challenge)!);
    const proof = g.proof(friendship());
    expect(real.side.receive(proof)).toBeDefined();
    // The attacker opens its own socket to the same host with the same frames.
    const replay = makeHost(nonce);
    expect(replay.side.receive(challenge)).toBeDefined();
    expect(replay.side.receive(proof)).toBeUndefined();
    expect(replay.summary).not.toHaveBeenCalled();
    // A clear proof, or a proof before any challenge, is refused.
    const bare = makeHost(nonce);
    expect(
      bare.side.receive(
        JSON.stringify({
          kind: "together-friends-probe-v1",
          nonce,
          friendship: friendship(),
        }),
      ),
    ).toBeUndefined();
    const early = makeHost(nonce);
    expect(early.side.receive(proof)).toBeUndefined();
    expect(early.side.receive(challenge)).toBeUndefined();
    expect(bare.summary).not.toHaveBeenCalled();
    expect(early.summary).not.toHaveBeenCalled();
  });
  it("the host verifies the sealed proof exactly as admission does, and honours its own refusal", () => {
    for (const bad of [
      friendship([guest, id(5)]),
      friendship([host, host]),
      friendship([host, guest], { expiresAt: now }),
      friendship([host, guest], {}, new Uint8Array(32).fill(8)),
      { payload: {} } as unknown as Signed<FriendshipEvidence>,
    ]) {
      const nonce = fresh();
      const { side, summary } = makeHost(nonce);
      const g = makeGuest(nonce);
      g.accept(side.receive(g.challenge())!);
      expect(side.receive(g.proof(bad))).toBeUndefined();
      expect(summary).not.toHaveBeenCalled();
      expect(side.finished).toBe(true);
    }
    const nonce = fresh();
    const { side, summary } = makeHost(nonce);
    summary.mockReturnValue(undefined);
    const g = makeGuest(nonce);
    g.accept(side.receive(g.challenge())!);
    expect(side.receive(g.proof(friendship()))).toBeUndefined();
    expect(summary).toHaveBeenCalledWith(guest);
  });
  it("refuses malformed, oversized and wrong-nonce frames", () => {
    const nonce = fresh();
    const g = makeGuest(nonce);
    for (const bad of [
      "{",
      "x".repeat(257),
      JSON.stringify({ kind: "together-friends-challenge-v1", nonce }),
      JSON.stringify({
        kind: "together-friends-challenge-v1",
        nonce: fresh(),
        eph: JSON.parse(g.challenge()).eph,
      }),
      JSON.stringify({
        kind: "together-friends-challenge-v1",
        nonce,
        eph: "short",
      }),
      // A low-order point gives an all-zero secret.
      JSON.stringify({
        kind: "together-friends-challenge-v1",
        nonce,
        eph: encode64(new Uint8Array(32), true),
      }),
    ])
      expect(makeHost(nonce).side.receive(bad)).toBeUndefined();
    expect(() => g.accept("x".repeat(4097))).toThrow();
    expect(() =>
      g.accept(
        JSON.stringify({
          kind: "together-friends-response-v1",
          nonce,
          eph: "short",
          sealed: "",
        }),
      ),
    ).toThrow();
    expect(() => g.summary("{}")).toThrow();
    const ok = makeGuest(nonce);
    const { side } = makeHost(nonce);
    const response = side.receive(ok.challenge())!;
    ok.accept(response);
    expect(() => ok.accept(response)).toThrow();
    expect(() =>
      ok.summary(
        JSON.stringify({
          kind: "together-friends-summary-v1",
          nonce,
          sealed: 7,
        }),
      ),
    ).toThrow();
    ok.dispose();
    side.dispose();
    expect(side.finished).toBe(true);
  });
});
