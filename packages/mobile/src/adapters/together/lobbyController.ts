import { encode64 } from "./security/encoding";
import {
  TogetherLobbyBrowser,
  signSummary,
  type LobbySummary,
} from "./lobbyDiscovery";
import type {
  TogetherLobbyAudience,
  TogetherLobbyPort,
  TogetherLobbySnapshot,
} from "../../domain/ports/togetherLobby.port";
import type {
  ReadyIdentity,
  TogetherProvisioningPort,
} from "../../domain/ports/togetherProvisioning.port";
import type { TogetherLanNative } from "../../../modules/together-lan";
import {
  TogetherJournal,
  type TogetherJournalDatabase,
} from "../storage/togetherJournal";
import { TogetherLocalStore, type HostPin } from "./localStore";
import { TogetherLocalLobby, type LocalJoinRequest } from "./localLobby";
import { TogetherLanSession, type LanSessionEvent } from "./lanSession";
import { LocalSecureChannel } from "./security/channel";
import {
  requestHash,
  signPayload,
  verifyCredential,
  type JoinConsent,
} from "./security/identity";
import {
  createLobbyInvitation,
  readLobbyInvitation,
  type LobbyInvitation,
} from "./lobbyInvitation";

export interface TogetherLobbyControllerOptions {
  enabled?: boolean;
  provisioning: TogetherProvisioningPort;
  native: TogetherLanNative | null;
  /** Composition supplies an environment-specific database; rows are account-scoped. */
  database: TogetherJournalDatabase;
  randomBytes(length: number): Uint8Array;
  randomUUID(): string;
  now?: () => number;
  deniedPairs?: () => readonly (readonly [string, string])[];
}
interface Resources {
  identity: ReadyIdentity;
  lobby: TogetherLocalLobby;
  journal: TogetherJournal;
  session?: TogetherLanSession;
  request?: LocalJoinRequest;
}
/** Foreground, explicit-action coordinator. Discovery routes bytes only after a signed pin. */
export class TogetherLobbyController implements TogetherLobbyPort {
  private snapshot: TogetherLobbySnapshot;
  private listeners = new Set<() => void>();
  private account: string | null = null;
  private active = true;
  private online = false;
  private disposed = false;
  private generation = 0;
  private resources?: Resources;
  private selected?: LobbyInvitation;
  private browser?: TogetherLobbyBrowser;
  private discovered = new Map<string, LobbySummary>();
  private identity?: ReadyIdentity;
  private nativeQueue: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setTimeout>;
  constructor(private readonly options: TogetherLobbyControllerOptions) {
    this.snapshot = {
      phase: options.enabled ? "idle" : "disabled",
      members: [],
      pending: [],
    };
  }
  getSnapshot = (): TogetherLobbySnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(change: Partial<TogetherLobbySnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* UI cannot prevent teardown. */
      }
    }
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private current(generation: number) {
    return generation === this.generation && !this.disposed && this.active;
  }
  private enqueue(action: () => Promise<void>) {
    const next = this.nativeQueue.then(action);
    this.nativeQueue = next.catch(() => {});
    return next;
  }
  private allowed() {
    return (
      !!this.options.enabled && !!this.account && this.active && !this.disposed
    );
  }
  invalidateAuthorization(code: string): void {
    if (this.options.enabled && this.account)
      this.failure(new Error(code), this.generation);
  }
  setOnline(online: boolean): void {
    this.online = online;
  }
  setAccount(userId: string | null): void {
    if (this.account === userId) return;
    this.account = userId;
    void this.cancel();
  }
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) void this.cancel();
  }
  private clearTimers() {
    clearTimeout(this.timer);
    clearTimeout(this.expiry);
  }
  async cancel(): Promise<void> {
    const cancelledGeneration = ++this.generation;
    this.clearTimers();
    const resources = this.resources;
    this.resources = undefined;
    const browser = this.browser;
    this.browser = undefined;
    this.discovered.clear();
    this.selected = undefined;
    this.identity?.seed.fill(0);
    this.identity = undefined;
    resources?.identity.seed.fill(0);
    resources?.lobby.dispose();
    this.snapshot = {
      phase: this.options.enabled ? "idle" : "disabled",
      members: [],
      pending: [],
    };
    this.publish({});
    // Closing is durable, but owner journal data is deliberately retained.
    try {
      if (resources) {
        const { store, pin } = resources.lobby;
        // A failed discovery is retryable; terminal closure starts at own admission.
        if (
          store
            .current(pin.sessionId)
            ?.payload.members.some(
              (member) => member.credential.payload.userId === store.accountId,
            )
        )
          store.close(pin.sessionId);
      }
    } catch {
      this.publish({ phase: "unavailable", error: "storage" });
    }
    await this.enqueue(async () => {
      await browser?.stop();
      await resources?.session?.stop();
    }).catch(() => {
      if (this.generation === cancelledGeneration)
        this.publish({ phase: "unavailable", error: "stop-failed" });
    });
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    await this.cancel();
    this.listeners.clear();
  }
  private async prepare(
    generation: number,
  ): Promise<ReadyIdentity | undefined> {
    const result = await this.options.provisioning.prepare({
      online: this.online,
    });
    if (!result.ok) {
      if (this.current(generation))
        this.publish({ phase: "unavailable", error: result.error.code });
      return;
    }
    if (!this.current(generation)) {
      result.value.seed.fill(0);
      return;
    }
    if (result.value.credential.payload.userId !== this.account) {
      result.value.seed.fill(0);
      this.publish({ phase: "unavailable", error: "signed-out" });
      return;
    }
    this.identity = result.value;
    return result.value;
  }
  private async begin(): Promise<number | undefined> {
    const cleanup = this.cancel();
    const generation = this.generation;
    await cleanup;
    if (!this.allowed() || !this.current(generation)) return;
    this.publish({ phase: "preparing", error: undefined });
    return generation;
  }
  async host(
    workoutName: string,
    audience: TogetherLobbyAudience = "invite-only",
  ): Promise<void> {
    const generation = await this.begin();
    if (generation === undefined) return;
    try {
      const identity = await this.prepare(generation);
      if (!identity) return;
      const pin = {
        sessionId: this.options.randomUUID(),
        hostUserId: identity.credential.payload.userId,
        hostDeviceId: identity.deviceId,
      };
      const invitationToken =
        audience === "invite-only"
          ? encode64(this.options.randomBytes(32), true)
          : undefined;
      const invitation = createLobbyInvitation(
        pin,
        workoutName,
        identity.credential,
        identity.seed,
        { audience, ...(invitationToken ? { invitationToken } : {}) },
      );
      const resources = this.createResources(
        pin,
        identity,
        audience,
        invitationToken,
      );
      resources.lobby.start(this.consent(pin, identity));
      this.publish({
        role: "host",
        audience,
        invitation,
        selection: {
          hostUserId: pin.hostUserId,
          workoutName: workoutName.trim(),
        },
      });
      await this.start(resources, generation);
      if (this.current(generation)) {
        this.publish({ phase: "hosting" });
        this.roster();
      }
    } catch (error) {
      this.failure(error, generation);
    }
  }
  private deniedHost(hostUserId: string) {
    const pairs = [
      ...(this.options.deniedPairs?.() ?? []),
      ...(this.options.provisioning.deniedPairs?.([
        this.account!,
        hostUserId,
      ]) ?? []),
    ];
    return (
      hostUserId === this.account ||
      pairs.some(
        ([a, b]) =>
          (a === this.account && b === hostUserId) ||
          (b === this.account && a === hostUserId),
      )
    );
  }
  async browse(): Promise<void> {
    const generation = await this.begin();
    if (generation === undefined) return;
    try {
      const identity = await this.prepare(generation);
      if (!identity) return;
      if (!this.options.native)
        throw new Error("Together LAN requires a compatible native build");
      const browser = new TogetherLobbyBrowser({
        native: this.options.native,
        trustedKeys: identity.trustedKeys,
        randomBytes: this.options.randomBytes,
        now: () => this.now(),
        onChange: (summaries) => {
          if (!this.current(generation)) return;
          this.discovered.clear();
          for (const summary of summaries)
            if (!this.deniedHost(summary.hostUserId))
              this.discovered.set(summary.sessionId, summary);
          this.publish({
            discovered: [...this.discovered.values()].map(
              ({ sessionId, hostUserId, workoutName, memberCount }) => ({
                sessionId,
                hostUserId,
                workoutName,
                memberCount,
              }),
            ),
          });
        },
        onError: (code) => this.failure(new Error(code), generation),
      });
      this.browser = browser;
      this.publish({ phase: "browsing", role: "guest", discovered: [] });
      this.watchExpiry(identity, Infinity, generation);
      await this.enqueue(async () => {
        if (this.current(generation)) await browser.start();
      });
    } catch (error) {
      this.failure(error, generation);
    }
  }
  async selectDiscovered(sessionId: string): Promise<void> {
    const summary = this.discovered.get(sessionId);
    if (
      !this.allowed() ||
      this.snapshot.phase !== "browsing" ||
      !summary ||
      !this.identity
    )
      return;
    const generation = this.generation;
    try {
      if (summary.expiresAt <= this.now()) throw new Error("discovery-expired");
      if (this.deniedHost(summary.hostUserId))
        throw new Error("host-unavailable");
      verifyCredential(
        summary.credential,
        this.identity.trustedKeys,
        this.now(),
      );
      const browser = this.browser;
      this.browser = undefined;
      await this.enqueue(async () => {
        await browser?.stop();
      });
      if (!this.current(generation)) return;
      if (summary.expiresAt <= this.now()) throw new Error("discovery-expired");
      if (this.deniedHost(summary.hostUserId))
        throw new Error("host-unavailable");
      this.selected = {
        kind: "together-invitation-v2",
        audience: "open",
        sessionId: summary.sessionId,
        hostUserId: summary.hostUserId,
        hostDeviceId: summary.hostDeviceId,
        credential: summary.credential,
        workoutName: summary.workoutName,
      };
      this.discovered.clear();
      this.publish({
        phase: "selected",
        audience: "open",
        discovered: [],
        selection: {
          hostUserId: summary.hostUserId,
          workoutName: summary.workoutName,
        },
      });
      this.watchExpiry(
        this.identity,
        summary.credential.payload.expiresAt,
        generation,
      );
    } catch (error) {
      this.failure(error, generation);
    }
  }
  async selectInvite(text: string): Promise<void> {
    const generation = await this.begin();
    if (generation === undefined) return;
    try {
      const identity = await this.prepare(generation);
      if (!identity) return;
      const selected = readLobbyInvitation(
        text,
        identity.trustedKeys,
        this.now(),
      );
      if (this.deniedHost(selected.hostUserId))
        throw new Error("own-invitation");
      this.selected = selected;
      this.publish({
        phase: "selected",
        audience: selected.audience ?? "open",
        role: "guest",
        selection: {
          hostUserId: selected.hostUserId,
          workoutName: selected.workoutName,
        },
      });
      this.watchExpiry(
        identity,
        selected.credential.payload.expiresAt,
        generation,
      );
    } catch (error) {
      this.failure(error, generation);
    }
  }
  async join(): Promise<void> {
    if (
      !this.allowed() ||
      this.snapshot.phase !== "selected" ||
      !this.selected ||
      !this.identity
    )
      return;
    const generation = this.generation;
    const identity = this.identity,
      selected = this.selected;
    this.publish({ phase: "preparing", error: undefined });
    try {
      verifyCredential(selected.credential, identity.trustedKeys, this.now());
      const friendship = await this.options.provisioning.friendship(
        selected.hostUserId,
        { online: this.online },
      );
      if (!this.current(generation)) return;
      if (!friendship.ok) throw new Error(friendship.error.code);
      const resources = this.createResources(selected, identity);
      resources.request = {
        credential: identity.credential,
        consent: this.consent(selected, identity),
        ...(friendship.value ? { friendship: friendship.value } : {}),
        ...(selected.invitationToken
          ? { invitationToken: selected.invitationToken }
          : {}),
      };
      await this.start(resources, generation);
    } catch (error) {
      this.failure(error, generation);
    }
  }
  private consent(pin: HostPin, identity: ReadyIdentity) {
    return signPayload<JoinConsent>(
      {
        kind: "together-consent-v1",
        sessionId: pin.sessionId,
        hostUserId: pin.hostUserId,
        hostDeviceId: pin.hostDeviceId,
        userId: identity.credential.payload.userId,
        deviceId: identity.deviceId,
        executionId: this.options.randomUUID(),
        nonce: this.options.randomUUID(),
        consentVersion: "together-v1",
        consentAccepted: true,
      },
      identity.seed,
    );
  }
  private createResources(
    pin: HostPin,
    identity: ReadyIdentity,
    audience: TogetherLobbyAudience = "open",
    invitationToken?: string,
  ): Resources {
    const store = new TogetherLocalStore(this.options.database, this.account!);
    const lobby = new TogetherLocalLobby(store, {
      ...pin,
      ...identity,
      audience,
      ...(invitationToken
        ? { invitationTokenHash: requestHash(invitationToken) }
        : {}),
      invitedUserIds: [],
      deniedPairs: (users) => [
        ...(this.options.deniedPairs?.() ?? []),
        ...(this.options.provisioning.deniedPairs?.(users) ?? []),
      ],
      now: () => this.now(),
    });
    const resources = {
      identity,
      lobby,
      journal: new TogetherJournal(this.options.database, this.account!),
    };
    this.resources = resources;
    return resources;
  }
  private async start(resources: Resources, generation: number) {
    await this.enqueue(async () => {
      if (!this.current(generation)) return;
      const session = new TogetherLanSession({
        enabled: this.options.enabled,
        native: this.options.native,
        lobby: resources.lobby,
        journal: resources.journal,
        channelFactory: (role) =>
          new LocalSecureChannel({
            role,
            ...resources.lobby.pin,
            ...resources.identity,
            randomBytes: this.options.randomBytes,
            now: () => this.now(),
          }),
        probeSummary: (nonce) => {
          if (!this.current(generation) || this.snapshot.audience !== "open")
            return;
          return signSummary(
            resources.lobby.pin,
            resources.identity,
            this.snapshot.selection!.workoutName,
            resources.lobby.store.current(resources.lobby.pin.sessionId)!
              .payload.members.length,
            nonce,
            this.now(),
          );
        },
        onEvent: (event) => {
          if (this.current(generation))
            this.event(event, resources, generation);
        },
      });
      resources.session = session;
      this.watchExpiry(
        resources.identity,
        this.selected?.credential.payload.expiresAt ?? Infinity,
        generation,
      );
      if (resources.lobby.isHost) await session.startHost();
      else {
        this.publish({ phase: "searching" });
        this.timer = setTimeout(
          () => this.failure(new Error("unreachable-host"), generation),
          10_000,
        );
        await session.startDiscovery();
      }
    });
  }
  private watchExpiry(
    identity: ReadyIdentity,
    hostExpiry: number,
    generation: number,
  ) {
    clearTimeout(this.expiry);
    this.expiry = setTimeout(
      () => this.failure(new Error("expired"), generation),
      Math.max(
        0,
        Math.min(identity.credential.payload.expiresAt, hostExpiry) -
          this.now(),
      ),
    );
  }
  private roster() {
    const resources = this.resources;
    if (!resources) return;
    const roster = resources.lobby.store.current(resources.lobby.pin.sessionId);
    const members =
      roster?.payload.members.map((member) => ({
        userId: member.credential.payload.userId,
        host: member.admission === "host",
      })) ?? [];
    this.publish({
      members,
      pending: this.snapshot.pending.filter(
        (p) => !members.some((m) => m.userId === p.userId),
      ),
    });
  }
  private event(
    event: LanSessionEvent,
    resources: Resources,
    generation: number,
  ) {
    if (event.type === "discovered" && this.snapshot.phase === "searching") {
      clearTimeout(this.timer);
      this.publish({ phase: "connecting" });
      void resources
        .session!.connect(event.endpointId, resources.request!)
        .catch((error) => this.failure(error, generation));
    } else if (event.type === "approval-required") {
      if (resources.lobby.isHost && event.request)
        this.publish({
          pending: [
            ...this.snapshot.pending.filter((p) => p.peerId !== event.peerId),
            {
              peerId: event.peerId,
              userId: event.request.credential.payload.userId,
            },
          ],
        });
      else this.publish({ phase: "pending-approval" });
    } else if (event.type === "admitted" || event.type === "roster") {
      this.roster();
      if (
        !resources.lobby.isHost &&
        this.snapshot.members.some((m) => m.userId === this.account)
      )
        this.publish({ phase: "joined", error: undefined });
    } else if (event.type === "disconnected") {
      this.publish({
        pending: this.snapshot.pending.filter((p) => p.peerId !== event.peerId),
      });
      if (
        !resources.lobby.isHost &&
        !["unavailable", "full"].includes(this.snapshot.phase)
      )
        this.publish({ phase: "reconnecting", error: "disconnected" });
    } else if (event.type === "full" || event.type === "declined") {
      if (!resources.lobby.isHost)
        this.failure(new Error(event.type), generation);
    } else if (event.type === "error") {
      if (resources.lobby.isHost && event.peerId)
        this.publish({
          pending: this.snapshot.pending.filter(
            (p) => p.peerId !== event.peerId,
          ),
        });
      else this.failure(new Error(event.code), generation);
    }
  }
  private failure(error: unknown, generation: number) {
    if (!this.current(generation)) return;
    const code = error instanceof Error ? error.message : "unavailable";
    // Invalidate handlers before stopping; keep durable logs, never keep signing seeds on failure.
    const cleanup = this.cancel();
    const failedGeneration = this.generation;
    this.publish({
      phase: code === "full" ? "full" : "unavailable",
      error: code === "CREDENTIAL_EXPIRED" ? "expired" : code,
    });
    void cleanup.then(() => {
      if (this.generation === failedGeneration) this.publish({});
    });
  }
  async approve(peerId: string): Promise<void> {
    const generation = this.generation;
    try {
      await this.resources?.session?.approve(peerId);
      if (this.current(generation)) this.roster();
    } catch {
      if (this.current(generation)) this.publish({ error: "approval-failed" });
    }
  }
  async decline(peerId: string): Promise<void> {
    const generation = this.generation;
    try {
      await this.resources?.session?.decline(peerId);
    } catch {
      if (this.current(generation)) this.publish({ error: "decline-failed" });
    }
  }
  async reconnect(): Promise<void> {
    const resources = this.resources;
    if (
      !this.allowed() ||
      !resources ||
      resources.lobby.isHost ||
      this.snapshot.phase !== "reconnecting"
    )
      return;
    const generation = ++this.generation;
    this.publish({ phase: "reconnecting", error: undefined });
    try {
      await this.enqueue(async () => {
        await resources.session?.stop();
      });
      if (this.current(generation)) await this.start(resources, generation);
    } catch (error) {
      this.failure(error, generation);
    }
  }
}
