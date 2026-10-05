import { object, uuid, integer, hash } from "./security/schema";
const array = (v: unknown, check: (value: unknown) => boolean, min = 0) =>
  Array.isArray(v) && v.length >= min && v.length <= 100 && v.every(check);
const range = (v: unknown, max: number) => integer(v) && v <= max;
export function recoveryPlan(value: unknown): boolean {
  return (
    object(value, ["name", "exercises"]) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 120 &&
    array(
      value.exercises,
      (e) =>
        object(
          e,
          ["planExerciseId", "exerciseId", "order", "targetSets"],
          ["targetReps"],
        ) &&
        uuid(e.planExerciseId) &&
        uuid(e.exerciseId) &&
        range(e.order, 99) &&
        range(e.targetSets, 100) &&
        e.targetSets !== 0 &&
        (e.targetReps === undefined || range(e.targetReps, 10000)),
      1,
    )
  );
}
export function recoveryExecution(value: unknown): boolean {
  return (
    object(value, ["exercises"], ["restEndsAt"]) &&
    (value.restEndsAt === undefined ||
      value.restEndsAt === null ||
      (typeof value.restEndsAt === "string" &&
        Number.isFinite(Date.parse(value.restEndsAt)))) &&
    array(
      value.exercises,
      (e) =>
        object(
          e,
          ["planExerciseId", "skipped", "sets"],
          ["substituteExerciseId", "everAcknowledged"],
        ) &&
        uuid(e.planExerciseId) &&
        typeof e.skipped === "boolean" &&
        (e.substituteExerciseId === undefined ||
          e.substituteExerciseId === null ||
          uuid(e.substituteExerciseId)) &&
        (e.everAcknowledged === undefined ||
          typeof e.everAcknowledged === "boolean") &&
        array(
          e.sets,
          (s) =>
            object(s, ["setId", "reps", "weightKg", "completed"]) &&
            uuid(s.setId) &&
            range(s.reps, 10000) &&
            typeof s.weightKg === "number" &&
            Number.isFinite(s.weightKg) &&
            s.weightKg >= 0 &&
            s.weightKg <= 9999.99 &&
            typeof s.completed === "boolean",
        ),
    )
  );
}
export function recoveryCandidate(value: unknown, upload = false): boolean {
  return (
    object(
      value,
      [
        "status",
        "sharingActive",
        "historySaved",
        "sessionId",
        "executionId",
        "revision",
        "startedAt",
        "plan",
        "execution",
        ...(upload ? ["receipts"] : []),
      ],
      ["historyId", "reviewedRevision", "effectsPending"],
    ) &&
    ["stored_for_review", "saved", "finished_empty"].includes(
      String(value.status),
    ) &&
    value.sharingActive === false &&
    typeof value.historySaved === "boolean" &&
    uuid(value.sessionId) &&
    uuid(value.executionId) &&
    integer(value.revision) &&
    integer(value.startedAt) &&
    recoveryPlan(value.plan) &&
    recoveryExecution(value.execution) &&
    (value.historyId === undefined ||
      value.historyId === null ||
      uuid(value.historyId)) &&
    (value.reviewedRevision === undefined ||
      value.reviewedRevision === null ||
      integer(value.reviewedRevision)) &&
    (value.effectsPending === undefined ||
      typeof value.effectsPending === "boolean") &&
    (!upload ||
      array(
        value.receipts,
        (r) =>
          object(r, ["commandId", "commandHash", "revision", "status"]) &&
          uuid(r.commandId) &&
          hash(r.commandHash) &&
          integer(r.revision) &&
          r.status === "stored_for_review",
        1,
      ))
  );
}
export function recoveryResult(value: unknown): boolean {
  return (
    object(value, [
      "status",
      "historyId",
      "reviewedRevision",
      "effectsPending",
      "sharingActive",
    ]) &&
    ["saved", "finished_empty"].includes(String(value.status)) &&
    (value.historyId === null || uuid(value.historyId)) &&
    integer(value.reviewedRevision) &&
    typeof value.effectsPending === "boolean" &&
    value.sharingActive === false &&
    (value.status !== "saved" || uuid(value.historyId))
  );
}
