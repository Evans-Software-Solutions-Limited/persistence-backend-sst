import type {
  TogetherLanNative,
  TogetherLanEvent,
} from "../../../modules/together-lan";
import type { ReadyIdentity } from "../../domain/ports/togetherProvisioning.port";
import type { HostPin } from "./localStore";
import {
  signPayload,
  verifyCredential,
  verifySignature,
  type Credential,
  type FriendshipEvidence,
  type Signed,
  type TrustedKeys,
} from "./security/identity";
import { object, uuid } from "./security/schema";
import { encode64 } from "./security/encoding";
import { getCryptoBackend } from "./security/cryptoBackend";
import type { TogetherSocialApi } from "../../domain/ports/togetherSocial.port";
import { isHostDetails } from "./planDetails";
import type {
  TogetherHostDetails,
  TogetherPlanRow,
} from "../../domain/ports/togetherLobby.port";

export const SUMMARY_TTL = 15_000;
/** A verified host is probed again this long before its summary expires, so it stays listed while the search runs. */
export const REFRESH_MARGIN = 5_000;
/** How long the native socket keeps trying after `connect` returns (Android and iOS both use 30 s). */
export const NATIVE_CONNECT_DEADLINE = 30_000;
/**
 * A Training partners host answers a probe with a hint; the guest then has
 * this long to match it against its partners and send a friendship proof.
 */
export const FRIENDS_STEP_DEADLINE = 10_000;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
export interface LobbySummary extends HostPin {
  kind: "together-summary-v1";
  /** "friends" only in reply to a verified friendship proof. */
  audience: "open" | "friends";
  workoutName: string;
  memberCount: number;
  /** PER-60: start time, plan rows and the session code; absent from older hosts. */
  startedAt?: number;
  plan?: readonly TogetherPlanRow[];
  code?: string;
  credential: Signed<Credential>;
  nonce: string;
  expiresAt: number;
}
export function readProbe(frame: string): string | undefined {
  if (frame.length > 256) return;
  try {
    const p: unknown = JSON.parse(frame);
    if (
      object(p, ["kind", "nonce"]) &&
      p.kind === "together-probe-v1" &&
      typeof p.nonce === "string" &&
      NONCE.test(p.nonce)
    )
      return p.nonce;
  } catch {
    /* Non-probes go to the existing authenticated protocol. */
  }
}
/**
 * Binds a Training partners host to one probe without naming it: only a
 * guest that already knows the host's user id can recompute the tag, and a
 * fresh nonce gives a fresh tag, so hints cannot be linked across searches.
 */
