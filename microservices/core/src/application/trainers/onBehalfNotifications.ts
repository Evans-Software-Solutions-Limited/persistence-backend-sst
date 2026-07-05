import { eq } from "drizzle-orm";
import { profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { NotificationDispatcher } from "../notifications/push/notificationDispatcher";
import type { NotificationType } from "../repositories/notificationRepository";

/**
 * Fallback coach name used in the notification message when the trainer's
 * profile row has no `full_name` (or the lookup fails). Keeps the copy
 * sensible without leaking a raw id.
 */
const FALLBACK_COACH_NAME = "your coach";

export interface TrainerOnBehalfNotificationArgs {
  /** The client the notification is delivered TO (`notifications.user_id`). */
  clientId: string;
  /** The acting trainer — used to resolve the coach's display name. */
  trainerId: string;
  type: NotificationType;
  title: string;
  /** Builds the notification body from the resolved coach display name. */
  buildMessage: (coachName: string) => string;
  /** Deep-link route per cross-cuts § 5 (stored under `data.deepLink`). */
  deepLink: string;
  relatedEntityType: string;
  relatedEntityId: string;
}

/**
 * Best-effort emit of a trainer on-behalf notification TO THE CLIENT, called
 * AFTER the on-behalf write has committed (Phase 3 / cross-cuts § 5). These
 * notification types default opt-in "on".
 *
 * This NEVER throws: the target row is already committed, so a notification
 * hiccup (missing profile, push failure, transient DB error) must not fail the
 * action — same posture as the streak post-commit advance in
 * `logClientMeasurementOnBehalf` and the trainer notification in the
 * accept-invite-code handler. Errors are logged and swallowed.
 *
 * The coach's display name is resolved from `profiles.full_name`; if absent
 * the message falls back to "your coach".
 */
export async function emitTrainerOnBehalfNotification(
  args: TrainerOnBehalfNotificationArgs,
): Promise<void> {
  try {
    let coachName = FALLBACK_COACH_NAME;
    const rows = await getDb()
      .select({ fullName: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.id, args.trainerId))
      .limit(1);
    if (rows[0]?.fullName) {
      coachName = rows[0].fullName;
    }

    await new NotificationDispatcher().createAndDispatch(args.clientId, {
      type: args.type,
      title: args.title,
      message: args.buildMessage(coachName),
      relatedEntityType: args.relatedEntityType,
      relatedEntityId: args.relatedEntityId,
      data: { deepLink: args.deepLink },
    });
  } catch (err) {
    console.error(
      `[trainer-on-behalf] failed to emit ${args.type} notification for client ${args.clientId}`,
      err,
    );
  }
}
