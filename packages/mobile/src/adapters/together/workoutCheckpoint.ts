import type { TogetherRecoveryExecution } from "../../domain/ports/togetherOfflineApi.port";
import {
  TogetherWorkoutRecovery,
  snapshotToken,
  type RecoveryState,
  type WorkoutRecoveryOptions,
} from "./workoutRecovery";
import type { WorkoutSession } from "../../domain/models/session";
import type {
  TogetherWorkoutPort,
  TogetherWorkoutStatus,
  TogetherWorkoutReview,
} from "../../domain/ports/togetherWorkout.port";
import {
  TogetherJournal,
  type TogetherJournalDatabase,
} from "../storage/togetherJournal";
import {
  commandFromEnvelope,
  readOwnerCommand,
  type OwnerCommand,
} from "./localCommand";
import type { LocalCommand } from "./localStore";
import {
  requestHash,
  signPayload,
  type Credential,
  type Signed,
} from "./security/identity";
import { uuid, object, integer } from "./security/schema";

export interface WorkoutAuthority {
  sessionId: string;
  executionId: string;
  credential: Signed<Credential>;
  seed: Uint8Array;
  sharing: "active" | "reconnecting";
  send(command: LocalCommand): Promise<void>;
}
type Plan = {
  name: string;
  exercises: {
    planExerciseId: string;
    exerciseId: string;
    order: number;
    targetSets: number;
  }[];
};
type Projection = Record<
  string,
  {
    planExerciseId: string;
    set: { setId: string; reps: number; weightKg: number; completed: boolean };
  }
