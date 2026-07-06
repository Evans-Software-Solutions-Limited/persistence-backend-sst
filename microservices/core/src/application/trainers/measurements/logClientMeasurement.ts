import { getDb } from "@persistence/db/client";
import { assertTrainerCanActForClient } from "../../relationships/assertTrainerCanActForClient";
import { auditTrainerAction } from "../../relationships/auditTrainerAction";
import { MeasurementRepository } from "../../repositories/measurementRepository";
import { safeEvaluateStreaks } from "../../streaks/evaluate";
import { emitTrainerOnBehalfNotification } from "../onBehalfNotifications";
import type { BodyMeasurement } from "@persistence/db";

export interface LogClientMeasurementBody {
  weightKg?: string | number;
  bodyFatPercentage?: string | number;
  chestCm?: string | number;
  waistCm?: string | number;
  hipsCm?: string | number;
  leftArmCm?: string | number;
  rightArmCm?: string | number;
  leftThighCm?: string | number;
  rightThighCm?: string | number;
  notes?: string;
}

export interface LogClientMeasurementArgs {
  trainerId: string;
  clientId: string;
  body: LogClientMeasurementBody;
}

export type LogClientMeasurementResult =
  | { ok: true; measurement: BodyMeasurement }
  | { ok: false; status: 403; body: { code: string; message: string } };

const toStr = (v: string | number | undefined) =>
  v !== undefined ? String(v) : undefined;

/**
 * Shared core for the coach on-behalf measurement write (specs/10-trainer-
 * features R-1 reconciliation). Both `POST /trainers/me/clients/:clientId/
 * measurements` (canonical) and the temporary `POST /clients/:clientId/
 * measurements` alias call this so the authorization + audit logic never
 * diverges between the two routes.
 *
 * Authorization goes through the shared `assertTrainerCanActForClient` gate
 * (role-first, then active-relationship — cross-cuts § 1.3) rather than the
 * inline relationship-only check the original #136 handler shipped with.
 *
 * The measurement insert and the audit-log insert happen inside ONE
 * transaction: per cross-cuts § 1.4.2, if the audit write fails the
 * measurement write must roll back too, so we never end up with a
 * `logged_by_user_id` row that has no matching audit trail.
 *
 * The measurement streak advance happens AFTER the transaction commits and
 * is error-tolerant (matches the pre-existing handler behaviour) — a streak
 * hiccup must never fail an otherwise-successful measurement log.
 *
 * Phase 3 backfill: the `measurement_logged_on_behalf` client notification
 * (cross-cuts § 5) is emitted post-commit, best-effort. Phase 2 deliberately
 * deferred this — it needed the `notification_type` enum ALTER that Phase 3
 * lands — so the emit is wired here now that the enum value exists.
 */
export async function logClientMeasurementOnBehalf({
  trainerId,
  clientId,
  body,
}: LogClientMeasurementArgs): Promise<LogClientMeasurementResult> {
  const verdict = await assertTrainerCanActForClient(trainerId, clientId);
  if (!verdict.allowed) {
    return { ok: false, status: verdict.status, body: verdict.body };
  }

  const measurementInput = {
    loggedByUserId: trainerId,
    weightKg: toStr(body.weightKg),
    bodyFatPercentage: toStr(body.bodyFatPercentage),
    chestCm: toStr(body.chestCm),
    waistCm: toStr(body.waistCm),
    hipsCm: toStr(body.hipsCm),
    leftArmCm: toStr(body.leftArmCm),
    rightArmCm: toStr(body.rightArmCm),
    leftThighCm: toStr(body.leftThighCm),
    rightThighCm: toStr(body.rightThighCm),
    notes: body.notes,
  };

  const measurementRepository = new MeasurementRepository();

  const measurement = await getDb().transaction(async (tx) => {
    const created = await measurementRepository.create(
      clientId,
      measurementInput,
      tx,
    );

    await auditTrainerAction({
      trainerId,
      clientId,
      actionType: "measurement_logged_on_behalf",
      targetTable: "body_measurements",
      targetRowId: created.id,
      payload: { ...body },
      tx,
    });

    return created;
  });

  // Advance the CLIENT's measurement streak — error-tolerant, the
  // measurement already committed.
  await safeEvaluateStreaks(clientId, "measurement_logged", new Date());

  // Notify the client their coach logged a measurement (cross-cuts § 5) —
  // post-commit, best-effort. See docstring re: Phase 2 deferral.
  await emitTrainerOnBehalfNotification({
    clientId,
    trainerId,
    type: "measurement_logged_on_behalf",
    title: "Measurement logged by your coach",
    buildMessage: (coachName) => `${coachName} logged a measurement for you`,
    deepLink: `/progress/measurements/${measurement.id}`,
    relatedEntityType: "body_measurement",
    relatedEntityId: measurement.id,
  });

  return { ok: true, measurement };
}
