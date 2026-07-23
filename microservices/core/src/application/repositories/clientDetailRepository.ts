import { and, desc, eq, sql } from "drizzle-orm";
import {
  bodyMeasurements,
  goalTypes,
  habitConfigs,
  profiles,
  ptClientRelationships,
  trainerClientNotes,
  userGoals,
  workoutAssignments,
  workoutSessions,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import {
  clientAdherence,
  clientRosterBand,
  initialsFromName,
} from "./trainerRepository";
import { HomeReadRepository } from "./homeReadRepository";
import { VolumeRepository } from "./volumeRepository";
import { NutritionTargetRepository } from "./nutritionTargetRepository";
import { StreakRepository } from "./streakRepository";
import { ProgramAssignmentRepository } from "./programAssignmentRepository";
import { AiUsageLogRepository } from "./aiUsageLogRepository";
import {
  AI_COACH_SUMMARY_DAILY_LIMIT,
  AI_COACH_SUMMARY_ENDPOINT,
  ClientAiSummaryRepository,
} from "./clientAiSummaryRepository";
import { assertEntitlement } from "../entitlement/assertEntitlement";
import {
  addDaysISO,
  localDateISO,
  periodEndISO,
  periodStartFromEndISO,
} from "../streaks/period";
import { weekMet } from "../streaks/collection";
import {
  ageYearsFrom,
  calorieCategoryPct,
  habitProgressPct,
  weightGoalPct,
  type AdherenceModule,
  type AiSummaryModule,
  type CalorieHitModule,
  type ClientDetail,
  type ClientDetailHeader,
  type ClientDetailNote,
  type ClientDetailRecentSession,
  type GoalModule,
  type HabitsModule,
  type PrHighlight,
  type VolumeModule,
} from "./clientDetail";

const ADHERENCE_WINDOW_DAYS = 28;
const RECENT_SESSIONS_LIMIT = 10;
const RECENT_PRS_LIMIT = 8;
const DEFAULT_TZ = "Europe/London";

/**
 * The Client Detail read aggregate (specs/10-trainer-features/design.md
 * § "Client Detail — functional contract"). Composes the athlete repos with
 * the CLIENT's userId for the coach's single-scroll screen. All authorization
 * (role + active relationship) is the HANDLER's job via
 * `assertTrainerCanActForClient`; this repository assumes the gate has passed
 * and does NO cross-user leakage — every module query is scoped to `clientId`,
 * and notes are scoped to `(trainerId, clientId)`.
 *
 * The delegate repos are constructed here (not DI-injected) so the handler
 * mounts as a single `.get` with no long decorator chain — that keeps the root
 * Elysia type instantiation under TS's depth ceiling (TS2589), the same reason
 * the on-behalf routes are grouped into a sub-app.
 */
export class ClientDetailRepository {
  static readonly key = "ClientDetailRepository";

  private readonly home = new HomeReadRepository();
  private readonly volume = new VolumeRepository();
  private readonly nutritionTargets = new NutritionTargetRepository();
  private readonly streaks = new StreakRepository();
  private readonly programmes = new ProgramAssignmentRepository();
  private readonly aiSummaries = new ClientAiSummaryRepository();
  private readonly aiUsage = new AiUsageLogRepository();

  async getClientDetail(
    trainerId: string,
    clientId: string,
    now: Date = new Date(),
  ): Promise<ClientDetail> {
    const tz = await this.resolveTz(clientId);

    // Current client-local week (Mon–Sun) per the streak period math.
    const weekEnd = periodEndISO(now, "weekly", tz);
    const weekStart = periodStartFromEndISO(weekEnd, "weekly");
    const todayISO = localDateISO(now, tz);
    // 28-day adherence window (same grain the roster row uses).
    const windowStart = addDaysISO(todayISO, -(ADHERENCE_WINDOW_DAYS - 1));
    // The AI summary covers the CONCLUDED (previous) client-local day, so the
    // card is always a whole-day view (design.md § Module g).
    const coversDate = addDaysISO(todayISO, -1);

    const [
      client,
      calorieHit,
      volume,
      prsRaw,
      goal,
      habits,
      recentSessions,
      notes,
      adherence,
      workoutsCompleted,
      workoutsPlanned,
      aiSummary,
    ] = await Promise.all([
      this.getHeader(trainerId, clientId, now),
      this.getCalorieHit(clientId, tz, weekStart, weekEnd, todayISO),
      this.getVolume(clientId, tz, weekStart, weekEnd),
      this.home.getRecentPRs(clientId, RECENT_PRS_LIMIT),
      this.getGoal(trainerId, clientId, tz, windowStart, todayISO),
      this.getHabits(clientId, tz, weekStart, weekEnd),
      this.getRecentSessions(clientId),
      this.getNotes(trainerId, clientId),
      this.getAdherence(trainerId, clientId, windowStart, todayISO),
      this.volume.completedSessionCount(clientId, tz, weekStart, weekEnd),
      this.getWorkoutsPlannedThisWeek(clientId, todayISO, weekStart, weekEnd),
      this.getAiSummaryModule(trainerId, clientId, coversDate),
    ]);

    const prs: PrHighlight[] = prsRaw.map((r) => ({
      type: r.recordType,
      exerciseName: r.exerciseName,
      value: r.value,
      unit: "kg",
      achievedAt: r.achievedAt,
    }));

    const prsThisWeek = prsRaw.filter(
      (r) =>
        r.achievedAt != null &&
        this.inWeek(r.achievedAt, tz, weekStart, weekEnd),
    ).length;

    // Adherence categories: v1 lights Workouts (from the 28-day %) AND Calorie
    // (from module d's daysHit/daysLogged, since module d ships in this PR).
    // Protein / check-in / sleep stay unavailable (need HealthKit / habits).
    const caloriePct = calorieHit
      ? calorieCategoryPct(calorieHit.daysHit, calorieHit.daysLogged)
      : null;
    const withCategories: AdherenceModule = {
      overall: adherence.overall,
      band: adherence.band,
      categories: [
        {
          label: "Workouts completed",
          pct: adherence.overall,
          sub: "Last 28 days",
          available: adherence.overall != null,
        },
        {
          label: "Calorie target",
          pct: caloriePct,
          sub: "Days within ±10% this week",
          available: caloriePct != null,
        },
        {
          label: "Protein target",
          pct: null,
          sub: "Available with Fuel",
          available: false,
        },
        {
          label: "Check-ins",
          pct: null,
          sub: "Available with habits",
          available: false,
        },
        {
          label: "Sleep",
          pct: null,
          sub: "Available with Health",
          available: false,
        },
      ],
    };

    return {
      client,
      adherence: withCategories,
      prs,
      volume,
      calorieHit,
      goal,
      habits,
      // Module g — the cached summary for the concluded day (or null). The read
      // NEVER triggers an inference (design.md § Module g "Reads never infer").
      aiSummary,
      thisWeek: {
        workoutsCompleted,
        workoutsPlanned,
        volumeKg: volume.weekKg,
        prs: prsThisWeek,
        checkIns: null,
      },
      recentSessions,
      notes,
    };
  }

  private async resolveTz(clientId: string): Promise<string> {
    const db = getDb();
    const rows = await db
      .select({ tz: profiles.timezone })
      .from(profiles)
      .where(eq(profiles.id, clientId))
      .limit(1);
    return rows[0]?.tz ?? DEFAULT_TZ;
  }

  /**
   * Module g read — the cached summary row for the concluded day, or a null
   * shell. NEVER triggers a Bedrock inference (design.md § Module g): the
   * generation path is the POST endpoint only. `canManualRefresh` mirrors the
   * design contract — a row exists, its one manual refresh is unused
   * (refresh_count < 1), the coach still has `ai_access`, AND the coach is under
   * the per-coach daily ceiling. The entitlement + ceiling reads are cheap and
   * only run when a refreshable row actually exists (no row / spent row →
   * short-circuit false, zero extra reads).
   */
  private async getAiSummaryModule(
    trainerId: string,
    clientId: string,
    coversDate: string,
  ): Promise<AiSummaryModule> {
    const row = await this.aiSummaries.getForDay(
      trainerId,
      clientId,
      coversDate,
    );
    if (!row) {
      return {
        summary: null,
        coversDate,
        generatedAt: null,
        canManualRefresh: false,
      };
    }
    const canManualRefresh =
      row.refreshCount < 1 && (await this.coachCanSpendOnSummary(trainerId));
    return {
      summary: row.summary,
      coversDate,
      generatedAt: row.generatedAt,
      canManualRefresh,
    };
  }

  /**
   * Whether the coach may spend another summary inference right now: has
   * `ai_access` AND is under the per-coach daily ceiling. Used only to gate the
   * manual-refresh affordance on a read — a read never spends a token.
   */
  private async coachCanSpendOnSummary(trainerId: string): Promise<boolean> {
    const entitlement = await assertEntitlement(trainerId, "ai_access");
    if (!entitlement.allowed) return false;
    const usedToday = await this.aiUsage.countForUserToday(
      trainerId,
      AI_COACH_SUMMARY_ENDPOINT,
    );
    return usedToday < AI_COACH_SUMMARY_DAILY_LIMIT;
  }

  private async getHeader(
    trainerId: string,
    clientId: string,
    now: Date,
  ): Promise<ClientDetailHeader> {
    const db = getDb();
    const rows = await db
      .select({
        id: profiles.id,
        fullName: profiles.fullName,
        avatarUrl: profiles.avatarUrl,
        dateOfBirth: profiles.dateOfBirth,
        heightCm: profiles.heightCm,
        preferredUnits: profiles.preferredUnits,
      })
      .from(profiles)
      .where(eq(profiles.id, clientId))
      .limit(1);
    const p = rows[0];

    // Relationship status for THIS trainer↔client pair (scoped to trainerId so
    // another trainer's row can't set it). The gate guarantees an active,
    // non-AI row exists; the query mirrors that filter and defaults to "active"
    // as a type-narrowing safety net.
    const relRows = await db
      .select({ status: ptClientRelationships.status })
      .from(ptClientRelationships)
      .where(
        and(
          eq(ptClientRelationships.trainerId, trainerId),
          eq(ptClientRelationships.clientId, clientId),
          eq(ptClientRelationships.isAiTrainer, false),
        ),
      )
      .orderBy(desc(ptClientRelationships.status))
      .limit(1);
    const status =
      (relRows[0]?.status as "active" | "pending" | undefined) ?? "active";

    const name = p?.fullName ?? "";
    return {
      id: clientId,
      name,
      initials: initialsFromName(name),
      avatarUrl: p?.avatarUrl ?? null,
      status,
      ageYears: ageYearsFrom(p?.dateOfBirth ?? null, now),
      heightCm: p?.heightCm != null ? Number(p.heightCm) : null,
      preferredUnits:
        (p?.preferredUnits as "metric" | "imperial" | null) ?? null,
    };
  }

  /**
   * `windowEnd` is always the client-local `todayISO` at this call site (the
   * caller never passes a historical end date), so the upper bound can be a
   * plain strict `<` against it — that alone excludes a due-TODAY assignment
   * (QA-18): it's neither completed nor genuinely missed yet, so it must not
   * drag adherence to 0%. Mirrors the `dueDate < now` MISSED-flag bound in
   * `trainerRepository.getMissedCountsByClient` / `getAdherenceRows`.
   */
  private async getAdherence(
    trainerId: string,
    clientId: string,
    windowStart: string,
    windowEnd: string,
  ): Promise<{ overall: number | null; band: AdherenceModule["band"] }> {
    const db = getDb();
    // Same computation the roster row uses: completed vs total past-due
    // workout assignments due in the window, scoped to THIS trainer.
    const rows = await db
      .select({
        completed: sql<number>`count(*) filter (where ${workoutAssignments.status} = 'completed')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(workoutAssignments)
      .where(
        and(
          eq(workoutAssignments.trainerId, trainerId),
          eq(workoutAssignments.clientId, clientId),
          sql`${workoutAssignments.dueDate} is not null`,
          sql`${workoutAssignments.dueDate} >= ${windowStart}`,
          sql`${workoutAssignments.dueDate} < ${windowEnd}`,
        ),
      );
    const total = rows[0]?.total ?? 0;
    const completed = rows[0]?.completed ?? 0;
    // Brand-new / lightly-scheduled client — fewer than ADHERENCE_MIN_SAMPLE
    // past-due assignments → "not enough data yet" (null/null), never
    // 0%/crisis (design.md § Module a; QA-18 grace). Shares the threshold with
    // the roster path via `clientAdherence` so the two never disagree.
    const overall = clientAdherence(completed, total);
    if (overall === null) return { overall: null, band: null };
    return { overall, band: clientRosterBand(overall) };
  }

  private async getVolume(
    clientId: string,
    tz: string,
    weekStart: string,
    weekEnd: string,
  ): Promise<VolumeModule> {
    const daily = await this.volume.dailyVolume(
      clientId,
      tz,
      weekStart,
      weekEnd,
    );
    if (daily.length === 0) return { weekKg: null, daily: [] };
    const weekKg = daily.reduce((sum, d) => sum + d.volumeKg, 0);
    return { weekKg, daily };
  }

  /**
   * Module d — per-day kcal totals for the client's current week. TOTALS ONLY:
   * this returns hit/logged counts + today's kcal, NEVER the food-entry rows
   * (privacy line, Brad 2026-07-05). The per-day sum + ±10% tolerance mirrors
   * `nutrition_streak`'s within_tolerance rule (cross-cuts § 3.1). Grouped by
   * the SELECT ordinal in a subquery so the parameterized tz expr is never
   * reused across SELECT and GROUP BY (Postgres 42803 guard — same shape as
   * StreakRepository.countCalorieToleranceDays / VolumeRepository.dailyVolume).
   */
  private async getCalorieHit(
    clientId: string,
    tz: string,
    weekStart: string,
    weekEnd: string,
    todayISO: string,
  ): Promise<CalorieHitModule | null> {
    const target = await this.nutritionTargets.get(clientId);
    const targetKcal = target ? target.dailyKcal : null;

    const perDay = await this.dailyKcalTotals(clientId, tz, weekStart, weekEnd);
    // No target AND no logging → nothing to show (design.md empty state).
    if (targetKcal == null && perDay.length === 0) return null;

    const daysLogged = perDay.length;
    let daysHit = 0;
    if (targetKcal != null) {
      const lower = targetKcal * 0.9;
      const upper = targetKcal * 1.1;
      daysHit = perDay.filter((d) => d.kcal >= lower && d.kcal <= upper).length;
    }
    const todayRow = perDay.find((d) => d.date === todayISO);
    const todayKcal = todayRow ? todayRow.kcal : perDay.length > 0 ? 0 : null;
    const todayRemainingKcal =
      targetKcal != null && todayKcal != null ? targetKcal - todayKcal : null;

    return {
      targetKcal,
      daysHit,
      daysLogged,
      todayKcal,
      todayRemainingKcal,
    };
  }

  /**
   * Per-day kcal SUM for the client-local week — totals only, one row per day
   * that has any logged entry. Ordinal GROUP BY (42803 guard).
   */
  private async dailyKcalTotals(
    clientId: string,
    tz: string,
    weekStart: string,
    weekEnd: string,
  ): Promise<{ date: string; kcal: number }[]> {
    const db = getDb();
    const rows = (await db.execute(sql`
      SELECT (logged_at AT TIME ZONE ${tz})::date AS d,
             coalesce(sum(kcal), 0)::float AS kcal
      FROM nutrition_entries
      WHERE user_id = ${clientId}
        AND (logged_at AT TIME ZONE ${tz})::date BETWEEN ${weekStart} AND ${weekEnd}
      GROUP BY 1
    `)) as unknown as Array<{ d: string | Date; kcal: number }>;
    return rows.map((r) => {
      const day = r.d as unknown;
      return {
        date:
          day instanceof Date
            ? day.toISOString().slice(0, 10)
            : String(day).slice(0, 10),
        kcal: Number(r.kcal) || 0,
      };
    });
  }

  /**
   * Module e — the most recent ACTIVE user_goals row (name via goal_types FK;
   * no title column, no status enum). Weight axis: start = earliest weigh-in in
   * the 28-day window, now = latest, target = the goal target_value; pct
   * clamped 0..1 or null. `assignedByCoach = assigned_by_user_id === trainerId`.
   */
  private async getGoal(
    trainerId: string,
    clientId: string,
    tz: string,
    windowStart: string,
    todayISO: string,
  ): Promise<GoalModule | null> {
    const db = getDb();
    const rows = await db
      .select({
        id: userGoals.id,
        title: goalTypes.name,
        unit: userGoals.unit,
        targetValue: userGoals.targetValue,
        targetDate: userGoals.targetDate,
        assignedByUserId: userGoals.assignedByUserId,
      })
      .from(userGoals)
      .innerJoin(goalTypes, eq(userGoals.goalTypeId, goalTypes.id))
      .where(
        and(
          eq(userGoals.userId, clientId),
          eq(userGoals.isActive, true),
          // The primary-goal card is a body/training goal (Weight Loss, Muscle
          // Gain, …) rendered on a weight axis — NOT a habit. Habit goal types
          // (water/gym/steps/sleep/calories) carry `category = 'habit'` and are
          // surfaced by the habits module; including them here made the newest
          // habit (e.g. Calories) masquerade as the primary goal, rendering the
          // client's bodyweight with the habit's unit ("67 kcal"). Exclude them.
          sql`${goalTypes.category} is distinct from 'habit'`,
        ),
      )
      .orderBy(desc(userGoals.createdAt))
      .limit(1);
    const g = rows[0];
    if (!g) return null;

    // Weight axis from body_measurements within the window (client-local).
    const measRows = await db
      .select({
        weightKg: bodyMeasurements.weightKg,
        measuredAt: bodyMeasurements.measuredAt,
      })
      .from(bodyMeasurements)
      .where(
        and(
          eq(bodyMeasurements.userId, clientId),
          sql`${bodyMeasurements.weightKg} is not null`,
          sql`(${bodyMeasurements.measuredAt} AT TIME ZONE ${tz})::date >= ${windowStart}`,
          sql`(${bodyMeasurements.measuredAt} AT TIME ZONE ${tz})::date <= ${todayISO}`,
        ),
      )
      .orderBy(bodyMeasurements.measuredAt);
    const weights = measRows
      .map((m) => (m.weightKg != null ? Number(m.weightKg) : null))
      .filter((w): w is number => w != null);
    const startKg = weights.length > 0 ? weights[0] : null;
    const nowKg = weights.length > 0 ? weights[weights.length - 1] : null;
    const targetKg = g.targetValue != null ? Number(g.targetValue) : null;

    return {
      id: g.id,
      title: g.title,
      unit: g.unit ?? null,
      targetDate: g.targetDate ?? null,
      assignedByCoach: g.assignedByUserId === trainerId,
      weight: { startKg, nowKg, targetKg },
      pct: weightGoalPct(startKg, nowKg, targetKg),
    };
  }

  /**
   * Module f — the client's enabled habit configs + per-habit weekly
   * satisfaction (reusing the Phase-7 `getCollectionHabitAggregates` SQL +
   * `weekMet` decision) + the weekly collection streak (their user_streaks
   * row). No new SQL for the aggregates — this composes the shipped pieces.
   */
  private async getHabits(
    clientId: string,
    tz: string,
    weekStart: string,
    weekEnd: string,
  ): Promise<HabitsModule | null> {
    // Per-habit WEEK satisfaction for the habits EFFECTIVE this week — the
    // streak-scoring set, gated on `effective_from <= weekStart` (§ 4.4).
    const aggregates = await this.streaks.getCollectionHabitAggregates(
      clientId,
      weekStart,
      weekEnd,
      tz,
    );
    const aggByGoal = new Map(aggregates.map((a) => [a.goalId, a]));

    // The Targets summary is "what the coach has set for this client" — NOT the
    // streak-scoring set — so list EVERY active habit config regardless of
    // `effective_from`. A habit whose `effective_from` is a future Monday (a
    // fresh enable, § 4.4) is configured-but-not-yet-scored: show it as a
    // target to aim for (0% / not started this week) rather than hiding the
    // whole card, which made a client with habits set look like they had none.
    const db = getDb();
    const configs = await db
      .select({
        goalId: habitConfigs.goalId,
        category: habitConfigs.category,
        label: goalTypes.name,
      })
      .from(habitConfigs)
      .innerJoin(userGoals, eq(habitConfigs.goalId, userGoals.id))
      .innerJoin(goalTypes, eq(userGoals.goalTypeId, goalTypes.id))
      .where(
        and(eq(habitConfigs.userId, clientId), eq(userGoals.isActive, true)),
      );
    if (configs.length === 0) return null;

    const habits = configs.map((c) => {
      const a = aggByGoal.get(c.goalId);
      if (!a) {
        // Configured but not effective this week yet — a target to aim for.
        return {
          goalId: c.goalId,
          label: c.label ?? "Habit",
          category: c.category ?? "",
          met: false,
          pct: 0,
        };
      }
      return {
        goalId: c.goalId,
        label: c.label ?? "Habit",
        category: c.category ?? "",
        met: weekMet(a),
        pct: habitProgressPct({
          completionRule: a.completionRule,
          targetValue: a.targetValue,
          daysPerWeek: a.daysPerWeek,
          qualifyingDays: a.qualifyingDays,
          sessionCount: a.sessionCount,
        }),
      };
    });

    const streakRow = await this.streaks.getCollectionHabitStreak(clientId);
    return {
      habits,
      collectionStreak: streakRow?.currentCount ?? 0,
      // Collection satisfaction stays scored on EFFECTIVE habits only (anti-
      // gaming § 4.4): a not-yet-effective habit is loggable but not part of
      // this week's requirement, so it can't make the collection unsatisfied.
      collectionSatisfied:
        aggregates.length > 0 && aggregates.every((a) => weekMet(a)),
    };
  }

  private async getRecentSessions(
    clientId: string,
  ): Promise<ClientDetailRecentSession[]> {
    const db = getDb();
    const rows = await db
      .select({
        id: workoutSessions.id,
        name: workoutSessions.name,
        completedAt: workoutSessions.completedAt,
      })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, clientId),
          eq(workoutSessions.status, "completed"),
          sql`${workoutSessions.completedAt} is not null`,
        ),
      )
      .orderBy(desc(workoutSessions.completedAt))
      .limit(RECENT_SESSIONS_LIMIT);
    return rows.map((r) => ({
      id: r.id,
      name: r.name ?? null,
      completedAt:
        r.completedAt instanceof Date
          ? r.completedAt.toISOString()
          : String(r.completedAt),
      // Per-session volume is not part of the aggregate's cheap read; the
      // screen shows names + dates. Left null (contract permits it).
      volumeKg: null,
    }));
  }

  private async getNotes(
    trainerId: string,
    clientId: string,
  ): Promise<ClientDetailNote[]> {
    const db = getDb();
    // Read-only, scoped to (trainerId, clientId) — notes NEVER leak across
    // trainers. A coach keeps MANY notes per client (there is no unique
    // constraint on the pair — see the note in schema.ts); render them all,
    // newest first. CRUD is the coach note sheet (Phase 12).
    const rows = await db
      .select({
        id: trainerClientNotes.id,
        noteType: trainerClientNotes.noteType,
        title: trainerClientNotes.title,
        content: trainerClientNotes.content,
        createdAt: trainerClientNotes.createdAt,
      })
      .from(trainerClientNotes)
      .where(
        and(
          eq(trainerClientNotes.trainerId, trainerId),
          eq(trainerClientNotes.clientId, clientId),
        ),
      )
      .orderBy(desc(trainerClientNotes.createdAt));
    return rows.map((r) => ({
      id: r.id,
      noteType: r.noteType ?? "progress",
      title: r.title,
      content: r.content,
      createdAt:
        r.createdAt instanceof Date
          ? r.createdAt.toISOString()
          : String(r.createdAt),
    }));
  }

  /**
   * `thisWeek.workoutsPlanned` — the count of the client's programme-scheduled
   * workouts falling in the current client-local week. Programme assignment
   * MATERIALISES `workout_assignments` occurrence rows, so the weekly schedule
   * is the count of those rows with due_date in the week. Null when the client
   * has no active programme (design.md `thisWeek.workoutsPlanned` null rule).
   * The aggregate does NOT fold the programme object itself — mobile keeps its
   * separate active-programme endpoint (#166).
   */
  private async getWorkoutsPlannedThisWeek(
    clientId: string,
    todayISO: string,
    weekStart: string,
    weekEnd: string,
  ): Promise<number | null> {
    const active = await this.programmes.getActiveProgrammeForClient(
      clientId,
      todayISO,
    );
    if (!active) return null;
    const db = getDb();
    const rows = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(workoutAssignments)
      .where(
        and(
          eq(workoutAssignments.clientId, clientId),
          sql`${workoutAssignments.dueDate} is not null`,
          sql`${workoutAssignments.dueDate} >= ${weekStart}`,
          sql`${workoutAssignments.dueDate} <= ${weekEnd}`,
        ),
      );
    return rows[0]?.c ?? 0;
  }

  private inWeek(
    achievedAtISO: string,
    tz: string,
    weekStart: string,
    weekEnd: string,
  ): boolean {
    const d = localDateISO(new Date(achievedAtISO), tz);
    return d >= weekStart && d <= weekEnd;
  }
}
