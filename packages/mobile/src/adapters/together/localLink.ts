import {
  TogetherJournal,
  type TogetherJournalEntry,
} from "../storage/togetherJournal";
import { TogetherLocalLobby, type LocalJoinRequest } from "./localLobby";
import { type LocalCommand } from "./localStore";
import { readOwnerCommand } from "./localCommand";
import { LocalSecureChannel } from "./security/channel";
import { object, uuid, hash } from "./security/schema";
import {
  requestHash,
  type OfflineRoster,
  type Signed,
} from "./security/identity";

export type LocalLinkEvent =
  | "authenticated"
  | "approval-required"
  | "roster"
  | "command"
  | "receipt"
  | "heartbeat";

/**
 * One authenticated ordered native connection. No plaintext application traffic.
 * Native peer IDs only route bytes; the channel credential identifies the athlete.
 * Call close on native disconnect. Reconnect uses a NEW channel and resendOwn.
 */
export class TogetherLocalLink {
  private writes: Promise<void> = Promise.resolve();
  private reads: Promise<unknown> = Promise.resolve();
  private closed = false;
  private pending?: LocalJoinRequest;
  private queuedReads = 0;
  private queuedWrites = 0;
  private inFlight?: LocalCommand;
  private commandTimer?: ReturnType<typeof setTimeout>;
  private lastCommandSentAt = -Infinity;
  constructor(
    private readonly channel: LocalSecureChannel,
    private readonly lobby: TogetherLocalLobby,
    private readonly journal: TogetherJournal,
    private readonly sendFrame: (frame: string) => Promise<void>,
  ) {
    const pin = lobby.pin;
    if (
      journal.accountId !== lobby.store.accountId ||
      channel.sessionId !== pin.sessionId ||
      channel.hostUserId !== pin.hostUserId ||
      channel.hostDeviceId !== pin.hostDeviceId ||
      (channel.role === "host") !== lobby.isHost ||
      requestHash(channel.ownCredential) !== requestHash(lobby.ownCredential)
    )
      throw new Error("Wrong channel composition");
  }

  start(): Promise<void> {
    return this.write(this.channel.start());
  }

  get ready(): boolean {
    return !this.closed && this.channel.ready;
  }
  get pendingRequest(): LocalJoinRequest | undefined {
    return this.pending && JSON.parse(JSON.stringify(this.pending));
  }

  private write(frame: string): Promise<void> {
    if (++this.queuedWrites > 16) {
      this.queuedWrites--;
      this.close();
      return Promise.reject(new Error("Write queue full"));
    }
    const write = this.writes.then(async () => {
      if (this.closed) throw new Error("Link closed");
      await this.sendFrame(frame);
    });
    this.writes = write
      .catch(() => {
        this.close();
      })
      .finally(() => {
        this.queuedWrites--;
      });
    return write;
  }

  private send(message: unknown): Promise<void> {
    return this.write(this.channel.encrypt(JSON.stringify(message)));
  }

  close(): void {
    this.closed = true;
    if (this.commandTimer !== undefined) clearTimeout(this.commandTimer);
    this.commandTimer = undefined;
    this.channel.close();
  }

  receive(frame: string): Promise<LocalLinkEvent> {
    if (++this.queuedReads > 16) {
      this.queuedReads--;
      this.close();
      return Promise.reject(new Error("Read queue full"));
    }
    const read = this.reads.then(() => this.handle(frame));
    this.reads = read
      .catch(() => {
        this.close();
      })
      .finally(() => {
        this.queuedReads--;
      });
    return read;
  }

