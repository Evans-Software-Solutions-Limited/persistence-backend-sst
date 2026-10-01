import { x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { encode64, decode64 } from "./encoding";
import { object, hash, integer, uuid, signed } from "./schema";
import {
  Credential,
  Signed,
  TrustedKeys,
  publicKeyPem,
  requestHash,
  signPayload,
  verifyCredential,
  verifySignature,
  requireTogether,
} from "./identity";

export interface ChannelOptions {
  role: "host" | "guest";
  sessionId: string;
  hostUserId: string;
  hostDeviceId: string;
  credential: Signed<Credential>;
  seed: Uint8Array;
  /** Authenticated server keyring. Never accept keyring contents from a peer. */
  trustedKeys: TrustedKeys;
  randomBytes: (length: number) => Uint8Array;
  now?: () => number;
}
interface Hello {
  kind: "together-channel-hello-v1";
  role: "guest";
  sessionId: string;
  hostUserId: string;
  hostDeviceId: string;
  credential: Signed<Credential>;
  ephemeral: string;
  nonce: string;
}
interface Response extends Omit<Hello, "kind" | "role"> {
  kind: "together-channel-response-v1";
  role: "host";
  helloHash: string;
}
const encoder = new TextEncoder();
export const MAX_LOCAL_PLAINTEXT_BYTES = 40000;
function bytes32(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    decode64(value, true).length === 32
  );
}
function helloShape(value: unknown, response: boolean): boolean {
  return (
    object(value, [
      "kind",
      "role",
      "sessionId",
      "hostUserId",
      "hostDeviceId",
      "credential",
      "ephemeral",
      "nonce",
      ...(response ? ["helloHash"] : []),
    ]) &&
    value.kind ===
      (response
        ? "together-channel-response-v1"
        : "together-channel-hello-v1") &&
    value.role === (response ? "host" : "guest") &&
    uuid(value.sessionId) &&
    uuid(value.hostUserId) &&
    uuid(value.hostDeviceId) &&
    bytes32(value.ephemeral) &&
    bytes32(value.nonce) &&
    (!response || hash(value.helloHash))
  );
}
/** One connection, one transcript, monotonically ordered frames. No transport or persistence. */
export class LocalSecureChannel {
  private state: "new" | "hello" | "response" | "ready" | "closed" = "new";
  private hello?: Signed<Hello>;
  private response?: Signed<Response>;
  private ephemeral?: Uint8Array;
  private peer?: Signed<Credential>;
  private sendKey?: Uint8Array;
  private receiveKey?: Uint8Array;
  private binding = "";
  private sent = 0;
  private received = 0;
  private readonly options: ChannelOptions;
  constructor(options: ChannelOptions) {
    // Snapshot public inputs: a caller must not be able to mutate a validated identity.
    this.options = {
      ...options,
      credential: JSON.parse(JSON.stringify(options.credential)),
      trustedKeys: { ...options.trustedKeys },
      seed: options.seed.slice(),
    };
    requireTogether(
      [options.sessionId, options.hostUserId, options.hostDeviceId].every(uuid),
      "INVALID_CHANNEL",
    );
    const own = verifyCredential(
      this.options.credential,
      this.options.trustedKeys,
      this.now(),
    );
    requireTogether(
      own.publicKey === publicKeyPem(options.seed),
      "INVALID_DEVICE_KEY",
    );
    requireTogether(
      options.role === "host"
        ? own.userId === options.hostUserId &&
            own.deviceId === options.hostDeviceId
        : options.role === "guest" &&
            own.userId !== options.hostUserId &&
            own.deviceId !== options.hostDeviceId,
      "INVALID_CHANNEL",
    );
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  get role() {
    return this.options.role;
  }
  get sessionId() {
    return this.options.sessionId;
  }
  get hostUserId() {
    return this.options.hostUserId;
  }
  get hostDeviceId() {
    return this.options.hostDeviceId;
  }
  get ownCredential(): Signed<Credential> {
    return JSON.parse(JSON.stringify(this.options.credential));
  }
  get ready() {
    return this.state === "ready";
  }
  get peerCredential(): Signed<Credential> | undefined {
    return this.peer ? JSON.parse(JSON.stringify(this.peer)) : undefined;
  }
  private guard<T>(action: () => T): T {
    try {
      requireTogether(this.state !== "closed", "CHANNEL_CLOSED");
      verifyCredential(
        this.options.credential,
        this.options.trustedKeys,
        this.now(),
      );
      if (this.peer)
        verifyCredential(this.peer, this.options.trustedKeys, this.now());
      return action();
    } catch (error) {
      this.close();
      throw error;
    }
  }
  private random() {
    const bytes = this.options.randomBytes(32);
    requireTogether(
      bytes instanceof Uint8Array && bytes.length === 32,
      "INVALID_RANDOM",
    );
    return bytes.slice();
  }
  start(): string {
    return this.guard(() => {
      requireTogether(
        this.options.role === "guest" && this.state === "new",
        "INVALID_CHANNEL_STATE",
      );
      this.ephemeral = this.random();
      this.hello = signPayload(
        {
          kind: "together-channel-hello-v1",
          role: "guest",
          sessionId: this.options.sessionId,
          hostUserId: this.options.hostUserId,
          hostDeviceId: this.options.hostDeviceId,
          credential: this.options.credential,
          ephemeral: encode64(x25519.getPublicKey(this.ephemeral), true),
          nonce: encode64(this.random(), true),
        },
        this.options.seed,
      );
      this.state = "hello";
      return JSON.stringify(this.hello);
    });
  }
  receiveHandshake(wire: string): string | null {
    return this.guard(() => {
      requireTogether(
        typeof wire === "string" && wire.length <= 12000,
        "INVALID_HANDSHAKE",
      );
      const envelope = JSON.parse(wire);
      if (this.options.role === "host" && this.state === "new") {
        requireTogether(
          signed(envelope, (p) => helloShape(p, false)),
          "INVALID_HANDSHAKE",
        );
        this.validatePeer(envelope, false);
        this.hello = envelope;
        this.ephemeral = this.random();
        this.response = signPayload(
          {
            kind: "together-channel-response-v1",
            role: "host",
            sessionId: this.options.sessionId,
            hostUserId: this.options.hostUserId,
            hostDeviceId: this.options.hostDeviceId,
            credential: this.options.credential,
            ephemeral: encode64(x25519.getPublicKey(this.ephemeral), true),
            nonce: encode64(this.random(), true),
            helloHash: requestHash(envelope),
          },
          this.options.seed,
        );
        this.state = "response";
        return JSON.stringify(this.response);
      }
      if (this.options.role === "guest" && this.state === "hello") {
        requireTogether(
          signed(envelope, (p) => helloShape(p, true)) &&
            envelope.payload.helloHash === requestHash(this.hello),
          "INVALID_HANDSHAKE",
        );
        this.validatePeer(envelope, true);
        this.response = envelope;
        const finish = signPayload(
          {
            kind: "together-channel-finish-v1",
            role: "guest",
            responseHash: requestHash(envelope),
          },
          this.options.seed,
        );
        this.derive();
        return JSON.stringify(finish);
      }
      requireTogether(
        this.options.role === "host" &&
          this.state === "response" &&
          signed(
            envelope,
            (p) =>
              object(p, ["kind", "role", "responseHash"]) &&
              p.kind === "together-channel-finish-v1" &&
              p.role === "guest" &&
              hash(p.responseHash),
          ) &&
          envelope.payload.responseHash === requestHash(this.response),
        "INVALID_HANDSHAKE",
      );
      verifySignature(envelope, this.peer!.payload.publicKey);
      this.derive();
      return null;
    });
  }
  private validatePeer(envelope: Signed<Hello | Response>, host: boolean) {
    const p = envelope.payload;
    requireTogether(
      p.sessionId === this.options.sessionId &&
        p.hostUserId === this.options.hostUserId &&
        p.hostDeviceId === this.options.hostDeviceId,
      "WRONG_SESSION",
    );
    const identity = verifyCredential(
      p.credential,
      this.options.trustedKeys,
      this.now(),
    );
    requireTogether(
      host
        ? identity.userId === this.options.hostUserId &&
            identity.deviceId === this.options.hostDeviceId
        : identity.userId !== this.options.hostUserId &&
            identity.deviceId !== this.options.hostDeviceId,
      "WRONG_PEER",
    );
    verifySignature(envelope, identity.publicKey);
    this.peer = p.credential;
  }
  private derive() {
    this.binding = requestHash({ hello: this.hello, response: this.response });
    const remote = this.options.role === "host" ? this.hello! : this.response!;
    const shared = x25519.getSharedSecret(
      this.ephemeral!,
      decode64(remote.payload.ephemeral, true),
    );
    const key = (direction: string) =>
      hkdf(
        sha256,
        shared,
        encoder.encode(this.binding),
        encoder.encode(`persistence-together-channel-v1:${direction}`),
        32,
      );
    const toHost = key("guest-to-host"),
      toGuest = key("host-to-guest");
    this.sendKey = this.options.role === "host" ? toGuest : toHost;
    this.receiveKey = this.options.role === "host" ? toHost : toGuest;
    shared.fill(0);
    this.ephemeral!.fill(0);
    this.ephemeral = undefined;
    this.state = "ready";
  }
  private nonce(sequence: number) {
    const nonce = new Uint8Array(12);
    new DataView(nonce.buffer).setBigUint64(4, BigInt(sequence), false);
    return nonce;
  }
  encrypt(plaintext: string): string {
    return this.guard(() => {
      requireTogether(
        this.ready &&
          typeof plaintext === "string" &&
          encoder.encode(plaintext).length <= MAX_LOCAL_PLAINTEXT_BYTES &&
          this.sent < Number.MAX_SAFE_INTEGER,
        "INVALID_FRAME",
      );
      const sequence = this.sent++;
      const ciphertext = chacha20poly1305(
        this.sendKey!,
        this.nonce(sequence),
        encoder.encode(`${this.binding}:${sequence}`),
      ).encrypt(encoder.encode(plaintext));
      return JSON.stringify({
        kind: "together-channel-data-v1",
        sequence,
        ciphertext: encode64(ciphertext, true),
      });
    });
  }
  decrypt(wire: string): string {
    return this.guard(() => {
      requireTogether(
        this.ready && typeof wire === "string" && wire.length <= 60000,
        "INVALID_FRAME",
      );
      const frame = JSON.parse(wire);
      requireTogether(
        object(frame, ["kind", "sequence", "ciphertext"]) &&
          frame.kind === "together-channel-data-v1" &&
          integer(frame.sequence) &&
          frame.sequence === this.received &&
          this.received < Number.MAX_SAFE_INTEGER &&
          typeof frame.ciphertext === "string",
        "INVALID_FRAME",
      );
      const bytes = decode64(frame.ciphertext, true);
      requireTogether(
        bytes.length >= 16 && bytes.length <= MAX_LOCAL_PLAINTEXT_BYTES + 16,
        "INVALID_FRAME",
      );
      const clear = chacha20poly1305(
        this.receiveKey!,
        this.nonce(frame.sequence),
        encoder.encode(`${this.binding}:${frame.sequence}`),
      ).decrypt(bytes);
      this.received++;
      return new TextDecoder("utf-8", { fatal: true }).decode(clear);
    });
  }
  close() {
    this.state = "closed";
    this.ephemeral?.fill(0);
    this.sendKey?.fill(0);
    this.receiveKey?.fill(0);
    this.options.seed.fill(0);
    this.ephemeral = undefined;
    this.sendKey = undefined;
    this.receiveKey = undefined;
  }
}
