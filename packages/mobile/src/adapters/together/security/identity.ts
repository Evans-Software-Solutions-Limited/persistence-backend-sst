import type {
  Signed,
  Credential,
  FriendshipEvidence,
  TrustedKeys,
} from "@/domain/models/togetherIdentity";
import {
  credentialValidator,
  rosterValidator,
  friendshipValidator,
} from "./schema";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { encode64, decode64 } from "./encoding";
export type {
  Signed,
  Credential,
  FriendshipEvidence,
  Registration,
  TrustedKeys,
} from "@/domain/models/togetherIdentity";
export function requireTogether(
  condition: unknown,
  code: string,
  _status?: number,
): asserts condition {
  if (!condition) throw new Error(code);
}
export function requestHash(payload: unknown): string {
  function canonical(value: unknown, depth = 0): unknown {
    requireTogether(depth <= 32, "INVALID_PAYLOAD_DEPTH");
    if (Array.isArray(value))
      return value.map((item) => canonical(item, depth + 1));
    if (value !== null && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => [key, canonical(val, depth + 1)]),
      );
    return value;
  }
  return bytesToHex(
    sha256(new TextEncoder().encode(JSON.stringify(canonical(payload)))),
  );
}

export const OFFLINE_CREDENTIAL_TTL_MS = 24 * 60 * 60 * 1000;
export function signatureBytes(payload: unknown) {
  return new TextEncoder().encode(
    `persistence-together-signature-v1:${requestHash(payload)}`,
  );
}
const SPKI_PREFIX = new Uint8Array([
  48, 42, 48, 5, 6, 3, 43, 101, 112, 3, 33, 0,
]);
export function publicKeyPem(seed: Uint8Array): string {
  return `-----BEGIN PUBLIC KEY-----\n${encode64(new Uint8Array([...SPKI_PREFIX, ...ed25519.getPublicKey(seed)]))}\n-----END PUBLIC KEY-----\n`;
}
function parsePublicKey(pem: string): Uint8Array {
  requireTogether(
    typeof pem === "string" &&
      /^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/]{59}=\n-----END PUBLIC KEY-----\n$/.test(
        pem,
      ),
    "INVALID_PROOF",
  );
  const bytes = decode64(pem.split("\n")[1]);
  requireTogether(
    bytes.length === 44 && SPKI_PREFIX.every((v, i) => bytes[i] === v),
    "INVALID_PROOF",
  );
  return bytes.slice(12);
}
export function signPayload<T>(payload: T, seed: Uint8Array): Signed<T> {
  return {
    payload,
    signature: encode64(ed25519.sign(signatureBytes(payload), seed), true),
  };
}
export function verifySignature<T>(envelope: Signed<T>, publicKey: string): T {
  try {
    requireTogether(
      envelope &&
        typeof envelope.signature === "string" &&
        /^[A-Za-z0-9_-]{86}$/.test(envelope.signature) &&
        ed25519.verify(
          decode64(envelope.signature, true),
          signatureBytes(envelope.payload),
          parsePublicKey(publicKey),
          { zip215: false },
        ),
      "INVALID_PROOF",
    );
    return envelope.payload;
  } catch {
    throw new Error("INVALID_PROOF");
  }
}
function fresh(payload: { issuedAt: number; expiresAt: number }, now: number) {
  requireTogether(
    Number.isSafeInteger(payload.issuedAt) &&
      Number.isSafeInteger(payload.expiresAt) &&
      payload.issuedAt <= now &&
      payload.expiresAt > now &&
      payload.expiresAt > payload.issuedAt &&
      payload.expiresAt - payload.issuedAt <= OFFLINE_CREDENTIAL_TTL_MS,
    "CREDENTIAL_EXPIRED",
    403,
  );
}
export function verifyCredential(
  envelope: Signed<Credential>,
  trusted: TrustedKeys,
  now = Date.now(),
) {
  requireTogether(credentialValidator.Check(envelope), "INVALID_PROOF", 403);
  const p = envelope.payload;
  requireTogether(
    p.kind === "together-device-v1" && Object.hasOwn(trusted, p.keyId),
    "INVALID_PROOF",
    403,
  );
  verifySignature(envelope, trusted[p.keyId]);
  fresh(p, now);
  return p;
}
export interface JoinConsent {
  kind: "together-consent-v1";
  sessionId: string;
  hostUserId: string;
  hostDeviceId: string;
  userId: string;
  deviceId: string;
  executionId: string;
  nonce: string;
  consentVersion: "together-v1";
  consentAccepted: true;
}
export interface RosterMember {
  credential: Signed<Credential>;
  consent: Signed<JoinConsent>;
  admission: "host" | "friend" | "approved";
  friendship?: Signed<FriendshipEvidence>;
}
export interface OfflineRoster {
  /** Signed friends-only admission policy; absent preserves legacy policies. */
  audience?: "friends";
  kind: "together-roster-v1";
  sessionId: string;
  hostUserId: string;
  hostDeviceId: string;
  revision: number;
  previousHash: string | null;
  members: RosterMember[];
}
/** Persist the returned roster hash before acknowledging; caller owns monotonic storage.
 * Previous must be the trusted durably validated local roster, never peer-supplied.
 * Trusted keys come from authenticated server configuration, never the peer envelope.
 * Local block knowledge must include both directions and is checked for every pair.
 */
