/**
 * Superset paired-set commands. (M3, Story-005.)
 *
 * Supersets are paired logging: every exercise in the group has the
 * same number of sets, lined up by setNumber. Adding a set adds row N
 * to ALL peers; removing a set drops row N from ALL peers and
 * renumbers survivors. Mirrors legacy `useActiveWorkout.addSupersetSet`
 * + `removeSupersetSet`.
 *
 * Spec: persistence-mobile/hooks/useActiveWorkout.tsx:488-588
 */

import {
  addSupersetSet,
  removeSupersetSet,
  type IdFactory,
} from "@/domain/services/sessionService";
import type { WorkoutSession } from "@/domain/models/session";
import type { StoragePort } from "@/domain/ports/storage.port";
import { fail, ok, type Result } from "@/shared/errors";
import type { SessionNotFoundError } from "./log-set.command";

export type SupersetSetCommandDeps = {
  storage: StoragePort;
  generateId: IdFactory;
  userId: string;
};

export type AddSupersetSetInput = {
  /** session_exercise IDs that share a `supersetGroup`. */
  sessionExerciseIds: readonly string[];
};

export function addSupersetSetCommand(
  deps: SupersetSetCommandDeps,
  input: AddSupersetSetInput,
): Result<WorkoutSession, SessionNotFoundError> {
  const session = deps.storage.getActiveSession(deps.userId);
  if (!session) {
    return fail({
      kind: "session_not_found",
      code: "SESSION_NOT_FOUND",
      message: "No active session — cannot add a superset set.",
    });
  }
  const updated = addSupersetSet(
    session,
    input.sessionExerciseIds,
    deps.generateId,
  );
  deps.storage.cacheActiveSession(deps.userId, updated);
  deps.storage.invalidateDashboard(deps.userId);
  return ok(updated);
}

export type RemoveSupersetSetInput = {
  sessionExerciseIds: readonly string[];
  setNumber: number;
};

export type RemoveSupersetSetCommandDeps = Omit<
  SupersetSetCommandDeps,
  "generateId"
>;

export function removeSupersetSetCommand(
  deps: RemoveSupersetSetCommandDeps,
  input: RemoveSupersetSetInput,
): Result<WorkoutSession, SessionNotFoundError> {
  const session = deps.storage.getActiveSession(deps.userId);
  if (!session) {
    return fail({
      kind: "session_not_found",
      code: "SESSION_NOT_FOUND",
      message: "No active session — cannot remove a superset set.",
    });
  }
  const updated = removeSupersetSet(
    session,
    input.sessionExerciseIds,
    input.setNumber,
  );
  deps.storage.cacheActiveSession(deps.userId, updated);
  deps.storage.invalidateDashboard(deps.userId);
  return ok(updated);
}
