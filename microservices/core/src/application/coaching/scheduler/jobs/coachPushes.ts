import { and, asc, eq, gt, inArray, lt } from "drizzle-orm";
import { coachEvents, type CoachEvent } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  deliverCoachEvents,
  isCoachQuiet,
  loadCoachPrefs,
  pushHeldGroup,
} from "../../events/coachEvents";
import type { SchedulerJob } from "../coachScheduler";
import { PAGE_SIZES } from "./pageSizes";

/**
 * Coach pushes (PER-117, design C D4):
 *  - events still `pending` a minute after they were written (a writer whose
 *    post-commit push never ran, or one that leaves the push to the
 *    scheduler) are pushed;
 *  - events `held` for quiet hours are released once the coach's window has
 *    ended, as one push per client ("Sam: 3 updates").
 *
 * Both claim before they push (`pending`/`held` → `sent`), so nothing is
 * pushed twice.
 */

export const MAX_EVENTS = 1000;
const PENDING_GRACE_MS = 60_000;

export const coachPushesJob: SchedulerJob = {
  name: "coach_pushes",
  cadence: "tick",
  async run({ now, dispatcher }) {
    const db = getDb();
    const pending = await db
      .select({ id: coachEvents.id, trainerId: coachEvents.trainerId })
      .from(coachEvents)
      .where(
        and(
          eq(coachEvents.pushState, "pending"),
          lt(coachEvents.createdAt, new Date(now.getTime() - PENDING_GRACE_MS)),
        ),
      )
      .orderBy(asc(coachEvents.occurredAt))
      .limit(MAX_EVENTS);
    // Quiet hours may have begun since the event was written: hold those
    // instead (Inspector Brad, #548). The release below sends them later.
    const quiet = new Map<string, boolean>();
    for (const trainerId of new Set(pending.map((p) => p.trainerId))) {
      quiet.set(
        trainerId,
        isCoachQuiet(await loadCoachPrefs(db, trainerId), now),
      );
    }
    const toHold = pending.filter((p) => quiet.get(p.trainerId));
    if (toHold.length > 0) {
      await db
        .update(coachEvents)
        .set({ pushState: "held" })
        .where(
          and(
            inArray(
              coachEvents.id,
              toHold.map((p) => p.id),
            ),
            eq(coachEvents.pushState, "pending"),
          ),
        );
    }
    const pushed = await deliverCoachEvents(
      pending.filter((p) => !quiet.get(p.trainerId)).map((p) => p.id),
      dispatcher,
    );

    // Release per coach: page through the coaches who have held pushes and
    // claim each one's events only once their window has ended, so coaches
    // still in quiet hours never fill a batch (Inspector Brad, #548).
    let released = 0;
    let groups = 0;
    let after: string | null = null;
    for (;;) {
      const page: { trainerId: string }[] = await db
        .selectDistinct({ trainerId: coachEvents.trainerId })
        .from(coachEvents)
        .where(
          and(
            eq(coachEvents.pushState, "held"),
            ...(after ? [gt(coachEvents.trainerId, after)] : []),
          ),
        )
        .orderBy(asc(coachEvents.trainerId))
        .limit(PAGE_SIZES.heldTrainers);
      for (const { trainerId } of page) {
        const prefs = await loadCoachPrefs(db, trainerId);
        if (isCoachQuiet(prefs, now)) continue;
        const claimed: CoachEvent[] = await db
          .update(coachEvents)
          .set({ pushState: "sent" })
          .where(
            and(
              eq(coachEvents.trainerId, trainerId),
              eq(coachEvents.pushState, "held"),
            ),
          )
          .returning();
        released += claimed.length;
        const byClient = new Map<string, CoachEvent[]>();
        for (const e of claimed.sort(
          (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime(),
        )) {
          const key = e.clientId ?? `none:${e.id}`;
          byClient.set(key, [...(byClient.get(key) ?? []), e]);
        }
        for (const events of byClient.values()) {
          if (
            await pushHeldGroup(
              trainerId,
              events[0]!.clientId,
              events,
              dispatcher,
            )
          ) {
            groups += 1;
          }
        }
      }
      if (page.length < PAGE_SIZES.heldTrainers) break;
      after = page[page.length - 1]!.trainerId;
    }
    return { pushed, released, groups };
  },
};
