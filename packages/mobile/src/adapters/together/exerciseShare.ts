import { EXERCISE_CATEGORIES } from "../../domain/models/exercise";
import type {
  ExerciseShareProof,
  TogetherExerciseShare,
} from "../../domain/models/togetherIdentity";
import type { TogetherSharedExerciseDefinition } from "../../domain/ports/togetherShared.port";
import {
  requestHash,
  signPayload,
  verifySignature,
  type Credential,
  type Signed,
} from "./security/identity";
import {
  credentialValidator,
  integer,
  object,
  signed,
  uuid,
} from "./security/schema";
import { MAX_SHARED_BYTES, sealedFrameBytes } from "./sharedTransfer";

/**
 * A host's share of its custom exercises with one admitted guest (PER-60):
 * the signed proof the guest uploads with its recovery, so the server lets
 * it save on them, and display definitions so the guest sees their names.
 * Mirrors core `exerciseShareSchema`.
 */
export interface ExerciseShareBody extends TogetherExerciseShare {
  definitions: Record<string, TogetherSharedExerciseDefinition>;
}
/** A share names at most a plan's 100 exercises, like the server allows. */
export const MAX_SHARED_EXERCISES = 100;
export const MAX_EXERCISE_NAME = 120;
export const MAX_SHARED_MUSCLES = 8;
const MAX_MUSCLE_LENGTH = 64;

const utf8 = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;

function proofShape(value: unknown): value is ExerciseShareProof {
  return (
    object(value, [
      "kind",
      "sessionId",
      "hostUserId",
      "hostDeviceId",
      "userId",
      "exerciseIds",
      "issuedAt",
    ]) &&
    value.kind === "together-exercise-share-v1" &&
    uuid(value.sessionId) &&
    uuid(value.hostUserId) &&
    uuid(value.hostDeviceId) &&
    uuid(value.userId) &&
    Array.isArray(value.exerciseIds) &&
    value.exerciseIds.length >= 1 &&
    value.exerciseIds.length <= MAX_SHARED_EXERCISES &&
    value.exerciseIds.every(uuid) &&
    new Set(value.exerciseIds).size === value.exerciseIds.length &&
    integer(value.issuedAt)
  );
}
function definitionShape(
  value: unknown,
): value is TogetherSharedExerciseDefinition {
  return (
    object(value, ["name", "category", "primaryMuscles"]) &&
    typeof value.name === "string" &&
    !!value.name.trim() &&
    value.name.length <= MAX_EXERCISE_NAME &&
    (value.category === null ||
      (EXERCISE_CATEGORIES as readonly unknown[]).includes(value.category)) &&
    Array.isArray(value.primaryMuscles) &&
    value.primaryMuscles.length <= MAX_SHARED_MUSCLES &&
    value.primaryMuscles.every(
      (m) =>
        typeof m === "string" && m.length > 0 && m.length <= MAX_MUSCLE_LENGTH,
    )
  );
}
/** A cached exercise trimmed to what the wire allows, or nothing to share. */
function normalised(
  value: TogetherSharedExerciseDefinition | undefined,
): TogetherSharedExerciseDefinition | undefined {
  if (!value || typeof value.name !== "string") return undefined;
  let name = value.name.trim().slice(0, MAX_EXERCISE_NAME);
  // Never leave half of a surrogate pair at the cut.
  if (/[\uD800-\uDBFF]$/.test(name)) name = name.slice(0, -1);
  if (!name.trim()) return undefined;
  const definition = {
    name,
    category: (EXERCISE_CATEGORIES as readonly unknown[]).includes(
      value.category,
    )
      ? value.category
      : null,
    primaryMuscles: (Array.isArray(value.primaryMuscles)
      ? value.primaryMuscles
      : []
    )
      .filter(
        (m) =>
          typeof m === "string" &&
          m.length > 0 &&
          m.length <= MAX_MUSCLE_LENGTH,
      )
      .slice(0, MAX_SHARED_MUSCLES),
  };
  return definitionShape(definition) ? definition : undefined;
}

