import type {
  CoachCalorieAdherence,
  CoachClientTarget,
  CoachPlanAssignment,
} from "@/domain/models/coachMealPlans";
import type { NutritionPlan, PlanMacros } from "@/domain/models/nutritionPlans";
import type { NutritionTarget } from "@/domain/models/nutrition";

/**
 * Coach meal plans (PER-135, canvas C1 / C3.2). Pure copy and numbers for
 * the coach's library, editor and the client's Nutrition tab.
 */

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** "2,476" */
export function kcalText(n: number): string {
  return Math.round(n).toLocaleString("en-GB");
}

/** "186P 294C 63F" */
export function macroLine(m: Omit<PlanMacros, "kcal">): string {
  return `${Math.round(m.proteinG)}P ${Math.round(m.carbsG)}C ${Math.round(m.fatG)}F`;
}

/** C2 row: "5 meals · 186P 294C 63F". */
export function librarySubline(plan: NutritionPlan): string {
  return `${plural(plan.meals.length, "meal", "meals")} · ${macroLine(plan.totals)}`;
}

/** C3.2b row: "5 meals · 2,476 planned". */
export function plannedLine(plan: NutritionPlan): string {
  return `${plural(plan.meals.length, "meal", "meals")} · ${kcalText(plan.totals.kcal)} planned`;
}

/** "today", "yesterday", "3 days ago", or "21 Oct" after two weeks. */
export function daysAgo(iso: string, now: number): string {
  const start = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const then = new Date(iso);
  const days = Math.round((start(new Date(now)) - start(then)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** What the client has done with a plan; `tone` picks the pill. */
export function assignmentStatus(
  a: Pick<CoachPlanAssignment, "status" | "sentAt" | "usedDays">,
  clientFirst: string,
  now: number,
): { text: string; tone: "done" | "waiting" | "paused" } {
  if (a.status === "added") {
    return {
      text:
        a.usedDays > 0
          ? `In ${clientFirst}’s plans · used ${plural(a.usedDays, "day", "days")}`
          : `In ${clientFirst}’s plans`,
      tone: "done",
    };
  }
  if (a.status === "dismissed") {
    return { text: `${clientFirst} chose Not now`, tone: "paused" };
  }
  // The API has no "opened" signal: the server sets seenRevision to the
  // plan's revision when it's sent, so only the send time is shown.
  return { text: `Sent ${daysAgo(a.sentAt, now)}`, tone: "waiting" };
}

export function loggedThisWeek(list: readonly CoachPlanAssignment[]): number {
  return list.reduce((n, a) => n + a.loggedThisWeek, 0);
}

/** "5 of 7 days on target · 1 not logged" (PER-114). */
export function calorieLine(c: CoachCalorieAdherence | null): string | null {
  if (!c || c.daysCounted === 0) return null;
  const base = `${c.daysOnTarget} of ${plural(c.daysCounted, "day", "days")} on target`;
  return c.daysNotLogged > 0 ? `${base} · ${c.daysNotLogged} not logged` : base;
}

/** Who set the target: this coach, the client, or another of their coaches. */
export function targetSetBy(
  setByUserId: string | null,
  coachId: string | null,
  clientId: string,
  clientFirst: string,
): string {
  if (setByUserId && setByUserId === coachId) return "Set by you";
  if (!setByUserId || setByUserId === clientId) {
    return `${clientFirst}’s own target`;
  }
  return "Set by another coach";
}

/** The client's target in the shape the plan ring compares with. */
export function asNutritionTarget(
  t: CoachClientTarget | null,
  clientId: string,
): NutritionTarget | null {
  if (!t) return null;
  return {
    userId: clientId,
    dailyKcal: t.dailyKcal,
    proteinG: t.proteinG,
    carbsG: t.carbsG,
    fatG: t.fatG,
    waterCups: 0,
    preset: null,
    setByUserId: t.setByUserId,
    setByName: null,
    updatedAt: null,
  };
}

/** "Sam" from "Sam Patel". */
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] || "your client";
}
