import { TogetherLocalStore, type HostPin } from "./localStore";
import {
  requestHash,
  signPayload,
  publicKeyPem,
  verifyCredential,
  verifyRoster,
  type Credential,
  type JoinConsent,
  type FriendshipEvidence,
  type OfflineRoster,
  type RosterMember,
  type Signed,
  type TrustedKeys,
} from "./security/identity";

export interface LocalJoinRequest {
  credential: Signed<Credential>;
  consent: Signed<JoinConsent>;
  friendship?: Signed<FriendshipEvidence>;
}

export interface LobbyOptions extends HostPin {
  credential: Signed<Credential>;
  seed: Uint8Array;
  trustedKeys: TrustedKeys;
  deniedPairs: () => readonly (readonly [string, string])[];
  now: () => number;
  /** Persisted host choice; no widening after restart. Guests use the same pin. */
  audience: "invite-only" | "open";
  invitedUserIds: readonly string[];
}

/** Host-only admission decisions. Network discovery alone never admits anyone. */
export class TogetherLocalLobby {
  private readonly options: LobbyOptions;
  constructor(
    readonly store: TogetherLocalStore,
    options: LobbyOptions,
  ) {
    this.options = {
      ...options,
      credential: JSON.parse(JSON.stringify(options.credential)),
      seed: options.seed.slice(),
      trustedKeys: { ...options.trustedKeys },
      invitedUserIds: [...new Set(options.invitedUserIds)].sort(),
    };
    const own = verifyCredential(
      this.options.credential,
      this.options.trustedKeys,
      options.now(),
    );
    if (
      own.userId !== store.accountId ||
      own.publicKey !== publicKeyPem(options.seed)
    )
      throw new Error("Wrong local identity");
    if (this.isHost)
      store.bindPolicy(options.sessionId, {
        audience: options.audience,
        invitedUserIds: this.options.invitedUserIds,
        hostUserId: options.hostUserId,
        hostDeviceId: options.hostDeviceId,
      });
  }

  get pin(): HostPin {
    const { sessionId, hostUserId, hostDeviceId } = this.options;
    return { sessionId, hostUserId, hostDeviceId };
  }

  get isHost(): boolean {
    const own = this.options.credential.payload;
    return (
      own.userId === this.options.hostUserId &&
      own.deviceId === this.options.hostDeviceId
    );
  }

  start(consent: Signed<JoinConsent>): Signed<OfflineRoster> {
    if (!this.isHost) throw new Error("Only the host can start a lobby");
    const current = this.store.current(this.options.sessionId);
    if (current) {
      if (
        requestHash(current.payload.members[0].consent) !== requestHash(consent)
      )
        throw new Error("Host consent changed");
      this.accept(current);
      return current;
    }
    const envelope = signPayload<OfflineRoster>(
      {
        kind: "together-roster-v1",
        ...this.pin,
        revision: 1,
        previousHash: null,
        members: [
          { credential: this.options.credential, consent, admission: "host" },
        ],
      },
      this.options.seed,
    );
    this.accept(envelope);
    return envelope;
  }

  admit(
    request: LocalJoinRequest,
    peer: Signed<Credential>,
    approved = false,
  ):
    | { status: "approval-required" }
    | { status: "admitted"; roster: Signed<OfflineRoster> } {
    if (!this.isHost) throw new Error("Only the host can admit");
    this.store.assertOpen(this.options.sessionId);
    if (requestHash(request.credential) !== requestHash(peer))
      throw new Error("Wrong joining device");
    const identity = verifyCredential(
      peer,
      this.options.trustedKeys,
      this.options.now(),
    );
    if (
      this.options.audience === "invite-only" &&
      !this.options.invitedUserIds.includes(identity.userId)
    )
      throw new Error("Invitation required");
    const current = this.store.current(this.options.sessionId);
    if (!current) throw new Error("Host lobby not started");
    const existing = current.payload.members.find(
      (m) => m.credential.payload.userId === identity.userId,
    );
    if (existing) {
      if (
        requestHash(existing.credential) !== requestHash(peer) ||
        requestHash(existing.consent) !== requestHash(request.consent)
      )
        throw new Error("Member identity changed");
      this.accept(current);
      return { status: "admitted", roster: current };
    }
    const member: RosterMember = {
      credential: request.credential,
      consent: request.consent,
      admission: request.friendship ? "friend" : "approved",
      ...(request.friendship ? { friendship: request.friendship } : {}),
    };
    const envelope = signPayload<OfflineRoster>(
      {
        ...current.payload,
        revision: current.payload.revision + 1,
        previousHash: requestHash(current.payload),
        members: [...current.payload.members, member],
      },
      this.options.seed,
    );
    // Validate consent, all block pairs, capacity and friendship BEFORE prompting.
    verifyRoster(
      envelope,
      this.options.trustedKeys,
      current,
      this.options.deniedPairs(),
      this.options.now(),
    );
    if (!request.friendship && !approved)
      return { status: "approval-required" };
    this.accept(envelope);
    return { status: "admitted", roster: envelope };
  }

  accept(roster: Signed<OfflineRoster>): void {
    this.store.commitRoster(
      roster,
      this.pin,
      this.options.trustedKeys,
      this.options.deniedPairs(),
      this.options.now(),
    );
  }

  /** Run at every send/read: stale credentials or newly known blocks stop sharing. */
  member(peer: Signed<Credential>): RosterMember {
    this.store.assertOpen(this.options.sessionId);
    const chain = this.store.rosters(this.options.sessionId);
    const roster = chain.at(-1);
    if (!roster) throw new Error("No admitted roster");
    verifyRoster(
      roster,
      this.options.trustedKeys,
      chain.at(-2) ?? null,
      this.options.deniedPairs(),
      this.options.now(),
    );
    const own = roster.payload.members.find(
      (m) => requestHash(m.credential) === requestHash(this.options.credential),
    );
    const member = roster.payload.members.find(
      (m) => requestHash(m.credential) === requestHash(peer),
    );
    if (!own || !member) throw new Error("Device not admitted");
    return member;
  }

  get ownCredential(): Signed<Credential> {
    return JSON.parse(JSON.stringify(this.options.credential));
  }
}
