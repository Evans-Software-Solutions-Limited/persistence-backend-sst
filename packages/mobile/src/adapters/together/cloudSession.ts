import type {
  TogetherCloudApi,
  TogetherCloudPort,
  TogetherCloudState,
  CloudDraft,
  CloudJoin,
  CloudCommand,
  CloudExecution,
  CloudSnapshot,
} from "../../domain/ports/togetherCloud.port";
import {
  EXERCISE_CATEGORIES,
  type ExerciseCategory,
} from "../../domain/models/exercise";
import type { WorkoutSession } from "../../domain/models/session";
import type { TogetherJournalDatabase } from "../storage/togetherJournal";
import {
  mergeCloudExecution,
  cloudProjection,
  cloudOperations,
  promoteCloudDraft,
  type CloudMapping,
} from "./cloudDraft";
import { cloudSnapshot } from "./cloudSchema";
import { requestHash } from "./security/identity";
import { uuid } from "./security/schema";
import type { Result } from "../../shared/errors/result";
import type { TogetherOfflineApiError } from "../../domain/ports/togetherOfflineApi.port";
type Mutation =
  | "remove"
  | "create"
  | "join"
  | "cancelJoin"
  | "decide"
  | "command"
  | "delegation"
  | "consent"
  | "visibility"
  | "finish"
  | "close"
  | "review"
  | "invite"
  | "revokeInvite";
