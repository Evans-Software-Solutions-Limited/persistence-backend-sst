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
  kind: "together-invitation-v1" | "together-invitation-v2";
  audience?: "invite-only" | "friends" | "open";
  invitationToken?: string;
  workoutName: string;
  credential: Signed<Credential>;
}
export function createLobbyInvitation(
  pin: HostPin,
  workoutName: string,
  credential: Signed<Credential>,
  seed: Uint8Array,
  policy?: {
    audience: "invite-only" | "friends" | "open";
    invitationToken?: string;
  },
): string {
  if (!workoutName.trim() || workoutName.length > 100)
    throw new Error("invalid-workout-name");
  return JSON.stringify(
    signPayload<LobbyInvitation>(
      {
        kind: policy ? "together-invitation-v2" : "together-invitation-v1",
        ...policy,
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
    !envelope.payload ||
    typeof envelope.payload !== "object" ||
    !object(envelope.payload, [
      "kind",
      "sessionId",
      "hostUserId",
      "hostDeviceId",
      "workoutName",
      "credential",
      ...((envelope.payload as Record<string, unknown>).kind ===
      "together-invitation-v2"
        ? [
            "audience",
            ...((envelope.payload as Record<string, unknown>).audience ===
            "invite-only"
              ? ["invitationToken"]
              : []),
          ]
        : []),
    ])
  )
    throw new Error("invalid-invitation");
  const p = envelope.payload;
  if (
    !["together-invitation-v1", "together-invitation-v2"].includes(
      p.kind as string,
    ) ||
    (p.kind === "together-invitation-v2" &&
      ((p.audience !== "open" &&
        p.audience !== "invite-only" &&
        p.audience !== "friends") ||
        (p.audience === "invite-only" &&
          (typeof p.invitationToken !== "string" ||
            !/^[A-Za-z0-9_-]{43}$/.test(p.invitationToken))))) ||
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
