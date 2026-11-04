/**
 * Training partners search, after a hint's tag matched one of the guest's
 * partners (Brad, 3 Nov; Inspector Brad on PR #527).
 *
 *   guest → host  challenge {nonce, eph}             anonymous, fresh ephemeral
 *   host  → guest response  {nonce, eph, sealed}     sealed: host credential +
 *                                                    device signature over the
 *                                                    transcript
 *   guest → host  proof     {nonce, sealed}          sealed friendship proof
 *   host  → guest summary   {nonce, sealed}          sealed signed summary
 *
 * Every key comes from the two ephemerals' X25519 secret mixed with the
 * host's user id and bound to the transcript (session, nonce, both
 * ephemerals). So a device that is not the host cannot sign the response, and
 * the guest releases its identity (inside the proof) only after it verified
 * the host's server-issued credential; a relay cannot open any sealed part;
 * and a stranger who sends its own challenge cannot open the response without
 * already knowing the host's user id. Each key seals exactly one message.
 */
import { x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { getCryptoBackend } from "./security/cryptoBackend";
import { decode64, encode64 } from "./security/encoding";
import { object, signed } from "./security/schema";
import {
  requestHash,
  signPayload,
  verifyCredential,
  verifyFriendship,
  verifySignature,
  type Credential,
  type FriendshipEvidence,
  type Signed,
  type TrustedKeys,
} from "./security/identity";

const KEY = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
interface ResponseProof {
  kind: "together-friends-response-v1";
  transcript: string;
}
type Purpose = "identity" | "to-host" | "to-guest";

function key32(value: unknown): value is string {
  return (
    typeof value === "string" &&
    KEY.test(value) &&
    decode64(value, true).length === 32
  );
}
function frame(
  text: string,
  kind: string,
  nonce: string,
  fields: string[],
  max: number,
): Record<string, unknown> {
  if (typeof text !== "string" || text.length > max)
    throw new Error("invalid-friends-frame");
  const p: unknown = JSON.parse(text);
  if (!object(p, ["kind", "nonce", ...fields]) || p.kind !== kind)
    throw new Error("invalid-friends-frame");
  if (p.nonce !== nonce) throw new Error("invalid-friends-frame");
  return p;
}
function secret(randomBytes: (length: number) => Uint8Array): Uint8Array {
  const bytes = randomBytes(32);
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32)
    throw new Error("INVALID_RANDOM");
  return bytes.slice();
}

/** Shared by both sides: the transcript and the three single-use keys. */
class Keys {
  readonly transcript: string;
  private readonly ikm: Uint8Array;
  constructor(
    own: Uint8Array,
    peer: string,
    hostUserId: string,
    t: { sessionId: string; nonce: string; guest: string; host: string },
  ) {
    const shared = getCryptoBackend().x25519SharedSecret(
      own,
      decode64(peer, true),
    );
    if (shared.every((b) => b === 0)) throw new Error("invalid-friends-key");
    this.transcript = requestHash({ kind: "together-friends-v1", ...t });
    this.ikm = new Uint8Array([...shared, ...encoder.encode(hostUserId)]);
    shared.fill(0);
  }
  private key(purpose: Purpose) {
    return hkdf(
      sha256,
      this.ikm,
      encoder.encode(this.transcript),
      encoder.encode(`persistence-together-friends-v1:${purpose}`),
      32,
    );
  }
  seal(purpose: Purpose, clear: string): string {
    return encode64(
      chacha20poly1305(
        this.key(purpose),
        new Uint8Array(12),
        encoder.encode(this.transcript),
      ).encrypt(encoder.encode(clear)),
      true,
    );
  }
  open(purpose: Purpose, sealed: unknown, max: number): string {
    if (typeof sealed !== "string" || sealed.length > max)
      throw new Error("invalid-friends-frame");
    return decoder.decode(
      chacha20poly1305(
        this.key(purpose),
        new Uint8Array(12),
        encoder.encode(this.transcript),
      ).decrypt(decode64(sealed, true, max)),
    );
  }
  dispose() {
    this.ikm.fill(0);
  }
}

