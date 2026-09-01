import { and, desc, eq, sql } from "drizzle-orm";
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
    const [activeProgramme, upcomingWorkouts, habits, nutritionTarget, goals] =
      await Promise.all([
        this.programmes.getActiveProgrammeForRelationship(
          trainerId,
          clientId,
          todayIso(),
        ),
        this.programmes.listOpenAssignmentsForClient(trainerId, clientId),
        this.habits.listForUser(clientId),
        this.nutrition.get(clientId),
        this.goals.list(clientId),
      ]);

    const trainerRows = await getDb()
      .select({ role: profiles.role, name: profiles.fullName })
      .from(profiles)
      .where(eq(profiles.id, trainerId))
      .limit(1);
    const trainer = trainerRows[0];
    const assignedByType =
      trainer?.role === "personal_trainer" ||
      trainer?.role === "physiotherapist"
        ? trainer.role
        : null;

    const briefRows = await getDb()
      .select({
        id: notifications.id,
        title: notifications.title,
        message: notifications.message,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, clientId),
          eq(notifications.type, "coach_brief"),
          // Legacy briefs without trainerId cannot be safely assigned from the
          // current relationship alone: a newly-active coach could otherwise
          // inherit a previous coach's private guidance. Fail closed until an
          // auditable attribution/backfill exists.
          sql`${notifications.data}->>'trainerId' = ${trainerId}`,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(20);

    const activeGoal = goals.find(
      (goal) => goal.isActive === true && goal.assignedByUserId === trainerId,
    );
    return {
      activeProgramme,
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
          (habit) => habit.enabled && habit.assignedByUserId === trainerId,
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
            ? { from: habit.pending.from, ...habit.pending.config }
            : null,
        })),
      nutritionTarget:
        nutritionTarget?.setByUserId === trainerId ? nutritionTarget : null,
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
      visibleBriefs: briefRows.map((brief) => ({
        id: brief.id,
        title: brief.title,
        content: brief.message ?? "",
        createdAt:
          brief.createdAt instanceof Date
            ? brief.createdAt.toISOString()
            : String(brief.createdAt),
      })),
    };
  }
}