export function verifyRoster(
  envelope: Signed<OfflineRoster>,
  trusted: TrustedKeys,
  previous: Signed<OfflineRoster> | null,
  deniedPairs: readonly (readonly [string, string])[],
  now = Date.now(),
) {
  requireTogether(
    rosterValidator.Check(envelope) &&
      (!previous || rosterValidator.Check(previous)),
    "INVALID_ROSTER",
    400,
  );
  const p = envelope.payload;
  requireTogether(
    p.kind === "together-roster-v1" &&
      p.members.length >= 1 &&
      p.members.length <= 4 &&
      Number.isSafeInteger(p.revision),
    "INVALID_ROSTER",
    400,
  );
  requireTogether(
    p.revision === (previous ? previous.payload.revision + 1 : 1) &&
      p.previousHash === (previous ? requestHash(previous.payload) : null),
    "VERSION_CONFLICT",
    409,
  );
  const host = p.members[0];
  requireTogether(
    host.admission === "host" &&
      host.credential.payload.userId === p.hostUserId &&
      host.credential.payload.deviceId === p.hostDeviceId,
    "INVALID_PROOF",
    403,
  );
  verifySignature(
    envelope,
    verifyCredential(host.credential, trusted, now).publicKey,
  );
  const users = new Set<string>(),
    devices = new Set<string>(),
    executions = new Set<string>(),
    nonces = new Set<string>();
  for (const member of p.members) {
    const identity = verifyCredential(member.credential, trusted, now);
    const consent = verifySignature(member.consent, identity.publicKey);
    requireTogether(
      consent.kind === "together-consent-v1" &&
        consent.consentAccepted === true &&
        consent.consentVersion === "together-v1" &&
        consent.sessionId === p.sessionId &&
        consent.hostUserId === p.hostUserId &&
        consent.hostDeviceId === p.hostDeviceId &&
        consent.userId === identity.userId &&
        consent.deviceId === identity.deviceId,
      "INVALID_PROOF",
      403,
    );
    requireTogether(
      !users.has(identity.userId) &&
        !devices.has(identity.deviceId) &&
        !executions.has(consent.executionId) &&
        !nonces.has(consent.nonce),
      "INVALID_ROSTER",
      400,
    );
    users.add(identity.userId);
    devices.add(identity.deviceId);
    executions.add(consent.executionId);
    nonces.add(consent.nonce);
    if (member !== host) {
      requireTogether(
        member.admission === "friend" || member.admission === "approved",
        "INVALID_PROOF",
        403,
      );
      if (member.admission === "friend" || p.audience === "friends") {
        const proof = member.friendship;
        requireTogether(
          proof &&
            proof.payload.kind === "together-friendship-v1" &&
            Object.hasOwn(trusted, proof.payload.keyId),
          "INVALID_PROOF",
          403,
        );
        verifySignature(proof, trusted[proof.payload.keyId]);
        fresh(proof.payload, now);
        requireTogether(
          proof.payload.users.length === 2 &&
            proof.payload.users.includes(p.hostUserId) &&
            proof.payload.users.includes(identity.userId),
          "INVALID_PROOF",
          403,
        );
      }
    }
  }
  requireTogether(
    !deniedPairs.some(([a, b]) => users.has(a) && users.has(b)),
    "FORBIDDEN",
    403,
  );
  if (previous) {
    requireTogether(
      previous.payload.audience === p.audience &&
        previous.payload.sessionId === p.sessionId &&
        previous.payload.hostUserId === p.hostUserId &&
        previous.payload.hostDeviceId === p.hostDeviceId &&
        Math.abs(p.members.length - previous.payload.members.length) === 1,
      "INVALID_ROSTER",
      400,
    );
    const removed = p.members.length < previous.payload.members.length;
    const retained = removed
      ? previous.payload.members.filter((member) =>
          users.has(member.credential.payload.userId),
        )
      : previous.payload.members;
    requireTogether(
      !removed || retained.length === p.members.length,
      "INVALID_ROSTER",
      400,
    );
    for (let i = 0; i < retained.length; i++)
      requireTogether(
        requestHash(retained[i]) === requestHash(p.members[i]),
        "INVALID_ROSTER",
        400,
      );
  }
  return {
    rosterHash: requestHash(p),
    revision: p.revision,
    userIds: [...users],
  };
}

/** Authority-signed friendship binds this exact pair and remains fresh. */
export function verifyFriendship(
  envelope: Signed<FriendshipEvidence>,
  trusted: TrustedKeys,
  hostUserId: string,
  userId: string,
  now: number,
): void {
  requireTogether(friendshipValidator.Check(envelope), "INVALID_PROOF", 403);
  const proof = envelope.payload;
  requireTogether(Object.hasOwn(trusted, proof.keyId), "INVALID_PROOF", 403);
  verifySignature(envelope, trusted[proof.keyId]);
  fresh(proof, now);
  requireTogether(
    proof.users.includes(hostUserId) &&
      proof.users.includes(userId) &&
      hostUserId !== userId,
    "INVALID_PROOF",
    403,
  );
}
