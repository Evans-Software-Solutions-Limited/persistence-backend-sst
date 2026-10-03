import { readProbe } from "./lobbyDiscovery";
import type {
  TogetherLanNative,
  TogetherLanEvent,
} from "../../../modules/together-lan";
import { TogetherJournal } from "../storage/togetherJournal";
import { TogetherLocalLink } from "./localLink";
import { TogetherLocalLobby, type LocalJoinRequest } from "./localLobby";
import { readOwnerCommand } from "./localCommand";
import type { LocalCommand } from "./localStore";
import { LocalSecureChannel } from "./security/channel";
import { requestHash } from "./security/identity";

export type LanSessionEvent =
  | Extract<TogetherLanEvent, { type: "discovered" | "lost" }>
  | {
      type:
        | "connected"
        | "authenticated"
        | "admitted"
        | "disconnected"
        | "command"
        | "receipt"
        | "roster"
        | "full"
        | "declined";
      peerId: string;
    }
  | { type: "approval-required"; peerId: string; request?: LocalJoinRequest }
  | { type: "error"; code: string; peerId?: string };
interface Connection {
  channel: LocalSecureChannel;
  link: TogetherLocalLink;
  authenticated: boolean;
  received: boolean;
  admitted: boolean;
  frames: number;
  processing: Promise<void>;
  deadline: ReturnType<typeof setTimeout>;
  heartbeat?: ReturnType<typeof setInterval>;
}
export interface LanSessionOptions {
  native: TogetherLanNative | null;
  lobby: TogetherLocalLobby;
  journal: TogetherJournal;
  channelFactory: (role: "host" | "guest") => LocalSecureChannel;
  enabled?: boolean;
  onEvent: (event: LanSessionEvent) => void;
  probeSummary?: (nonce: string) => string | undefined;
}

/** Foreground LAN lifecycle only. No UI mounting, account switching or cloud fallback. */
export class TogetherLanSession {
  private mode?: "host" | "guest";
  private generation = 0;
  private subscription?: { remove(): void };
  private readonly endpoints = new Map<string, string>();
  private readonly links = new Map<string, Connection>();
  private connecting = false;
  private connectDeadline?: ReturnType<typeof setTimeout>;
  private stopping = false;
  private stopPromise?: Promise<void>;
  private request?: LocalJoinRequest;
  private readonly options: Readonly<LanSessionOptions>;
  constructor(options: LanSessionOptions) {
    if (options.journal.accountId !== options.lobby.store.accountId)
      throw new Error("Wrong journal account");
    this.options = { ...options };
  }

  private begin(mode: "host" | "guest"): TogetherLanNative {
    if (!this.options.enabled) throw new Error("Together LAN is disabled");
    if (!this.options.native)
      throw new Error("Together LAN requires a compatible native build");
    if (
      this.mode ||
      this.stopping ||
      (mode === "host") !== this.options.lobby.isHost
    )
      throw new Error("Wrong LAN lifecycle");
    this.mode = mode;
    const generation = ++this.generation;
    try {
      this.subscription = this.options.native.addListener(
        "onEvent",
        (event) => {
          if (generation === this.generation) this.handle(event);
        },
      );
    } catch (error) {
      this.mode = undefined;
      ++this.generation;
      throw error;
    }
    return this.options.native;
  }

  async startHost(): Promise<void> {
    const native = this.begin("host");
    const generation = this.generation;
    try {
      await native.startHost(this.options.lobby.pin.sessionId);
    } catch (error) {
      if (generation === this.generation) await this.stop();
      throw error;
    }
  }

  async startDiscovery(): Promise<void> {
    const native = this.begin("guest");
    const generation = this.generation;
    try {
      await native.startDiscovery();
    } catch (error) {
      if (generation === this.generation) await this.stop();
      throw error;
    }
  }

  async connect(endpointId: string, request: LocalJoinRequest): Promise<void> {
    if (
      this.mode !== "guest" ||
      this.connecting ||
      this.links.size ||
      this.endpoints.get(endpointId) !== this.options.lobby.pin.sessionId
    )
      throw new Error("Unknown or busy lobby endpoint");
    if (
      requestHash(request.credential) !==
      requestHash(this.options.lobby.ownCredential)
    )
      throw new Error("Wrong joining identity");
    this.request = JSON.parse(JSON.stringify(request));
    this.connecting = true;
    this.connectDeadline = setTimeout(() => {
      this.emit({ type: "error", code: "connect_timeout" });
      void this.stop().catch(() =>
        this.emit({ type: "error", code: "stop_failed" }),
      );
    }, 10_000);
    const generation = this.generation;
    try {
      await this.options.native!.connect(endpointId);
    } catch (error) {
      if (generation === this.generation) {
        clearTimeout(this.connectDeadline);
        this.connecting = false;
        this.request = undefined;
      }
      throw error;
    }
  }

