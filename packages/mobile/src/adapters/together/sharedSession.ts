import { MAX_PREVIOUS_BYTES, sharedLimit } from "./sharedTransfer";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { chacha20poly1305 } from "@noble/ciphers/chacha.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type {
  TogetherSharedPort,
  TogetherSharedPlan,
  TogetherSharedSnapshot,
  TogetherSharingConsent,
  TogetherPreviousRow,
  TogetherAthleteProjection,
  TogetherPlanProgress,
} from "../../domain/ports/togetherShared.port";
import { TogetherLocalLobby } from "./localLobby";
import {
  requestHash,
  signPayload,
  verifySignature,
  type Signed,
} from "./security/identity";
import { encode64, decode64 } from "./security/encoding";
import { object, uuid, integer, hash } from "./security/schema";
import { readOwnerCommand } from "./localCommand";
import type { LocalCommand } from "./localStore";

type EventType =
  | "activity"
  | "receipt"
  | "profile"
  | "plan"
  | "consent"
  | "progress"
  | "previous"
  | "delegate"
  | "closure";
export interface SharedPayload {
  kind: "together-shared-v1";
  sessionId: string;
  id: string;
  authorId: string;
  recipientId: string;
  type: EventType;
  revision: number;
  body: unknown;
}
export type SharedEnvelope = Signed<SharedPayload>;
export interface TogetherSharedOptions {
  lobby: TogetherLocalLobby;
  seed: Uint8Array;
  randomBytes(length: number): Uint8Array;
  randomUUID(): string;
  now(): number;
  send(envelope: SharedEnvelope): Promise<void>;
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
function check(valid: unknown): asserts valid {
  if (!valid) throw new Error("Invalid shared session message");
}
const scope = (p: Pick<SharedPayload, "authorId" | "recipientId" | "type">) =>
  `${p.authorId}:${p.recipientId}:${p.type}`;
function planShape(value: unknown): value is TogetherSharedPlan {
  if (
    !object(value, ["name", "exercises"]) ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    value.name.length > 120 ||
    !Array.isArray(value.exercises) ||
    !value.exercises.length ||
    value.exercises.length > 100
  )
    return false;
  const ids = new Set(),
    orders = new Set();
  return value.exercises.every((e) => {
    if (
      !object(e, ["planExerciseId", "exerciseId", "order", "targetSets"]) ||
      !uuid(e.planExerciseId) ||
      !uuid(e.exerciseId) ||
      !integer(e.order) ||
      e.order > 99 ||
      !integer(e.targetSets) ||
      e.targetSets < 1 ||
      e.targetSets > 100 ||
      ids.has(e.planExerciseId) ||
      orders.has(e.order)
    )
      return false;
    ids.add(e.planExerciseId);
    orders.add(e.order);
    return true;
  });
}
function consentShape(v: unknown): v is TogetherSharingConsent {
  return (
    object(v, ["numbers", "prev", "logging"]) &&
    [v.numbers, v.prev, v.logging].every((x) => typeof x === "boolean")
  );
}
/** Signed event IDs and revisions are durable; recipient sealing keeps an ungranted relay blind. */
export class TogetherSharedSession implements TogetherSharedPort {
  private seed: Uint8Array;
  private listeners = new Set<() => void>();
  private latest = new Map<string, SharedEnvelope>();
  private grants = new Map<
    string,
    {
      ownerId: string;
      recipientId: string;
      version: number;
      consent: TogetherSharingConsent;
    }
  >();
  private athletes = new Map<string, TogetherAthleteProjection>();
  private previous = new Map<string, TogetherPreviousRow[]>();
  private delegated = new Map<
    string,
    {
      id: string;
      actorId: string;
      operation: Record<string, unknown>;
      grantVersion: number;
      expectedVersion: number;
    }
  >();
  private closures = new Map<string, "finish_all" | "save_own" | "leave">();
  private plan: TogetherSharedPlan | null = null;
  private athletePlans = new Map<string, TogetherSharedPlan>();
  private disposed = false;
  private barriers = new Map<string, number>();
  private deliveries = new Map<
    string,
    { recipientId: string; revision: number; state: "pending" | "received" }
  >();
  private progress = new Map<string, TogetherPlanProgress>();
  private profiles = new Map<string, string>();
  private ownRevision = 0;
  private ownerVersions = new Map<string, number>();
  constructor(private readonly options: TogetherSharedOptions) {
    this.seed = options.seed.slice();
    for (const row of options.lobby.store.sharedSuspensions(
      options.lobby.pin.sessionId,
    ))
      this.barriers.set(`${row.ownerId}:${row.recipientId}`, row.revision);
    const admitted = new Set(
      options.lobby.store
        .current(options.lobby.pin.sessionId)
        ?.payload.members.map((m) => m.credential.payload.userId),
    );
    if (!admitted.has(this.ownId)) return;
    const events = options.lobby.store
      .sharedEvents(options.lobby.pin.sessionId)
      .map((text) => JSON.parse(text) as SharedEnvelope)
      .filter(
        (e) =>
          admitted.has(e.payload.authorId) &&
          (e.payload.recipientId === "all" ||
            admitted.has(e.payload.recipientId)),
      );
    // Restore latest permissions before private caches; old grants cannot resurrect revoked values.
    const latest = new Map<string, SharedEnvelope>();
    for (const e of events)
      if (
        !latest.has(scope(e.payload)) ||
        latest.get(scope(e.payload))!.payload.revision < e.payload.revision
      )
        latest.set(scope(e.payload), e);
    for (const type of [
      "plan",
      "profile",
      "activity",
      "consent",
      "closure",
      "progress",
      "previous",
      "delegate",
      "receipt",
    ] as EventType[])
      for (const e of latest.values())
        if (e.payload.type === type) this.accept(e, undefined, true);
  }
  get ownId() {
    return this.options.lobby.store.accountId;
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  getSnapshot(): TogetherSharedSnapshot {
    this.revalidate();
    return clone({
      plan: this.plan,
      profiles: Object.fromEntries(this.profiles),
      progress: [...this.progress.values()],
      deliveries: [...this.deliveries.values()],
      planHash: this.plan ? requestHash(this.plan) : null,
      athletePlans: Object.fromEntries(this.athletePlans),
      athletes: [...this.athletes.values()],
      previous: Object.fromEntries(this.previous),
      grants: [...this.grants.values()].filter(
        (grant) => this.active(grant.ownerId) && this.active(grant.recipientId),
      ),
      closures: [...this.closures].map(([userId, mode]) => ({ userId, mode })),
      delegated: [...this.delegated.values()],
    });
  }
  private notify() {
    for (const listener of this.listeners)
      try {
        listener();
      } catch {
        /* Observers cannot prevent cache purge. */
      }
  }
  private member(userId: string) {
    const roster = this.options.lobby.store.current(
      this.options.lobby.pin.sessionId,
    );
    const member = roster?.payload.members.find(
      (m) => m.credential.payload.userId === userId,
    );
    if (!member) throw new Error("Athlete not admitted");
    this.options.lobby.member(member.credential);
    return member;
  }
  private revalidate() {
    try {
      this.member(this.ownId);
    } catch {
      this.purge();
      this.grants.clear();
      this.progress.clear();
    }
  }
  private purge(ownerId?: string) {
    if (ownerId) {
      this.athletes.delete(ownerId);
      if (ownerId !== this.ownId && !this.progress.has(ownerId))
        this.athletePlans.delete(ownerId);
      this.previous.delete(ownerId);
      this.options.lobby.store.purgePeerCommands(
        this.options.lobby.pin.sessionId,
        ownerId,
      );
    } else {
      for (const owner of this.athletes.keys())
        if (owner !== this.ownId) this.athletes.delete(owner);
      for (const owner of this.athletePlans.keys())
        if (owner !== this.ownId) this.athletePlans.delete(owner);
      this.previous.clear();
      this.delegated.clear();
    }
  }
  private purgeDelegatedActor(userId: string) {
    for (const [id, intent] of this.delegated)
      if (intent.actorId === userId) this.delegated.delete(id);
  }
  private active(userId: string) {
    return (
      !this.disposed &&
      !!this.options.lobby.store
        .current(this.options.lobby.pin.sessionId)
        ?.payload.members.some((m) => m.credential.payload.userId === userId) &&
      !this.closures.has(this.options.lobby.pin.hostUserId) &&
      !this.closures.has(userId)
    );
  }
  private key(peerId: string) {
    const peer = this.member(peerId).credential.payload.publicKey;
    const raw = decode64(peer.split("\n")[1]).slice(12);
    const secret = ed25519.utils.toMontgomerySecret(this.seed);
    try {
      return sha256(
        x25519.getSharedSecret(secret, ed25519.utils.toMontgomery(raw)),
      );
    } finally {
      secret.fill(0);
    }
  }
  private seal(body: unknown, p: Omit<SharedPayload, "body">) {
    if (p.recipientId === "all") return body;
    const nonce = this.options.randomBytes(12),
      key = this.key(p.recipientId);
    try {
      return {
        nonce: encode64(nonce, true),
        ciphertext: encode64(
          chacha20poly1305(
            key,
            nonce,
            new TextEncoder().encode(JSON.stringify(p)),
          ).encrypt(new TextEncoder().encode(JSON.stringify(body))),
          true,
        ),
      };
    } finally {
      key.fill(0);
    }
  }
  private unseal(p: SharedPayload) {
    if (p.recipientId === "all") return p.body;
    check(
      object(p.body, ["nonce", "ciphertext"]) &&
        typeof p.body.nonce === "string" &&
        typeof p.body.ciphertext === "string",
    );
    const { body, ...header } = p;
    const sealed = body as { nonce: string; ciphertext: string };
    const key = this.key(p.authorId);
    try {
      return JSON.parse(
        new TextDecoder().decode(
          chacha20poly1305(
            key,
            decode64(sealed.nonce, true),
            new TextEncoder().encode(JSON.stringify(header)),
          ).decrypt(
            decode64(
              sealed.ciphertext,
              true,
              p.type === "previous" ? MAX_PREVIOUS_BYTES : 60000,
            ),
          ),
        ),
      );
    } finally {
      key.fill(0);
    }
  }
  private grant(ownerId: string, recipientId: string) {
    return this.grants.get(`${ownerId}:${recipientId}`);
  }
  private async publish(
    type: EventType,
    recipientId: string,
    body: unknown,
    send = true,
  ) {
    check(!this.disposed);
    this.member(this.ownId);
    if (type !== "consent") check(this.active(this.ownId));
    if (recipientId !== "all") this.member(recipientId);
    const header = {
      kind: "together-shared-v1" as const,
      sessionId: this.options.lobby.pin.sessionId,
      id: this.options.randomUUID(),
      authorId: this.ownId,
      recipientId,
      type,
      revision:
        type === "activity"
          ? this.ownRevision
          : (this.latest.get(scope({ authorId: this.ownId, recipientId, type }))
              ?.payload.revision ?? 0) + 1,
    };
    const envelope = signPayload(
      { ...header, body: this.seal(body, header) },
      this.seed,
    );
    check(
      new TextEncoder().encode(JSON.stringify(envelope)).length <=
        sharedLimit(envelope),
    );
    this.accept(envelope);
    if (send) await this.options.send(envelope);
  }
  /** Incoming peer must be the author, or the pinned host forwarding an original signed envelope. */
  accept(
    envelope: SharedEnvelope,
    transportUserId?: string,
    restoring = false,
  ): boolean {
    const p = envelope?.payload;
    check(
      object(envelope, ["payload", "signature"]) &&
        object(p, [
          "kind",
          "sessionId",
          "id",
          "authorId",
          "recipientId",
          "type",
          "revision",
          "body",
        ]) &&
        new TextEncoder().encode(JSON.stringify(envelope)).length <=
          sharedLimit(envelope) &&
        p.kind === "together-shared-v1" &&
        p.sessionId === this.options.lobby.pin.sessionId &&
        uuid(p.id) &&
        uuid(p.authorId) &&
        (p.recipientId === "all" || uuid(p.recipientId)) &&
        integer(p.revision) &&
        p.revision > 0 &&
        [
          "plan",
          "profile",
          "activity",
          "consent",
          "progress",
          "previous",
          "delegate",
          "receipt",
          "closure",
        ].includes(p.type),
    );
    check(
      !transportUserId ||
        transportUserId === p.authorId ||
        transportUserId === this.options.lobby.pin.hostUserId,
    );
    verifySignature(
      envelope,
      this.member(p.authorId).credential.payload.publicKey,
    );
    if (p.recipientId !== "all") this.member(p.recipientId);
    check(
      ["plan", "closure", "profile", "activity"].includes(p.type) ===
        (p.recipientId === "all"),
    );
    if (p.type === "plan")
      check(p.authorId === this.options.lobby.pin.hostUserId);
    const prior = this.latest.get(scope(p));
    if (prior && prior.payload.revision >= p.revision) {
      if (prior.payload.revision === p.revision)
        check(requestHash(prior) === requestHash(envelope));
      return false;
    }
    let acknowledge = false;
    const restore = this.checkpoint();
    try {
      // Skipped revisions are safe: all payloads are complete current projections, never patches.
      let body: unknown;
      if (
        p.recipientId === "all" ||
        p.recipientId === this.ownId ||
        p.authorId === this.ownId
      ) {
        // Own targeted records decrypt using recipient key (the same shared secret).
        if (
          p.authorId === this.ownId &&
          p.recipientId !== "all" &&
          p.recipientId !== this.ownId
        ) {
          const key = this.key(p.recipientId);
          check(object(p.body, ["nonce", "ciphertext"]));
          const { body: sealed, ...header } = p;
          const b = sealed as { nonce: string; ciphertext: string };
          try {
            body = JSON.parse(
              new TextDecoder().decode(
                chacha20poly1305(
                  key,
                  decode64(b.nonce, true),
                  new TextEncoder().encode(JSON.stringify(header)),
                ).decrypt(
                  decode64(
                    b.ciphertext,
                    true,
                    p.type === "previous" ? MAX_PREVIOUS_BYTES : 60000,
                  ),
                ),
              ),
            );
          } finally {
            key.fill(0);
          }
        } else body = this.unseal(p);
        this.apply(p, body, restoring);
        acknowledge =
          !restoring &&
          p.type === "progress" &&
          p.recipientId === this.ownId &&
          p.authorId !== this.ownId &&
          object(body, ["grantVersion", "planHash", "plan", "value"]) &&
          body.grantVersion === this.grant(p.authorId, this.ownId)?.version &&
          this.grant(p.authorId, this.ownId)?.consent.numbers === true &&
          this.active(p.authorId) &&
          this.active(this.ownId);
      }
      if (!restoring)
        this.options.lobby.store.saveShared(
          p.sessionId,
          p.id,
          JSON.stringify(envelope),
        );
    } catch (error) {
      restore();
      throw error;
    }
    if (p.type === "consent" || p.type === "closure") {
      const affected = (old: SharedPayload) =>
        ["progress", "previous", "delegate"].includes(old.type) &&
        (p.type === "closure"
          ? p.authorId === this.options.lobby.pin.hostUserId ||
            old.authorId === p.authorId ||
            old.recipientId === p.authorId
          : (old.authorId === p.authorId &&
              old.recipientId === p.recipientId) ||
            (old.type === "delegate" &&
              old.authorId === p.recipientId &&
              old.recipientId === p.authorId));
      for (const [key, event] of this.latest)
        if (affected(event.payload)) this.latest.delete(key);
      if (!restoring)
        this.options.lobby.store.deleteShared(
          p.sessionId,
          this.options.lobby.store
            .sharedEvents(p.sessionId)
            .map((text) => (JSON.parse(text) as SharedEnvelope).payload)
            .filter(affected)
            .map((old) => old.id),
        );
    }

    // These are complete snapshots: retaining superseded private ciphertext is unnecessary.
    // Progress also invalidates any previous-values cache for that owner/recipient pair.
    if (p.type === "progress") {
      for (const [key, event] of this.latest)
        if (
          event.payload.type === "previous" &&
          event.payload.authorId === p.authorId &&
          event.payload.recipientId === p.recipientId
        )
          this.latest.delete(key);
    }
    if (!restoring)
      this.options.lobby.store.deleteShared(
        p.sessionId,
        this.options.lobby.store
          .sharedEvents(p.sessionId)
          .map((text) => (JSON.parse(text) as SharedEnvelope).payload)
          .filter(
            (old) =>
              old.id !== p.id &&
              (scope(old) === scope(p) ||
                (p.type === "progress" &&
                  old.type === "previous" &&
                  old.authorId === p.authorId &&
                  old.recipientId === p.recipientId)),
          )
          .map((old) => old.id),
      );
    this.latest.set(scope(p), clone(envelope));
    if (
      p.type === "progress" &&
      p.authorId === this.ownId &&
      p.recipientId !== this.ownId
    )
      this.deliveries.set(p.recipientId, {
        recipientId: p.recipientId,
        revision: p.revision,
        state: "pending",
      });
    if (acknowledge)
      void this.publish("receipt", p.authorId, {
        eventId: p.id,
        eventHash: requestHash(envelope),
        revision: p.revision,
      }).catch(() => {});
    this.notify();
    return true;
  }
  private checkpoint() {
    const maps = {
      deliveries: clone([...this.deliveries]),
      profiles: clone([...this.profiles]),
      progress: clone([...this.progress]),
      latest: clone([...this.latest]),
      grants: clone([...this.grants]),
      athletes: clone([...this.athletes]),
      previous: clone([...this.previous]),
      delegated: clone([...this.delegated]),
      closures: clone([...this.closures]),
      athletePlans: clone([...this.athletePlans]),
      ownerVersions: clone([...this.ownerVersions]),
    };
    const plan = clone(this.plan),
      ownRevision = this.ownRevision;
    return () => {
      this.deliveries = new Map(maps.deliveries);
      this.profiles = new Map(maps.profiles);
      this.progress = new Map(maps.progress);
      this.latest = new Map(maps.latest);
      this.grants = new Map(maps.grants);
      this.athletes = new Map(maps.athletes);
      this.previous = new Map(maps.previous);
      this.delegated = new Map(maps.delegated);
      this.closures = new Map(maps.closures);
      this.athletePlans = new Map(maps.athletePlans);
      this.ownerVersions = new Map(maps.ownerVersions);
      this.plan = plan;
      this.ownRevision = ownRevision;
    };
  }
  private apply(p: SharedPayload, body: unknown, restoring: boolean) {
    if (p.type === "activity") {
      check(this.active(p.authorId));
      check(
        object(body, ["plan", "planHash", "value"]) &&
          planShape(body.plan) &&
          body.planHash === requestHash(body.plan),
      );
      const value = body.value;
      check(
        object(value, ["userId", "revision", "exercises"]) &&
          value.userId === p.authorId &&
          integer(value.revision) &&
          value.revision === p.revision &&
          Array.isArray(value.exercises) &&
          value.exercises.length === body.plan.exercises.length,
      );
      const ids = new Set<string>();
      let total = 0;
      for (const exercise of value.exercises) {
        check(
          object(exercise, ["planExerciseId", "completedSets", "skipped"]) &&
            uuid(exercise.planExerciseId) &&
            integer(exercise.completedSets) &&
            exercise.completedSets <= 100 &&
            typeof exercise.skipped === "boolean" &&
            body.plan.exercises.some(
              (e) => e.planExerciseId === exercise.planExerciseId,
            ) &&
            !ids.has(exercise.planExerciseId),
        );
        ids.add(exercise.planExerciseId);
        total += exercise.completedSets;
      }
      check(
        total <= 100 &&
          value.revision >= (this.progress.get(p.authorId)?.revision ?? 0),
      );
      this.bindPlan(p.authorId, body.plan);
      this.progress.set(
        p.authorId,
        clone(value) as unknown as TogetherPlanProgress,
      );
      return;
    }
    if (p.type === "receipt") {
      check(
        object(body, ["eventId", "eventHash", "revision"]) &&
          uuid(body.eventId) &&
          hash(body.eventHash) &&
          integer(body.revision),
      );
      const original = this.latest.get(
        scope({
          authorId: p.recipientId,
          recipientId: p.authorId,
          type: "progress",
        }),
      );
      if (
        p.recipientId === this.ownId &&
        original &&
        original.payload.id === body.eventId &&
        original.payload.revision === body.revision &&
        requestHash(original) === body.eventHash
      )
        this.deliveries.set(p.authorId, {
          recipientId: p.authorId,
          revision: body.revision,
          state: "received",
        });
      return;
    }

    if (p.type === "profile") {
      check(
        object(body, ["displayName"]) &&
          typeof body.displayName === "string" &&
          !!body.displayName.trim() &&
          body.displayName.length <= 80,
      );
      this.profiles.set(p.authorId, body.displayName.trim());
      return;
    }

    if (p.type === "plan") {
      check(planShape(body));
      if (this.plan) check(requestHash(this.plan) === requestHash(body));
      this.plan = clone(body);
      return;
    }
    if (p.type === "closure") {
      check(
        object(body, ["mode"]) &&
          ["finish_all", "save_own", "leave"].includes(body.mode as string),
      );
      check(
        p.authorId === this.options.lobby.pin.hostUserId ||
          body.mode === "leave",
      );
      this.closures.set(
        p.authorId,
        body.mode as "finish_all" | "save_own" | "leave",
      );
      if (
        p.authorId === this.options.lobby.pin.hostUserId ||
        p.authorId === this.ownId
      )
        this.purge();
      else this.purge(p.authorId);
      if (
        p.authorId === this.options.lobby.pin.hostUserId ||
        p.authorId === this.ownId
      )
        this.progress.clear();
      else this.progress.delete(p.authorId);
      if (
        p.authorId === this.options.lobby.pin.hostUserId ||
        p.authorId === this.ownId
      )
        this.delegated.clear();
      else this.purgeDelegatedActor(p.authorId);
      if (
        p.authorId === this.options.lobby.pin.hostUserId ||
        p.authorId === this.ownId
      )
        this.deliveries.clear();
      else this.deliveries.delete(p.authorId);
      return;
    }
    if (p.type === "consent") {
      if (
        p.revision <= (this.barriers.get(`${p.authorId}:${p.recipientId}`) ?? 0)
      )
        return;

      check(
        object(body, ["consent", "plan", "executionRevision"]) &&
          integer(body.executionRevision) &&
          consentShape(body.consent) &&
          (body.plan === null || planShape(body.plan)),
      );
      if (!this.active(p.authorId) || !this.active(p.recipientId))
        check(
          !body.consent.numbers && !body.consent.prev && !body.consent.logging,
        );
      this.ownerVersions.set(p.authorId, body.executionRevision);
      if (p.authorId === this.ownId) this.deliveries.delete(p.recipientId);
      this.grants.set(`${p.authorId}:${p.recipientId}`, {
        ownerId: p.authorId,
        recipientId: p.recipientId,
        version: p.revision,
        consent: clone(body.consent),
      });
      if (p.authorId !== this.ownId) this.purge(p.authorId);
      if (
        body.plan &&
        (body.consent.numbers || body.consent.prev || body.consent.logging)
      )
        this.bindPlan(p.authorId, body.plan);

      if (p.authorId === this.ownId) this.purgeDelegatedActor(p.recipientId);
      return;
    }
    if (!this.active(p.authorId) || !this.active(p.recipientId)) return;
    check(object(body, ["grantVersion", "planHash", "value"], ["plan"]));
    if (p.type !== "previous") check(Object.hasOwn(body, "plan"));
    check(integer(body.grantVersion) && hash(body.planHash));
    const planOwner = p.type === "delegate" ? p.recipientId : p.authorId;
    const permission =
      p.type === "delegate"
        ? this.grant(p.recipientId, p.authorId)
        : this.grant(p.authorId, p.recipientId);
    if (
      !(
        p.type === "progress" &&
        p.authorId === this.ownId &&
        p.recipientId === this.ownId
      ) &&
      (!permission ||
        permission.version !== body.grantVersion ||
        !permission.consent[
          p.type === "progress"
            ? "numbers"
            : p.type === "previous"
              ? "prev"
              : "logging"
        ])
    )
      return;
    const resolvedPlan = body.plan ?? this.athletePlans.get(planOwner);
    check(
      planShape(resolvedPlan) && body.planHash === requestHash(resolvedPlan),
    );
    if (p.type === "delegate")
      check(
        this.athletePlans.has(planOwner) &&
          requestHash(this.athletePlans.get(planOwner)) === body.planHash,
      );
    const athletePlan = resolvedPlan;
    if (p.type !== "delegate") this.bindPlan(planOwner, athletePlan);
    if (p.type === "progress") {
      this.validateProjection(body.value, p.authorId);
      if (p.recipientId === this.ownId) {
        this.athletes.set(p.authorId, clone(body.value));
        this.ownerVersions.set(p.authorId, body.value.revision);
        this.previous.delete(p.authorId);
        if (p.authorId === this.ownId) this.ownRevision = body.value.revision;
      }
      return;
    }
    if (p.type === "previous") {
      check(
        object(body.value, [
          "rows",
          "startedAt",
          "effective",
          "executionRevision",
        ]) &&
          integer(body.value.executionRevision) &&
          Array.isArray(body.value.effective) &&
          body.value.effective.length === athletePlan.exercises.length &&
          integer(body.value.startedAt) &&
          Array.isArray(body.value.rows) &&
          body.value.rows.length <= 100 * 100,
      );
      const effectiveIds = new Set<string>();
      for (const item of body.value.effective) {
        check(
          object(item, ["planExerciseId", "exerciseId", "skipped"]) &&
            uuid(item.planExerciseId) &&
            athletePlan.exercises.some(
              (e) => e.planExerciseId === item.planExerciseId,
            ) &&
            !effectiveIds.has(item.planExerciseId) &&
            uuid(item.exerciseId) &&
            typeof item.skipped === "boolean",
        );
        effectiveIds.add(item.planExerciseId);
      }
      const effective = new Set(
        (body.value.effective as { exerciseId: string; skipped: boolean }[])
          .filter((e) => !e.skipped)
          .map((e) => e.exerciseId),
      );
      const knownVersion = this.ownerVersions.get(p.authorId) ?? 0;
      if (body.value.executionRevision < knownVersion) return;
      // A complete PREV snapshot may contain 100 sets for each of 100 exercises.
      // Bounded transport chunks carry the complete recipient-encrypted snapshot.
      const previousKeys = new Set<string>();
      for (const row of body.value.rows) {
        check(
          object(row, [
            "exerciseId",
            "setNumber",
            "reps",
            "weightKg",
            "recordedAt",
          ]) &&
            uuid(row.exerciseId) &&
            effective.has(row.exerciseId) &&
            !previousKeys.has(`${row.exerciseId}:${row.setNumber}`) &&
            integer(row.setNumber) &&
            row.setNumber >= 1 &&
            row.setNumber <= 100 &&
            integer(row.reps) &&
            row.reps <= 10000 &&
            typeof row.weightKg === "number" &&
            Number.isFinite(row.weightKg) &&
            row.weightKg >= 0 &&
            row.weightKg <= 9999.99 &&
            integer(row.recordedAt) &&
            row.recordedAt < body.value.startedAt,
        );
        previousKeys.add(`${row.exerciseId}:${row.setNumber}`);
      }
      if (p.recipientId === this.ownId)
        this.previous.set(
          p.authorId,
          clone(body.value.rows) as TogetherPreviousRow[],
        );
      return;
    }
    check(
      object(body.value, ["operation", "expectedVersion"]) &&
        integer(body.value.expectedVersion),
    );
    check(
      object(body.value.operation, ["type", "planExerciseId", "set"]) &&
        body.value.operation.type === "upsertSet",
    );
    const delegatedValue = body.value.operation;
    const fake = {
      userId: p.recipientId,
      revision: 1,
      restEndsAt: null,
      exercises: {
        [String(delegatedValue.planExerciseId)]: {
          exerciseId: athletePlan.exercises.find(
            (e) => e.planExerciseId === delegatedValue.planExerciseId,
          )?.exerciseId,
          skipped: false,
          sets: [delegatedValue.set],
        },
      },
    };
    this.validateProjection(fake, p.recipientId);
    if (p.recipientId === this.ownId && !restoring)
      this.delegated.set(p.id, {
        id: p.id,
        actorId: p.authorId,
        operation: clone(delegatedValue),
        grantVersion: body.grantVersion,
        expectedVersion: body.value.expectedVersion,
      });
  }
  private validateProjection(
    value: unknown,
    userId: string,
  ): asserts value is TogetherAthleteProjection {
    check(
      object(value, ["userId", "revision", "exercises", "restEndsAt"]) &&
        value.userId === userId &&
        integer(value.revision) &&
        object(value.exercises, [], Object.keys(value.exercises ?? {})) &&
        (value.restEndsAt === null ||
          (typeof value.restEndsAt === "string" &&
            Number.isFinite(Date.parse(value.restEndsAt)))),
    );
    let total = 0;
    for (const [id, e] of Object.entries(value.exercises)) {
      check(
        this.athletePlans
          .get(userId)
          ?.exercises.some((x) => x.planExerciseId === id) &&
          object(e, ["exerciseId", "skipped", "sets"]) &&
          uuid(e.exerciseId) &&
          typeof e.skipped === "boolean" &&
          Array.isArray(e.sets),
      );
      const ids = new Set();
      for (const set of e.sets) {
        check(
          object(set, ["setId", "reps", "weightKg", "completed"]) &&
            uuid(set.setId) &&
            !ids.has(set.setId) &&
            integer(set.reps) &&
            set.reps <= 10000 &&
            typeof set.weightKg === "number" &&
            Number.isFinite(set.weightKg) &&
            set.weightKg >= 0 &&
            set.weightKg <= 9999.99 &&
            typeof set.completed === "boolean",
        );
        ids.add(set.setId);
        check(++total <= 100);
      }
    }
  }
  private bindPlan(ownerId: string, plan: TogetherSharedPlan) {
    const current = this.athletePlans.get(ownerId);
    if (current) check(requestHash(current) === requestHash(plan));
    this.athletePlans.set(ownerId, clone(plan));
  }
  setOwnPlan(plan: TogetherSharedPlan): void {
    check(planShape(plan));
    this.bindPlan(this.ownId, plan);
  }
  async publishProfile(displayName: string) {
    await this.publish("profile", "all", { displayName });
  }
  async publishPlan(plan: TogetherSharedPlan) {
    check(this.options.lobby.isHost);
    await this.publish("plan", "all", plan);
  }
  async setConsent(recipientId: string, consent: TogetherSharingConsent) {
    check(recipientId !== this.ownId && consentShape(consent));
    await this.publish("consent", recipientId, {
      consent,
      plan: this.athletePlans.get(this.ownId) ?? null,
      executionRevision: this.ownRevision,
    });
    if (consent.numbers && this.athletes.has(this.ownId))
      await this.sendProjection(recipientId);
  }
  private async sendProjection(recipientId: string) {
    const grant = this.grant(this.ownId, recipientId);
    // A delayed grant send may finish after a newer revoke. Never seal new values then.
    if (
      !grant?.consent.numbers ||
      !this.active(this.ownId) ||
      !this.active(recipientId)
    )
      return;
    await this.publish("progress", recipientId, {
      grantVersion: grant.version,
      planHash: requestHash(this.athletePlans.get(this.ownId)),
      plan: this.athletePlans.get(this.ownId),
      value: this.athletes.get(this.ownId),
    });
  }
  async publishProgress(command: LocalCommand) {
    check(this.active(this.ownId));
    const p = readOwnerCommand(command, this.options.lobby.ownCredential);
    const ownPlan = this.athletePlans.get(this.ownId);
    check(
      ownPlan &&
        p.planHash === requestHash(ownPlan) &&
        p.sessionId === this.options.lobby.pin.sessionId &&
        p.executionId === this.member(this.ownId).consent.payload.executionId,
    );
    if (p.expectedVersion < this.ownRevision) return;
    check(p.expectedVersion === this.ownRevision);
    const projection = clone(
      this.athletes.get(this.ownId) ?? {
        userId: this.ownId,
        revision: 0,
        restEndsAt: null,
        exercises: Object.fromEntries(
          ownPlan.exercises.map((e) => [
            e.planExerciseId,
            { exerciseId: e.exerciseId, skipped: false, sets: [] },
          ]),
        ),
      },
    );
    const op = p.operation;
    if (op.type === "rest") projection.restEndsAt = op.endsAt as string | null;
    else {
      const e = projection.exercises[op.planExerciseId as string];
      check(e);
      if (op.type === "upsertSet") {
        e.sets = e.sets.filter(
          (s) => s.setId !== (op.set as { setId: string }).setId,
        );
        e.sets.push(clone(op.set) as (typeof e.sets)[number]);
      } else if (op.type === "removeSet")
        e.sets = e.sets.filter((s) => s.setId !== op.setId);
      else if (op.type === "skip") e.skipped = op.skipped as boolean;
      else if (op.type === "substitute")
        e.exerciseId =
          (op.exerciseId as string | null) ??
          ownPlan.exercises.find((x) => x.planExerciseId === op.planExerciseId)!
            .exerciseId;
    }
    projection.revision = this.ownRevision + 1;
    this.validateProjection(projection, this.ownId);

    await this.publish(
      "progress",
      this.ownId,
      {
        grantVersion: 0,
        planHash: requestHash(ownPlan),
        plan: ownPlan,
        value: projection,
      },
      false,
    );
    await this.publish("activity", "all", {
      plan: ownPlan,
      planHash: requestHash(ownPlan),
      value: {
        userId: this.ownId,
        revision: projection.revision,
        exercises: ownPlan.exercises.map((e) => ({
          planExerciseId: e.planExerciseId,
          completedSets: projection.exercises[e.planExerciseId].sets.filter(
            (set) => set.completed,
          ).length,
          skipped: projection.exercises[e.planExerciseId].skipped,
        })),
      },
    });
    this.notify();
    for (const grant of this.grants.values()) {
      if (grant.ownerId !== this.ownId || !this.active(grant.recipientId))
        continue;
      if (grant.consent.numbers) await this.sendProjection(grant.recipientId);
      // PREV-only recipients also receive an empty invalidation after any own edit.
      if (grant.consent.prev)
        await this.publishPrevious(grant.recipientId, [], p.startedAt);
    }
  }
  async publishPrevious(
    recipientId: string,
    rows: readonly TogetherPreviousRow[],
    startedAt: number,
  ) {
    const grant = this.grant(this.ownId, recipientId);
    const ownPlan = this.athletePlans.get(this.ownId);
    check(grant?.consent.prev && ownPlan);
    await this.publish("previous", recipientId, {
      grantVersion: grant.version,
      planHash: requestHash(ownPlan),
      value: {
        rows,
        startedAt,
        executionRevision: this.ownRevision,
        effective: ownPlan.exercises.map((e) => ({
          planExerciseId: e.planExerciseId,
          exerciseId:
            this.athletes.get(this.ownId)?.exercises[e.planExerciseId]
              ?.exerciseId ?? e.exerciseId,
          skipped:
            this.athletes.get(this.ownId)?.exercises[e.planExerciseId]
              ?.skipped ?? false,
        })),
      },
    });
  }
  async requestDelegatedSet(
    ownerId: string,
    operation: Record<string, unknown>,
    observedRevision: number,
  ) {
    check(
      Number.isSafeInteger(observedRevision) &&
        observedRevision >= 0 &&
        observedRevision === (this.ownerVersions.get(ownerId) ?? 0),
    );
    const grant = this.grant(ownerId, this.ownId);
    const ownerPlan = this.athletePlans.get(ownerId);
    check(grant?.consent.logging && ownerPlan);
    await this.publish("delegate", ownerId, {
      grantVersion: grant.version,
      planHash: requestHash(ownerPlan),
      plan: ownerPlan,
      value: {
        operation,
        expectedVersion: observedRevision,
      },
    });
  }
  consumeDelegated(
    id: string,
    apply?: (accepted: {
      operation: Record<string, unknown>;
      expectedVersion: number;
    }) => void,
  ) {
    this.member(this.ownId);
    const intent = this.delegated.get(id),
      grant = intent && this.grant(this.ownId, intent.actorId);
    check(
      intent &&
        grant?.consent.logging &&
        grant.version === intent.grantVersion &&
        this.active(this.ownId) &&
        this.active(intent.actorId) &&
        intent.expectedVersion === this.ownRevision,
    );
    const accepted = {
      operation: clone(intent.operation),
      expectedVersion: intent.expectedVersion,
    };
    // A durable owner write must succeed before the intent is acknowledged locally.
    // Failure retains the pending intent without notifying/retrying in a tight loop.
    apply?.(accepted);
    this.delegated.delete(id);
    this.notify();
    return accepted;
  }
  async close(mode: "finish_all" | "save_own" | "leave") {
    const existing = this.closures.get(this.ownId);
    if (existing) {
      check(existing === mode);
      const event = this.latest.get(
        scope({ authorId: this.ownId, recipientId: "all", type: "closure" }),
      )!;
      await this.options.send(event);
      return;
    }
    await this.publish("closure", "all", { mode });
  }
  /** Checked between transfer chunks: revocation/supersession stops stale sends. */
  isCurrent(envelope: SharedEnvelope): boolean {
    const p = envelope.payload;
    return (
      !this.disposed &&
      this.active(p.authorId) &&
      this.active(p.recipientId) &&
      this.latest.get(scope(p))?.payload.id === p.id
    );
  }
  /** Only current consent/data is replayed, ordered permission first. No stale encrypted caches. */
  replay(recipientId: string): SharedEnvelope[] {
    this.member(recipientId);
    const all = [...this.latest.values()].filter(
      (e) => this.options.lobby.isHost || e.payload.authorId === this.ownId,
    );
    return all
      .filter((e) =>
        this.options.lobby.isHost
          ? e.payload.recipientId === "all" ||
            (e.payload.authorId === this.ownId &&
              e.payload.recipientId === recipientId)
          : e.payload.recipientId !== this.ownId,
      )
      .filter((e) => {
        const p = e.payload;
        if (p.type === "activity") return this.active(p.authorId);
        if (
          ["plan", "profile", "activity", "consent", "closure"].includes(p.type)
        )
          return true;
        const grant = [...this.latest.values()].find(
          (x) =>
            x.payload.type === "consent" &&
            x.payload.authorId ===
              (p.type === "delegate" ? p.recipientId : p.authorId) &&
            x.payload.recipientId ===
              (p.type === "delegate" ? p.authorId : p.recipientId),
        );
        return (
          !!grant &&
          p.revision > 0 &&
          this.active(p.authorId) &&
          this.active(p.recipientId)
        );
      })
      .sort(
        (a, b) =>
          [
            "plan",
            "profile",
            "activity",
            "consent",
            "closure",
            "progress",
            "previous",
            "delegate",
            "receipt",
          ].indexOf(a.payload.type) -
          [
            "plan",
            "profile",
            "activity",
            "consent",
            "closure",
            "progress",
            "previous",
            "delegate",
            "receipt",
          ].indexOf(b.payload.type),
      )
      .map(clone);
  }
  /** Apply signed roster removal immediately, including caches relayed for other athletes. */
  rosterChanged(): void {
    const roster = this.options.lobby.store.current(
      this.options.lobby.pin.sessionId,
    );
    const members = new Set(
      roster?.payload.members.map((m) => m.credential.payload.userId),
    );
    const history = this.options.lobby.store.rosters(
      this.options.lobby.pin.sessionId,
    );
    const removed = new Set(
      history
        .flatMap((r) =>
          r.payload.members.map((m) => m.credential.payload.userId),
        )
        .filter((id) => !members.has(id)),
    );
    const failures: unknown[] = [];
    const peers = !members.has(this.ownId)
      ? [this.options.lobby.pin.hostUserId]
      : removed;
    for (const userId of peers) {
      try {
        this.suspendPeer(userId);
      } catch (error) {
        failures.push(error);
      }
    }
    for (const userId of removed) this.profiles.delete(userId);
    this.notify();
    if (failures.length)
      throw new AggregateError(failures, "Shared roster cleanup failed");
  }

  /** Disconnected grants are not proof of current authorization. Require a fresh owner revision. */
  suspendPeer(userId: string): void {
    const all =
      userId === this.options.lobby.pin.hostUserId &&
      !this.options.lobby.isHost;
    const suspended: SharedPayload[] = [];
    const stale: SharedPayload[] = [];
    for (const [key, event] of this.latest) {
      const p = event.payload;
      if (
        p.type === "consent" &&
        (all || p.authorId === userId || p.recipientId === userId)
      ) {
        this.barriers.set(`${p.authorId}:${p.recipientId}`, p.revision);
        this.grants.delete(`${p.authorId}:${p.recipientId}`);
        suspended.push(p);
      }
      if (
        ["activity", "progress", "previous", "delegate", "receipt"].includes(
          p.type,
        ) &&
        (all
          ? p.authorId !== this.ownId || p.recipientId !== this.ownId
          : p.authorId === userId || p.recipientId === userId)
      ) {
        stale.push(p);
        this.latest.delete(key);
      }
    }
    if (all) this.progress.clear();
    else this.progress.delete(userId);
    let failure: unknown;
    try {
      if (all) {
        this.purge();
        this.deliveries.clear();
      } else {
        this.purge(userId);
      }
    } catch (error) {
      failure = error;
    }
    // Durable purge can fail; memory authorization must still be withdrawn.
    if (!all) {
      this.deliveries.delete(userId);
      this.purgeDelegatedActor(userId);
    }
    for (const p of suspended)
      try {
        this.options.lobby.store.suspendShared(
          p.sessionId,
          p.authorId,
          p.recipientId,
          p.revision,
        );
      } catch (error) {
        failure = error;
      }
    try {
      this.options.lobby.store.deleteShared(
        this.options.lobby.pin.sessionId,
        stale.map((p) => p.id),
      );
    } catch (error) {
      failure = error;
    }
    this.notify();
    if (failure) throw failure;
  }

  dispose() {
    this.disposed = true;
    this.seed.fill(0);
    this.purge();
    this.athletes.clear();
    this.athletePlans.clear();
    this.grants.clear();
    this.deliveries.clear();
    this.progress.clear();
    this.listeners.clear();
  }
}
