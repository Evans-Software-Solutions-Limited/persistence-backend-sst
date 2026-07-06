import { and, asc, eq } from "drizzle-orm";
import { profiles, streakHolidays, type StreakHoliday } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { addDaysISO, compareISO, localDateISO } from "../streaks/period";

/**
 * Streak-holiday reads + writes (18-habit-setup, Phase 18.2 — T-18.2.4).
 * Per specs/18-habit-setup/design.md § 2.3 + § 3.1 + § 6 (AC 8.3). Every method
 * is JWT-scoped by `userId`; a holiday applies to ALL habits (`goal_id` NULL —
 * the prototype default) and is MANAGED FROM HOME, not the setup screen.
 *
 * Anti-gaming (AC 8.3):
 *  - a holiday must start ≥ 24 h in advance (`start_date >= today + 1`,
 *    user-local) so it can't be retro-declared over a week already missed;
 *  - ending one early TRUNCATES the range to today (never erases a week already
 *    counted as missed), while cancelling a not-yet-started one deletes it;
 *  - a wholly-past holiday is immutable (409).
 *
 * The 24 h rule is enforced here rather than as a SQL CHECK because `today` is
 * timezone-relative (design.md § 2.3). `now` is injectable for tests.
 */

export type DeclareHolidayResult =
  | { ok: true; holiday: StreakHoliday }
  | { ok: false; status: 422; error: string };

export type EndHolidayResult =
  | {
      ok: true;
      holiday: StreakHoliday | null;
      action: "cancelled" | "truncated";
    }
  | { ok: false; status: 404 | 409; error: string };

export class HabitHolidayRepository {
  static readonly key = "HabitHolidayRepository";

  private async getUserTimezone(userId: string): Promise<string> {
    const db = getDb();
    const rows = await db
      .select({ tz: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    return rows[0]?.tz ?? "Europe/London";
  }

  /** All of a user's declared holidays, earliest-start first. */
  async listForUser(userId: string): Promise<StreakHoliday[]> {
    const db = getDb();
    return db
      .select()
      .from(streakHolidays)
      .where(eq(streakHolidays.userId, userId))
      .orderBy(asc(streakHolidays.startDate));
  }

  /**
   * Declare an all-habits holiday. `startDate`/`endDate` are YYYY-MM-DD
   * user-local calendar dates. Rejects (422) when the start is not ≥ 24 h ahead
   * (`start < today + 1`) or the range is inverted (`end < start`; the SQL CHECK
   * also guards this but we return a clean 422 rather than a 500).
   */
  async declare(
    userId: string,
    startDate: string,
    endDate: string,
    opts: { now?: Date } = {},
  ): Promise<DeclareHolidayResult> {
    const now = opts.now ?? new Date();
    const tz = await this.getUserTimezone(userId);
    const today = localDateISO(now, tz);
    const earliestStart = addDaysISO(today, 1);

    if (compareISO(startDate, earliestStart) < 0) {
      return {
        ok: false,
        status: 422,
        error: "A holiday must start at least 24 hours in advance",
      };
    }
    if (compareISO(endDate, startDate) < 0) {
      return {
        ok: false,
        status: 422,
        error: "endDate must be on or after startDate",
      };
    }

    const db = getDb();
    const inserted = await db
      .insert(streakHolidays)
      .values({
        userId,
        goalId: null, // all habits (prototype default)
        startDate,
        endDate,
      })
      .returning();
    return { ok: true, holiday: inserted[0] };
  }

  /**
   * End a holiday early / cancel it (DELETE). Scoped to the owner:
   *  - a WHOLLY-PAST holiday (`end < today`) is immutable → 409;
   *  - a NOT-YET-STARTED holiday (`start > today`) is cancelled (deleted);
   *  - an ACTIVE holiday (`start <= today <= end`) is TRUNCATED to end today, so
   *    any week already counted as missed still counts (AC 8.3).
   * Returns 404 when the id isn't the user's.
   */
  async endEarly(
    userId: string,
    id: string,
    opts: { now?: Date } = {},
  ): Promise<EndHolidayResult> {
    const db = getDb();
    const rows = await db
      .select()
      .from(streakHolidays)
      .where(and(eq(streakHolidays.id, id), eq(streakHolidays.userId, userId)))
      .limit(1);
    const holiday = rows[0];
    if (!holiday) return { ok: false, status: 404, error: "Holiday not found" };

    const now = opts.now ?? new Date();
    const tz = await this.getUserTimezone(userId);
    const today = localDateISO(now, tz);

    // Wholly past — immutable.
    if (compareISO(holiday.endDate, today) < 0) {
      return {
        ok: false,
        status: 409,
        error: "A past holiday cannot be changed",
      };
    }

    // Not yet started — cancel it entirely.
    if (compareISO(holiday.startDate, today) > 0) {
      await db
        .delete(streakHolidays)
        .where(
          and(eq(streakHolidays.id, id), eq(streakHolidays.userId, userId)),
        );
      return { ok: true, holiday: null, action: "cancelled" };
    }

    // Active — truncate to today (never erase an already-missed week).
    const updated = await db
      .update(streakHolidays)
      .set({ endDate: today })
      .where(and(eq(streakHolidays.id, id), eq(streakHolidays.userId, userId)))
      .returning();
    return { ok: true, holiday: updated[0], action: "truncated" };
  }
}
