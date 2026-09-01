import { inArray, sql } from "drizzle-orm";
import { notifications, profiles } from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { todayIso } from "../trainers/programs/shared";
import {
  ProgramAssignmentRepository,
  type ActiveProgrammeSummary,
  type CoachClientAssignment,
} from "./programAssignmentRepository";
import {
  NutritionTargetRepository,
  type NutritionTargetDTO,
} from "./nutritionTargetRepository";
import { HabitConfigRepository } from "./habitConfigRepository";
import { GoalRepository } from "./goalRepository";

export type AthleteVisibleBrief = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
};

export type AthleteCoachingHabit = {
  category: string;
  enabled: boolean;
  goalId: string;
  assignedByCoach: boolean;
  assignedByName: string | null;
  locked: boolean;
  targetValue: number;
  unit: string;
  period: string;
  completionRule: string;
  daysPerWeek: number | null;
  tolerancePct: number | null;
  pending: ({ from: string } & Record<string, unknown>) | null;
};

export type AthleteCoachingGoal = {
  id: string;
  title: string;
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  targetDate: string | null;
};

export type AthleteUpcomingWorkout = {
  assignmentId: string;
  workoutId: string;
  name: string | null;
  estimatedDurationMinutes: number | null;
  dueDate: string | null;
  assignedByType: "personal_trainer" | "physiotherapist" | null;
  assignedByName: string | null;
};

/**
 * Public relationship/assignment contract shared verbatim by coach and athlete.
 * Private coach notes are intentionally not representable in this type.
 */
export type CoachingAssignmentAggregate = {
  activeProgramme: ActiveProgrammeSummary | null;
  upcomingWorkouts: AthleteUpcomingWorkout[];
  habits: AthleteCoachingHabit[];
  nutritionTarget: NutritionTargetDTO | null;
  activeGoal: AthleteCoachingGoal | null;
  visibleBriefs: AthleteVisibleBrief[];
};

export class CoachingAggregateRepository {
  private readonly programmes = new ProgramAssignmentRepository();
  private readonly nutrition = new NutritionTargetRepository();
  private readonly habits = new HabitConfigRepository();
  private readonly goals = new GoalRepository();

  async get(
    trainerId: string,
    clientId: string,
  ): Promise<CoachingAssignmentAggregate> {
    const aggregates = await this.getMany([trainerId], clientId);
    return aggregates.get(trainerId)!;
  }

