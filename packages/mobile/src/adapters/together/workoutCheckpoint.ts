import type { WorkoutSession } from "../../domain/models/session";
import type {
  TogetherWorkoutPort,
  TogetherWorkoutStatus,
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
import { uuid } from "./security/schema";

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
interface Checkpoint {
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
      e.originalExerciseId !== null ||
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
      exerciseId: e.exerciseId,
      order: e.sortOrder,
    })),
  });

/** Full personal checkpoint is the authority; sharing is a bounded projection of it. */
export class TogetherWorkoutCheckpoint implements TogetherWorkoutPort {
  private listeners = new Set<() => void>();
  constructor(
    private readonly db: TogetherJournalDatabase,
    private readonly account: () => string | null,
    private readonly authority: () => WorkoutAuthority | undefined,
    private readonly randomUUID: () => string,
  ) {
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
  changed() {
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
  read(userId: string, localId: string): WorkoutSession | null {
    return this.load(userId, localId)?.snapshot ?? null;
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
        return checkpoint.snapshot;
    }
    return null;
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
    };
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
    if (!c.error) {
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
      const operations: Record<string, unknown>[] = [];
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
    // The journal and checkpoint share one transaction, including all prior-set promotion.
    const journal = new TogetherJournal(
      {
        execSync: this.db.execSync.bind(this.db),
        runSync: this.db.runSync.bind(this.db),
        getFirstSync: this.db.getFirstSync.bind(this.db),
        getAllSync: this.db.getAllSync.bind(this.db),
        withTransactionSync: (action) => action(),
      },
      session.userId,
    );
    this.db.withTransactionSync(() => {
      for (const command of commands) journal.append(command);
      this.db.runSync(
        "INSERT INTO together_workout_checkpoint(account_id, local_session_id, payload) VALUES (?, ?, ?) ON CONFLICT(account_id, local_session_id) DO UPDATE SET payload = excluded.payload",
        [session.userId, session.id, JSON.stringify(c)],
      );
    });
    this.changed();
    for (const command of commands)
      void auth!.send(command).catch(() => this.changed());
  }
}
