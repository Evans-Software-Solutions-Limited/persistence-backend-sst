import type { LocalCommand } from "./localStore";
import {
  type Credential,
  type Signed,
  verifySignature,
} from "./security/identity";
import { object, uuid, integer, hash, signed } from "./security/schema";

export interface OwnerCommand {
  kind: "together-recovery-v1";
  userId: string;
  sessionId: string;
  executionId: string;
  commandId: string;
  planHash: string;
  startedAt: number;
  expectedVersion: number;
  operation: Record<string, unknown>;
}

const range = (v: unknown, max: number) => integer(v) && (v as number) <= max;

/** RFC 3339 subset with real calendar dates; Date.parse alone normalises Feb 30. */
function dateTime(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!parts) return false;
  const year = Number(parts[1]),
    month = Number(parts[2]),
    day = Number(parts[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= days[month - 1] &&
    Number(parts[4]) <= 23 &&
    Number(parts[5]) <= 59 &&
    Number(parts[6]) <= 59 &&
    (parts[7] === "Z" || (Number(parts[8]) <= 23 && Number(parts[9]) <= 59))
  );
}

function operation(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  switch (p.type) {
    case "upsertSet":
      return (
        object(p, ["type", "planExerciseId", "set"]) &&
        uuid(p.planExerciseId) &&
        object(p.set, ["setId", "reps", "weightKg", "completed"]) &&
        uuid(p.set.setId) &&
        range(p.set.reps, 10000) &&
        typeof p.set.weightKg === "number" &&
        Number.isFinite(p.set.weightKg) &&
        p.set.weightKg >= 0 &&
        p.set.weightKg <= 9999.99 &&
        typeof p.set.completed === "boolean"
      );
    case "removeSet":
      return (
        object(p, ["type", "planExerciseId", "setId"]) &&
        uuid(p.planExerciseId) &&
        uuid(p.setId)
      );
    case "substitute":
      return (
        object(p, ["type", "planExerciseId", "exerciseId"]) &&
        uuid(p.planExerciseId) &&
        (p.exerciseId === null || uuid(p.exerciseId))
      );
    case "skip":
      return (
        object(p, ["type", "planExerciseId", "skipped"]) &&
        uuid(p.planExerciseId) &&
        typeof p.skipped === "boolean"
      );
    case "rest":
      return (
        object(p, ["type", "endsAt"]) &&
        (p.endsAt === null || dateTime(p.endsAt))
      );
    default:
      return false;
  }
}

/** Exact owner-only server recovery wire; never accept arbitrary workout/history blobs. */
export function readOwnerCommand(
  command: unknown,
  credential: Signed<Credential>,
): OwnerCommand {
  if (
    !object(command, ["commandId", "sessionId", "executionId", "payload"]) ||
    !uuid(command.commandId) ||
    !uuid(command.sessionId) ||
    !uuid(command.executionId) ||
    typeof command.payload !== "string" ||
    new TextEncoder().encode(command.payload).length > 16000
  )
    throw new Error("Invalid local command");
  const envelope: unknown = JSON.parse(command.payload);
  if (
    !object(envelope, ["payload", "signature"]) ||
    !signed(envelope, () => true) ||
    !object(envelope.payload, [
      "kind",
      "userId",
      "sessionId",
      "executionId",
      "commandId",
      "planHash",
      "startedAt",
      "expectedVersion",
      "operation",
    ])
  )
    throw new Error("Invalid owner command");
  const p = envelope.payload;
  if (
    p.kind !== "together-recovery-v1" ||
    p.userId !== credential.payload.userId ||
    p.commandId !== command.commandId ||
    p.sessionId !== command.sessionId ||
    p.executionId !== command.executionId ||
    !hash(p.planHash) ||
    !integer(p.startedAt) ||
    !integer(p.expectedVersion) ||
    !operation(p.operation)
  )
    throw new Error("Invalid owner operation");
  return verifySignature(
    envelope as unknown as Signed<OwnerCommand>,
    credential.payload.publicKey,
  );
}

export function commandFromEnvelope(
  envelope: Signed<OwnerCommand>,
): LocalCommand {
  const { commandId, sessionId, executionId } = envelope.payload;
  return {
    commandId,
    sessionId,
    executionId,
    payload: JSON.stringify(envelope),
  };
}
