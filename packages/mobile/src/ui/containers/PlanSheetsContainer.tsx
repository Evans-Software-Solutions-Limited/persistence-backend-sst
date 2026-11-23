import { useMemo } from "react";
import { router, type Href } from "expo-router";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useNutritionPlans } from "@/ui/hooks/useNutritionPlans";
import { useMealprintGate } from "@/ui/hooks/useMealprintGate";
import { useManualMealPlansGate } from "@/ui/hooks/useManualMealPlansGate";
import { useFuelSheets } from "@/state/fuel-sheets";
import { usePlanSheets } from "@/state/plan-sheets";
import type { NutritionPlansCache } from "@/domain/models/nutritionPlans";
import {
  compareWithTarget,
  defaultPlanId,
  macrosVsTarget,
  visibleCoachPlans,
  visibleMyPlans,
} from "@/domain/services/nutritionPlans.service";
import {
  CoachPlanSheetPresenter,
  PlanSwitchSheetPresenter,
  type SwitchGroupVM,
} from "@/ui/presenters/fuel/PlanSheetsPresenter";
import { firstName, mealLine } from "./PlanTabContainer";

const kcal = (n: number) => `${Math.round(n).toLocaleString("en-GB")} kcal`;

/** N7 groups: each coach's plans (violet), then mine (cyan). */
export function switchGroups(
  cache: NutritionPlansCache,
  selectedId: string | null,
): SwitchGroupVM[] {
  const current = selectedId ?? defaultPlanId(cache);
  const byCoach = new Map<string, SwitchGroupVM>();
  for (const c of visibleCoachPlans(cache)) {
    const key = `coach-${c.coach.id}`;
    if (!byCoach.has(key)) {
      byCoach.set(key, {
        key,
        title: `From ${firstName(c.coach.name)} · your coach`,
        coach: true,
        rows: [],
      });
    }
    const tag =
      c.status === "sent" ? " · New" : c.updatedSinceSeen ? " · Updated" : "";
    byCoach.get(key)!.rows.push({
      id: c.plan.id,
      name: c.plan.name,
      sub: `${kcal(c.plan.totals.kcal)}${tag}`,
      initial: (firstName(c.coach.name)[0] ?? "C").toUpperCase(),
      selected: c.plan.id === current,
    });
  }
  const mine = visibleMyPlans(cache).map((p) => ({
    id: p.id,
    name: p.name,
    sub: kcal(p.totals.kcal),
    initial: (p.name.trim()[0] ?? "P").toUpperCase(),
    selected: p.id === current,
  }));
  return [
    ...byCoach.values(),
    ...(mine.length > 0
      ? [{ key: "mine", title: "Mine", coach: false, rows: mine }]
      : []),
  ];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "C"
  );
}

/**
 * <PlanSheetsContainer> — root-mounted N7 "Your plans" and C6 "New meal plan
 * from <coach>" (PER-133). Picking a plan shows it on the Plan tab; Add to my
 * plans / Not now answer the coach offline-first.
 */
export function PlanSheetsContainer() {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const sheet = usePlanSheets((s) => s.sheet);
  const coachPlanId = usePlanSheets((s) => s.coachPlanId);
  const selectedPlanId = usePlanSheets((s) => s.selectedPlanId);
  const select = usePlanSheets((s) => s.select);
  const close = usePlanSheets((s) => s.close);
  const openCoachPlan = usePlanSheets((s) => s.openCoachPlan);
  const plans = useNutritionPlans(sheet !== null);
  const mealprintGate = useMealprintGate();
  const manualGate = useManualMealPlansGate();

  const groups = useMemo(
    () => switchGroups(plans.cache, selectedPlanId),
    [plans.cache, selectedPlanId],
  );

  const coach = coachPlanId
    ? (visibleCoachPlans(plans.cache).find((c) => c.plan.id === coachPlanId) ??
      null)
    : null;
  const target = userId ? storage.getCachedNutritionTarget(userId) : null;

  return (
    <>
      <PlanSwitchSheetPresenter
        visible={sheet === "switch"}
        groups={groups}
        onClose={close}
        onPick={(id) => {
          select(id);
          const waiting = visibleCoachPlans(plans.cache).find(
            (c) => c.plan.id === id && c.status === "sent",
          );
          if (waiting) openCoachPlan(id);
          else close();
        }}
        onNewPlan={() => {
          close();
          if (!manualGate.isResolved) return;
          if (!manualGate.allowed) manualGate.onUpgrade();
          else router.push("/(app)/fuel/plan-new" as Href);
        }}
        onMealprint={() => {
          close();
          if (!mealprintGate.isResolved) return;
          if (mealprintGate.allowed)
            useFuelSheets.getState().openMealprintPlan();
          else useFuelSheets.getState().openSuggestLocked();
        }}
      />
      {coach ? (
        <CoachPlanSheetPresenter
          visible={sheet === "coachPlan"}
          coachName={coach.coach.name}
          coachInitials={initials(coach.coach.name)}
          planName={coach.plan.name}
          note={coach.note}
          comparison={compareWithTarget(coach.plan.totals, target)}
          planned={coach.plan.totals}
          macros={macrosVsTarget(coach.plan.totals, target)}
          meals={coach.plan.meals.map((m) => ({
            id: m.id,
            slot: m.name,
            name: mealLine(m.items.map((i) => i.name)),
            kcal: Math.round(m.totals.kcal).toLocaleString("en-GB"),
          }))}
          onClose={close}
          onNotNow={() => {
            close();
            void plans.answerCoachPlan(coach.plan.id, false);
          }}
          onAdd={() => {
            close();
            select(coach.plan.id);
            void plans.answerCoachPlan(coach.plan.id, true);
          }}
        />
      ) : null}
    </>
  );
}