export function friendsHintTag(nonce: string, hostUserId: string): string {
  return encode64(
    getCryptoBackend().sha256(
      new TextEncoder().encode(`together-friends-hint-v1${nonce}${hostUserId}`),
    ),
    true,
  );
}
/** A Training partners host's reply to a probe: no session, name, plan or identity. */
export function friendsHint(nonce: string, hostUserId: string): string {
  return JSON.stringify({
    kind: "together-friends-hint-v1",
    nonce,
    tag: friendsHintTag(nonce, hostUserId),
  });
}
export function readFriendsHint(
  frame: string,
  nonce: string,
): string | undefined {
  if (frame.length > 256) return;
  try {
    const p: unknown = JSON.parse(frame);
    if (
      object(p, ["kind", "nonce", "tag"]) &&
      p.kind === "together-friends-hint-v1" &&
      p.nonce === nonce &&
      typeof p.tag === "string" &&
      NONCE.test(p.tag)
    )
      return p.tag;
  } catch {
    /* Anything else is a summary or nothing. */
  }
}
/** The guest's second frame, sent only after a hint matched one of its partners. */
export function friendsProbe(
  nonce: string,
  friendship: Signed<FriendshipEvidence>,
): string {
  return JSON.stringify({
    kind: "together-friends-probe-v1",
    nonce,
    friendship,
  });
}
/** Host side: the proof comes back unverified; the caller verifies it exactly as admission does. */
export function readFriendsProbe(frame: string, nonce: string): unknown {
  if (frame.length > 2048) return;
  try {
    const p: unknown = JSON.parse(frame);
    if (
      object(p, ["kind", "nonce", "friendship"]) &&
      p.kind === "together-friends-probe-v1" &&
      p.nonce === nonce
    )
      return p.friendship;
  } catch {
    /* Not a friends probe: no summary. */
  }
}
/** Accepted training partners' user ids, every page; the social API lists both directions. */
export async function acceptedFriendIds(
  social: Pick<TogetherSocialApi, "friends">,
  userId: string,
): Promise<string[]> {
  const ids = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const result = await social.friends(cursor);
    if (!result.ok) throw new Error("friends-unavailable");
    for (const r of result.value.data)
      if (r.status === "accepted")
        ids.add(r.userId === userId ? r.friendId : r.userId);
    if (!result.value.nextCursor) break;
    cursor = result.value.nextCursor;
  }
  ids.delete(userId);
  return [...ids];
}
export function signSummary(
  pin: HostPin,
  identity: ReadyIdentity,
  workoutName: string,
  memberCount: number,
  nonce: string,
  now: number,
  details?: TogetherHostDetails & { code: string },
  audience: LobbySummary["audience"] = "open",
): string {
  verifyCredential(identity.credential, identity.trustedKeys, now);
  return JSON.stringify(
    signPayload<LobbySummary>(
      {
        kind: "together-summary-v1",
        ...pin,
        audience,
        workoutName,
        memberCount,
        ...(details
          ? {
              startedAt: details.startedAt,
              plan: details.plan,
              code: details.code,
            }
          : {}),
        credential: identity.credential,
        nonce,
        expiresAt: Math.min(
          now + SUMMARY_TTL,
          identity.credential.payload.expiresAt,
        ),
      },
      identity.seed,
    ),
  );
}
export function readSummary(
  frame: string,
  sessionId: string,
  nonce: string,
  trusted: TrustedKeys,
  now: number,
  /** Set only in the Training partners flow: the partner whose hint matched. */
  friendId?: string,
): LobbySummary {
  if (frame.length > 6000) throw new Error("invalid-summary");
  const envelope: unknown = JSON.parse(frame);
  if (
    !object(envelope, ["payload", "signature"]) ||
    !object(
      envelope.payload,
      [
        "kind",
        "sessionId",
        "hostUserId",
        "hostDeviceId",
        "audience",
        "workoutName",
        "memberCount",
        "credential",
        "nonce",
        "expiresAt",
      ],
      ["startedAt", "plan", "code"],
    )
  )
    throw new Error("invalid-summary");
  const p = envelope.payload;
  if (
    p.kind !== "together-summary-v1" ||
    p.audience !== (friendId === undefined ? "open" : "friends") ||
    (friendId !== undefined && p.hostUserId !== friendId) ||
    p.sessionId !== sessionId ||
    ![p.sessionId, p.hostUserId, p.hostDeviceId].every(uuid) ||
    p.nonce !== nonce ||
    typeof p.workoutName !== "string" ||
    !p.workoutName.trim() ||
    p.workoutName.length > 100 ||
    !Number.isInteger(p.memberCount) ||
    (p.memberCount as number) < 1 ||
    (p.memberCount as number) > 4 ||
    !Number.isSafeInteger(p.expiresAt) ||
    (p.expiresAt as number) <= now ||
    (p.expiresAt as number) > now + SUMMARY_TTL ||
    !isHostDetails(p)
  )
    throw new Error("invalid-summary");
  const identity = verifyCredential(
    p.credential as Signed<Credential>,
    trusted,
    now,
  );
  if (
    identity.userId !== p.hostUserId ||
    identity.deviceId !== p.hostDeviceId ||
    (p.expiresAt as number) > identity.expiresAt
  )
    throw new Error("invalid-summary");
  return verifySignature(
    envelope as unknown as Signed<LobbySummary>,
    identity.publicKey,
  );
}
/** A verified summary; a Training partners one keeps the proof that unlocked it, for Join. */
export type DiscoveredSummary = LobbySummary & {
  friendship?: Signed<FriendshipEvidence>;
};
interface BrowserOptions {
  native: TogetherLanNative;
  trustedKeys: TrustedKeys;
  randomBytes(length: number): Uint8Array;
  now(): number;
  onChange(summaries: readonly DiscoveredSummary[]): void;
  onError(code: string): void;
  /**
   * Training partners search. Without it, or when either call fails, a
   * partners host's hint is ignored and the search behaves as before.
   */
  friends?: {
    /** Accepted partners' user ids; read once per search. */
    ids(): Promise<readonly string[]>;
    /** The server-signed friendship proof for one partner; fetched once per search. */
    proof(friendId: string): Promise<Signed<FriendshipEvidence> | null>;
  };
}
/** No visitor identity or admission data is sent until explicit Join. One outbound socket at a time. */
export class TogetherLobbyBrowser {
  private subscription?: { remove(): void };
  private running = false;
  private finishing = false;
  private seen = new Set<string>();
  private queue: {
    endpointId: string;
    sessionId: string;
    refresh?: boolean;
  }[] = [];
  private summaries = new Map<string, DiscoveredSummary>();
  private friendIds?: Promise<readonly string[]>;
  private proofs = new Map<
    string,
    Promise<Signed<FriendshipEvidence> | null>
  >();
  /** Endpoints queued for a refresh probe; cleared when a new summary lands or the host is lost. */
  private refreshing = new Set<string>();
  private active?: {
    endpointId: string;
    sessionId: string;
    nonce: string;
    peerId?: string;
    /** A re-probe of a listed host: its failure drops that row only. */
    refresh?: boolean;
    /** Training partners step: matching a hint, then waiting for the summary. */
    stage?: "matching" | "friends";
    friendId?: string;
    friendship?: Signed<FriendshipEvidence>;
  };
  private deadline?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setInterval>;
  private stopping?: Promise<void>;
  /**
   * An abandoned refresh probe whose native socket may still connect: the
   * slot stays reserved until that late connection arrives (and is dropped)
   * or the native deadline passes, so it can never bind to another host's probe.
   */
  private reserved?: ReturnType<typeof setTimeout>;
  /** Sockets this browser closed itself; their closing events say nothing about a probe. */
  private discarded = new Set<string>();
  constructor(private readonly options: BrowserOptions) {}
  async start() {
    this.running = true;
    this.subscription = this.options.native.addListener("onEvent", (event) =>
      this.event(event),
    );
    this.expiry = setInterval(() => this.publish(), 1000);
    try {
      await this.options.native.startDiscovery();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }
  private publish() {
    const now = this.options.now();
    for (const [endpoint, summary] of this.summaries) {
      if (summary.expiresAt <= now) {
        this.summaries.delete(endpoint);
        this.refreshing.delete(endpoint);
      } else if (
        summary.expiresAt - now <= REFRESH_MARGIN &&
        !this.refreshing.has(endpoint) &&
        this.active?.endpointId !== endpoint
      ) {
        // Summaries live 15 s and a search runs 30 s: probe the host again
        // before its summary lapses, or every host found early drops off
        // the list before the search ends.
        this.refreshing.add(endpoint);
        this.queue.push({
          endpointId: endpoint,
          sessionId: summary.sessionId,
          refresh: true,
        });
        this.next();
      }
    }
    this.options.onChange([...this.summaries.values()]);
  }
  private event(event: TogetherLanEvent) {
    if (!this.running) return;
    if (event.type === "discovered") {
      if (
        !uuid(event.lobbyId) ||
        this.seen.has(event.endpointId) ||
        this.seen.size >= 64
      )
        return;
      this.seen.add(event.endpointId);
      this.queue.push({
        endpointId: event.endpointId,
        sessionId: event.lobbyId,
      });
      this.next();
    } else if (event.type === "lost") {
      this.queue = this.queue.filter(
        (item) => item.endpointId !== event.endpointId,
      );
      this.summaries.delete(event.endpointId);
      this.refreshing.delete(event.endpointId);
      this.publish();
      const active = this.active;
      if (active?.endpointId === event.endpointId) {
        // A bound socket can be closed independently. An unbound connection
        // must end this generation because native connected events lack endpoint IDs.
        if (active.peerId) void this.finish(active);
        else this.unreachable(active, true);
      }
    } else if (event.type === "connected") {
      const active = this.active;
      if (!active || active.peerId || event.incoming) {
        this.discarded.add(event.peerId);
        void this.options.native
          .disconnect(event.peerId)
          .catch(() => this.fatal("disconnect-failed"));
        // The abandoned probe's socket has finally connected: the slot is free.
        if (!active && !event.incoming && this.reserved) this.release();
        return;
      }
      active.peerId = event.peerId;
      void this.options.native
        .send(
          event.peerId,
          JSON.stringify({ kind: "together-probe-v1", nonce: active.nonce }),
        )
        .catch(() => {
          if (this.active === active) void this.finish(active);
        });
    } else if (event.type === "frame") {
      const active = this.active;
      if (!active || active.peerId !== event.peerId) return;
      if (!active.stage && this.options.friends) {
        const tag = readFriendsHint(event.frame, active.nonce);
        if (tag) {
          void this.matchFriend(active, tag);
          return;
        }
      }
      // A host that speaks again while its hint is being matched gets nothing.
      if (active.stage === "matching") {
        void this.finish(active);
        return;
      }
      try {
        this.refreshing.delete(active.endpointId);
        const summary = readSummary(
          event.frame,
          active.sessionId,
          active.nonce,
          this.options.trustedKeys,
          this.options.now(),
          active.friendId,
        );
        this.summaries.set(
          active.endpointId,
          active.friendship
            ? { ...summary, friendship: active.friendship }
            : summary,
        );
        this.publish();
      } catch {
        /* Unverified discovery never reaches UI. */
      }
      void this.finish(active);
    } else if (event.type === "disconnected") {
      if (this.active?.peerId === event.peerId) void this.finish(this.active);
      else this.strayClosure(event.peerId, true);
    } else if (event.type === "error") {
      // Android reports normal remote EOF as read_failed before disconnected.
      // Peer-scoped closure must not erase verified hosts or poison a later probe.
      if (event.peerId) {
        if (this.active?.peerId === event.peerId) void this.finish(this.active);
        else this.strayClosure(event.peerId, false);
      } else this.fatal(event.code);
    }
  }
  private next() {
    if (!this.running || this.active || this.finishing || this.reserved) return;
    const endpoint = this.queue.shift();
    if (!endpoint) return;
    const active = {
      ...endpoint,
      nonce: encode64(this.options.randomBytes(32), true),
    };
    this.active = active;
    // No endpoint correlation exists on connected: timeout ends the entire generation.
    this.deadline = setTimeout(() => this.unreachable(active, true), 5000);
    void this.options.native.connect(endpoint.endpointId).catch(() => {
      // A rejected connect left no socket behind.
      if (this.active === active) this.unreachable(active, false);
    });
  }
  /**
   * A first-contact probe that cannot reach its host ends the generation, as
   * above. A refresh probe only drops that host's row: a host that left
   * before Nearby reported it lost must not end the whole search (PER-60).
   * While its native socket may still be trying, the slot stays reserved so
   * a late connection cannot attach to the next host's probe.
   */
  private unreachable(
    active: NonNullable<TogetherLobbyBrowser["active"]>,
    socketPending: boolean,
  ) {
    if (this.active !== active) return;
    if (!active.refresh) {
      this.fatal("unreachable-host");
      return;
    }
    this.summaries.delete(active.endpointId);
    this.refreshing.delete(active.endpointId);
    this.options.onChange([...this.summaries.values()]);
    if (socketPending) {
      clearTimeout(this.deadline);
      this.active = undefined;
      this.reserved = setTimeout(() => this.release(), NATIVE_CONNECT_DEADLINE);
      return;
    }
    void this.finish(active);
  }
  /**
   * A closing event for a socket that is not the bound probe. Sockets this
   * browser closed itself are expected. Any other one is an outbound connect
   * that failed fast (a host that closed the app before Nearby reported it
   * lost): it ends a reservation, or fails the unbound probe without the
   * 5 s wait, since no socket is left behind (PER-60).
   */
  private strayClosure(peerId: string, closed: boolean) {
    if (this.discarded.has(peerId)) {
      if (closed) this.discarded.delete(peerId);
      return;
    }
    // Android sends error then disconnected for one failure: count it once.
    if (!closed) this.discarded.add(peerId);
    const active = this.active;
    if (!active) {
      if (this.reserved) this.release();
    } else if (!active.peerId) this.unreachable(active, false);
  }
  /**
   * A Training partners host answered with a hint. If the tag is one of this
   * account's partners, send that partner's friendship proof on the same
   * socket; the host replies with its signed summary only if the proof is
   * valid for the pair. Anything else ends the probe as if no host answered.
   */
  private async matchFriend(
    active: NonNullable<TogetherLobbyBrowser["active"]>,
    tag: string,
  ) {
    const friends = this.options.friends!;
    active.stage = "matching";
    // The bound socket is closed on timeout; it never ends the search.
    clearTimeout(this.deadline);
    this.deadline = setTimeout(
      () => void this.finish(active),
      FRIENDS_STEP_DEADLINE,
    );
    // Offline or a failed lookup: no partner matches for the rest of this search.
    this.friendIds ??= friends.ids().catch(() => []);
    const ids = await this.friendIds;
    if (this.active !== active) return;
    const friendId = ids.find((id) => friendsHintTag(active.nonce, id) === tag);
    let friendship: Signed<FriendshipEvidence> | null = null;
    if (friendId) {
      let proof = this.proofs.get(friendId);
      if (!proof) {
        proof = friends.proof(friendId).catch(() => null);
        this.proofs.set(friendId, proof);
      }
      friendship = await proof;
    }
    if (this.active !== active) return;
    if (!friendId || !friendship) {
      void this.finish(active);
      return;
    }
    active.stage = "friends";
    active.friendId = friendId;
    active.friendship = friendship;
    void this.options.native
      .send(active.peerId!, friendsProbe(active.nonce, friendship))
      .catch(() => {
        if (this.active === active) void this.finish(active);
      });
  }
  private release() {
    clearTimeout(this.reserved);
    this.reserved = undefined;
    this.next();
  }
  private async finish(active: NonNullable<TogetherLobbyBrowser["active"]>) {
    if (this.active !== active) return;
    clearTimeout(this.deadline);
    // Keep ownership until disconnect resolves, and ignore repeated frames.
    this.active = undefined;
    this.finishing = true;
    try {
      if (active.peerId) await this.options.native.disconnect(active.peerId);
    } catch {
      this.fatal("disconnect-failed");
      return;
    }
    this.finishing = false;
    this.next();
  }
  private fatal(code: string) {
    if (!this.running) return;
    this.running = false;
    this.options.onError(code);
    void this.stop().catch(() => {});
  }
  async stop() {
    if (this.stopping) return this.stopping;
    this.running = false;
    this.subscription?.remove();
    clearTimeout(this.deadline);
    clearTimeout(this.reserved);
    this.reserved = undefined;
    this.discarded.clear();
    clearInterval(this.expiry);
    this.queue = [];
    this.summaries.clear();
    this.refreshing.clear();
    this.friendIds = undefined;
    this.proofs.clear();
    this.active = undefined;
    this.stopping = this.options.native.stop();
    await this.stopping;
  }
}
