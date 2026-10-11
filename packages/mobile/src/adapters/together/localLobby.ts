import { TogetherLocalStore, type HostPin } from "./localStore";
import {
  requestHash,
  signPayload,
  publicKeyPem,
  verifyCredential,
  verifyFriendship,
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
  invitationToken?: string;
}

export interface LobbyOptions extends HostPin {
  credential: Signed<Credential>;
  seed: Uint8Array;
  trustedKeys: TrustedKeys;
  deniedPairs: (
    candidateUserIds?: readonly string[],
  ) => readonly (readonly [string, string])[];
  now: () => number;
  /** Persisted host choice; no widening after restart. Guests use the same pin. */
  audience: "invite-only" | "friends" | "open";
  invitedUserIds: readonly string[];
  invitationTokenHash?: string;
}

function matchesToken(token: unknown, expected: string | undefined): boolean {
  if (
    !expected ||
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(token) ||
    !/^[a-f0-9]{64}$/.test(expected)
  )
    return false;
  const actual = requestHash(token);
  let difference = 0;
  for (let i = 0; i < 64; i++)
    difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

/** Host-only admission decisions. Network discovery alone never admits anyone. */
export class TogetherLocalLobby {
  private readonly options: LobbyOptions;
  private readonly ownCredentialHash: string;
  private readonly hashes = new WeakMap<object, string>();
  /** D16: one verification per roster revision, denied-pair set and validity window. */
  private verified?: {
    chain: readonly Signed<OfflineRoster>[];
    deniedKey: string;
    validFrom: number;
    validUntil: number;
    members: Map<string, RosterMember>;
  };
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
    this.ownCredentialHash = requestHash(this.options.credential);
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
    if (this.isHost || options.audience === "friends")
      store.bindPolicy(options.sessionId, {
        ...(options.invitationTokenHash
          ? { invitationTokenHash: options.invitationTokenHash }
          : {}),
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
        ...(this.options.audience === "friends"
          ? { audience: "friends" as const }
          : {}),
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
      !this.options.invitedUserIds.includes(identity.userId) &&
      !matchesToken(request.invitationToken, this.options.invitationTokenHash)
    )
      throw new Error("Invitation required");
    if (this.options.audience === "friends") {
      try {
        if (!request.friendship) throw new Error("missing");
        verifyFriendship(
          request.friendship,
          this.options.trustedKeys,
          this.pin.hostUserId,
          identity.userId,
          this.options.now(),
        );
      } catch {
        throw new Error("friendship-required");
      }
    }
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
    if (current.payload.members.length >= 4) throw new Error("LOBBY_FULL");
    const previouslyAdmitted = this.store
      .rosters(this.options.sessionId)
      .some((roster) =>
        roster.payload.members.some(
          (member) => member.credential.payload.userId === identity.userId,
        ),
      );
    const friend = request.friendship && !previouslyAdmitted;
    const member: RosterMember = {
      credential: request.credential,
      consent: request.consent,
      admission: friend ? "friend" : "approved",
      ...(friend || this.options.audience === "friends"
        ? { friendship: request.friendship }
        : {}),
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
      this.options.deniedPairs(
        envelope.payload.members.map(
          (member) => member.credential.payload.userId,
        ),
      ),
      this.options.now(),
    );
    if (!friend && !approved) return { status: "approval-required" };
    this.accept(envelope);
    return { status: "admitted", roster: envelope };
  }

  /** A removal is one host-signed roster revision; old join proofs require fresh approval. */
  removeParticipant(userId: string): Signed<OfflineRoster> {
    if (!this.isHost) throw new Error("Only the host can remove athletes");
    const current = this.store.current(this.options.sessionId);
    if (
      !current ||
      userId === this.pin.hostUserId ||
      !current.payload.members.some(
        (m) => m.credential.payload.userId === userId,
      )
    )
      throw new Error("Athlete not removable");
    this.member(this.ownCredential);
    const envelope = signPayload<OfflineRoster>(
      {
        ...current.payload,
        revision: current.payload.revision + 1,
        previousHash: requestHash(current.payload),
        members: current.payload.members.filter(
          (m) => m.credential.payload.userId !== userId,
        ),
      },
      this.options.seed,
    );
    this.accept(envelope);
    return envelope;
  }

  accept(roster: Signed<OfflineRoster>): void {
    if (
      (roster.payload.audience === "friends") !==
      (this.options.audience === "friends")
    )
      throw new Error("Lobby policy changed");
    this.store.commitRoster(
      roster,
      this.pin,
      this.options.trustedKeys,
      this.options.deniedPairs(
        roster.payload.members.map(
          (member) => member.credential.payload.userId,
        ),
      ),
      this.options.now(),
    );
  }

  /**
   * Run at every send/read: stale credentials, closure or newly known blocks
   * stop sharing. The signed chain is verified once per revision, denied-pair
   * set and validity window (D16); the closed flag is checked every time.
   */
  member(peer: Signed<Credential>): RosterMember {
    this.store.assertOpen(this.options.sessionId);
    const chain = this.store.rosters(this.options.sessionId);
    const roster = chain.at(-1);
    if (!roster) throw new Error("No admitted roster");
    const members = roster.payload.members;
    const denied = this.options.deniedPairs(
      members.map((member) => member.credential.payload.userId),
    );
    const deniedKey = denied
      .map(([a, b]) => (a < b ? `${a}\n${b}` : `${b}\n${a}`))
      .sort()
      .join("\u0000");
    const now = this.options.now();
    let verified = this.verified;
    if (
      !verified ||
      verified.chain !== chain ||
      verified.deniedKey !== deniedKey ||
      now < verified.validFrom ||
      now >= verified.validUntil
    ) {
      verifyRoster(
        roster,
        this.options.trustedKeys,
        chain.at(-2) ?? null,
        denied,
        now,
      );
      let validFrom = Number.NEGATIVE_INFINITY;
      let validUntil = Number.POSITIVE_INFINITY;
      for (const m of members) {
        validFrom = Math.max(
          validFrom,
          m.credential.payload.issuedAt,
          m.friendship?.payload.issuedAt ?? Number.NEGATIVE_INFINITY,
        );
        validUntil = Math.min(
          validUntil,
          m.credential.payload.expiresAt,
          m.friendship?.payload.expiresAt ?? Number.POSITIVE_INFINITY,
        );
      }
      verified = {
        chain,
        deniedKey,
        validFrom,
        validUntil,
        members: new Map(members.map((m) => [requestHash(m.credential), m])),
      };
      this.verified = verified;
    }
    const own = verified.members.get(this.ownCredentialHash);
    const member = verified.members.get(this.credentialHash(peer));
    if (!own || !member) throw new Error("Device not admitted");
    return member;
  }

  /** Hash by identity; own-credential clones short-circuit on field equality. */
  private credentialHash(credential: Signed<Credential>): string {
    const own = this.options.credential;
    if (
      credential === own ||
      (credential.signature === own.signature &&
        credential.payload.kind === own.payload.kind &&
        credential.payload.keyId === own.payload.keyId &&
        credential.payload.userId === own.payload.userId &&
        credential.payload.deviceId === own.payload.deviceId &&
        credential.payload.publicKey === own.payload.publicKey &&
        credential.payload.issuedAt === own.payload.issuedAt &&
        credential.payload.expiresAt === own.payload.expiresAt)
    )
      return this.ownCredentialHash;
    let hash = this.hashes.get(credential);
    if (!hash) {
      hash = requestHash(credential);
      this.hashes.set(credential, hash);
    }
    return hash;
  }

  /** Release the private signing copy when the foreground lobby ends. */
  dispose(): void {
    this.options.seed.fill(0);
    this.verified = undefined;
  }

  get ownCredential(): Signed<Credential> {
    return JSON.parse(JSON.stringify(this.options.credential));
  }
}
