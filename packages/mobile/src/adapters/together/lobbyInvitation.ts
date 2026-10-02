import {
  type Credential,
  type Signed,
  type TrustedKeys,
  signPayload,
  verifyCredential,
  verifySignature,
} from "./security/identity";
import { object, uuid } from "./security/schema";
import type { HostPin } from "./localStore";
export interface LobbyInvitation extends HostPin {
  kind: "together-invitation-v1";
  workoutName: string;
  credential: Signed<Credential>;
}
export function createLobbyInvitation(
  pin: HostPin,
  workoutName: string,
  credential: Signed<Credential>,
  seed: Uint8Array,
): string {
  if (!workoutName.trim() || workoutName.length > 100)
    throw new Error("invalid-workout-name");
  return JSON.stringify(
    signPayload<LobbyInvitation>(
      {
        kind: "together-invitation-v1",
        ...pin,
        workoutName: workoutName.trim(),
        credential,
      },
      seed,
    ),
  );
}
/** The peer may supply a credential, never a trust key. Names are signed display text only. */
export function readLobbyInvitation(
  text: string,
  trusted: TrustedKeys,
  now: number,
): LobbyInvitation {
  if (text.length > 6000) throw new Error("invalid-invitation");
  const envelope = JSON.parse(text);
  if (
    !object(envelope, ["payload", "signature"]) ||
    !object(envelope.payload, [
      "kind",
      "sessionId",
      "hostUserId",
      "hostDeviceId",
      "workoutName",
      "credential",
    ])
  )
    throw new Error("invalid-invitation");
  const p = envelope.payload;
  if (
    p.kind !== "together-invitation-v1" ||
    ![p.sessionId, p.hostUserId, p.hostDeviceId].every(uuid) ||
    typeof p.workoutName !== "string" ||
    !p.workoutName.trim() ||
    p.workoutName.length > 100
  )
    throw new Error("invalid-invitation");
  const identity = verifyCredential(
    p.credential as Signed<Credential>,
    trusted,
    now,
  );
  if (identity.userId !== p.hostUserId || identity.deviceId !== p.hostDeviceId)
    throw new Error("invalid-invitation");
  return verifySignature(
    envelope as unknown as Signed<LobbyInvitation>,
    identity.publicKey,
  );
}