/** Guest side, created only after a hint's tag matched partner `friendId`. */
export class FriendsGuestExchange {
  private readonly ephemeral: Uint8Array;
  private readonly eph: string;
  private keys?: Keys;
  /** The verified host device, once the response checked out. */
  hostDeviceId?: string;
  constructor(
    private readonly o: {
      nonce: string;
      sessionId: string;
      friendId: string;
      trustedKeys: TrustedKeys;
      randomBytes(length: number): Uint8Array;
      now(): number;
    },
  ) {
    this.ephemeral = secret(o.randomBytes);
    this.eph = encode64(x25519.getPublicKey(this.ephemeral), true);
  }
  /** Carries nothing about the guest: a fresh ephemeral key only. */
  challenge(): string {
    return JSON.stringify({
      kind: "together-friends-challenge-v1",
      nonce: this.o.nonce,
      eph: this.eph,
    });
  }
  /** Throws unless the host proved it is `friendId`'s device for this exchange. */
  accept(text: string): void {
    if (this.keys) throw new Error("invalid-friends-frame");
    const p = frame(
      text,
      "together-friends-response-v1",
      this.o.nonce,
      ["eph", "sealed"],
      4096,
    );
    if (!key32(p.eph)) throw new Error("invalid-friends-frame");
    const keys = new Keys(this.ephemeral, p.eph, this.o.friendId, {
      sessionId: this.o.sessionId,
      nonce: this.o.nonce,
      guest: this.eph,
      host: p.eph,
    });
    this.ephemeral.fill(0);
    try {
      const inner: unknown = JSON.parse(keys.open("identity", p.sealed, 4096));
      if (!object(inner, ["credential", "proof"]))
        throw new Error("invalid-friends-frame");
      const host = verifyCredential(
        inner.credential as Signed<Credential>,
        this.o.trustedKeys,
        this.o.now(),
      );
      if (
        host.userId !== this.o.friendId ||
        !signed(
          inner.proof,
          (v) =>
            object(v, ["kind", "transcript"]) &&
            v.kind === "together-friends-response-v1" &&
            v.transcript === keys.transcript,
        )
      )
        throw new Error("invalid-friends-frame");
      verifySignature(inner.proof as Signed<ResponseProof>, host.publicKey);
      this.hostDeviceId = host.deviceId;
      this.keys = keys;
    } catch (error) {
      keys.dispose();
      throw error;
    }
  }
  /** The friendship proof, readable only by the verified host of this exchange. */
  proof(friendship: Signed<FriendshipEvidence>): string {
    if (!this.keys) throw new Error("invalid-friends-frame");
    return JSON.stringify({
      kind: "together-friends-proof-v1",
      nonce: this.o.nonce,
      sealed: this.keys.seal("to-host", JSON.stringify(friendship)),
    });
  }
  /** The host's signed summary frame; the caller verifies it with `readSummary`. */
  summary(text: string): string {
    if (!this.keys) throw new Error("invalid-friends-frame");
    const p = frame(
      text,
      "together-friends-summary-v1",
      this.o.nonce,
      ["sealed"],
      9000,
    );
    return this.keys.open("to-guest", p.sealed, 9000);
  }
  dispose() {
    this.ephemeral.fill(0);
    this.keys?.dispose();
  }
}

/**
 * Host side of one hinted socket: one challenge, then one sealed proof.
 * Any other frame, or a proof that does not verify, ends it with nothing.
 */
export class FriendsHostExchange {
  private keys?: Keys;
  private done = false;
  readonly hint: string;
  constructor(
    private readonly o: {
      /** The anonymous hint this exchange answers a probe with. */
      hint: string;
      nonce: string;
      sessionId: string;
      hostUserId: string;
      credential: Signed<Credential>;
      seed: Uint8Array;
      trustedKeys: TrustedKeys;
      randomBytes(length: number): Uint8Array;
      now(): number;
      /** The signed summary for this verified partner, or nothing (blocked, lobby gone). */
      summary(guestUserId: string): string | undefined;
    },
  ) {
    this.hint = o.hint;
  }
  /** The reply to `frame`, or undefined to close the socket with nothing. */
  receive(text: string): string | undefined {
    if (this.done) return;
    try {
      return this.keys ? this.prove(text) : this.challenge(text);
    } catch {
      this.dispose();
      return;
    }
  }
  /** True once the exchange is over and the socket should close. */
  get finished(): boolean {
    return this.done;
  }
  private challenge(text: string): string {
    const p = frame(
      text,
      "together-friends-challenge-v1",
      this.o.nonce,
      ["eph"],
      256,
    );
    if (!key32(p.eph)) throw new Error("invalid-friends-frame");
    const ephemeral = secret(this.o.randomBytes);
    const eph = encode64(x25519.getPublicKey(ephemeral), true);
    const keys = new Keys(ephemeral, p.eph, this.o.hostUserId, {
      sessionId: this.o.sessionId,
      nonce: this.o.nonce,
      guest: p.eph,
      host: eph,
    });
    ephemeral.fill(0);
    this.keys = keys;
    return JSON.stringify({
      kind: "together-friends-response-v1",
      nonce: this.o.nonce,
      eph,
      sealed: keys.seal(
        "identity",
        JSON.stringify({
          credential: this.o.credential,
          proof: signPayload<ResponseProof>(
            {
              kind: "together-friends-response-v1",
              transcript: keys.transcript,
            },
            this.o.seed,
          ),
        }),
      ),
    });
  }
  private prove(text: string): string | undefined {
    this.done = true;
    const keys = this.keys!;
    const p = frame(
      text,
      "together-friends-proof-v1",
      this.o.nonce,
      ["sealed"],
      2048,
    );
    const friendship = JSON.parse(keys.open("to-host", p.sealed, 2048)) as
      | Signed<FriendshipEvidence>
      | undefined;
    const users = friendship?.payload?.users;
    const guest = Array.isArray(users)
      ? users.find((user) => user !== this.o.hostUserId)
      : undefined;
    if (typeof guest !== "string") throw new Error("invalid-friends-frame");
    // Exactly the admission check: authority key, freshness, this pair.
    verifyFriendship(
      friendship!,
      this.o.trustedKeys,
      this.o.hostUserId,
      guest,
      this.o.now(),
    );
    const summary = this.o.summary(guest);
    const reply = summary
      ? JSON.stringify({
          kind: "together-friends-summary-v1",
          nonce: this.o.nonce,
          sealed: keys.seal("to-guest", summary),
        })
      : undefined;
    this.dispose();
    return reply;
  }
  dispose() {
    this.done = true;
    this.keys?.dispose();
  }
}
