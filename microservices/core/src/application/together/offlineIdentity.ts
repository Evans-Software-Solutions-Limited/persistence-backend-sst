import { credentialValidator, rosterValidator } from "./offlineTypes";
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { requestHash, requireTogether, TogetherError } from "./shared";

export const OFFLINE_CREDENTIAL_TTL_MS = 24 * 60 * 60 * 1000;
export interface Signed<T> {
  payload: T;
  signature: string;
}
export interface Credential {
  kind: "together-device-v1";
  keyId: string;
  userId: string;
  deviceId: string;
  publicKey: string;
  issuedAt: number;
  expiresAt: number;
}
export interface FriendshipEvidence {
  kind: "together-friendship-v1";
  keyId: string;
  users: [string, string];
  issuedAt: number;
  expiresAt: number;
}
export interface Registration {
  kind: "together-register-v1";
  userId: string;
  deviceId: string;
  publicKey: string;
  requestId: string;
  timestamp: number;
}
export type TrustedKeys = Record<string, string>;
export function signatureBytes(payload: unknown) {
  return Buffer.from(
    `persistence-together-signature-v1:${requestHash(payload)}`,
    "utf8",
  );
}
export function signPayload<T>(payload: T, privateKey: string): Signed<T> {
  const key = createPrivateKey(privateKey);
  requireTogether(key.asymmetricKeyType === "ed25519", "UNAVAILABLE", 503);
  return {
    payload,
    signature: sign(null, signatureBytes(payload), key).toString("base64url"),
  };
}
export function verifySignature<T>(envelope: Signed<T>, publicKey: string): T {
  try {
    const key = createPublicKey(publicKey);
    requireTogether(
      key.asymmetricKeyType === "ed25519" &&
        key.export({ format: "pem", type: "spki" }).toString() === publicKey &&
        /^[A-Za-z0-9_-]{86}$/.test(envelope.signature) &&
        verify(
          null,
          signatureBytes(envelope.payload),
          key,
          Buffer.from(envelope.signature, "base64url"),
        ),
      "INVALID_PROOF",
      403,
    );
    return envelope.payload;
  } catch {
    throw new TogetherError("INVALID_PROOF", 403);
  }
}
export function offlineAuthority() {
  try {
    const config = JSON.parse(process.env.TOGETHER_OFFLINE_AUTHORITY ?? "") as {
      keyId: string;
      privateKey: string;
      publicKeys: TrustedKeys;
    };
    requireTogether(
      typeof config.keyId === "string" &&
        /^[A-Za-z0-9_-]{1,64}$/.test(config.keyId) &&
        config.publicKeys &&
        Object.keys(config.publicKeys).length <= 32,
      "UNAVAILABLE",
      503,
    );
    for (const [id, pem] of Object.entries(config.publicKeys)) {
      const key = createPublicKey(pem);
      requireTogether(
        /^[A-Za-z0-9_-]{1,64}$/.test(id) &&
          key.asymmetricKeyType === "ed25519" &&
          key.export({ format: "pem", type: "spki" }).toString() === pem,
        "UNAVAILABLE",
        503,
      );
    }
    const publicKey = createPublicKey(createPrivateKey(config.privateKey))
      .export({ format: "pem", type: "spki" })
      .toString();
    requireTogether(
      config.keyId && config.publicKeys[config.keyId] === publicKey,
      "UNAVAILABLE",
      503,
    );
    verifySignature(
      signPayload({ kind: "configuration-check" }, config.privateKey),
      publicKey,
    );
    return config;
  } catch {
    throw new TogetherError("UNAVAILABLE", 503);
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
      if (member.admission === "friend") {
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
      previous.payload.sessionId === p.sessionId &&
        previous.payload.hostUserId === p.hostUserId &&
        previous.payload.hostDeviceId === p.hostDeviceId &&
        p.members.length === previous.payload.members.length + 1,
      "INVALID_ROSTER",
      400,
    );
    for (let i = 0; i < previous.payload.members.length; i++)
      requireTogether(
        requestHash(previous.payload.members[i]) === requestHash(p.members[i]),
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