  pendingRequest(peerId: string): LocalJoinRequest | undefined {
    return this.links.get(peerId)?.link.pendingRequest;
  }

  async approve(peerId: string): Promise<void> {
    const connection = this.links.get(peerId);
    const request = connection?.link.pendingRequest;
    if (this.mode !== "host" || !connection || !request)
      throw new Error("No pending request");
    try {
      if (!(await connection.link.approve(request))) {
        this.emit({ type: "full", peerId });
        this.drop(peerId);
        await this.disconnect(peerId);
        return;
      }
      if (this.links.get(peerId) !== connection) return;
      await this.admitted(peerId, connection);
      if (this.links.get(peerId) === connection)
        await this.broadcastRoster(peerId);
    } catch (error) {
      this.fail(peerId, "approval_failed", connection);
      throw error;
    }
  }

  async decline(peerId: string): Promise<void> {
    const connection = this.links.get(peerId);
    if (!connection) throw new Error("No pending request");
    await connection.link.decline();
    this.drop(peerId);
    await this.disconnect(peerId);
  }

  async sendOwn(command: LocalCommand): Promise<void> {
    const own = this.options.lobby.ownCredential;
    const payload = readOwnerCommand(command, own);
    const roster = this.options.lobby.store.current(
      this.options.lobby.pin.sessionId,
    );
    const member = roster?.payload.members.find(
      (value) => requestHash(value.credential) === requestHash(own),
    );
    if (
      !member ||
      payload.sessionId !== this.options.lobby.pin.sessionId ||
      payload.executionId !== member.consent.payload.executionId
    )
      throw new Error("Wrong owner execution");
    // Keep valid own work even offline or after credential expiry; sharing still revalidates.
    this.options.journal.append(command);
    const connections = [...this.links].filter(([, value]) => value.admitted);
    await Promise.all(
      connections.map(async ([peerId, connection]) => {
        try {
          await connection.link.sendOwn(command);
        } catch (error) {
          this.fail(peerId, "send_failed", connection);
          throw error;
        }
      }),
    );
  }

  private emit(event: LanSessionEvent): void {
    try {
      this.options.onEvent(event);
    } catch {
      /* UI callbacks cannot interrupt teardown. */
    }
  }

  private handle(event: TogetherLanEvent): void {
    if (event.type === "discovered") {
      if (
        this.mode !== "guest" ||
        event.lobbyId !== this.options.lobby.pin.sessionId ||
        (!this.endpoints.has(event.endpointId) && this.endpoints.size >= 64)
      )
        return;
      this.endpoints.set(event.endpointId, event.lobbyId);
      this.emit(event);
      return;
    }
    if (event.type === "lost") {
      if (this.endpoints.delete(event.endpointId)) this.emit(event);
      return;
    }
    if (event.type === "connected") {
      this.connected(event);
      return;
    }
    if (event.type === "disconnected") {
      this.drop(event.peerId);
      return;
    }
    if (event.type === "error") {
      if (event.peerId) this.fail(event.peerId, event.code);
      else {
        this.emit(event);
        void this.stop().catch(() =>
          this.emit({ type: "error", code: "stop_failed" }),
        );
      }
      return;
    }
    const connection = this.links.get(event.peerId);
    if (!connection) {
      void this.disconnect(event.peerId);
      return;
    }
    if (++connection.frames > 16) {
      this.fail(event.peerId, "frame_queue_full");
      return;
    }
    connection.processing = connection.processing
      .then(async () => {
        if (this.links.get(event.peerId) !== connection) return;
        if (this.mode === "host" && !connection.received) {
          connection.received = true;
          const nonce = readProbe(event.frame);
          if (nonce) {
            const summary = this.options.probeSummary?.(nonce);
            if (summary) await this.options.native!.send(event.peerId, summary);
            this.drop(event.peerId);
            await this.disconnect(event.peerId);
            return;
          }
        }
        const result = await connection.link.receive(event.frame);
        if (this.links.get(event.peerId) !== connection) return;
        if (!connection.authenticated && connection.link.ready) {
          connection.authenticated = true;
          clearTimeout(connection.deadline);
          connection.deadline = setTimeout(
            () => this.fail(event.peerId, "admission_timeout"),
            60_000,
          );
          connection.heartbeat = setInterval(() => {
            void connection.link
              .heartbeat()
              .catch(() =>
                this.fail(event.peerId, "heartbeat_failed", connection),
              );
          }, 10_000);
          this.emit({ type: "authenticated", peerId: event.peerId });
          if (this.mode === "guest") await connection.link.join(this.request!);
        }
        if (result === "approval-required") {
          this.emit({
            type: "approval-required",
            peerId: event.peerId,
            request: connection.link.pendingRequest,
          });
        } else if (result === "full" || result === "declined") {
          this.emit({ type: result, peerId: event.peerId });
          this.drop(event.peerId);
          await this.disconnect(event.peerId);
        } else if (result === "roster") {
          this.emit({ type: "roster", peerId: event.peerId });
          await this.admitted(event.peerId, connection);
          if (
            this.links.get(event.peerId) === connection &&
            this.mode === "host"
          )
            await this.broadcastRoster(event.peerId);
        } else if (result === "command" || result === "receipt")
          this.emit({ type: result, peerId: event.peerId });
      })
      .catch(() => this.fail(event.peerId, "protocol_failed", connection))
      .finally(() => {
        connection.frames--;
      });
  }

