import { commandFromEnvelope, readOwnerCommand } from "../localCommand";
import type {
  TogetherOfflineApi,
  TogetherOfflineApiError,
  TogetherRecoveryCommand,
} from "../../../domain/ports/togetherOfflineApi.port";
import type {
  ProvisioningError,
  ProvisioningErrorCode,
  ReadyIdentity,
  TogetherProvisioningPort,
  TogetherAccessSnapshot,
} from "../../../domain/ports/togetherProvisioning.port";
import type {
  FriendshipEvidence,
  Credential,
  Signed,
} from "../../../domain/models/togetherIdentity";
import {
  fail,
  ok,
  type ApiError,
  type Result,
} from "../../../shared/errors/result";
import type { TogetherJournalDatabase } from "../../storage/togetherJournal";
import type { DeviceSecretStore } from "../security/secureSeed";
import {
  OFFLINE_CREDENTIAL_TTL_MS,
  publicKeyPem,
  requestHash,
  signPayload,
  verifyCredential,
} from "../security/identity";
import { uuid } from "../security/schema";
import { ProvisioningCache, type Snapshot } from "./cache";
import { device, randomUuid, type Device } from "./device";
import { validateFriend, validateTrust } from "./validation";
export interface TogetherProvisioningOptions {
  api: TogetherOfflineApi;
  db: TogetherJournalDatabase;
  secrets: DeviceSecretStore;
  environment: string;
  randomBytes: (length: number) => Uint8Array;
  now?: () => number;
  enabled?: boolean;
}
const failure = (code: ProvisioningErrorCode) =>
  fail<ProvisioningError>({ kind: "together-provisioning", code });
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const retryableClientStatus = (status: number | undefined) =>
  status === 408 || status === 425 || status === 429;
const transient = (e: ApiError) =>
  e.code === "network" ||
  e.code === "timeout" ||
  retryableClientStatus(e.status) ||
  (e.status !== undefined && e.status >= 500 && e.status <= 599);
const authoritative = (e: ApiError) =>
  e.code === "unauthorized" ||
  e.code === "not_found" ||
  (e.status !== undefined &&
    e.status >= 400 &&
    e.status < 500 &&
    !retryableClientStatus(e.status));
