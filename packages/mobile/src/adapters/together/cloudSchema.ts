import { integer, object, uuid } from "./security/schema";
import { recoveryExecution, recoveryPlan } from "./recoverySchema";
export const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
export const flag = (v: unknown, key: string) =>
  record(v) && typeof v[key] === "boolean";
export const idField = (v: unknown, key: string) => record(v) && uuid(v[key]);
export const consent = (v: unknown) =>
  record(v) &&
  uuid(v.sessionId) &&
  uuid(v.ownerId) &&
  integer(v.version) &&
  Array.isArray(v.recipientIds) &&
  v.recipientIds.length <= 3 &&
  v.recipientIds.every(uuid);
const ownConsent = (v: unknown) =>
  object(v, ["version", "recipientIds"]) &&
  integer(v.version) &&
  Array.isArray(v.recipientIds) &&
  v.recipientIds.length <= 3 &&
  v.recipientIds.every(uuid);
export function cloudSnapshot(v: unknown): boolean {
  return (
    record(v) &&
    uuid(v.sessionId) &&
    ["active", "closed"].includes(String(v.state)) &&
    typeof v.sharingActive === "boolean" &&
    (v.continuation === null || v.continuation === "solo") &&
    (v.hostId === null || uuid(v.hostId)) &&
    integer(v.revision) &&
    integer(v.planVersion) &&
    recoveryPlan(v.plan) &&
    Array.isArray(v.participants) &&
    v.participants.length >= 1 &&
    v.participants.length <= 4 &&
    v.participants.every(
      (p) =>
        record(p) &&
        uuid(p.userId) &&
        ["active", "finalizing", "saved", "finished_empty"].includes(
          String(p.status),
        ) &&
        integer(p.ownRevision) &&
        integer(p.delegationGeneration) &&
        typeof p.allowPartnerLogging === "boolean" &&
        typeof p.previousValuesAvailable === "boolean" &&
        typeof p.numbersAvailable === "boolean" &&
        (p.progress === undefined ||
          (Array.isArray(p.progress) &&
            p.progress.length <= 100 &&
            p.progress.every(
              (e) =>
                record(e) &&
                uuid(e.planExerciseId) &&
                integer(e.completedSets) &&
                e.completedSets <= 100 &&
                typeof e.skipped === "boolean",
            ))) &&
        (p.numbersAvailable
          ? recoveryExecution(p.execution)
          : p.execution === null) &&
        record(p.exerciseCatalog) &&
        (p.previousConsent === undefined || ownConsent(p.previousConsent)) &&
        (p.numbersConsent === undefined || ownConsent(p.numbersConsent)),
    ) &&
    record(v.completion) &&
    typeof v.completion.status === "string" &&
    (v.completion.historyId === null || uuid(v.completion.historyId)) &&
    integer(v.completion.ownRevision) &&
    typeof v.completion.recoveryMayBePending === "boolean"
  );
}
export const page = (v: unknown, check: (row: unknown) => boolean) =>
  record(v) &&
  Array.isArray(v.data) &&
  v.data.length <= 50 &&
  v.data.every(check) &&
  (v.nextCursor === null || typeof v.nextCursor === "string");
export const person = (v: unknown) =>
  record(v) &&
  uuid(v.userId) &&
  (v.displayName === null || typeof v.displayName === "string") &&
  (v.avatarUrl === null || typeof v.avatarUrl === "string");
export const finish = (v: unknown) =>
  record(v) &&
  ["pending", "saved", "finished_empty", "active", "finalizing"].includes(
    String(v.status),
  ) &&
  (v.historyId === null || uuid(v.historyId));
export function previous(v: unknown): boolean {
  return (
    record(v) &&
    uuid(v.sessionId) &&
    uuid(v.ownerId) &&
    integer(v.consentVersion) &&
    integer(v.revision) &&
    integer(v.planVersion) &&
    integer(v.ownRevision) &&
    Array.isArray(v.values) &&
    v.values.length <= 10000 &&
    v.values.every(
      (s) =>
        record(s) &&
        uuid(s.exerciseId) &&
        integer(s.setNumber) &&
        s.setNumber >= 1 &&
        s.setNumber <= 100 &&
        typeof s.weightKg === "number" &&
        Number.isFinite(s.weightKg) &&
        typeof s.reps === "number" &&
        Number.isFinite(s.reps) &&
        typeof s.recordedAt === "string" &&
        Number.isFinite(Date.parse(s.recordedAt)),
    )
  );
}
