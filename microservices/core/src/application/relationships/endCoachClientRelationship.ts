import { and, eq } from "drizzle-orm";
import {
  ptClientRelationships,
  programAssignments,
  workoutAssignments,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { auditTrainerAction } from "./auditTrainerAction";
import { recordDataSharingConsent } from "./recordDataSharingConsent";
import { CONSENT_VERSION } from "./consent";

export interface EndCoachClientRelationshipArgs {
  trainerId: string;
  clientId: string;
  /** Direction — drives the audit payload + which party is notified. */
  initiatedBy: "trainer" | "client";
}

export type EndCoachClientRelationshipResult =
  | {
      ok: true;
      relationshipId: string;
      programmesRemoved: number;
      workoutAssignmentsRemoved: number;
    }
  | { ok: false; status: 404 };

/** UTC calendar date (YYYY-MM-DD) for the `end_date` marker column. */
function todayISODate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Shared core for ending an ACTIVE, human (non-AI) coach↔client relationship —
 * used by both endpoints (coach-removes-client and client-leaves-coach,
 * 25-coach-client-offboarding). The whole teardown runs in ONE transaction:
 *
 *   1. Soft-end the relationship (status → 'terminated', end_date = today).
 *      The `status = 'active'` + `is_ai_trainer = false` predicate IS the
 *      race/ownership/AI guard: if it matches no row (already ended, not this
 *      pair, or an AI-trainer row) the tx returns null → 404 and nothing else
 *      ran (the whole tx is a no-op).
 *   2. Delete the coach's PROGRAMME assignments for this client — cascades to
 *      their materialised workout-assignment occurrences via
 *      `workout_assignments.program_assignment_id` (onDelete cascade).
 *   3. Delete the coach's remaining ad-hoc workout assignments for this client.
 *   4. Audit (`relationship_terminated`).
 *
 * Coach-set HABITS and GOALS are deliberately NOT touched (D3 / spec 18 +
 * spec 10 locked decision 6): the habit edit-lock is *computed* from
 * `status = 'active'`, so step 1 lifts it automatically and the habits/goals
 * transfer to the client (stay active, streak unbroken, attribution kept as
 * history). See specs/25-coach-client-offboarding/design.md § 1.
 *
 * The client's own logged `workout_sessions` are untouched — a workout
 * assignment only *references* a session (`completed_session_id`), so deleting
 * the assignment row never removes the session.
 *
 * 26-coach-data-sharing-consent: this is ALSO the withdrawal mechanism —
 * "withdraw as easily as granted" is made literally true by reusing this one
 * teardown for both Leave Coach and Remove Client. Step 1's soft-end clears
 * `consent_given_at`/`consent_version` to NULL on the SAME update (no extra
 * query); step 4a appends a `data_sharing_consents` `withdraw` row, source
 * `leave_coach` when `initiatedBy: "client"`, `coach_removed` when
 * `initiatedBy: "trainer"`.
 *
 * The best-effort counterparty notification is emitted by the CALLER
 * post-commit (the recipient flips by direction), never here.
 */
export async function endCoachClientRelationship({
  trainerId,
  clientId,
  initiatedBy,
}: EndCoachClientRelationshipArgs): Promise<EndCoachClientRelationshipResult> {
  const outcome = await getDb().transaction(async (tx) => {
    const updated = await tx
      .update(ptClientRelationships)
      .set({
        status: "terminated",
        endDate: todayISODate(),
        updatedAt: new Date(),
        // 26-coach-data-sharing-consent: withdrawal clears the current-consent
        // stamp on the SAME update — no extra query.
        consentGivenAt: null,
        consentVersion: null,
      })
      .where(
        and(
          eq(ptClientRelationships.trainerId, trainerId),
          eq(ptClientRelationships.clientId, clientId),
          eq(ptClientRelationships.status, "active"),
          eq(ptClientRelationships.isAiTrainer, false),
        ),
      )
      .returning({ id: ptClientRelationships.id });

    const row = updated[0];
    if (!row) return null;

    // 2 — programme assignments (cascades to occurrence rows in
    // workout_assignments via the program_assignment_id FK).
    const programmes = await tx
      .delete(programAssignments)
      .where(
        and(
          eq(programAssignments.clientId, clientId),
          eq(programAssignments.assignedBy, trainerId),
        ),
      )
      .returning({ id: programAssignments.id });

    // 3 — remaining ad-hoc workout assignments from this coach (occurrence
    // rows are already gone via the step-2 cascade).
    const assignments = await tx
      .delete(workoutAssignments)
      .where(
        and(
          eq(workoutAssignments.clientId, clientId),
          eq(workoutAssignments.trainerId, trainerId),
        ),
      )
      .returning({ id: workoutAssignments.id });

    await auditTrainerAction({
      trainerId,
      clientId,
      actionType: "relationship_terminated",
      targetTable: "pt_client_relationships",
      targetRowId: row.id,
      payload: {
        initiatedBy,
        programmesRemoved: programmes.length,
        workoutAssignmentsRemoved: assignments.length,
      },
      tx,
    });

    // 26-coach-data-sharing-consent: append-only withdrawal record, same tx
    // as the consent-stamp clear above. Source mirrors the direction: the
    // client's own Leave Coach button IS the withdrawal action; a trainer-
    // initiated removal also ends sharing, recorded distinctly.
    await recordDataSharingConsent({
      trainerId,
      clientId,
      action: "withdraw",
      consentVersion: CONSENT_VERSION,
      source: initiatedBy === "client" ? "leave_coach" : "coach_removed",
      tx,
    });

    return {
      relationshipId: row.id,
      programmesRemoved: programmes.length,
      workoutAssignmentsRemoved: assignments.length,
    };
  });

  if (!outcome) return { ok: false, status: 404 };
  return { ok: true, ...outcome };
}