/**
 * Host side. Signs the share for `userId` over the plan's exercise ids and
 * adds the host's definitions, in plan order, while the sealed frame still
 * fits MAX_SHARED_BYTES; one that would not fit is left out and the guest
 * falls back to its existing naming. The proof always fits.
 */
export function buildExerciseShare(input: {
  seed: Uint8Array;
  credential: Signed<Credential>;
  sessionId: string;
  hostUserId: string;
  hostDeviceId: string;
  userId: string;
  exerciseIds: readonly string[];
  definitions: Readonly<Record<string, TogetherSharedExerciseDefinition>>;
  issuedAt: number;
}): ExerciseShareBody {
  const exerciseIds = [...new Set(input.exerciseIds)];
  const proof = signPayload<ExerciseShareProof>(
    {
      kind: "together-exercise-share-v1",
      sessionId: input.sessionId,
      hostUserId: input.hostUserId,
      hostDeviceId: input.hostDeviceId,
      userId: input.userId,
      exerciseIds,
      issuedAt: input.issuedAt,
    },
    input.seed,
  );
  if (!proofShape(proof.payload)) throw new Error("Invalid exercise share");
  const body: ExerciseShareBody = {
    credential: input.credential,
    proof,
    definitions: {},
  };
  // Names first, so as many exercises as possible are named; muscles only
  // with the room left. Each entry costs its key, a colon, its value and a
  // separating comma.
  let bytes = utf8(body);
  const fits = (cost: number) =>
    sealedFrameBytes(bytes + cost) <= MAX_SHARED_BYTES;
  const muscles: Record<string, string[]> = {};
  for (const id of exerciseIds) {
    const definition = normalised(
      Object.hasOwn(input.definitions, id) ? input.definitions[id] : undefined,
    );
    if (!definition) continue;
    const named = { ...definition, primaryMuscles: [] };
    const cost = utf8(id) + 1 + utf8(named) + 1;
    if (!fits(cost)) continue;
    body.definitions[id] = named;
    muscles[id] = definition.primaryMuscles;
    bytes += cost;
  }
  for (const [id, list] of Object.entries(muscles)) {
    const cost = utf8(list) - utf8([]);
    if (!list.length || !fits(cost)) continue;
    body.definitions[id].primaryMuscles = list;
    bytes += cost;
  }
  return body;
}

/**
 * Guest side. Accepts only the pinned host's share for this guest in this
 * session, signed by the host's roster credential, with definitions only for
 * the ids it names.
 */
export function readExerciseShare(
  body: unknown,
  expected: {
    sessionId: string;
    hostUserId: string;
    hostDeviceId: string;
    hostCredential: Signed<Credential>;
    userId: string;
  },
): ExerciseShareBody {
  const invalid = () => new Error("Invalid exercise share");
  if (
    !object(body, ["credential", "proof", "definitions"]) ||
    !credentialValidator.Check(body.credential) ||
    requestHash(body.credential) !== requestHash(expected.hostCredential) ||
    !signed(body.proof, proofShape)
  )
    throw invalid();
  const credential = body.credential as Signed<Credential>,
    proof = body.proof as Signed<ExerciseShareProof>;
  verifySignature(proof, credential.payload.publicKey);
  const p = proof.payload;
  if (
    p.sessionId !== expected.sessionId ||
    p.hostUserId !== expected.hostUserId ||
    p.hostDeviceId !== expected.hostDeviceId ||
    credential.payload.userId !== expected.hostUserId ||
    credential.payload.deviceId !== expected.hostDeviceId ||
    p.userId !== expected.userId ||
    !object(body.definitions, [], Object.keys(body.definitions ?? {}))
  )
    throw invalid();
  const definitions = body.definitions as Record<string, unknown>;
  const named = new Set(p.exerciseIds);
  if (
    Object.keys(definitions).length > MAX_SHARED_EXERCISES ||
    !Object.entries(definitions).every(
      ([id, definition]) =>
        uuid(id) && named.has(id) && definitionShape(definition),
    )
  )
    throw invalid();
  return {
    credential,
    proof,
    definitions: definitions as Record<
      string,
      TogetherSharedExerciseDefinition
    >,
  };
}