  private connected(
    event: Extract<TogetherLanEvent, { type: "connected" }>,
  ): void {
    if (
      !this.mode ||
      event.incoming !== (this.mode === "host") ||
      this.links.size >= 8 ||
      this.links.has(event.peerId) ||
      (this.mode === "guest" && (!this.connecting || this.links.size > 0))
    ) {
      this.drop(event.peerId);
      void this.disconnect(event.peerId);
      return;
    }
    this.connecting = false;
    clearTimeout(this.connectDeadline);
    let channel: LocalSecureChannel | undefined;
    try {
      channel = this.options.channelFactory(this.mode);
      const link = new TogetherLocalLink(
        channel,
        this.options.lobby,
        this.options.journal,
        (frame) => this.options.native!.send(event.peerId, frame),
      );
      const connection: Connection = {
        channel,
        link,
        authenticated: false,
        received: false,
        admitted: false,
        frames: 0,
        processing: Promise.resolve(),
        deadline: setTimeout(
          () => this.fail(event.peerId, "authentication_timeout"),
          10_000,
        ),
      };
      this.links.set(event.peerId, connection);
      this.emit({ type: "connected", peerId: event.peerId });
      if (this.mode === "guest")
        void link
          .start()
          .catch(() => this.fail(event.peerId, "handshake_failed", connection));
    } catch {
      channel?.close();
      this.fail(event.peerId, "channel_failed");
    }
  }

  private async admitted(
    peerId: string,
    connection: Connection,
  ): Promise<void> {
    if (this.links.get(peerId) !== connection || connection.admitted) return;
    const roster = this.options.lobby.store.current(
      this.options.lobby.pin.sessionId,
    );
    const own = this.options.lobby.ownCredential;
    if (
      !roster?.payload.members.some(
        (member) => requestHash(member.credential) === requestHash(own),
      )
    )
      return;
    this.options.lobby.member(connection.channel.peerCredential!);
    connection.admitted = true;
    clearTimeout(connection.deadline);
    this.emit({ type: "admitted", peerId });
    await connection.link.resendOwn();
  }

  private async broadcastRoster(except: string): Promise<void> {
    await Promise.all(
      [...this.links].map(async ([peerId, connection]) => {
        if (peerId === except || !connection.admitted) return;
        try {
          await connection.link.syncRoster();
        } catch {
          this.fail(peerId, "roster_failed", connection);
        }
      }),
    );
  }

  private drop(peerId: string): void {
    const connection = this.links.get(peerId);
    if (!connection) return;
    this.links.delete(peerId);
    clearTimeout(connection.deadline);
    clearInterval(connection.heartbeat);
    connection.link.close();
    if (this.mode === "guest") {
      this.connecting = false;
      this.request = undefined;
    }
    this.emit({ type: "disconnected", peerId });
  }

  private fail(peerId: string, code: string, expected?: Connection): void {
    if (expected && this.links.get(peerId) !== expected) return;
    this.emit({ type: "error", code, peerId });
    if (this.mode === "guest" && this.connecting) {
      clearTimeout(this.connectDeadline);
      this.connecting = false;
      this.request = undefined;
    }
    this.drop(peerId);
    void this.disconnect(peerId);
  }

  private async disconnect(peerId: string): Promise<void> {
    try {
      await this.options.native!.disconnect(peerId);
    } catch {
      this.emit({ type: "error", code: "disconnect_failed", peerId });
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    ++this.generation;
    clearTimeout(this.connectDeadline);
    this.subscription?.remove();
    this.subscription = undefined;
    for (const peerId of this.links.keys()) this.drop(peerId);
    this.endpoints.clear();
    this.connecting = false;
    this.request = undefined;
    const wasActive = this.mode !== undefined;
    this.mode = undefined;
    if (wasActive) {
      this.stopping = true;
      try {
        this.stopPromise = this.options.native!.stop();
        await this.stopPromise;
      } finally {
        this.stopping = false;
        this.stopPromise = undefined;
      }
    }
  }
}
