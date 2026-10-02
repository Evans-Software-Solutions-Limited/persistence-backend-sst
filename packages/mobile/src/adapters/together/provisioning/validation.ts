import { decode64 } from "../security/encoding";
import { integer, object, signed, uuid } from "../security/schema";
import {
  OFFLINE_CREDENTIAL_TTL_MS,
  verifySignature,
} from "../security/identity";
import type {
  FriendshipEvidence,
  Signed,
  TrustedKeys,
} from "../../../domain/models/togetherIdentity";
export function validateTrust(keys: TrustedKeys, ttl: number): void {
  if (
    !keys ||
    typeof keys !== "object" ||
    Array.isArray(keys) ||
    Object.keys(keys).length < 1 ||
    Object.keys(keys).length > 32 ||
    !Number.isSafeInteger(ttl) ||
    ttl <= 0 ||
    ttl > OFFLINE_CREDENTIAL_TTL_MS
  )
    throw new Error("invalid-proof");
  for (const [id, pem] of Object.entries(keys)) {
    if (
      !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
      typeof pem !== "string" ||
      !/^-----BEGIN PUBLIC KEY-----\n[A-Za-z0-9+/]{59}=\n-----END PUBLIC KEY-----\n$/.test(
        pem,
      )
    )
      throw new Error("invalid-proof");
    const bytes = decode64(pem.split("\n")[1]);
    if (
      bytes.length !== 44 ||
      ![48, 42, 48, 5, 6, 3, 43, 101, 112, 3, 33, 0].every(
        (v, i) => bytes[i] === v,
      )
    )
      throw new Error("invalid-proof");
  }
}
export function validateFriend(
  proof: Signed<FriendshipEvidence>,
  keys: TrustedKeys,
  account: string,
  friend: string,
  now: number,
): void {
  if (
    !uuid(friend) ||
    friend === account ||
    !signed(
      proof,
      (p) =>
        object(p, ["kind", "keyId", "users", "issuedAt", "expiresAt"]) &&
        p.kind === "together-friendship-v1" &&
        typeof p.keyId === "string" &&
        /^[A-Za-z0-9_-]{1,64}$/.test(p.keyId) &&
        Array.isArray(p.users) &&
        p.users.length === 2 &&
        p.users.every(uuid) &&
        p.users.includes(account) &&
        p.users.includes(friend) &&
        integer(p.issuedAt) &&
        integer(p.expiresAt),
    )
  )
    throw new Error("invalid-proof");
  const p = proof.payload;
  if (
    !Object.hasOwn(keys, p.keyId) ||
    p.issuedAt > now ||
    p.expiresAt <= now ||
    p.expiresAt - p.issuedAt > OFFLINE_CREDENTIAL_TTL_MS
  )
    throw new Error("invalid-proof");
  verifySignature(proof, keys[p.keyId]);
}
