// Shared offline Together wire types; cryptographic validation lives in the adapter.
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
