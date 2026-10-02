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
  type Signed,
  type TrustedKeys,
} from "./security/identity";
import { object, uuid } from "./security/schema";
import { encode64 } from "./security/encoding";

export const SUMMARY_TTL = 15_000;
export interface LobbySummary extends HostPin {
  kind: "together-summary-v1";
  audience: "open";
  workoutName: string;
  memberCount: number;
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
      /^[A-Za-z0-9_-]{43}$/.test(p.nonce)
    )
      return p.nonce;
  } catch {
    /* Non-probes go to the existing authenticated protocol. */
  }
}
export function signSummary(
  pin: HostPin,
  identity: ReadyIdentity,
  workoutName: string,
  memberCount: number,
  nonce: string,
  now: number,
): string {
  verifyCredential(identity.credential, identity.trustedKeys, now);
  return JSON.stringify(
    signPayload<LobbySummary>(
      {
        kind: "together-summary-v1",
        ...pin,
        audience: "open",
        workoutName,
        memberCount,
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
): LobbySummary {
  if (frame.length > 6000) throw new Error("invalid-summary");
  const envelope: unknown = JSON.parse(frame);
  if (
    !object(envelope, ["payload", "signature"]) ||
    !object(envelope.payload, [
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
    ])
  )
    throw new Error("invalid-summary");
  const p = envelope.payload;
  if (
    p.kind !== "together-summary-v1" ||
    p.audience !== "open" ||
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
    (p.expiresAt as number) > now + SUMMARY_TTL
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
interface BrowserOptions {
  native: TogetherLanNative;
  trustedKeys: TrustedKeys;
  randomBytes(length: number): Uint8Array;
  now(): number;
  onChange(summaries: readonly LobbySummary[]): void;
  onError(code: string): void;
}
/** No visitor identity or admission data is sent until explicit Join. One outbound socket at a time. */
export class TogetherLobbyBrowser {
  private subscription?: { remove(): void };
  private running = false;
  private finishing = false;
  private seen = new Set<string>();
  private queue: { endpointId: string; sessionId: string }[] = [];
  private summaries = new Map<string, LobbySummary>();
  private active?: {
    endpointId: string;
    sessionId: string;
    nonce: string;
    peerId?: string;
  };
  private deadline?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setInterval>;
  private stopping?: Promise<void>;
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
    for (const [endpoint, summary] of this.summaries)
      if (summary.expiresAt <= this.options.now())
        this.summaries.delete(endpoint);
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
      this.publish();
      if (this.active?.endpointId === event.endpointId)
        this.fatal("unreachable-host");
    } else if (event.type === "connected") {
      const active = this.active;
      if (!active || active.peerId || event.incoming) {
        void this.options.native
          .disconnect(event.peerId)
          .catch(() => this.fatal("disconnect-failed"));
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
      try {
        this.summaries.set(
          active.endpointId,
          readSummary(
            event.frame,
            active.sessionId,
            active.nonce,
            this.options.trustedKeys,
            this.options.now(),
          ),
        );
        this.publish();
      } catch {
        /* Unverified discovery never reaches UI. */
      }
      void this.finish(active);
    } else if (event.type === "disconnected") {
      if (this.active?.peerId === event.peerId) void this.finish(this.active);
    } else if (event.type === "error") {
      // Android reports normal remote EOF as read_failed before disconnected.
      // Peer-scoped closure must not erase verified hosts or poison a later probe.
      if (event.peerId) {
        if (this.active?.peerId === event.peerId) void this.finish(this.active);
      } else this.fatal(event.code);
    }
  }
  private next() {
    if (!this.running || this.active || this.finishing) return;
    const endpoint = this.queue.shift();
    if (!endpoint) return;
    const active = {
      ...endpoint,
      nonce: encode64(this.options.randomBytes(32), true),
    };
    this.active = active;
    // No endpoint correlation exists on connected: timeout ends the entire generation.
    this.deadline = setTimeout(() => this.fatal("unreachable-host"), 5000);
    void this.options.native.connect(endpoint.endpointId).catch(() => {
      if (this.active === active) this.fatal("unreachable-host");
    });
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
    clearInterval(this.expiry);
    this.queue = [];
    this.summaries.clear();
    this.active = undefined;
    this.stopping = this.options.native.stop();
    await this.stopping;
  }
}