  /**
   * Loads every active relationship aggregate with a fixed seven-query read:
   * programme, workouts, habits, nutrition, goals, profiles, and briefs.
   */
  async getMany(
    trainerIds: string[],
    clientId: string,
  ): Promise<Map<string, CoachingAssignmentAggregate>> {
    const uniqueTrainerIds = [...new Set(trainerIds)];
    if (uniqueTrainerIds.length === 0) return new Map();

    const db = getDb();
    const [
      activeProgrammes,
      workoutsByTrainer,
      habits,
      nutritionTarget,
      goals,
      trainerRows,
      briefRows,
    ] = await Promise.all([
      this.programmes.getActiveProgrammesForRelationships(
        uniqueTrainerIds,
        clientId,
        todayIso(),
      ),
      this.programmes.listOpenAssignmentsForRelationships(
        uniqueTrainerIds,
        clientId,
      ),
      this.habits.listForUser(clientId),
      this.nutrition.get(clientId),
      this.goals.list(clientId),
      db
        .select({
          id: profiles.id,
          role: profiles.role,
          name: profiles.fullName,
        })
        .from(profiles)
        .where(inArray(profiles.id, uniqueTrainerIds)),
      db.execute(sql`
        WITH ranked_briefs AS (
          SELECT
            ${notifications.id} AS "id",
            ${notifications.data}->>'trainerId' AS "trainerId",
            ${notifications.title} AS "title",
            ${notifications.message} AS "message",
            ${notifications.createdAt} AS "createdAt",
            row_number() OVER (
              PARTITION BY ${notifications.data}->>'trainerId'
              ORDER BY ${notifications.createdAt} DESC, ${notifications.id} DESC
            ) AS relationship_rank
          FROM ${notifications}
          WHERE ${notifications.userId} = ${clientId}
            AND ${notifications.type} = 'coach_brief'
            -- Legacy briefs without trainerId fail closed; a current coach must
            -- never inherit another coach's unattributed historical guidance.
            AND ${inArray(
              sql<string>`${notifications.data}->>'trainerId'`,
              uniqueTrainerIds,
            )}
        )
        SELECT "id", "trainerId", "title", "message", "createdAt"
        FROM ranked_briefs
        WHERE relationship_rank <= 20
        ORDER BY "trainerId", relationship_rank
      `) as unknown as Promise<
        Array<{
          id: string;
          trainerId: string;
          title: string;
          message: string | null;
          createdAt: Date | string;
        }>
      >,
    ]);

    const trainersById = new Map(trainerRows.map((row) => [row.id, row]));
    const briefsByTrainer = new Map<string, typeof briefRows>();
    for (const brief of briefRows) {
      const trainerBriefs = briefsByTrainer.get(brief.trainerId) ?? [];
      trainerBriefs.push(brief);
      briefsByTrainer.set(brief.trainerId, trainerBriefs);
    }

    return new Map(
      uniqueTrainerIds.map((trainerId) => {
        const trainer = trainersById.get(trainerId);
        const assignedByType =
          trainer?.role === "personal_trainer" ||
          trainer?.role === "physiotherapist"
            ? trainer.role
            : null;
        const activeGoal = goals.find(
          (goal) =>
            goal.isActive === true && goal.assignedByUserId === trainerId,
        );
        const upcomingWorkouts = workoutsByTrainer.get(trainerId) ?? [];
        const trainerBriefs = briefsByTrainer.get(trainerId) ?? [];

        return [
          trainerId,
          {
            activeProgramme: activeProgrammes.get(trainerId) ?? null,
            upcomingWorkouts: upcomingWorkouts.map(
              (workout: CoachClientAssignment) => ({
                assignmentId: workout.assignmentId,
                workoutId: workout.workoutId,
                name: workout.name,
                estimatedDurationMinutes: workout.estimatedDurationMinutes,
                dueDate: workout.dueDate,
                assignedByType,
                assignedByName: trainer?.name ?? null,
              }),
            ),
            habits: habits
              // Relationship modules must contain only THIS coach's assignments.
              // Client-authored and co-coach setup belongs on the client's canonical
              // surfaces, not under a misleading "your coach" heading here.
              .filter(
                (habit) =>
                  habit.enabled && habit.assignedByUserId === trainerId,
              )
              .map((habit) => ({
                category: habit.category,
                enabled: habit.enabled,
                goalId: habit.goalId,
                assignedByCoach: habit.assignedByUserId !== null,
                assignedByName: habit.assignedByName,
                // This aggregate is only attached to an active relationship payload.
                locked: habit.assignedByUserId !== null,
                targetValue: habit.targetValue,
                unit: habit.unit,
                period: habit.period,
                completionRule: habit.completionRule,
                daysPerWeek: habit.daysPerWeek,
                tolerancePct: habit.tolerancePct,
                pending: habit.pending
                  ? { ...habit.pending.config, from: habit.pending.from }
                  : null,
              })),
            nutritionTarget:
              nutritionTarget?.setByUserId === trainerId
                ? nutritionTarget
                : null,
            activeGoal: activeGoal
              ? {
                  id: activeGoal.id,
                  title: activeGoal.goalTypeName ?? "Goal",
                  targetValue: activeGoal.targetValue,
                  currentValue: activeGoal.currentValue,
                  unit: activeGoal.unit,
                  targetDate: activeGoal.targetDate,
                }
              : null,
            visibleBriefs: trainerBriefs.map((brief) => ({
              id: brief.id,
              title: brief.title,
              content: brief.message ?? "",
              createdAt:
                brief.createdAt instanceof Date
                  ? brief.createdAt.toISOString()
                  : String(brief.createdAt),
            })),
          },
        ];
      }),
    );
  }
}
