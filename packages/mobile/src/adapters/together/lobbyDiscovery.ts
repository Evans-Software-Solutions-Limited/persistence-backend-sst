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
import { FriendsGuestExchange } from "./friendsDiscovery";
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
 * From a matched Training partners hint to its summary (friendsDiscovery.ts).
 * Below REFRESH_MARGIN: the browser has one socket, and a slow partner step
 * (or a host stalling on purpose) must not let listed hosts' refresh probes
 * miss their summaries' expiry.
 */
export const FRIENDS_STEP_DEADLINE = REFRESH_MARGIN - 1_000;
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
/**
 * Pages of partners read at most: a safety bound only (5,000 partners at the
 * API's default page size), never a product limit. The list loads off the
 * probe socket, so reading it all costs the search nothing.
 */
export const FRIEND_PAGES_MAX = 250;
/** Accepted training partners' user ids, every page; the social API lists both directions. */
export async function acceptedFriendIds(
  social: Pick<TogetherSocialApi, "friends">,
  userId: string,
): Promise<string[]> {
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < FRIEND_PAGES_MAX; page++) {
    const result = await social.friends(cursor);
    if (!result.ok) throw new Error("friends-unavailable");
    for (const r of result.value.data)
      if (r.status === "accepted")
        ids.add(r.userId === userId ? r.friendId : r.userId);
    const next = result.value.nextCursor;
    // Until the server says there is no more; a repeated cursor would loop.
    if (!next || cursors.has(next)) break;
    cursors.add(next);
    cursor = next;
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
  /** Accepted partners, once loaded for this search. */
  private friendIds?: readonly string[];
  /** Hosts whose hint came before the partner list: probed again once it loads. */
  private awaitingIds = new Map<string, string>();
  /** Endpoints already given a second probe after a slow proof fetch. */
  private retried = new Set<string>();
  private searches = 0;
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
    /** When this slot opened: the partners step shares its budget from here. */
    startedAt: number;
    peerId?: string;
    /** A re-probe of a listed host: its failure drops that row only. */
    refresh?: boolean;
    /**
     * Training partners step: waiting for the matched host to prove
     * it is that partner, fetching the proof, then waiting for the summary.
     */
    stage?: "challenged" | "proving" | "friends";
    friendId?: string;
    exchange?: FriendsGuestExchange;
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
    this.searches++;
    this.subscription = this.options.native.addListener("onEvent", (event) =>
      this.event(event),
    );
    this.expiry = setInterval(() => this.publish(), 1000);
    this.loadFriendIds();
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
      this.awaitingIds.delete(event.endpointId);
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
          this.matchFriend(active, tag);
          return;
        }
      }
      if (active.stage === "challenged") {
        void this.prove(active, event.frame);
        return;
      }
      // A host that speaks out of turn in the partners step gets nothing.
      if (active.stage === "proving") {
        void this.finish(active);
        return;
      }
      try {
        this.refreshing.delete(active.endpointId);
        const exchange = active.exchange;
        const summary = readSummary(
          exchange ? exchange.summary(event.frame) : event.frame,
          active.sessionId,
          active.nonce,
          this.options.trustedKeys,
          this.options.now(),
          active.friendId,
        );
        if (exchange && summary.hostDeviceId !== exchange.hostDeviceId)
          throw new Error("invalid-summary");
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
      startedAt: this.options.now(),
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
   * account's partners, challenge the host with a fresh ephemeral key and
   * nothing else (friendsDiscovery.ts). Anything else ends the probe as if no
   * host answered.
   */
  private matchFriend(
    active: NonNullable<TogetherLobbyBrowser["active"]>,
    tag: string,
  ) {
    // The partner list loads in parallel from the start of the search; the
    // socket never waits for it. A hint that arrives first is probed again
    // once the list is in.
    if (!this.friendIds) {
      this.awaitingIds.set(active.endpointId, active.sessionId);
      void this.finish(active);
      return;
    }
    const friendId = this.friendIds.find(
      (id) => friendsHintTag(active.nonce, id) === tag,
    );
    if (!friendId) {
      void this.finish(active);
      return;
    }
    // The whole slot, connect included, is held at most this long from when
    // it opened (not from the hint), so listed hosts' refresh probes still
    // run before their summaries lapse; it never ends the search.
    clearTimeout(this.deadline);
    this.deadline = setTimeout(
      () => this.partnerTimeout(active),
      Math.max(
        0,
        active.startedAt + FRIENDS_STEP_DEADLINE - this.options.now(),
      ),
    );
    // Fetched from our own server while the host proves itself; a fetch that
    // outlives this socket still lands in the cache for the next probe.
    void this.proof(friendId);
    active.stage = "challenged";
    active.friendId = friendId;
    active.exchange = new FriendsGuestExchange({
      nonce: active.nonce,
      sessionId: active.sessionId,
      friendId,
      trustedKeys: this.options.trustedKeys,
      randomBytes: this.options.randomBytes,
      now: this.options.now,
    });
    this.send(active, active.exchange.challenge());
  }
  /**
   * The host's response must prove, with its server-issued credential, that
   * it is the matched partner's device for this exchange. Only then does the
   * partner's proof leave the phone, sealed to that host.
   */
  private async prove(
    active: NonNullable<TogetherLobbyBrowser["active"]>,
    frame: string,
  ) {
    active.stage = "proving";
    const friendId = active.friendId!;
    try {
      active.exchange!.accept(frame);
    } catch {
      void this.finish(active);
      return;
    }
    const friendship = await this.proof(friendId);
    if (this.active !== active) return;
    if (!friendship) {
      void this.finish(active);
      return;
    }
    active.stage = "friends";
    active.friendship = friendship;
    this.send(active, active.exchange!.proof(friendship));
  }
  /**
   * The partner step ran out of time. A host that already proved it is the
   * partner, held up only by our own proof fetch, is probed once more when
   * that fetch lands; a host that stalled on its own is not.
   */
  private partnerTimeout(active: NonNullable<TogetherLobbyBrowser["active"]>) {
    if (this.active !== active) return;
    const { endpointId, sessionId, friendId } = active;
    // A matched partner host gets one more slot of its own per search: the
    // budget counts from when the slot opened, so a slow connect can leave
    // too little for the exchange. Still at most one extra bounded slot, so
    // a host stalling on purpose can't make the search loop.
    if (active.stage && !this.retried.has(endpointId)) {
      this.retried.add(endpointId);
      if (active.stage === "proving") {
        // Waiting on our own proof: probe again once it has landed.
        const generation = this.searches;
        void this.proof(friendId!).then((proof) => {
          if (proof && this.running && this.searches === generation)
            this.retry([[endpointId, sessionId]]);
        });
      } else {
        // Behind whatever is already queued; finish() starts the next slot.
        this.queue.push({ endpointId, sessionId, refresh: true });
      }
    }
    void this.finish(active);
  }
  /** Probed again like a refresh: a host that has since gone drops quietly. */
  private retry(endpoints: Iterable<[string, string]>) {
    for (const [endpointId, sessionId] of endpoints)
      this.queue.push({ endpointId, sessionId, refresh: true });
    this.next();
  }
  /** One fetch per partner per search, cached whether or not its socket is still open. */
  private proof(friendId: string) {
    let proof = this.proofs.get(friendId);
    if (!proof) {
      proof = this.options.friends!.proof(friendId).catch(() => null);
      this.proofs.set(friendId, proof);
    }
    return proof;
  }
  /** Starts with the search, off the probe socket; offline or failed means no partners. */
  private loadFriendIds() {
    const friends = this.options.friends;
    if (!friends) return;
    const generation = this.searches;
    void friends
      .ids()
      .catch(() => [])
      .then((ids) => {
        if (!this.running || this.searches !== generation) return;
        this.friendIds = [...ids];
        const waiting = [...this.awaitingIds];
        this.awaitingIds.clear();
        if (ids.length) this.retry(waiting);
      });
  }
  private send(
    active: NonNullable<TogetherLobbyBrowser["active"]>,
    frame: string,
  ) {
    void this.options.native.send(active.peerId!, frame).catch(() => {
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
    active.exchange?.dispose();
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
    this.searches++;
    this.friendIds = undefined;
    this.awaitingIds.clear();
    this.retried.clear();
    this.proofs.clear();
    this.active?.exchange?.dispose();
    this.active = undefined;
    this.stopping = this.options.native.stop();
    await this.stopping;
  }
}
