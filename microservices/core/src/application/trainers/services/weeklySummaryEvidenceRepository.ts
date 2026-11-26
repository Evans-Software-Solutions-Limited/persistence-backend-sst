import { and, desc, eq, gte, inArray, isNull, ne } from "drizzle-orm";
import {
  coachFormRequests,
  coachFormResponses,
  coachFormVersions,
  coachForms,
  nutritionEntries,
  nutritionPlanAssignments,
  nutritionPlans,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import { clientAdherenceReport } from "../../adherence/coachAdherence";
import {
  addDays,
  localDateIn,
  type LocalDate,
} from "../../adherence/computeAdherence";
import type { CoachScope } from "../../relationships/resolveCoachScope";
import { ProgramAssignmentRepository } from "../../repositories/programAssignmentRepository";
import {
  MAX_CHECK_INS,
  adherenceEvidence,
  checkInEvidence,
  mealPlanEvidence,
  type EvidenceQuestion,
  type WeeklySummaryEvidence,
} from "./weeklySummary";

const DAY_MS = 86_400_000;

/**
 * Assembles the AI weekly summary's evidence for one client as one coach
 * sees them (PER-115, design B D4). The caller has already run
 * `resolveCoachScope`; every read here is scoped by that scope's coach,
 * relationship and client.
 *
 *  - Adherence: the one shared calculation (`clientAdherenceReport`, 7 days),
 *    tracked areas only.
 *  - Programme week: this coach's live programme, via PER-112's
 *    `weekOfProgramme`.
 *  - Form responses: the latest few this coach may see, from the last 7 days,
 *    when the coach has Check-ins on. Photo answers are dropped.
 *  - Plan meals logged: from this coach's live plans over the last 7
 *    completed days, when the coach has Nutrition on.
 *
 * Never photos, never the coach's private notes, never food rows.
 */
export async function loadWeeklySummaryEvidence(
  scope: CoachScope,
  timeZone: string,
  now: Date,
): Promise<WeeklySummaryEvidence> {
  const today = localDateIn(now, timeZone);
  const coachingStart = scope.activatedAt
    ? localDateIn(new Date(scope.activatedAt), timeZone)
    : null;
  const features = scope.settings.features;

  const [report, programme, checkIns, mealPlan] = await Promise.all([
    clientAdherenceReport(scope, "7d", now),
    new ProgramAssignmentRepository().getActiveProgrammeForRelationship(
      scope.trainerId,
      scope.clientId,
      today,
    ),
    features.checkIns
      ? latestCheckIns(scope, timeZone, now)
      : Promise.resolve([]),
    features.nutrition
      ? planMealsLogged(scope, timeZone, now, today, coachingStart)
      : Promise.resolve(null),
  ]);

  const evidence: WeeklySummaryEvidence = adherenceEvidence(report);
  if (programme) evidence.programme = programme.weekOfProgramme;
  if (checkIns.length > 0) evidence.checkIns = checkIns;
  if (mealPlan) evidence.mealPlan = mealPlan;
  return evidence;
}

/**
 * The latest form responses from this coach's CURRENT coaching cycle,
 * submitted in the last 7 days: requests on this relationship sent since it
 * last became active. That is the active branch of PER-116's
 * `visibleRequests` without exit forms (they belong to ended coaching), so it
 * never shows more than the coach may see. Written out here rather than
 * imported because the forms module also handles photo answers, and no module
 * on an AI path may import photo code (PER-121 `noAiPhotos.test.ts`).
 */
async function latestCheckIns(scope: CoachScope, timeZone: string, now: Date) {
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const rows = await getDb()
    .select({
      title: coachForms.title,
      late: coachFormRequests.late,
      submittedAt: coachFormResponses.submittedAt,
      answers: coachFormResponses.answers,
      questions: coachFormVersions.questions,
    })
    .from(coachFormResponses)
    .innerJoin(
      coachFormRequests,
      eq(coachFormRequests.id, coachFormResponses.requestId),
    )
    .innerJoin(coachForms, eq(coachForms.id, coachFormRequests.formId))
    .innerJoin(
      coachFormVersions,
      eq(coachFormVersions.id, coachFormRequests.formVersionId),
    )
    .where(
      and(
        eq(coachFormRequests.trainerId, scope.trainerId),
        eq(coachFormRequests.clientId, scope.clientId),
        eq(coachFormRequests.relationshipId, scope.relationshipId),
        scope.activatedAt
          ? gte(coachFormRequests.sentAt, new Date(scope.activatedAt))
          : undefined,
        gte(coachFormResponses.submittedAt, since),
      ),
    )
    .orderBy(desc(coachFormResponses.submittedAt), desc(coachFormResponses.id))
    .limit(MAX_CHECK_INS);
  return rows.map((r) =>
    checkInEvidence({
      title: r.title,
      submittedOn: localDateIn(r.submittedAt, timeZone),
      late: r.late,
      questions: r.questions as EvidenceQuestion[],
      answers: r.answers,
    }),
  );
}

/**
 * Plan meals logged from this coach's live plans over the last 7 completed
 * days (yesterday back 6, never before coaching started). null when the coach
 * has no live plan for the client: no plan, no meal-plan area.
 */
async function planMealsLogged(
  scope: CoachScope,
  timeZone: string,
  now: Date,
  today: LocalDate,
  coachingStart: LocalDate | null,
) {
  const db = getDb();
  const plans = await db
    .select({ planId: nutritionPlanAssignments.planId })
    .from(nutritionPlanAssignments)
    .innerJoin(
      nutritionPlans,
      eq(nutritionPlans.id, nutritionPlanAssignments.planId),
    )
    .where(
      and(
        eq(nutritionPlanAssignments.trainerId, scope.trainerId),
        eq(nutritionPlanAssignments.relationshipId, scope.relationshipId),
        eq(nutritionPlanAssignments.clientId, scope.clientId),
        ne(nutritionPlanAssignments.status, "removed"),
        isNull(nutritionPlans.archivedAt),
      ),
    );
  const planIds = [...new Set(plans.map((p) => p.planId))];
  if (planIds.length === 0) return null;

  const to = addDays(today, -1);
  const windowFrom = addDays(to, -6);
  const from =
    coachingStart !== null && coachingStart > windowFrom
      ? coachingStart
      : windowFrom;
  // Two days of slack either side of the local window for time zones.
  const since = new Date(now.getTime() - 9 * DAY_MS);
  const rows = await db
    .select({
      id: nutritionEntries.id,
      loggedAt: nutritionEntries.loggedAt,
      sourcePlanMealId: nutritionEntries.sourcePlanMealId,
    })
    .from(nutritionEntries)
    .where(
      and(
        eq(nutritionEntries.userId, scope.clientId),
        inArray(nutritionEntries.sourcePlanId, planIds),
        gte(nutritionEntries.loggedAt, since),
      ),
    );
  return mealPlanEvidence(
    planIds.length,
    rows.map((r) => ({
      id: r.id,
      day: localDateIn(r.loggedAt, timeZone),
      sourcePlanMealId: r.sourcePlanMealId,
    })),
    from,
    to,
  );
}