  private async handle(frame: string): Promise<LocalLinkEvent> {
    if (this.closed) throw new Error("Link closed");
    if (!this.channel.ready) {
      const reply = this.channel.receiveHandshake(frame);
      if (reply) await this.write(reply);
      return "authenticated";
    }
    const message: unknown = JSON.parse(this.channel.decrypt(frame));
    if (!message || typeof message !== "object")
      throw new Error("Invalid lobby message");
    const m = message as Record<string, unknown>;
    const peer = this.channel.peerCredential!;
    if (object(m, ["kind"]) && (m.kind === "ping" || m.kind === "pong")) {
      if (m.kind === "ping") await this.send({ kind: "pong" });
      return "heartbeat";
    }
    if (object(m, ["kind", "request"]) && m.kind === "join") {
      if (!object(m.request, ["credential", "consent"], ["friendship"]))
        throw new Error("Invalid join request");
      const result = this.lobby.admit(
        m.request as unknown as LocalJoinRequest,
        peer,
      );
      if (result.status === "approval-required") {
        this.pending = m.request as unknown as LocalJoinRequest;
        await this.send({ kind: "approval-required" });
        return "approval-required";
      }
      this.pending = undefined;
      await this.syncRoster();
      return "roster";
    }
    if (
      object(m, ["kind"]) &&
      m.kind === "approval-required" &&
      !this.lobby.isHost
    )
      return "approval-required";
    if (
      object(m, ["kind", "roster"]) &&
      m.kind === "roster" &&
      !this.lobby.isHost
    ) {
      this.lobby.accept(m.roster as Signed<OfflineRoster>);
      return "roster";
    }
    const member = this.lobby.member(peer);
    if (object(m, ["kind", "command"]) && m.kind === "command") {
      const p = readOwnerCommand(m.command, peer);
      if (
        p.sessionId !== this.lobby.pin.sessionId ||
        p.executionId !== member.consent.payload.executionId
      )
        throw new Error("Wrong peer execution");
      const command = m.command as LocalCommand;
      this.lobby.store.receive(peer.payload.userId, command);
      // Only reached after the receiver transaction has committed successfully.
      await this.send({
        kind: "receipt",
        sessionId: p.sessionId,
        executionId: p.executionId,
        commandId: p.commandId,
        commandHash: requestHash(command),
      });
      return "command";
    }
    if (
      object(m, [
        "kind",
        "sessionId",
        "executionId",
        "commandId",
        "commandHash",
      ]) &&
      m.kind === "receipt" &&
      uuid(m.commandId) &&
      uuid(m.sessionId) &&
      uuid(m.executionId) &&
      hash(m.commandHash)
    ) {
      const own = this.lobby.member(this.lobby.ownCredential);
      if (
        m.sessionId !== this.lobby.pin.sessionId ||
        m.executionId !== own.consent.payload.executionId
      )
        throw new Error("Wrong receipt execution");
      const command = this.journal
        .list(m.sessionId, m.executionId)
        .find((c) => c.commandId === m.commandId);
      if (!command || requestHash(this.wireCommand(command)) !== m.commandHash)
        throw new Error("Unknown receipt");
      this.journal.recordPeerReceipt(command, peer.payload.userId);
      // A delayed duplicate receipt must never release a different command.
      if (this.inFlight?.commandId === command.commandId) {
        this.inFlight = undefined;
        await this.deliverNext();
      }
      return "receipt";
    }
    throw new Error("Invalid lobby message");
  }

  join(request: LocalJoinRequest): Promise<void> {
    if (
      this.lobby.isHost ||
      requestHash(request.credential) !== requestHash(this.lobby.ownCredential)
    )
      throw new Error("Wrong join identity");
    return this.send({ kind: "join", request });
  }

  /** Invoked only by the explicit host approval action; validates the request again. */
  async approve(request: LocalJoinRequest): Promise<void> {
    if (!this.channel.ready) throw new Error("Not authenticated");
    this.lobby.admit(request, this.channel.peerCredential!, true);
    this.pending = undefined;
    await this.syncRoster();
  }

  heartbeat(): Promise<void> {
    return this.send({ kind: "ping" });
  }

  async syncRoster(): Promise<void> {
    if (!this.lobby.isHost || !this.channel.ready)
      throw new Error("Host connection required");
    this.lobby.member(this.channel.peerCredential!);
    for (const roster of this.lobby.store.rosters(this.lobby.pin.sessionId))
      await this.send({ kind: "roster", roster });
  }

  /** Resolves after durable local save and an initial send/schedule, never waits
   * for a receipt. A busy link retains the command in its durable queue. */
  async sendOwn(command: LocalCommand): Promise<void> {
    const p = readOwnerCommand(command, this.lobby.ownCredential);
    const own = this.lobby.member(this.lobby.ownCredential);
    if (
      p.sessionId !== this.lobby.pin.sessionId ||
      p.executionId !== own.consent.payload.executionId
    )
      throw new Error("Wrong owner execution");
    this.journal.append(command);
    this.lobby.member(this.channel.peerCredential!);
    await this.deliverNext();
  }

  /** Retries preserve exact signed bytes and IDs. Receipt loss cannot lose the log. */
  async resendOwn(): Promise<void> {
    await this.deliverNext(true);
  }

  /** Stop-and-wait delivery bounds peer queues regardless of offline backlog.
   * Commands are paced to ten per second; receipts and heartbeat remain free
   * to pass while waiting. Timer callbacks never block the incoming read queue. */
  private async deliverNext(retry = false): Promise<void> {
    if (this.closed) throw new Error("Link closed");
    const own = this.lobby.member(this.lobby.ownCredential);
    const peer = this.channel.peerCredential!;
    this.lobby.member(peer);
    if (this.inFlight && !retry) return;
    if (this.commandTimer !== undefined) return;
    const command =
      this.inFlight ??
      this.journal
        .list(this.lobby.pin.sessionId, own.consent.payload.executionId)
        .find((entry) => !entry.peerReceipts.includes(peer.payload.userId));
    if (!command) return;
    const delay = Math.max(
      0,
      100 - (performance.now() - this.lastCommandSentAt),
    );
    if (delay > 0) {
      this.commandTimer = setTimeout(() => {
        this.commandTimer = undefined;
        void this.deliverNext(retry).catch(() => this.close());
      }, delay);
      return;
    }
    const wire = this.wireCommand(command);
    // Journals can survive process restarts; revalidate before replaying bytes.
    readOwnerCommand(wire, this.lobby.ownCredential);
    this.inFlight = wire;
    this.lastCommandSentAt = performance.now();
    await this.send({ kind: "command", command: wire });
  }

  private wireCommand(
    command: LocalCommand | TogetherJournalEntry,
  ): LocalCommand {
    const { commandId, sessionId, executionId, payload } = command;
    return { commandId, sessionId, executionId, payload };
  }
}