>;
export interface Checkpoint {
  recovery?: RecoveryState;
  controls?: {
    restEndsAt: string | null;
    skipped: Record<string, boolean>;
    substitutions: Record<string, string | null>;
  };
  snapshot: WorkoutSession;
  sessionId: string;
  executionId: string;
  credential: Signed<Credential>;
  startedAt: number;
  plan: Plan;
  planHash: string;
  structure: string;
  exerciseIds: Record<string, string>;
  setIds: Record<string, string>;
  projected: Projection;
  intents: { payload: OwnerCommand; command?: LocalCommand }[];
  error?: string;
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const unsupported = () => {
  throw new Error("workout-unsupported");
};
function validate(session: WorkoutSession, promoting = false) {
  if (
    (session.restEndsAt != null &&
      (typeof session.restEndsAt !== "string" ||
        !Number.isFinite(Date.parse(session.restEndsAt)) ||
        new Date(session.restEndsAt).toISOString() !== session.restEndsAt)) ||
    session.status !== "in_progress" ||
    session.withClient ||
    session.retrospectiveCompletedAt != null ||
    session.retrospectiveDurationSeconds != null ||
    !Number.isSafeInteger(Date.parse(session.startedAt)) ||
    Date.parse(session.startedAt) < 0 ||
    !session.name.trim() ||
    session.name.length > 120 ||
    session.exercises.length < 1 ||
    session.exercises.length > 100
  )
    unsupported();
  const ids = new Set<string>(),
    sets = new Set<string>();
  for (const e of session.exercises) {
    if (
      !e.id ||
      ids.has(e.id) ||
      !uuid(e.exerciseId) ||
      e.sessionId !== session.id ||
      (e.category !== undefined && e.category !== "strength") ||
      e.isSubstituted ||
      (e.skipped !== undefined && typeof e.skipped !== "boolean") ||
      (promoting
        ? e.originalExerciseId !== null
        : e.originalExerciseId !== null && !uuid(e.originalExerciseId)) ||
      e.supersetGroup !== null ||
      !Number.isInteger(e.sortOrder) ||
      e.sortOrder < 0 ||
      e.sortOrder > 99 ||
      (promoting && e.sets.length < 1) ||
      e.sets.length > 100
    )
      unsupported();
    ids.add(e.id);
    for (const s of e.sets) {
      if (
        !s.id ||
        sets.has(s.id) ||
        s.sessionExerciseId !== e.id ||
        s.rpe !== null ||
        s.durationSeconds !== null ||
        s.distanceMeters !== null ||
        (s.weightKg !== null &&
          (!Number.isFinite(s.weightKg) ||
            s.weightKg < 0 ||
            s.weightKg > 9999.99)) ||
        (s.reps !== null &&
          (!Number.isInteger(s.reps) || s.reps < 0 || s.reps > 10000))
      )
        unsupported();
      sets.add(s.id);
    }
  }
}
const structure = (s: WorkoutSession) =>
  requestHash({
    name: s.name,
    startedAt: s.startedAt,
    exercises: s.exercises.map((e) => ({
      id: e.id,
      exerciseId: e.originalExerciseId ?? e.exerciseId,
      order: e.sortOrder,
    })),
  });

export function checkpointExecution(c: Checkpoint): TogetherRecoveryExecution {
  return {
    exercises: c.plan.exercises.map((p) => ({
      planExerciseId: p.planExerciseId,
      skipped: c.controls?.skipped[p.planExerciseId] ?? false,
      substituteExerciseId: c.controls?.substitutions[p.planExerciseId] ?? null,
      sets: Object.values(c.projected)
        .filter((s) => s.planExerciseId === p.planExerciseId)
        .map((s) => s.set),
    })),
    restEndsAt: c.controls?.restEndsAt ?? null,
  };
}

/** Full personal checkpoint is the authority; sharing is a bounded projection of it. */
export class TogetherWorkoutCheckpoint implements TogetherWorkoutPort {
  private listeners = new Set<() => void>();
  private accountGeneration = 0;
  private observedAccount: string | null = null;
  private recoveryRuntime?: TogetherWorkoutRecovery;
  private flights = new Map<string, "uploading" | "saving">();
  constructor(
    private readonly db: TogetherJournalDatabase,
    private readonly account: () => string | null,
    private readonly authority: () => WorkoutAuthority | undefined,
    private readonly randomUUID: () => string,
    recovery?: WorkoutRecoveryOptions,
  ) {
    if (recovery)
      this.recoveryRuntime = new TogetherWorkoutRecovery(recovery, randomUUID);
    db.execSync(
      `CREATE TABLE IF NOT EXISTS together_workout_checkpoint (account_id TEXT NOT NULL, local_session_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(account_id, local_session_id));`,
    );
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private accessGeneration() {
    const account = this.account();
    if (account !== this.observedAccount) {
      this.observedAccount = account;
      this.accountGeneration++;
    }
    return this.accountGeneration;
  }
  changed() {
    this.accessGeneration();
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* A consumer cannot undo a durable write. */
      }
    }
  }
  private load(userId: string, localId: string): Checkpoint | null {
    if (this.account() !== userId) return null;
    const row = this.db.getFirstSync<{ payload: string }>(
      "SELECT payload FROM together_workout_checkpoint WHERE account_id = ? AND local_session_id = ?",
      [userId, localId],
    );
    return row ? (JSON.parse(row.payload) as Checkpoint) : null;
  }
  discard(userId: string, localId: string) {
    const c = this.load(userId, localId);
    if (!c) throw new Error("workout-not-promoted");
    c.snapshot = {
      ...c.snapshot,
      status: "cancelled",
      completedAt: new Date().toISOString(),
    };
    this.persist(c, []);
    this.changed();
  }
  read(userId: string, localId: string): WorkoutSession | null {
    const checkpoint = this.load(userId, localId);
    return checkpoint ? this.editableSnapshot(checkpoint) : null;
  }
  getActive(userId: string): WorkoutSession | null {
    if (this.account() !== userId) return null;
    const rows = this.db.getAllSync<{ payload: string }>(
      "SELECT payload FROM together_workout_checkpoint WHERE account_id = ? ORDER BY local_session_id",
      [userId],
    );
    for (const row of rows) {
      const checkpoint = JSON.parse(row.payload) as Checkpoint;
      if (checkpoint.snapshot.status === "in_progress")
        return this.editableSnapshot(checkpoint);
    }
    return null;
  }
  private editableSnapshot(checkpoint: Checkpoint): WorkoutSession {
    return {
      ...copy(checkpoint.snapshot),
      together: {
        sessionId: checkpoint.sessionId,
        executionId: checkpoint.executionId,
        ...(checkpoint.snapshot.status === "completed" &&
        checkpoint.recovery?.review?.historyId
          ? { historyId: checkpoint.recovery.review.historyId }
          : {}),
        checkpointVersion: snapshotToken(checkpoint),
      },
    };
  }
  status(userId: string, localId: string): TogetherWorkoutStatus | null {
    const c = this.load(userId, localId);
    if (!c) return null;
    const receivedCount = new TogetherJournal(this.db, userId)
      .list(c.sessionId, c.executionId)
      .filter((e) => e.peerReceipts.length > 0).length;
    const auth = this.match(c);
    return {
      sessionId: c.sessionId,
      executionId: c.executionId,
      localSessionId: localId,
      receivedCount,
      pendingCount: c.intents.length - receivedCount,
      sharing: c.error ? "paused" : (auth?.sharing ?? "local-only"),
      ...(c.error ? { error: c.error } : {}),
      ...(this.flights.has(`${userId}:${localId}`)
        ? { recovery: this.flights.get(`${userId}:${localId}`)! }
        : c.recovery?.review &&
            (c.snapshot.status !== "in_progress" ||
              c.recovery.review.snapshotToken === snapshotToken(c))
          ? {
              recovery:
                c.recovery.review.status === "stored_for_review"
                  ? ("review" as const)
                  : c.recovery.review.status,
            }
          : {}),
      ...(c.recovery?.error ? { recoveryError: c.recovery.error } : {}),
    };
  }
  getReview(userId: string, localId: string): TogetherWorkoutReview | null {
    const c = this.load(userId, localId);
    return c?.recovery?.review &&
      (c.snapshot.status !== "in_progress" ||
        c.recovery.review.snapshotToken === snapshotToken(c))
      ? c.recovery.review
      : null;
  }
  review(userId: string, localId: string): Promise<TogetherWorkoutReview> {
    return this.recover(userId, localId, "uploading", (access) =>
      this.recoveryRuntime!.review(access),
    );
  }
  finish(
    userId: string,
    localId: string,
    revision: number,
    token: string,
  ): Promise<TogetherWorkoutReview> {
    return this.recover(userId, localId, "saving", (access) =>
      this.recoveryRuntime!.finish(access, revision, token),
    );
  }
  private async recover(
    userId: string,
    localId: string,
    phase: "uploading" | "saving",
    action: (access: {
      load: () => Checkpoint;
      guard: () => void;
      persist: (checkpoint: Checkpoint, commands?: LocalCommand[]) => void;
    }) => Promise<TogetherWorkoutReview>,
  ) {
    if (!this.recoveryRuntime) throw new Error("recovery-unavailable");
    const generation = this.accessGeneration(),
      key = `${userId}:${localId}`;
    const guard = () => {
      if (this.account() !== userId || generation !== this.accessGeneration())
        throw new Error("workout-account");
    };
    const load = () => {
      guard();
      const checkpoint = this.load(userId, localId);
      if (!checkpoint) throw new Error("workout-not-promoted");
      return checkpoint;
    };
    load();
    if (this.flights.has(key)) throw new Error("recovery-busy");
    this.flights.set(key, phase);
    this.changed();
    try {
      return await action({
        load,
        guard,
        persist: (checkpoint, commands = []) => {
          guard();
          this.persist(checkpoint, commands);
          this.changed();
        },
      });
    } catch (error) {
      if (this.account() === userId && generation === this.accessGeneration()) {
        const checkpoint = load();
        checkpoint.recovery ??= { uploaded: 0 };
        checkpoint.recovery.error =
          error instanceof Error ? error.message : "recovery-unavailable";
        this.persist(checkpoint, []);
      }
      throw error;
    } finally {
      this.flights.delete(key);
      this.changed();
    }
  }
  getPlan(userId: string, localId: string) {
    return this.load(userId, localId)?.plan ?? null;
  }
  getOwnExecution(userId: string, localId: string) {
    const c = this.load(userId, localId);
    if (!c) return null;
    return {
      revision: c.intents.length,
      planHash: c.planHash,
      execution: checkpointExecution(c),
    };
  }
  applyOwnOperation(
    userId: string,
    localId: string,
    expectedVersion: number,
    op: Record<string, unknown>,
  ): void {
    const c = this.load(userId, localId);
    if (!c) throw new Error("workout-not-promoted");
    if (c.error || c.intents.length !== expectedVersion)
      throw new Error("workout-version-conflict");
    const snapshot = copy(c.snapshot);
    if (op.type === "rest") {
      if (
        !object(op, ["type", "endsAt"]) ||
        (op.endsAt !== null &&
          (typeof op.endsAt !== "string" ||
            !Number.isFinite(Date.parse(op.endsAt)) ||
            new Date(op.endsAt).toISOString() !== op.endsAt))
      )
        throw new Error("workout-invalid-operation");
      snapshot.restEndsAt = op.endsAt as string | null;
    } else {
      const localExercise = Object.entries(c.exerciseIds).find(
        ([, id]) => id === op.planExerciseId,
      )?.[0];
      const e = snapshot.exercises.find((e) => e.id === localExercise);
      if (!e) throw new Error("workout-invalid-operation");
      if (op.type === "skip") {
        if (
          !object(op, ["type", "planExerciseId", "skipped"]) ||
          typeof op.skipped !== "boolean"
        )
          throw new Error("workout-invalid-operation");
        e.skipped = op.skipped;
      } else if (op.type === "substitute") {
        if (
          !object(op, ["type", "planExerciseId", "exerciseId"]) ||
          (op.exerciseId !== null && !uuid(op.exerciseId))
        )
          throw new Error("workout-invalid-operation");
        const original = c.plan.exercises.find(
          (p) => p.planExerciseId === op.planExerciseId,
        )!;
        const target = (op.exerciseId as string | null) ?? original.exerciseId;
        if (
          target !== e.exerciseId &&
          c.intents.some(
            (intent) =>
              intent.payload.operation.type === "upsertSet" &&
              intent.payload.operation.planExerciseId === op.planExerciseId,
          )
        )
          throw new Error("workout-substitution-locked");
        if (target !== e.exerciseId) {
          e.exerciseId = target;
          e.exerciseName = target;
          e.originalExerciseId =
            target === original.exerciseId ? null : original.exerciseId;
          e.isSubstituted = false;
        }
      } else if (op.type === "upsertSet") {
        if (
          !object(op, ["type", "planExerciseId", "set"]) ||
          !object(op.set, ["setId", "reps", "weightKg", "completed"]) ||
          !uuid(op.set.setId) ||
          !integer(op.set.reps) ||
          op.set.reps > 10000 ||
          typeof op.set.weightKg !== "number" ||
          !Number.isFinite(op.set.weightKg) ||
          op.set.weightKg < 0 ||
          op.set.weightKg > 9999.99 ||
          op.set.completed !== true
        )
          throw new Error("workout-invalid-operation");
        const canonicalSet = op.set;
        const localSet = Object.entries(c.setIds).find(
          ([, id]) => id === canonicalSet.setId,
        )?.[0];
        let set = e.sets.find((s) => s.id === localSet);
        if (!set) {
          if (localSet || e.sets.length >= 100)
            throw new Error("workout-unknown-set");
          const localId = `local-${this.randomUUID()}`;
          Object.defineProperty(c.setIds, localId, {
            value: canonicalSet.setId,
            enumerable: true,
            writable: true,
            configurable: true,
          });
          set = {
            id: localId,
            sessionExerciseId: e.id,
            setNumber: Math.max(0, ...e.sets.map((s) => s.setNumber)) + 1,
            reps: null,
            weightKg: null,
            rpe: null,
            durationSeconds: null,
            distanceMeters: null,
            isCompleted: false,
            completedAt: null,
          };
          e.sets.push(set);
        }
        set.reps = canonicalSet.reps as number;
        set.weightKg = canonicalSet.weightKg as number;
      } else if (op.type === "removeSet") {
        if (!object(op, ["type", "planExerciseId", "setId"]) || !uuid(op.setId))
          throw new Error("workout-invalid-operation");
        const localSet = Object.entries(c.setIds).find(
          ([, id]) => id === op.setId,
        )?.[0];
        const set = e.sets.find((s) => s.id === localSet);
        if (!set) throw new Error("workout-unknown-set");
        // Keep the local row and its annotations; removing a shared set clears its values.
        set.reps = null;
        set.weightKg = null;
        set.isCompleted = false;
        set.completedAt = null;
      } else throw new Error("workout-invalid-operation");
    }
    if (c.snapshot.status !== "in_progress")
      throw new Error("workout-finished");
    this.write(c, snapshot);
  }
  private match(c: Checkpoint) {
    const auth = this.authority();
    return auth &&
      auth.sessionId === c.sessionId &&
      auth.executionId === c.executionId &&
      requestHash(auth.credential) === requestHash(c.credential)
      ? auth
      : undefined;
  }
  async promote(session: WorkoutSession): Promise<void> {
    // No await before the complete atomic promotion: caller's snapshot cannot go stale.
    if (this.account() !== session.userId) throw new Error("workout-account");
    const existing = this.load(session.userId, session.id);
    const auth = this.authority();
    if (!auth) throw new Error("workout-not-admitted");
    if (existing) {
      if (
        existing.sessionId !== auth.sessionId ||
        existing.executionId !== auth.executionId
      )
        throw new Error("workout-already-promoted");
      return;
    }
    if (session.together || this.getActive(session.userId))
      throw new Error("workout-already-promoted");
    validate(session, true);
    const exerciseIds: Record<string, string> = Object.fromEntries(
      session.exercises.map((e) => [e.id, this.randomUUID()]),
    );
    const plan: Plan = {
      name: session.name,
      exercises: session.exercises.map((e) => ({
        planExerciseId: exerciseIds[e.id],
        exerciseId: e.exerciseId,
        order: e.sortOrder,
        targetSets: e.sets.length,
      })),
    };
    const c: Checkpoint = {
      snapshot: copy(session),
      sessionId: auth.sessionId,
      executionId: auth.executionId,
      credential: copy(auth.credential),
      startedAt: Date.parse(session.startedAt),
      plan,
      planHash: requestHash(plan),
      structure: structure(session),
      exerciseIds,
      setIds: {},
      projected: {},
      intents: [],
    };
    this.write(c, session);
  }
  save(userId: string, session: WorkoutSession): void {
    if (this.account() !== userId || session.userId !== userId)
      throw new Error("workout-account");
    const c = this.load(userId, session.id);
    if (!c) throw new Error("workout-not-promoted");
    if (c.snapshot.status !== "in_progress")
      throw new Error("workout-finished");
    // The version must travel with the editor's snapshot. Reading the latest
    // version here would bless an old full snapshot and delete delegated sets.
    if (session.together?.checkpointVersion !== snapshotToken(c))
      throw new Error("workout-version-conflict");
    this.write(c, session);
  }
  private write(c: Checkpoint, session: WorkoutSession) {
    c.snapshot = {
      ...copy(session),
      together: { sessionId: c.sessionId, executionId: c.executionId },
    };
    const auth = this.match(c);
    const commands: LocalCommand[] = [];
    try {
      validate(session);
      if (structure(session) !== c.structure)
        throw new Error("workout-plan-changed");
    } catch (error) {
      c.error = (error as Error).message;
    }
    // Pausing is sticky: restarting or restoring fields never silently resumes sharing.
    const controlOperations: Record<string, unknown>[] = [];
    if (!c.error) {
      const controls = c.controls ?? {
        restEndsAt: null,
        skipped: {},
        substitutions: {},
      };
      for (const e of session.exercises) {
        const planId = c.exerciseIds[e.id],
          plan = c.plan.exercises.find((p) => p.planExerciseId === planId)!;
        const substitute =
          e.exerciseId === plan.exerciseId ? null : e.exerciseId;
        if (substitute !== (controls.substitutions[planId] ?? null)) {
          if (
            c.intents.some(
              (i) =>
                i.payload.operation.type === "upsertSet" &&
                i.payload.operation.planExerciseId === planId,
            )
          ) {
            c.error = "workout-substitution-locked";
            break;
          }
          controlOperations.push({
            type: "substitute",
            planExerciseId: planId,
            exerciseId: substitute,
          });
        }
        if ((e.skipped ?? false) !== (controls.skipped[planId] ?? false))
          controlOperations.push({
            type: "skip",
            planExerciseId: planId,
            skipped: e.skipped ?? false,
          });
      }
      if ((session.restEndsAt ?? null) !== controls.restEndsAt)
        controlOperations.push({
          type: "rest",
          endsAt: session.restEndsAt ?? null,
        });
    }
    if (!c.error) {
      c.controls = {
        restEndsAt: session.restEndsAt ?? null,
        skipped: Object.fromEntries(
          session.exercises.map((e) => [
            c.exerciseIds[e.id],
            e.skipped ?? false,
          ]),
        ),
        substitutions: Object.fromEntries(
          session.exercises.map((e) => [
            c.exerciseIds[e.id],
            e.exerciseId ===
            c.plan.exercises.find(
              (p) => p.planExerciseId === c.exerciseIds[e.id],
            )!.exerciseId
              ? null
              : e.exerciseId,
          ]),
        ),
      };
      // If the same admitted authority is restored, fill earlier unsigned versions
      // before projecting newer edits. Never skip a durable intent in the chain.
      if (auth)
        for (const intent of c.intents) {
          if (intent.command) continue;
          const command = commandFromEnvelope(
            signPayload(intent.payload, auth.seed),
          );
          readOwnerCommand(command, c.credential);
          intent.command = command;
          commands.push(command);
        }
      const projected: Projection = Object.create(null);
      for (const e of session.exercises)
        for (const s of e.sets) {
          if (!Object.hasOwn(c.setIds, s.id))
            Object.defineProperty(c.setIds, s.id, {
              value: this.randomUUID(),
              enumerable: true,
              configurable: true,
              writable: true,
            });
          if (s.reps !== null && s.weightKg !== null)
            projected[s.id] = {
              planExerciseId: c.exerciseIds[e.id],
              set: {
                setId: c.setIds[s.id],
                reps: s.reps,
                weightKg: s.weightKg,
                completed: true,
              },
            };
        }
      const operations: Record<string, unknown>[] = controlOperations;
      for (const [id, value] of Object.entries(c.projected))
        if (
          !projected[id] ||
          projected[id].planExerciseId !== value.planExerciseId
        )
          operations.push({
            type: "removeSet",
            planExerciseId: value.planExerciseId,
            setId: value.set.setId,
          });
      for (const [id, value] of Object.entries(projected))
        if (requestHash(value) !== requestHash(c.projected[id] ?? null))
          operations.push({ type: "upsertSet", ...value });
      for (const operation of operations) {
        const payload: OwnerCommand = {
          kind: "together-recovery-v1",
          userId: session.userId,
          sessionId: c.sessionId,
          executionId: c.executionId,
          commandId: this.randomUUID(),
          planHash: c.planHash,
          startedAt: c.startedAt,
          expectedVersion: c.intents.length,
          operation,
        };
        const command = auth
          ? commandFromEnvelope(signPayload(payload, auth.seed))
          : undefined;
        if (command) {
          readOwnerCommand(command, c.credential);
          commands.push(command);
        }
        c.intents.push({ payload, ...(command ? { command } : {}) });
      }
      c.projected = projected;
    }
    this.persist(c, commands);
    this.changed();
    for (const command of commands)
      void auth!.send(command).catch(() => this.changed());
  }
  private persist(c: Checkpoint, commands: LocalCommand[]) {
    // The journal and checkpoint share one transaction, including all prior-set promotion.
    const journal = new TogetherJournal(
      {
        execSync: this.db.execSync.bind(this.db),
        runSync: this.db.runSync.bind(this.db),
        getFirstSync: this.db.getFirstSync.bind(this.db),
        getAllSync: this.db.getAllSync.bind(this.db),
        withTransactionSync: (action) => action(),
      },
      c.snapshot.userId,
    );
    this.db.withTransactionSync(() => {
      for (const command of commands) journal.append(command);
      this.db.runSync(
        "INSERT INTO together_workout_checkpoint(account_id, local_session_id, payload) VALUES (?, ?, ?) ON CONFLICT(account_id, local_session_id) DO UPDATE SET payload = excluded.payload",
        [c.snapshot.userId, c.snapshot.id, JSON.stringify(c)],
      );
    });
  }
}