/** Denial still revokes cached sharing authority; its reason must not imply payment. */
function denialCode(error: TogetherOfflineApiError): ProvisioningErrorCode {
  if (error.status === 401 || error.togetherCode === "UNAUTHENTICATED")
    return "authentication-required";
  if (error.togetherCode === "PAID_REQUIRED") return "paid-required";
  if (error.status === 404) return "service-unavailable";
  if (error.togetherCode === "DEVICE_REVOKED") return "device-revoked";
  if (error.togetherCode === "IDEMPOTENCY_MISMATCH")
    return "registration-conflict";
  if (error.togetherCode === "INVALID_PROOF") return "registration-invalid";
  return "unauthorized";
}
function errorCode(error: unknown): ProvisioningErrorCode {
  const message = error instanceof Error ? error.message : "storage";
  if (
    [
      "expired",
      "key-unavailable",
      "cancelled",
      "invalid-proof",
      "storage",
      "unauthorized",
    ].includes(message)
  )
    return message as ProvisioningErrorCode;
  if (message === "CREDENTIAL_EXPIRED") return "expired";
  if (message === "INVALID_PROOF" || message === "INVALID_ENCODING")
    return "invalid-proof";
  return "storage";
}
/** Explicit preparation only. Expiry timers revoke UI readiness; they never enrol or discover. */
export class TogetherProvisioning implements TogetherProvisioningPort {
  private accessSnapshot: TogetherAccessSnapshot = {
    accountId: null,
    state: "unavailable",
    expiresAt: null,
    error: "signed-out",
  };
  private accessListeners = new Set<() => void>();
  private accessTimer: ReturnType<typeof setTimeout> | undefined;
  getAccessSnapshot = (): TogetherAccessSnapshot => this.accessSnapshot;
  subscribeAccess = (listener: () => void): (() => void) => {
    this.accessListeners.add(listener);
    return () => {
      this.accessListeners.delete(listener);
    };
  };
  private publishAccess(snapshot: TogetherAccessSnapshot): void {
    if (this.accessTimer !== undefined) clearTimeout(this.accessTimer);
    this.accessTimer = undefined;
    this.accessSnapshot = snapshot;
    if (snapshot.state === "allowed" && snapshot.expiresAt !== null) {
      const generation = this.generation;
      this.accessTimer = setTimeout(
        () => {
          if (generation !== this.generation || this.stopped) return;
          if (snapshot.expiresAt! > this.now()) this.publishAccess(snapshot);
          else
            this.publishAccess({
              accountId: this.account,
              state: "unavailable",
              expiresAt: null,
              error: "expired",
            });
        },
        Math.min(Math.max(0, snapshot.expiresAt - this.now()), 2_147_483_647),
      );
      // Node test/service consumers must not be kept alive by readiness observation.
      (this.accessTimer as unknown as { unref?: () => void }).unref?.();
    }
    for (const listener of this.accessListeners) listener();
  }
  private publishAccessFailure(code: ProvisioningErrorCode): void {
    const locked =
      code === "paid-required" ||
      (code === "unauthorized" && this.accessSnapshot.state === "locked");
    this.publishAccess({
      accountId: this.account,
      state: locked ? "locked" : "unavailable",
      expiresAt: null,
      error: locked ? "paid-required" : code,
    });
  }
  async refreshAccess(options: { online: boolean }): Promise<void> {
    if (this.pending) {
      // Explicit retry abandons a hung request. Guards prevent its late response
      // from updating evidence; active lobby keys and owner journals stay intact.
      this.generation++;
      this.pending = null;
      this.publishAccess(this.accessSnapshot);
    }
    if (this.accessSnapshot.state === "unavailable")
      this.publishAccess({
        accountId: this.account,
        state: "pending",
        expiresAt: null,
      });
    const result = await this.prepare(options);
    if (result.ok) result.value.seed.fill(0);
  }
  private cache: ProvisioningCache;
  private account: string | null = null;
  private generation = 0;
  private authorizationRevision = 0;
  private friendRevisions = new Map<string, number>();
  private stopped = false;
  private storageFailed = false;
  private activeSeeds = new Set<Uint8Array>();
  private pending: {
    generation: number;
    consumers: number;
    online: boolean;
    promise: Promise<Result<ReadyIdentity, ProvisioningError>>;
  } | null = null;
  private now: () => number;
  constructor(private options: TogetherProvisioningOptions) {
    const url = new URL(options.environment);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      options.environment.length > 512
    )
      throw new Error("Invalid Together environment");
    this.options = {
      ...options,
      environment: `${url.origin}${url.pathname.replace(/\/$/, "")}`,
    };
    this.cache = new ProvisioningCache(options.db);
    this.now = options.now ?? Date.now;
  }
  private scope(account: string): string {
    return requestHash({ account, environment: this.options.environment });
  }
  setAccount(account: string | null): void {
    if (account !== null && !uuid(account))
      throw new Error("Invalid Together account");
    if (account === this.account) return;
    const previous = this.account;
    this.account = account;
    this.generation++;
    this.pending = null;
    this.publishAccess({
      accountId: account,
      state: account ? "pending" : "unavailable",
      expiresAt: null,
      ...(account ? {} : { error: "signed-out" as const }),
    });
    for (const seed of this.activeSeeds) seed.fill(0);
    this.activeSeeds.clear();
    if (previous !== null) {
      try {
        this.cache.block(this.scope(previous));
      } catch {
        this.storageFailed = true;
      }
    }
  }
  dispose(): void {
    this.setAccount(null);
    this.stopped = true;
    if (this.accessTimer !== undefined) clearTimeout(this.accessTimer);
    this.accessTimer = undefined;
    this.accessListeners.clear();
  }
  private guard(generation: number): void {
    if (this.stopped || this.generation !== generation)
      throw new Error("cancelled");
  }
  private access(): ProvisioningErrorCode | null {
    if (!this.options.enabled) return "disabled";
    if (this.stopped) return "cancelled";
    if (this.storageFailed) return "storage";
    if (!this.account) return "signed-out";
    return null;
  }
  async prepare(options: {
    online: boolean;
  }): Promise<Result<ReadyIdentity, ProvisioningError>> {
    const generation = this.generation;
    const revision = this.authorizationRevision;
    let result = await this.prepareIdentity(options);
    if (
      result.ok &&
      (generation !== this.generation ||
        this.stopped ||
        revision !== this.authorizationRevision ||
        result.value.credential.payload.expiresAt <= this.now())
    ) {
      result.value.seed.fill(0);
      result = failure(
        generation !== this.generation || this.stopped
          ? "cancelled"
          : revision !== this.authorizationRevision
            ? "unauthorized"
            : "expired",
      );
    }
    if (generation === this.generation && !this.stopped) {
      if (result.ok)
        this.publishAccess({
          accountId: this.account,
          state: "allowed",
          expiresAt: result.value.credential.payload.expiresAt,
        });
      else this.publishAccessFailure(result.error.code);
    }
    return result;
  }
  private async prepareIdentity({
    online,
  }: {
    online: boolean;
  }): Promise<Result<ReadyIdentity, ProvisioningError>> {
    const denied = this.access();
    if (denied) return failure(denied);
    const generation = this.generation;
    if (!this.pending || this.pending.generation !== generation) {
      const promise = this.prepareCurrent(this.account!, generation, online);
      this.pending = { generation, promise, consumers: 0, online };
    }
    const operation = this.pending;
    operation.consumers++;
    try {
      const result = await operation.promise;
      if (this.generation !== generation || this.stopped)
        return failure("cancelled");
      if (!online || operation.online) {
        if (!result.ok) return result;
        // Promise completion is another asynchronous boundary: a peer request may
        // have revoked authorization since prepareCurrent produced its result.
        return ok(
          this.ready(
            this.cache.read(this.scope(this.account!)),
            { deviceId: result.value.deviceId, seed: result.value.seed },
            this.account!,
            this.now(),
          ),
        );
      }
      // Detach the completed offline flight before upgrading. Other online
      // waiters must join the new online flight, not repeatedly rejoin this one.
      // Its remaining consumers still own their result and seed cleanup below.
      if (this.pending === operation) this.pending = null;
    } catch (error) {
      const code = errorCode(error);
      if (code === "storage") this.storageFailed = true;
      return failure(code);
    } finally {
      operation.consumers--;
      if (operation.consumers === 0) {
        if (this.pending === operation) this.pending = null;
        void operation.promise.then((result) => {
          if (result.ok) result.value.seed.fill(0);
        });
      }
    }
    return this.prepareIdentity({ online: true });
  }
  async signRecovery(
    credential: Signed<Credential>,
    commands: readonly TogetherRecoveryCommand[],
  ): Promise<Result<Signed<TogetherRecoveryCommand>[], ProvisioningError>> {
    if (this.stopped) return failure("cancelled");
    if (!this.account) return failure("signed-out");
    if (
      credential.payload.userId !== this.account ||
      !commands.length ||
      commands.length > 100
    )
      return failure("invalid-proof");
    const account = this.account,
      generation = this.generation;
    let identity: Device | undefined;
    try {
      // No cache/paid entitlement check: expired sharing authority still owns its journal.
      identity = await device(
        this.options.secrets,
        this.scope(account),
        account,
        this.options.environment,
        credential.payload.deviceId,
        false,
        this.options.randomBytes,
      );
      this.activeSeeds.add(identity.seed);
      this.guard(generation);
      if (publicKeyPem(identity.seed) !== credential.payload.publicKey)
        return failure("invalid-proof");
      const signed = commands.map((command) => {
        const envelope = signPayload(command, identity!.seed);
        readOwnerCommand(commandFromEnvelope(envelope), credential);
        return envelope;
      });
      return ok(signed);
    } catch (error) {
      return failure(errorCode(error));
    } finally {
      if (identity) {
        identity.seed.fill(0);
        this.activeSeeds.delete(identity.seed);
      }
    }
  }
  private ready(
    snapshot: Snapshot,
    identity: Device,
    account: string,
    now: number,
  ): ReadyIdentity {
    if (snapshot.blocked) throw new Error("unauthorized");
    if (!snapshot.credential) throw new Error("invalid-proof");
    if (now < snapshot.observedAt) throw new Error("expired");
    validateTrust(snapshot.trustedKeys, OFFLINE_CREDENTIAL_TTL_MS);
    const credential = verifyCredential(
      snapshot.credential,
      snapshot.trustedKeys,
      now,
    );
    if (
      credential.userId !== account ||
      credential.deviceId !== identity.deviceId ||
      credential.publicKey !== publicKeyPem(identity.seed)
    )
      throw new Error("invalid-proof");
    return {
      credential: copy(snapshot.credential),
      trustedKeys: copy(snapshot.trustedKeys),
      deviceId: identity.deviceId,
      seed: identity.seed.slice(),
    };
  }
  private async prepareCurrent(
    account: string,
    generation: number,
    online: boolean,
  ): Promise<Result<ReadyIdentity, ProvisioningError>> {
    let identity: Device | undefined;
    const authorizationRevision = this.authorizationRevision;
    try {
      const scope = this.scope(account);
      let snapshot = this.cache.read(scope);
      if (!online && !snapshot.credential) return failure("offline-unprepared");
      try {
        identity = await device(
          this.options.secrets,
          scope,
          account,
          this.options.environment,
          snapshot.deviceId,
          online,
          this.options.randomBytes,
        );
      } catch {
        return failure("key-unavailable");
      }
      this.activeSeeds.add(identity.seed);
      this.guard(generation);
      if (this.authorizationRevision !== authorizationRevision)
        return failure("unauthorized");
      snapshot = this.cache.read(scope);
      if (snapshot.deviceId === null) {
        snapshot.deviceId = identity.deviceId;
        this.cache.write(scope, snapshot);
      }
      let cached: ReadyIdentity | undefined;
      let cachedFailure: ProvisioningErrorCode = "invalid-proof";
      try {
        cached = this.ready(snapshot, identity, account, this.now());
      } catch (error) {
        cachedFailure = errorCode(error);
      }
      if (
        !online ||
        (cached && cached.credential.payload.expiresAt - this.now() > 300000)
      ) {
        if (!cached) return failure(cachedFailure);
        snapshot.observedAt = Math.max(snapshot.observedAt, this.now());
        this.cache.write(scope, snapshot);
        return ok(cached);
      }
      if (this.now() < snapshot.observedAt) return failure("expired");
      const fallback = (
        error: TogetherOfflineApiError,
      ): Result<ReadyIdentity, ProvisioningError> => {
        if (authoritative(error)) {
          this.authorizationRevision++;
          this.cache.block(scope);
          this.publishAccessFailure(denialCode(error));
          return failure(denialCode(error));
        }
        if (this.authorizationRevision !== authorizationRevision)
          return failure("unauthorized");
        snapshot = this.cache.read(scope);
        if (transient(error) && cached) {
          // Validate again after the request; a cached credential may expire in flight.
          const ready = this.ready(snapshot, identity!, account, this.now());
          snapshot.observedAt = this.now();
          this.cache.write(scope, snapshot);
          return ok(ready);
        }
        return failure("unavailable");
      };
      const trust = await this.options.api.trust();
      this.guard(generation);
      if (!trust.ok) return fallback(trust.error);
      if (this.authorizationRevision !== authorizationRevision)
        return failure("unauthorized");
      snapshot = this.cache.read(scope);
      if (this.now() < snapshot.observedAt) return failure("expired");
      const { publicKeys, maxCredentialAgeMs } = copy(trust.value);
      validateTrust(publicKeys, maxCredentialAgeMs);
      // Apply the authenticated key ring to all evidence before any network fallback.
      // Preserve the old public snapshot solely for recovery if its issuer was revoked.
      if (snapshot.credential) {
        snapshot.observedAt = this.now();
        let credentialValid = false;
        try {
          const old = verifyCredential(
            snapshot.credential,
            publicKeys,
            this.now(),
          );
          credentialValid = old.expiresAt - old.issuedAt <= maxCredentialAgeMs;
        } catch {
          /* The old issuer or credential no longer authorizes sharing. */
        }
        if (!credentialValid) {
          cached = undefined;
          snapshot.blocked = true;
          this.cache.write(scope, snapshot);
        } else {
          snapshot.trustedKeys = publicKeys;
          for (const [friend, proof] of Object.entries(snapshot.friends)) {
            try {
              validateFriend(proof, publicKeys, account, friend, this.now());
            } catch {
              delete snapshot.friends[friend];
            }
          }
          this.cache.write(scope, snapshot);
        }
      }
      const registration = signPayload(
        {
          kind: "together-register-v1" as const,
          userId: account,
          deviceId: identity.deviceId,
          publicKey: publicKeyPem(identity.seed),
          requestId: randomUuid(this.options.randomBytes),
          timestamp: this.now(),
        },
        identity.seed,
      );
      const registered = await this.options.api.register(registration);
      this.guard(generation);
      if (this.authorizationRevision !== authorizationRevision)
        return failure("unauthorized");
      snapshot = this.cache.read(scope);
      if (this.now() < snapshot.observedAt) return failure("expired");
      if (!registered.ok) return fallback(registered.error);
      const credential = verifyCredential(
        registered.value,
        publicKeys,
        this.now(),
      );
      if (credential.expiresAt - credential.issuedAt > maxCredentialAgeMs)
        throw new Error("invalid-proof");
      const next: Snapshot = {
        deviceId: identity.deviceId,
        blocked: false,
        observedAt: this.now(),
        trustedKeys: copy(publicKeys),
        credential: copy(registered.value),
        friends: {},
        friendAccess: snapshot.friendAccess,
        unknownFriendsDenied: snapshot.unknownFriendsDenied,
      };
      for (const [friend, proof] of Object.entries(snapshot.friends)) {
        try {
          validateFriend(proof, publicKeys, account, friend, this.now());
          next.friends[friend] = proof;
        } catch {
          /* A rotated authority does not preserve obsolete friendship proofs. */
        }
      }
      const ready = this.ready(next, identity, account, this.now());
      this.cache.write(scope, next);
      return ok(ready);
    } catch (error) {
      const code = errorCode(error);
      if (code === "storage") this.storageFailed = true;
      return failure(code);
    } finally {
      if (identity) {
        identity.seed.fill(0);
        this.activeSeeds.delete(identity.seed);
      }
    }
  }
  private pairDecision(
    snapshot: Snapshot,
    friendId: string,
    allowed: boolean,
  ): void {
    this.friendRevisions.set(
      friendId,
      (this.friendRevisions.get(friendId) ?? 0) + 1,
    );
    delete snapshot.friendAccess[friendId];
    snapshot.friendAccess[friendId] = allowed;
    while (Object.keys(snapshot.friendAccess).length > 100) {
      const oldest = Object.keys(snapshot.friendAccess)[0];
      // Evicting a known denial must never silently authorize that pair offline.
      if (!snapshot.friendAccess[oldest]) snapshot.unknownFriendsDenied = true;
      delete snapshot.friendAccess[oldest];
    }
  }
  private pairDenied(snapshot: Snapshot, friendId: string): boolean {
    return Object.hasOwn(snapshot.friendAccess, friendId)
      ? !snapshot.friendAccess[friendId]
      : snapshot.unknownFriendsDenied;
  }
  deniedPairs(
    candidateUserIds: readonly string[] = [],
  ): readonly (readonly [string, string])[] {
    const denied = this.access();
    if (denied) throw new Error(denied);
    const snapshot = this.cache.read(this.scope(this.account!));
    if (snapshot.blocked) throw new Error("unauthorized");
    const users = new Set([
      ...Object.keys(snapshot.friendAccess),
      ...candidateUserIds,
    ]);
    return [...users]
      .filter(
        (user) => user !== this.account && this.pairDenied(snapshot, user),
      )
      .map((user) => [this.account!, user] as const);
  }
  async friendship(
    friendId: string,
    { online }: { online: boolean },
  ): Promise<Result<Signed<FriendshipEvidence> | null, ProvisioningError>> {
    const denied = this.access();
    if (denied) return failure(denied);
    if (!uuid(friendId) || friendId === this.account)
      return failure("invalid-proof");
    const account = this.account!,
      generation = this.generation,
      scope = this.scope(account);
    const friendRevision = this.friendRevisions.get(friendId) ?? 0;
    const prepared = await this.prepare({ online });
    if (!prepared.ok) return prepared;
    prepared.value.seed.fill(0);
    try {
      this.guard(generation);
      let snapshot = this.cache.read(scope);
      if (snapshot.blocked || this.now() < snapshot.observedAt)
        return failure("unauthorized");
      if (!snapshot.credential) return failure("invalid-proof");
      verifyCredential(snapshot.credential, snapshot.trustedKeys, this.now());
      let cached: Signed<FriendshipEvidence> | null = null;
      if (Object.hasOwn(snapshot.friends, friendId)) {
        try {
          validateFriend(
            snapshot.friends[friendId],
            snapshot.trustedKeys,
            account,
            friendId,
            this.now(),
          );
          cached = snapshot.friends[friendId];
        } catch {
          /* Expired or rotated evidence is unavailable offline. */
        }
      }
      if (!online)
        return this.pairDenied(snapshot, friendId)
          ? failure("unauthorized")
          : ok(copy(cached));
      const result = await this.options.api.friendship(
        friendId,
        randomUuid(this.options.randomBytes),
      );
      this.guard(generation);
      // Re-read after I/O so another friend's result or renewed key ring cannot be lost.
      snapshot = this.cache.read(scope);
      // A global server refusal remains authoritative even after a newer pair refusal,
      // an expired credential or another request changed the local authorization revision.
      const ordinaryNonfriend =
        !result.ok &&
        result.error.status === 403 &&
        result.error.togetherCode === "FRIENDSHIP_NOT_ACCEPTED";
      if (!result.ok && authoritative(result.error) && !ordinaryNonfriend) {
        this.pairDecision(snapshot, friendId, false);
        delete snapshot.friends[friendId];
        if (
          !(
            result.error.status === 403 &&
            result.error.togetherCode === "FORBIDDEN"
          )
        ) {
          snapshot.blocked = true;
          this.authorizationRevision++;
          this.publishAccessFailure(denialCode(result.error));
        }
        this.cache.write(scope, snapshot);
        return failure(denialCode(result.error));
      }
      if (
        snapshot.blocked ||
        this.now() < snapshot.observedAt ||
        (this.friendRevisions.get(friendId) ?? 0) !== friendRevision
      )
        return failure("unauthorized");
      if (!snapshot.credential) return failure("invalid-proof");
      verifyCredential(snapshot.credential, snapshot.trustedKeys, this.now());
      if (!result.ok) {
        if (ordinaryNonfriend) {
          delete snapshot.friends[friendId];
          this.pairDecision(snapshot, friendId, true);
          snapshot.observedAt = this.now();
          this.cache.write(scope, snapshot);
          return ok(null);
        }
        if (this.pairDenied(snapshot, friendId)) return failure("unauthorized");
        if (transient(result.error)) {
          // Reachability cannot gate LAN when both identities remain authorized.
          // No friendship proof means explicit host approval, never friend admission.
          if (!cached) return ok(null);
          validateFriend(
            cached,
            snapshot.trustedKeys,
            account,
            friendId,
            this.now(),
          );
          return ok(copy(cached));
        }
        return failure("unavailable");
      }
      validateFriend(
        result.value,
        snapshot.trustedKeys,
        account,
        friendId,
        this.now(),
      );
      this.pairDecision(snapshot, friendId, true);
      snapshot.friends[friendId] = copy(result.value);
      while (Object.keys(snapshot.friends).length > 100) {
        const oldest = Object.keys(snapshot.friends).sort(
          (a, b) =>
            snapshot.friends[a].payload.issuedAt -
            snapshot.friends[b].payload.issuedAt,
        )[0];
        delete snapshot.friends[oldest];
      }
      snapshot.observedAt = this.now();
      this.cache.write(scope, snapshot);
      return ok(copy(result.value));
    } catch (error) {
      const code = errorCode(error);
      if (code === "storage") this.storageFailed = true;
      return failure(code);
    }
  }
}
