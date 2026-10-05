import type { TogetherWorkoutReview } from "../../domain/ports/togetherWorkout.port";
import type {
  TogetherRecoveryApi,
  TogetherRecoveryCandidate,
  TogetherRecoveryCommand,
} from "../../domain/ports/togetherOfflineApi.port";
import type { Credential, Signed } from "../../domain/models/togetherIdentity";
import { checkpointExecution, type Checkpoint } from "./workoutCheckpoint";
import { commandFromEnvelope, readOwnerCommand } from "./localCommand";
import { requestHash } from "./security/identity";
import { uuid } from "./security/schema";
import type { LocalCommand } from "./localStore";
import { recoveryCandidate, recoveryResult } from "./recoverySchema";

export interface WorkoutRecoveryOptions {
  api: TogetherRecoveryApi;
  sign(
    credential: Signed<Credential>,
    commands: readonly TogetherRecoveryCommand[],
  ): Promise<Signed<TogetherRecoveryCommand>[]>;
  now?: () => number;
}
export interface RecoveryState {
  uploaded: number;
  batch?: { key: string; start: number; count: number };
  finish?: {
    key: string;
    revision: number;
    snapshotToken: string;
    completedAt: string;
  };
  review?: TogetherWorkoutReview;
  error?: string;
}
interface Access {
  load(): Checkpoint;
  /** Account lifecycle generation; checked after every asynchronous boundary. */
  guard(): void;
  persist(checkpoint: Checkpoint, commands?: LocalCommand[]): void;
}
const state = (c: Checkpoint) => (c.recovery ??= { uploaded: 0 });
export const snapshotToken = (c: Checkpoint) => requestHash(c.snapshot);
const unwrap = <T>(
  result:
    | { ok: true; value: T }
    | { ok: false; error: { togetherCode?: string; code: string } },
): T => {
  if (!result.ok)
    throw new Error(result.error.togetherCode ?? result.error.code);
  return result.value;
};
function omissions(c: Checkpoint): string[] {
  const values: string[] = [];
  if (c.error)
    values.push(
      "Changes made after sharing paused are not included. This review contains the original supported plan and its recorded sets; your full changed workout stays active on this device for personal continuation.",
    );
  if (c.snapshot.notes || c.snapshot.exercises.some((e) => e.notes))
    values.push("Workout and exercise notes stay on this device.");
  if (
    c.snapshot.exercises.some((e) =>
      e.sets.some((s) => s.reps === null || s.weightKg === null),
    )
  )
    values.push(
      "Unfinished sets stay on this device and are not included in this result.",
    );
  if (c.snapshot.locationName || c.snapshot.activityEnvironment)
    values.push("Workout location details stay on this device.");
  return values;
}
function checked(
  c: Checkpoint,
  candidate: TogetherRecoveryCandidate,
  revision: number,
) {
  if (
    !recoveryCandidate(candidate) ||
    candidate.sessionId !== c.sessionId ||
    candidate.executionId !== c.executionId ||
    candidate.startedAt !== c.startedAt ||
    candidate.revision !== revision ||
    requestHash(candidate.plan) !== c.planHash
  )
    throw new Error("recovery-invalid-response");
  if (
    (candidate.status === "saved" &&
      (!candidate.historySaved ||
        !uuid(candidate.historyId) ||
        candidate.reviewedRevision !== revision)) ||
    (candidate.status === "finished_empty" &&
      (candidate.historySaved || candidate.reviewedRevision !== revision)) ||
    (candidate.status === "stored_for_review" && candidate.historySaved)
  )
    throw new Error("recovery-invalid-response");
  // The fetched candidate must contain exactly the performed own projection, not
  // an unrelated/stale server view with a coincidentally equal revision number.
  const actual = candidate.execution.exercises
    .flatMap((e) =>
      e.sets.map((s) => ({ planExerciseId: e.planExerciseId, set: s })),
    )
    .sort((a, b) => a.set.setId.localeCompare(b.set.setId));
  const expected = Object.values(c.projected).sort((a, b) =>
    a.set.setId.localeCompare(b.set.setId),
  );
  if (
    (candidate.execution.restEndsAt ?? null) !==
      (c.controls?.restEndsAt ?? null) ||
    requestHash(actual) !== requestHash(expected) ||
    checkpointExecution(c).exercises.some((expected) => {
      const received = candidate.execution.exercises.find(
        (e) => e.planExerciseId === expected.planExerciseId,
      );
      return (
        expected.skipped !== (received?.skipped ?? false) ||
        expected.substituteExerciseId !==
          (received?.substituteExerciseId ?? null)
      );
    }) ||
    candidate.execution.exercises.some((e) => {
      const expected = checkpointExecution(c).exercises.find(
        (x) => x.planExerciseId === e.planExerciseId,
      );
      return (
        !expected ||
        expected.skipped !== e.skipped ||
        expected.substituteExerciseId !== (e.substituteExerciseId ?? null)
      );
    })
  )
    throw new Error("recovery-invalid-response");
}
/** Network recovery owns no seed and never authorizes sharing. */
export class TogetherWorkoutRecovery {
  constructor(
    private readonly options: WorkoutRecoveryOptions,
    private readonly randomUUID: () => string,
  ) {}
  private async resolveFinish(access: Access): Promise<void> {
    const c = access.load(),
      attempt = state(c).finish;
    if (!attempt) return;
    const result = unwrap(
      await this.options.api.complete(c.executionId, attempt.key, {
        expectedRevision: attempt.revision,
        completedAt: attempt.completedAt,
      }),
    );
    access.guard();
    if (!recoveryResult(result) || result.reviewedRevision !== attempt.revision)
      throw new Error("recovery-invalid-response");
    const fresh = access.load(),
      recovery = state(fresh),
      reviewed = recovery.review;
    if (!reviewed || reviewed.snapshotToken !== attempt.snapshotToken)
      throw new Error("recovery-review-required");
    recovery.review = {
      ...reviewed,
      ...result,
      historySaved: result.status === "saved",
    };
    delete recovery.finish;
    if (
      snapshotToken(fresh) === attempt.snapshotToken &&
      !reviewed.retainedLocalChanges
    ) {
      fresh.snapshot = {
        ...fresh.snapshot,
        status: result.status === "saved" ? "completed" : "cancelled",
        completedAt: attempt.completedAt,
      };
      // The token continues to identify the exact snapshot the athlete reviewed.
    }
    access.persist(fresh);
  }
  async review(access: Access): Promise<TogetherWorkoutReview> {
    await this.resolveFinish(access);
    access.guard();
    let c = access.load();
    if (c.snapshot.status !== "in_progress") return state(c).review!;
    const token = snapshotToken(c);
    // Empty executions still need an authentic journal entry to establish the
    // recovery candidate. Explicitly clearing a nonexistent rest timer logs no set.
    if (!c.intents.length) {
      c.intents.push({
        payload: {
          kind: "together-recovery-v1",
          userId: c.snapshot.userId,
          sessionId: c.sessionId,
          executionId: c.executionId,
          commandId: this.randomUUID(),
          planHash: c.planHash,
          startedAt: c.startedAt,
          expectedVersion: 0,
          operation: { type: "rest", endsAt: null },
        },
      });
      access.persist(c);
    }
    for (;;) {
      c = access.load();
      const unsigned = c.intents
        .filter((intent) => !intent.command)
        .slice(0, 100);
      if (!unsigned.length) break;
      const signed = await this.options.sign(
        c.credential,
        unsigned.map((i) => i.payload),
      );
      access.guard();
      const fresh = access.load();
      if (signed.length !== unsigned.length)
        throw new Error("recovery-invalid-signature");
      const commands = signed.map((envelope, index) => {
        if (
          requestHash(envelope.payload) !== requestHash(unsigned[index].payload)
        )
          throw new Error("recovery-invalid-signature");
        const command = commandFromEnvelope(envelope);
        readOwnerCommand(command, fresh.credential);
        const intent = fresh.intents.find(
          (i) => i.payload.commandId === command.commandId,
        )!;
        intent.command = command;
        return command;
      });
      access.persist(fresh, commands);
      if (snapshotToken(fresh) !== token)
        throw new Error("workout-review-stale");
    }
    for (;;) {
      c = access.load();
      if (snapshotToken(c) !== token) throw new Error("workout-review-stale");
      const recovery = state(c);
      if (recovery.uploaded >= c.intents.length) break;
      recovery.batch ??= {
        key: this.randomUUID(),
        start: recovery.uploaded,
        count: Math.min(100, c.intents.length - recovery.uploaded),
      };
      const batch = recovery.batch,
        intents = c.intents.slice(batch.start, batch.start + batch.count);
      access.persist(c);
      const response = unwrap(
        await this.options.api.upload(batch.key, {
          credential: c.credential,
          sessionId: c.sessionId,
          executionId: c.executionId,
          startedAt: c.startedAt,
          plan: c.plan,
          commands: intents.map(
            (i) =>
              JSON.parse(i.command!.payload) as Signed<TogetherRecoveryCommand>,
          ),
        }),
      );
      access.guard();
      if (
        !recoveryCandidate(response, true) ||
        response.sessionId !== c.sessionId ||
        response.executionId !== c.executionId ||
        response.revision !== batch.start + batch.count ||
        response.receipts.length !== intents.length ||
        response.receipts.some(
          (r, index) =>
            r.commandId !== intents[index].payload.commandId ||
            r.commandHash !== requestHash(intents[index].payload) ||
            r.revision !== intents[index].payload.expectedVersion + 1,
        )
      )
        throw new Error("recovery-invalid-response");
      const fresh = access.load();
      state(fresh).uploaded = batch.start + batch.count;
      delete state(fresh).batch;
      access.persist(fresh);
    }
    const candidate = unwrap(await this.options.api.get(c.executionId));
    access.guard();
    c = access.load();
    if (snapshotToken(c) !== token) throw new Error("workout-review-stale");
    checked(c, candidate, c.intents.length);
    const reviewed = {
      ...candidate,
      snapshotToken: token,
      omissions: omissions(c),
      ...(c.error ? { retainedLocalChanges: true } : {}),
    };
    state(c).review = reviewed;
    if (
      candidate.status !== "stored_for_review" &&
      !reviewed.retainedLocalChanges
    ) {
      // Server reports a prior explicit acceptance of this exact candidate. Keep
      // unknown completion time null; never invent a second workout/history ID.
      c.snapshot = {
        ...c.snapshot,
        status: candidate.status === "saved" ? "completed" : "cancelled",
      };
    }
    delete state(c).error;
    access.persist(c);
    return reviewed;
  }
  async finish(
    access: Access,
    revision: number,
    token: string,
  ): Promise<TogetherWorkoutReview> {
    let c = access.load();
    const recovery = state(c),
      reviewed = recovery.review;
    if (
      !reviewed ||
      reviewed.revision !== revision ||
      reviewed.snapshotToken !== token
    )
      throw new Error("recovery-review-required");
    if (c.snapshot.status !== "in_progress") return reviewed;
    if (
      snapshotToken(c) !== token ||
      c.intents.length !== revision ||
      (c.error && !reviewed.retainedLocalChanges)
    )
      throw new Error("workout-review-stale");
    if (
      reviewed.retainedLocalChanges &&
      reviewed.status !== "stored_for_review"
    )
      return reviewed;
    if (!recovery.finish) {
      const now = (this.options.now ?? Date.now)();
      if (now < c.startedAt) throw new Error("recovery-invalid-time");
      recovery.finish = {
        key: this.randomUUID(),
        revision,
        snapshotToken: token,
        completedAt: new Date(now).toISOString(),
      };
      access.persist(c);
    }
    await this.resolveFinish(access);
    access.guard();
    c = access.load();
    if (
      c.snapshot.status === "in_progress" &&
      (!state(c).review?.retainedLocalChanges || snapshotToken(c) !== token)
    )
      throw new Error("workout-review-stale");
    return state(c).review!;
  }
}
