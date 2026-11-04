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
/**
 * A Nearby host's signed statement, issued to one admitted guest, that the
 * plan's exercises are shared with that guest (PER-60). Mirrors core
 * `ExerciseShare`; the server honours only ids the host created.
 */
export interface ExerciseShareProof {
  kind: "together-exercise-share-v1";
  sessionId: string;
  hostUserId: string;
  hostDeviceId: string;
  userId: string;
  exerciseIds: string[];
  issuedAt: number;
}
/** The share and the host's server-issued credential that verifies it. */
export interface TogetherExerciseShare {
  credential: Signed<Credential>;
  proof: Signed<ExerciseShareProof>;
}
export type TrustedKeys = Record<string, string>;