interface Action {
  method: Mutation;
  args: unknown[];
  own?: boolean;
}
interface Durable {
  detached?: boolean;
  retainedLocalChanges?: boolean;
  projectionConflict?: boolean;
  desiredPlanHash?: string;
  draft?: CloudDraft;
  personal?: WorkoutSession;
  mapping: CloudMapping;
  desired?: CloudExecution;
  sessionId?: string;
  requestId?: string;
  joinStatus?: "pending" | "approved" | "rejected" | "unavailable";
  pending: Action[];
  own?: CloudSnapshot;
  error?: string;
}
export interface CloudControllerOptions {
  api: TogetherCloudApi;
  db: TogetherJournalDatabase;
  randomUUID: () => string;
  now?: () => number;
  pollMs?: number;
}
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const unwrap = <T>(result: Result<T, TogetherOfflineApiError>): T => {
  if (!result.ok)
    throw new Error(result.error.togetherCode ?? result.error.code);
  return result.value;
};
const empty = (): TogetherCloudState => ({
  phase: "idle",
  requests: [],
  previous: {},
  pendingCount: 0,
});
/** Server-authoritative remote collaboration. No automatic LAN/cloud authority switching. */
export class TogetherCloudController implements TogetherCloudPort {
  private state = empty();
  private listeners = new Set<() => void>();
  private account: string | null = null;
  private generation = 0;
  private active = true;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  private draining?: Promise<unknown>;
  private refreshing?: Promise<void>;
  private mutationResults = new Map<
    string,
    { done: boolean; value?: unknown }
  >();
  constructor(private readonly options: CloudControllerOptions) {
    options.db.execSync(
      "CREATE TABLE IF NOT EXISTS together_cloud_workout(account_id TEXT PRIMARY KEY,payload TEXT NOT NULL)",
    );
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(change: Partial<TogetherCloudState>) {
    const stored = this.load();
    this.state = {
      ...this.state,
      ...change,
      canDetachDraft:
        !!stored?.personal &&
        !stored.own &&
        !stored.pending.length &&
        stored.joinStatus === "rejected",
    };
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* UI cannot interrupt durable state. */
      }
    }
  }
  private load(account = this.account): Durable | null {
    if (!account) return null;
    const row = this.options.db.getFirstSync<{ payload: string }>(
      "SELECT payload FROM together_cloud_workout WHERE account_id = ?",
      [account],
    );
    return row ? JSON.parse(row.payload) : null;
  }
  private persist(value: Durable) {
    if (!this.account) throw new Error("cloud-account");
    this.options.db.runSync(
      "INSERT INTO together_cloud_workout(account_id,payload) VALUES (?,?) ON CONFLICT(account_id) DO UPDATE SET payload=excluded.payload",
      [this.account, JSON.stringify(value)],
    );
    this.publish({ pendingCount: value.pending.length });
  }
  private context() {
    if (!this.account || !this.active || this.disposed)
      throw new Error("cloud-unavailable");
    return { account: this.account, generation: this.generation };
  }
  private guard(context: ReturnType<TogetherCloudController["context"]>) {
    if (
      context.account !== this.account ||
      context.generation !== this.generation ||
      !this.active ||
      this.disposed
    )
      throw new Error("cloud-cancelled");
  }
  private reset() {
    ++this.generation;
    clearTimeout(this.timer);
    this.state = empty();
    this.draining = undefined;
    this.refreshing = undefined;
    this.mutationResults.clear();
    this.publish({});
  }
  setAccount(userId: string | null) {
    if (this.account === userId) return;
    this.account = userId;
    this.reset();
  }
  setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    this.reset();
  }
  async cancelJoin() {
    const stored = this.load();
    if (!stored?.requestId || stored.joinStatus !== "pending")
      throw new Error("cloud-not-pending");
    await this.queue("cancelJoin", [
      stored.requestId,
      this.options.randomUUID(),
    ]);
  }
  cancel() {
    this.reset();
  }
  dispose() {
    this.disposed = true;
    this.reset();
    this.listeners.clear();
  }
  readDraft(userId: string) {
    if (userId !== this.account) return null;
    const stored = this.load();
    return stored?.detached ? null : (stored?.personal ?? null);
  }
  detachDraft(
    userId: string,
    persistPersonal: (draft: WorkoutSession) => void,
  ) {
    const context = this.context();
    if (userId !== this.account) throw new Error("cloud-account");
    const stored = this.load();
    if (
      !stored?.personal ||
      stored.own ||
      stored.pending.length ||
      stored.joinStatus !== "rejected"
    )
      throw new Error("cloud-cannot-detach");
    stored.detached = true;
    delete stored.personal.together;
    try {
      this.options.db.withTransactionSync(() => {
        this.persist(stored);
        this.guard(context);
        persistPersonal(copy(stored.personal!));
        this.guard(context);
      });
    } catch (error) {
      this.publish({});
      throw error;
    }
    this.publish({ phase: "idle", snapshot: undefined, error: undefined });
    return copy(stored.personal);
  }
  private own() {
    const s = this.state.snapshot,
      p = s?.participants.find((p) => p.userId === this.account);
    if (!s || !p) throw new Error("cloud-not-admitted");
    return { s, p };
  }
  private schedule() {
    clearTimeout(this.timer);
    if (
      this.account &&
      this.active &&
      !this.disposed &&
      this.state.phase !== "idle"
    )
      this.timer = setTimeout(() => {
        void this.refresh().catch(() => {});
      }, this.options.pollMs ?? 5000);
  }
  private accept(snapshot: CloudSnapshot) {
    if (!cloudSnapshot(snapshot)) throw new Error("cloud-invalid-response");
    const own = snapshot.participants.find((p) => p.userId === this.account);
    if (!own || !own.execution) throw new Error("cloud-invalid-response");
    const stored = this.load();
    if (!stored) throw new Error("cloud-missing-draft");
    if (stored.sessionId && stored.sessionId !== snapshot.sessionId)
      throw new Error("cloud-authority-conflict");
    if (
      this.state.snapshot &&
      this.state.snapshot.sessionId === snapshot.sessionId &&
      snapshot.revision <
        Math.max(this.state.snapshot.revision, stored.own?.revision ?? 0)
    )
      return;
    stored.sessionId = snapshot.sessionId;
    const createdPersonal = !stored.personal;
    if (!stored.personal) {
      const id = this.options.randomUUID();
      stored.personal = {
        id,
        userId: this.account!,
        workoutId: null,
        name: snapshot.plan.name,
        status: "in_progress",
        startedAt: new Date((this.options.now ?? Date.now)()).toISOString(),
        completedAt: null,
        notes: null,
        exercises: snapshot.plan.exercises.map((p) => {
          const eid = this.options.randomUUID();
          stored.mapping.exercises[eid] = p.planExerciseId;
          const definition = own.exerciseCatalog[p.exerciseId];
          return {
            id: eid,
            sessionId: id,
            exerciseId: p.exerciseId,
            exerciseName:
              typeof definition?.name === "string"
                ? definition.name
                : "Exercise",
            category: EXERCISE_CATEGORIES.includes(
              definition?.category as ExerciseCategory,
            )
              ? (definition.category as ExerciseCategory)
              : undefined,
            sortOrder: p.order,
            supersetGroup: null,
            isSubstituted: false,
            originalExerciseId: null,
            notes: null,
            sets: [],
          };
        }),
      };
    }
    if (createdPersonal) {
      mergeCloudExecution(
        stored.personal!,
        own.execution,
        stored.mapping,
        this.options.randomUUID,
      );
      stored.desired = copy(own.execution);
      stored.desiredPlanHash = requestHash(snapshot.plan);
    }
    if (
      stored.desired &&
      !stored.pending.length &&
      !stored.error &&
      !stored.retainedLocalChanges
    ) {
      mergeCloudExecution(
        stored.personal,
        own.execution,
        stored.mapping,
        this.options.randomUUID,
      );
      stored.desired = copy(own.execution);
      stored.desiredPlanHash = requestHash(snapshot.plan);
    }

    if (stored.personal && !stored.desired && !stored.error) {
      try {
        const desired = cloudProjection(
          stored.personal,
          snapshot.plan,
          stored.mapping,
          this.options.randomUUID,
        );
        let revision = own.ownRevision;
        for (const operation of cloudOperations(own.execution, desired)) {
          const commandId = this.options.randomUUID();
          stored.pending.push({
            method: "command",
            args: [
              snapshot.sessionId,
              commandId,
              {
                commandId,
                expectedVersion: revision++,
                target: { kind: "execution", athleteId: this.account },
                operation,
              },
            ],
            own: true,
          });
        }
        stored.desired = desired;
        stored.desiredPlanHash = requestHash(snapshot.plan);
      } catch (error) {
        stored.error =
          error instanceof Error ? error.message : "cloud-workout-unsupported";
      }
    }
    stored.own = {
      ...copy(snapshot),
      participants: [copy(own)],
      sharingActive: false,
    };
    if (stored.personal) {
      stored.personal.together = {
        sessionId: snapshot.sessionId,
        executionId: stored.draft?.clientDraftId ?? snapshot.sessionId,
        transport: "cloud",
      };
      if (
        ["saved", "finished_empty"].includes(own.status) &&
        !stored.pending.length &&
        !stored.error &&
        !stored.retainedLocalChanges
      )
        stored.personal.status =
          own.status === "saved" ? "completed" : "cancelled";
    }
    this.persist(stored);
    // All partner-derived data is replaced, never merged across consent changes.
    this.publish({
      snapshot: copy(snapshot),
      previous: {},
      phase:
        own.status === "saved" || own.status === "finished_empty"
          ? "finished"
          : snapshot.sharingActive
            ? "active"
            : "private",
      error: stored.error,
    });
  }
  async hostWorkout(session: WorkoutSession) {
    if (session.userId !== this.account) throw new Error("cloud-account");
    const { draft, mapping } = promoteCloudDraft(
      session,
      this.options.randomUUID,
    );
    await this.host(draft, mapping);
  }
  async host(
    draft: CloudDraft,
    mapping: CloudMapping = { exercises: {}, sets: {} },
  ) {
    this.context();
    const old = this.load();
    if (
      old &&
      !old.detached &&
      (old.pending.length ||
        old.personal?.status === "in_progress" ||
        old.own?.completion.status === "active")
    )
      throw new Error("cloud-workout-exists");
    if (draft.personalDraft && draft.personalDraft.userId !== this.account)
      throw new Error("cloud-account");
    const { personalDraft, ...body } = copy(draft);
    const record: Durable = {
      draft: copy(draft),
      personal: personalDraft,
      mapping,
      desired: copy(draft.ownExecution),
      desiredPlanHash: requestHash(draft.plan),
      pending: [{ method: "create", args: [this.options.randomUUID(), body] }],
    };
    if (record.personal)
      record.personal.together = {
        sessionId: draft.clientDraftId,
        executionId: draft.clientDraftId,
        transport: "cloud",
      };
    this.persist(record);
    this.publish({ phase: "preparing", error: undefined });
    await this.drain();
  }
  async join(target: CloudJoin, personalDraft?: WorkoutSession) {
    this.context();
    if (
      personalDraft &&
      (personalDraft.userId !== this.account || personalDraft.together)
    )
      throw new Error("cloud-authority-conflict");
    const old = this.load();
    if (
      old &&
      !old.detached &&
      (old.pending.length || old.personal?.status === "in_progress")
    )
      throw new Error("cloud-workout-exists");
    const stored: Durable = {
      personal: personalDraft ? copy(personalDraft) : undefined,
      mapping: { exercises: {}, sets: {} },
      pending: [
        {
          method: "join",
          args: [
            this.options.randomUUID(),
            {
              ...copy(target),
              ...(personalDraft ? { startedAt: personalDraft.startedAt } : {}),
            },
          ],
        },
      ],
    };
    if (stored.personal) {
      const id = this.options.randomUUID();
      stored.personal.together = {
        sessionId: id,
        executionId: id,
        transport: "cloud",
      };
    }
    this.persist(stored);
    this.publish({ phase: "preparing", error: undefined });
    await this.drain();
  }
  async resume(sessionId: string) {
    this.context();
    if (!uuid(sessionId)) throw new Error("cloud-invalid-session");
    const existing = this.load();
    if (
      existing?.sessionId &&
      existing.sessionId !== sessionId &&
      existing.personal?.status === "in_progress"
    )
      throw new Error("cloud-authority-conflict");
    const stored = existing ?? {
      pending: [],
      mapping: { exercises: {}, sets: {} },
    };
    stored.sessionId = sessionId;
    this.persist(stored);
    this.publish({ phase: "reconnecting", error: undefined });
    await this.retry();
  }
  async retry() {
    await this.drain();
    await this.refresh();
  }
  private fail(error: unknown) {
    const code = error instanceof Error ? error.message : "cloud-unavailable";
    const stored = this.load();
    const snapshot = stored?.own;
    this.publish({
      phase: ["network", "timeout"].includes(code)
        ? "reconnecting"
        : "unavailable",
      snapshot,
      previous: {},
      requests: [],
      error: code,
    });
  }
  async refresh() {
    if (this.refreshing) return this.refreshing;
    const context = this.context();
    const operation = (async () => {
      try {
        const stored = this.load();
        if (!stored) return;
        if (stored.requestId && stored.joinStatus !== "approved") {
          const result = unwrap(
            await this.options.api.joinStatus(stored.requestId),
          );
          this.guard(context);
          const fresh = this.load()!;
          fresh.joinStatus = result.status;
          fresh.sessionId = result.sessionId;
          this.persist(fresh);
          if (result.status === "pending") {
            this.publish({ phase: "pending-approval" });
            return;
          }
          if (result.status !== "approved")
            throw new Error(`cloud-join-${result.status}`);
        }
        const id = this.load()?.sessionId;
        if (!id) return;
        const snapshot = unwrap(await this.options.api.snapshot(id));
        this.guard(context);
        this.accept(snapshot);
        if (snapshot.hostId === this.account && snapshot.sharingActive) {
          const requests = unwrap(await this.options.api.requests(id));
          this.guard(context);
          if (this.state.snapshot?.revision === snapshot.revision)
            this.publish({ requests: requests.data });
        }
      } catch (error) {
        if (context.generation === this.generation) this.fail(error);
        throw error;
      } finally {
        if (context.generation === this.generation) this.schedule();
      }
    })();
    this.refreshing = operation;
    try {
      await operation;
    } finally {
      if (this.refreshing === operation) this.refreshing = undefined;
    }
  }
  private async drain() {
    if (this.draining) return this.draining;
    const context = this.context();
    const operation = (async () => {
      let latest: unknown;
      try {
        for (;;) {
          const stored = this.load();
          const next = stored?.pending[0];
          if (!stored || !next) break;
          if (next.method === "command" && next.args[0] === null) {
            if (!stored.sessionId) throw new Error("cloud-awaiting-plan");
            next.args[0] = stored.sessionId;
            this.persist(stored);
          }
          const method = this.options.api[next.method] as (
            ...args: never[]
          ) => Promise<Result<unknown, TogetherOfflineApiError>>;
          const response = await method(...(next.args as never[]));
          this.guard(context);
          if (
            !response.ok &&
            response.error.togetherCode === "VERSION_CONFLICT"
          ) {
            const conflicted = this.load()!;
            if (requestHash(conflicted.pending[0]) !== requestHash(next))
              throw new Error("cloud-outbox-conflict");
            conflicted.pending.shift();
            if (
              next.own ||
              ["finish", "close", "review"].includes(next.method)
            ) {
              // Subsequent owner versions and completion requests depend on the
              // rejected write. Preserve the full draft for explicit review.
              conflicted.pending = conflicted.pending.filter(
                (action) =>
                  !action.own &&
                  !["finish", "close", "review"].includes(action.method),
              );
              conflicted.projectionConflict = true;
              conflicted.error = "cloud-own-version-conflict";
            }
            this.persist(conflicted);
          }
          latest = unwrap(response);
          const resultKey = requestHash(next);
          if (this.mutationResults.has(resultKey))
            this.mutationResults.set(resultKey, { done: true, value: latest });
          const fresh = this.load()!;
          if (requestHash(fresh.pending[0]) !== requestHash(next))
            throw new Error("cloud-outbox-conflict");
          fresh.pending.shift();
          if (next.method === "create") {
            const created = latest as {
              sessionId: string;
              snapshot: CloudSnapshot;
            };
            fresh.sessionId = created.sessionId;
            const owner = created.snapshot.participants.find(
              (p) => p.userId === this.account,
            );
            if (!owner) throw new Error("cloud-invalid-response");
            fresh.own = {
              ...created.snapshot,
              participants: [owner],
              sharingActive: false,
            };
          }
          if (next.method === "join") {
            const joined = latest as {
              requestId: string;
              sessionId: string;
              status: "pending" | "approved";
            };
            fresh.requestId = joined.requestId;
            fresh.sessionId = joined.sessionId;
            fresh.joinStatus = joined.status;
          }
          if (next.method === "command" && next.own) {
            const own = fresh.own?.participants.find(
              (p) => p.userId === this.account,
            );
            if (own) {
              own.ownRevision =
                (next.args[2] as CloudCommand).expectedVersion + 1;
              fresh.own!.revision = (latest as { revision: number }).revision;
            }
          }
          if (next.method === "cancelJoin") fresh.joinStatus = "rejected";
          this.persist(fresh);
          if (next.method === "create")
            this.accept((latest as { snapshot: CloudSnapshot }).snapshot);
        }
        if (this.load()?.joinStatus === "rejected") {
          this.publish({ phase: "unavailable", error: "cloud-join-rejected" });
          return latest;
        }
        await this.refresh();
        return latest;
      } catch (error) {
        if (context.generation === this.generation) this.fail(error);
        throw error;
      }
    })();
    this.draining = operation;
    try {
      return await operation;
    } finally {
      if (this.draining === operation) {
        this.draining = undefined;
        if (this.load()?.pending.length && !this.state.error)
          void this.drain().catch(() => {});
      }
    }
  }
  private async queue(
    method: Mutation,
    args: unknown[],
    own = false,
    retainedLocalChanges?: boolean,
  ) {
    const context = this.context();
    const stored = this.load();
    if (!stored) throw new Error("cloud-not-admitted");
    if (retainedLocalChanges !== undefined)
      stored.retainedLocalChanges = retainedLocalChanges;
    const action = { method, args, own };
    const resultKey = requestHash(action);
    stored.pending.push(action);
    this.persist(stored);
    this.mutationResults.set(resultKey, { done: false });
    try {
      // A running drain may already be refreshing after its outbox loop. Its
      // completion does not acknowledge an action appended during that refresh.
      for (;;) {
        await this.drain();
        this.guard(context);
        const result = this.mutationResults.get(resultKey);
        if (result?.done) return result.value;
        if (!this.load()?.pending.some((p) => requestHash(p) === resultKey))
          throw new Error("cloud-outbox-conflict");
      }
    } finally {
      this.mutationResults.delete(resultKey);
    }
  }
  saveDraft(userId: string, session: WorkoutSession) {
    if (userId !== this.account || session.userId !== userId)
      throw new Error("cloud-account");
    const stored = this.load();
    if (!stored?.personal || stored.personal.id !== session.id)
      throw new Error("cloud-missing-draft");
    if (stored.personal.status !== "in_progress")
      throw new Error("cloud-workout-finished");
    stored.personal = {
      ...copy(session),
      ...(stored.personal.together
        ? { together: stored.personal.together }
        : {}),
    };
    try {
      const plan = stored.own?.plan ?? stored.draft?.plan;
      if (!plan) throw new Error("cloud-awaiting-plan");
      const desired = cloudProjection(
          session,
          plan,
          stored.mapping,
          this.options.randomUUID,
        ),
        previous = stored.desired ?? { exercises: [] };
      // Allocate durable canonical IDs even while sending is paused. Review reads
      // must never invent fresh IDs for the same retained personal set.
      if (stored.projectionConflict)
        throw new Error("cloud-own-version-conflict");
      stored.error = undefined;
      stored.retainedLocalChanges = false;
      const operations = cloudOperations(previous, desired);
      let revision =
        (stored.own?.participants.find((p) => p.userId === userId)
          ?.ownRevision ?? 0) +
        stored.pending.filter((p) => p.method === "command" && p.own).length;
      for (const operation of operations) {
        const commandId = this.options.randomUUID();
        stored.pending.push({
          method: "command",
          args: [
            stored.sessionId ?? null,
            commandId,
            {
              commandId,
              expectedVersion: revision++,
              target: { kind: "execution", athleteId: userId },
              operation,
            },
          ],
          own: true,
        });
      }
      stored.desired = desired;
      stored.desiredPlanHash = requestHash(plan);
    } catch (error) {
      stored.error =
        error instanceof Error && error.message === "cloud-awaiting-plan"
          ? undefined
          : error instanceof Error
            ? error.message
            : "cloud-workout-unsupported";
    }
    this.persist(stored);
    this.publish({ error: stored.error });
    if (!stored.error && this.active && !this.disposed)
      void this.drain().catch(() => {});
  }
  async publishOwnDraft() {
    const stored = this.load();
    if (!stored?.personal) throw new Error("cloud-missing-draft");
    if (stored.error) throw new Error(stored.error);
    this.saveDraft(this.account!, stored.personal);
    await this.drain();
  }
  async invite() {
    const { s } = this.own();
    return (await this.queue("invite", [
      s.sessionId,
      this.options.randomUUID(),
    ])) as { tokenId: string; token: string; expiresAt: string };
  }
  async revokeInvite(tokenId: string) {
    const { s } = this.own();
    await this.queue("revokeInvite", [
      s.sessionId,
      tokenId,
      this.options.randomUUID(),
    ]);
  }
  async decide(requestId: string, decision: "approve" | "reject") {
    const { s } = this.own();
    await this.queue("decide", [
      s.sessionId,
      requestId,
      this.options.randomUUID(),
      { decision, expectedRevision: s.revision },
    ]);
  }
  async remove(userId: string) {
    const { s } = this.own();
    await this.queue("remove", [
      s.sessionId,
      userId,
      this.options.randomUUID(),
      s.revision,
    ]);
  }
  async command(input: Omit<CloudCommand, "commandId">) {
    const { s } = this.own();
    const commandId = this.options.randomUUID();
    await this.queue(
      "command",
      [s.sessionId, commandId, { ...copy(input), commandId }],
      input.target.kind === "execution" &&
        (!input.target.athleteId || input.target.athleteId === this.account),
    );
  }
  async delegation(allowed: boolean) {
    const { s } = this.own();
    await this.queue("delegation", [
      s.sessionId,
      this.options.randomUUID(),
      allowed,
    ]);
  }
  private async setConsent(
    kind: "numbers" | "previous",
    recipientIds: string[],
  ) {
    const { s, p } = this.own();
    const current = kind === "numbers" ? p.numbersConsent : p.previousConsent;
    if (!current) throw new Error("cloud-invalid-response");
    await this.queue("consent", [
      s.sessionId,
      this.options.randomUUID(),
      kind,
      { expectedVersion: current.version, recipientIds: copy(recipientIds) },
    ]);
  }
  numbersConsent(recipientIds: string[]) {
    return this.setConsent("numbers", recipientIds);
  }
  previousConsent(recipientIds: string[]) {
    return this.setConsent("previous", recipientIds);
  }
  async previous(ownerId: string) {
    const context = this.context(),
      { s } = this.own();
    const owner = s.participants.find((p) => p.userId === ownerId);
    if (!owner?.previousValuesAvailable)
      throw new Error("cloud-previous-forbidden");
    const result = unwrap(
      await this.options.api.previous(s.sessionId, ownerId),
    );
    this.guard(context);
    const current = this.state.snapshot?.participants.find(
      (p) => p.userId === ownerId,
    );
    if (
      !current?.previousValuesAvailable ||
      this.state.snapshot?.revision !== s.revision ||
      result.sessionId !== s.sessionId ||
      result.ownerId !== ownerId ||
      result.planVersion !== s.planVersion ||
      result.ownRevision !== owner.ownRevision
    )
      throw new Error("cloud-previous-stale");
    this.publish({ previous: { ...this.state.previous, [ownerId]: result } });
  }
  async visibility(audience: "private" | "friends", expiresAt: string) {
    const { s } = this.own();
    await this.queue("visibility", [
      s.sessionId,
      this.options.randomUUID(),
      { audience, expiresAt },
    ]);
  }
  async friends(cursor?: string) {
    const context = this.context();
    const result = await this.options.api.friends(cursor);
    this.guard(context);
    return result;
  }
  async prepareReview() {
    return this.buildReview();
  }
  private buildReview() {
    const { s, p } = this.own();
    const stored = this.load()!;
    let execution = p.execution;
    if (!execution) throw new Error("cloud-invalid-response");
    const omissions: string[] = [];
    let retainedLocalChanges = false;
    if (stored.personal) {
      try {
        execution = cloudProjection(
          { ...stored.personal, status: "in_progress" },
          s.plan,
          copy(stored.mapping),
          this.options.randomUUID,
        );
      } catch {
        retainedLocalChanges = true;
        execution =
          stored.desired && stored.desiredPlanHash === requestHash(s.plan)
            ? stored.desired
            : p.execution!;
        omissions.push(
          "Only the last supported own sets shown here will be saved. Unsupported exercise, RPE, cardio or plan changes remain in your full personal draft on this device.",
        );
      }
    }
    if (stored.personal) {
      const p = stored.personal;
      if (
        p.notes ||
        p.locationName ||
        p.activityEnvironment ||
        p.exercises.some((e) => e.notes)
      )
        omissions.push("Notes and location remain on this device.");
      if (
        p.exercises.some((e) =>
          e.sets.some((set) => set.weightKg === null || set.reps === null),
        )
      )
        omissions.push("Incomplete sets remain on this device.");
    }
    return {
      plan: copy(s.plan),
      execution: copy(execution),
      token: this.reviewToken(),
      omissions,
      retainedLocalChanges,
    };
  }
  reviewToken() {
    const { s } = this.own();
    return requestHash({
      snapshot: s,
      personal: this.load()?.personal,
      pending: this.load()?.pending,
    });
  }
  private checkReview(token: string) {
    if (token !== this.reviewToken()) throw new Error("cloud-review-stale");
  }
  private requireAcknowledged(retainedLocalChanges: boolean) {
    const { s, p } = this.own();
    const stored = this.load()!;
    if (
      stored.pending.length ||
      (stored.error && !retainedLocalChanges) ||
      !p.execution
    )
      throw new Error("cloud-unsaved-work");
    if (
      stored.personal &&
      cloudOperations(
        p.execution,
        retainedLocalChanges
          ? stored.desired && stored.desiredPlanHash === requestHash(s.plan)
            ? stored.desired
            : p.execution
          : cloudProjection(
              stored.personal,
              s.plan,
              copy(stored.mapping),
              this.options.randomUUID,
            ),
      ).length
    )
      throw new Error("cloud-unsaved-work");
  }
  private async finishOwn(leave: boolean, token: string) {
    this.checkReview(token);
    const { s, p } = this.own();
    const reviewed = this.buildReview();
    if (this.load()?.projectionConflict) {
      await this.commitConflictReview(reviewed, "finish", leave);
      return;
    }
    this.requireAcknowledged(reviewed.retainedLocalChanges);
    await this.queue(
      "finish",
      [s.sessionId, this.options.randomUUID(), p.ownRevision, leave],
      false,
      reviewed.retainedLocalChanges,
    );
  }
  finish(token: string) {
    return this.finishOwn(false, token);
  }
  leave(token: string) {
    return this.finishOwn(true, token);
  }
  async close(mode: "finish_all" | "save_own", token: string) {
    this.checkReview(token);
    const { s, p } = this.own();
    const reviewed = this.buildReview();
    if (this.load()?.projectionConflict) {
      await this.commitConflictReview(reviewed, "close", mode);
      return;
    }
    this.requireAcknowledged(reviewed.retainedLocalChanges);
    await this.queue(
      "close",
      [
        s.sessionId,
        this.options.randomUUID(),
        {
          mode,
          expectedRevision: s.revision,
          expectedOwnRevision: p.ownRevision,
        },
      ],
      false,
      reviewed.retainedLocalChanges,
    );
  }
  private async commitConflictReview(
    reviewed: ReturnType<TogetherCloudController["buildReview"]>,
    method: "finish" | "close",
    choice: boolean | "finish_all" | "save_own",
  ) {
    this.context();
    const { s, p } = this.own(),
      stored = this.load()!;
    if (stored.pending.length || this.draining || !p.execution)
      throw new Error("cloud-unsaved-work");
    const operations = cloudOperations(p.execution, reviewed.execution);
    let revision = p.ownRevision;
    for (const operation of operations) {
      const commandId = this.options.randomUUID();
      stored.pending.push({
        method: "command",
        own: true,
        args: [
          s.sessionId,
          commandId,
          {
            commandId,
            expectedVersion: revision++,
            target: { kind: "execution", athleteId: this.account },
            operation,
          },
        ],
      });
    }
    stored.pending.push({
      method,
      args:
        method === "finish"
          ? [s.sessionId, this.options.randomUUID(), revision, choice]
          : [
              s.sessionId,
              this.options.randomUUID(),
              {
                mode: choice,
                expectedRevision: s.revision + operations.length,
                expectedOwnRevision: revision,
              },
            ],
    });
    stored.projectionConflict = false;
    stored.error = undefined;
    stored.retainedLocalChanges = reviewed.retainedLocalChanges;
    stored.desired = copy(reviewed.execution);
    stored.desiredPlanHash = requestHash(s.plan);
    this.persist(stored);
    await this.drain();
  }
  async reviewOwn(execution: CloudExecution, token: string) {
    this.checkReview(token);
    const { s, p } = this.own();
    if (s.sharingActive) throw new Error("cloud-sharing-active");
    const reviewed = await this.prepareReview();
    this.checkReview(token);
    if (requestHash(execution) !== requestHash(reviewed.execution))
      throw new Error("cloud-review-stale");
    const stored = this.load()!;
    stored.pending = [];
    if (!reviewed.retainedLocalChanges) stored.error = undefined;
    stored.retainedLocalChanges = reviewed.retainedLocalChanges;
    stored.projectionConflict = false;
    stored.desired = copy(execution);
    stored.desiredPlanHash = requestHash(s.plan);
    if (this.draining) throw new Error("cloud-request-in-flight");
    if (p.status === "active") {
      let revision = p.ownRevision;
      for (const operation of cloudOperations(p.execution!, execution)) {
        const commandId = this.options.randomUUID();
        stored.pending.push({
          method: "command",
          args: [
            s.sessionId,
            commandId,
            {
              commandId,
              expectedVersion: revision++,
              target: { kind: "execution", athleteId: this.account },
              operation,
            },
          ],
          own: true,
        });
      }
      stored.pending.push({
        method: "finish",
        args: [s.sessionId, this.options.randomUUID(), revision, false],
      });
      this.persist(stored);
      await this.drain();
      return;
    }
    if (p.status === "finalizing") throw new Error("cloud-finalizing");
    this.persist(stored);
    await this.queue("review", [
      s.sessionId,
      this.options.randomUUID(),
      { expectedOwnRevision: p.ownRevision, execution: copy(execution) },
    ]);
  }
}
