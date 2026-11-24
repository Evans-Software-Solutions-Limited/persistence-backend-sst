import { useEffect, useRef } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { findPlan } from "@/domain/services/nutritionPlans.service";
import { usePlanDraft } from "@/state/plan-draft";
import { useNutritionPlans } from "@/ui/hooks/useNutritionPlans";
import { PlanBuilderContainer } from "./PlanBuilderContainer";

/**
 * <PlanEditContainer> — `fuel/plan-edit?id=<planId>` (PER-133, N34). Opens
 * one of the person's OWN plans in the builder. A coach's plan is read-only
 * and an unknown id has nothing to edit, so both go straight back. Editing
 * a plan you already have needs no subscription.
 */
export function PlanEditContainer() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === "string" ? params.id : "";
  const { cache, isLoading } = useNutritionPlans();
  const start = usePlanDraft((s) => s.start);
  const clear = usePlanDraft((s) => s.clear);
  const draftId = usePlanDraft((s) => (s.mode === "edit" ? s.draft?.id : null));
  const started = useRef(false);

  const ref = findPlan(cache, id);
  const mine = ref?.kind === "mine" ? ref.plan : null;

  useEffect(() => {
    if (started.current) return;
    if (mine) {
      started.current = true;
      start("edit", mine);
    } else if (!isLoading) {
      started.current = true;
      router.back();
    }
  }, [mine, isLoading, start]);

  // A draft started from the route's local id stays open after its create
  // syncs (the id then resolves to the server plan; Inspector Brad, #554).
  if (!mine || (draftId !== mine.id && draftId !== id)) return null;
  return (
    <PlanBuilderContainer
      mode="edit"
      onBack={() => {
        clear();
        router.back();
      }}
    />
  );
}
