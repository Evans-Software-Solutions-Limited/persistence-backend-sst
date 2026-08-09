import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { getDb } from "@persistence/db/client";
import { StreakRepository } from "../streakRepository";

const USER = "00000000-0000-4000-8000-000000000001";
const dialect = new PgDialect();

function monday(date = new Date()): Date {
  const utc = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  return utc;
}

function plusDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe("workout streak reconciliation SQL", () => {
  let pg: PGlite;
  let repo: StreakRepository;

  beforeEach(async () => {
    pg = await PGlite.create();
    await pg.exec(`
      CREATE TABLE workout_sessions (
        id text PRIMARY KEY,
        user_id uuid NOT NULL,
        status text NOT NULL,
        completed_at timestamptz
      );
      CREATE TABLE user_streaks (
        id text PRIMARY KEY DEFAULT md5(random()::text),
        user_id uuid NOT NULL,
        streak_type text NOT NULL,
        source_goal_id uuid,
        period text NOT NULL,
        current_count int NOT NULL DEFAULT 0,
        longest_count int NOT NULL DEFAULT 0,
        last_period_end date NOT NULL,
        freeze_tokens int NOT NULL DEFAULT 0,
        status text NOT NULL DEFAULT 'active',
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      );
      CREATE UNIQUE INDEX user_streaks_workout_singleton_uq
        ON user_streaks (user_id)
        WHERE streak_type = 'workout_streak' AND source_goal_id IS NULL;
      CREATE TABLE achievements (
        id text PRIMARY KEY,
        category text NOT NULL,
        requirements jsonb
      );
      CREATE TABLE user_achievements (
        id text PRIMARY KEY DEFAULT md5(random()::text),
        user_id uuid NOT NULL,
        achievement_id text NOT NULL,
        unlocked_at timestamptz DEFAULT now(),
        UNIQUE (user_id, achievement_id)
      );
    `);
    for (const threshold of [1, 2, 4, 8, 12]) {
      await pg.query(
        `INSERT INTO achievements (id, category, requirements)
         VALUES ($1, 'streak', jsonb_build_object('streak_type', 'workout_streak', 'threshold', $2::int))`,
        [`a${threshold}`, threshold],
      );
    }

    vi.mocked(getDb).mockReturnValue({
      execute: async (input: SQL) => {
        const query = dialect.sqlToQuery(input);
        const result = await pg.query(query.sql, query.params);
        return result.rows;
      },
    } as never);
    repo = new StreakRepository();
    vi.spyOn(repo, "getUserTimezone").mockResolvedValue("UTC");
  });

  afterEach(async () => {
    await pg.close();
    vi.restoreAllMocks();
  });

  async function addWeeks(weekStarts: Date[]): Promise<void> {
    for (const [index, week] of weekStarts.entries()) {
      await pg.query(
        `INSERT INTO workout_sessions (id, user_id, status, completed_at)
         VALUES ($1, $2, 'completed', $3)`,
        [`w${index}`, USER, week.toISOString()],
      );
    }
  }

  async function state(): Promise<Record<string, unknown>> {
    const result = await pg.query<Record<string, unknown>>(
      `SELECT current_count, longest_count, last_period_end::text,
              freeze_tokens, status
       FROM user_streaks WHERE user_id = $1`,
      [USER],
    );
    return result.rows[0] ?? {};
  }

  it("replays 12 contiguous weeks, spends three tokens across a terminal gap, and unlocks every tier", async () => {
    const current = monday();
    const lastCompleted = plusDays(current, -28); // three missed weeks after it
    await addWeeks(
      Array.from({ length: 12 }, (_, index) =>
        plusDays(lastCompleted, (index - 11) * 7),
      ),
    );

    await repo.reconcileWorkoutStreakHistory(USER);

    expect(await state()).toMatchObject({
      current_count: 12,
      longest_count: 12,
      last_period_end: isoDate(plusDays(current, -1)),
      freeze_tokens: 0,
      status: "active",
    });
    const unlocked = await pg.query<{ achievement_id: string }>(
      `SELECT achievement_id FROM user_achievements
       WHERE user_id = $1 ORDER BY achievement_id`,
      [USER],
    );
    expect(unlocked.rows.map((row) => row.achievement_id)).toEqual([
      "a1",
      "a12",
      "a2",
      "a4",
      "a8",
    ]);
  });

  it("breaks when terminal misses exceed the earned token balance", async () => {
    const current = monday();
    const lastCompleted = plusDays(current, -21); // two missed weeks after it
    await addWeeks(
      Array.from({ length: 4 }, (_, index) =>
        plusDays(lastCompleted, (index - 3) * 7),
      ),
    );

    await repo.reconcileWorkoutStreakHistory(USER);

    expect(await state()).toMatchObject({
      current_count: 0,
      longest_count: 4,
      freeze_tokens: 1,
      status: "broken",
    });
  });

  it("uses the bounded event week as its horizon", async () => {
    const eventWeek = plusDays(monday(), -42);
    await addWeeks([plusDays(eventWeek, -14)]);

    await repo.reconcileWorkoutStreakHistory(USER, isoDate(eventWeek));

    expect(await state()).toMatchObject({
      current_count: 0,
      longest_count: 1,
      last_period_end: isoDate(plusDays(eventWeek, -1)),
      status: "broken",
    });
  });

  it("preserves equal-cursor live skip state while merging history", async () => {
    const current = monday();
    await addWeeks(
      Array.from({ length: 5 }, (_, index) =>
        plusDays(current, (index - 4) * 7),
      ),
    );
    await pg.query(
      `INSERT INTO user_streaks (
         user_id, streak_type, source_goal_id, period, current_count,
         longest_count, last_period_end, freeze_tokens, status
       ) VALUES ($1, 'workout_streak', NULL, 'weekly', 4, 4, $2, 0, 'active')`,
      [USER, isoDate(plusDays(current, 6))],
    );

    await repo.reconcileWorkoutStreakHistory(USER);

    expect(await state()).toMatchObject({
      current_count: 4,
      longest_count: 5,
      freeze_tokens: 0,
      status: "active",
    });
  });
});
