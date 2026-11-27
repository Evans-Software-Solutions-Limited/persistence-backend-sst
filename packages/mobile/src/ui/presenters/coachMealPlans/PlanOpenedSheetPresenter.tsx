import { Text, View } from "@tamagui/core";

import type { NutritionPlan } from "@/domain/models/nutritionPlans";
import type { NutritionTarget } from "@/domain/models/nutrition";
import {
  compareWithTarget,
  macrosVsTarget,
} from "@/domain/services/nutritionPlans.service";
import { kcalText } from "@/domain/services/coachMealPlans.service";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { EyebrowHead } from "@/ui/presenters/coachForms/kit";
import { PlanTargetSummaryPresenter } from "@/ui/presenters/fuel/plans/PlanTargetSummaryPresenter";

/**
 * C3.2c iPhone · Meal plan opened: the plan against the client's own target
 * and its meals, with Edit plan. Pure.
 */
export function PlanOpenedSheetPresenter(p: {
  visible: boolean;
  plan: NutritionPlan | null;
  target: NutritionTarget | null;
  clientFirst: string;
  online: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const plan = p.plan;
  const meals = plan
    ? [...plan.meals].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];
  return (
    <BottomSheet
      visible={p.visible && !!plan}
      onClose={p.onClose}
      title={plan?.name ?? ""}
      eyebrow="Meal plan"
      accent="trainer"
      height="tall"
      scrollable
      testID="plan-opened-sheet"
      footer={
        <View paddingHorizontal={20} paddingTop={6}>
          <Btn
            variant="filled"
            tone="trainer"
            size="lg"
            full
            disabled={!p.online}
            onPress={p.onEdit}
            testID="plan-opened-edit"
          >
            Edit plan
          </Btn>
        </View>
      }
    >
      {plan ? (
        <View paddingHorizontal={20} gap={14}>
          <EyebrowHead
            title={p.target ? `Against ${p.clientFirst}’s target` : "Planned"}
          />
          <PlanTargetSummaryPresenter
            comparison={compareWithTarget(plan.totals, p.target)}
            planned={plan.totals}
            macros={macrosVsTarget(plan.totals, p.target)}
            testID="plan-opened-summary"
          />
          <EyebrowHead title={`Meals · ${meals.length}`} />
          {meals.map((m) => (
            <View
              key={m.id}
              flexDirection="row"
              alignItems="center"
              gap={10}
              paddingVertical={10}
              borderBottomWidth={1}
              borderBottomColor="$border"
            >
              <View flex={1} gap={2}>
                <Text fontFamily="$body" fontSize={14.5} color="$text">
                  {m.name}
                </Text>
                <Text
                  fontFamily="$body"
                  fontSize={12}
                  color="$text3"
                  numberOfLines={1}
                >
                  {m.items.map((i) => i.name).join(" · ") || "Nothing yet"}
                </Text>
              </View>
              <Text fontFamily="$mono" fontSize={12.5} color="$text2">
                {kcalText(m.totals.kcal)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </BottomSheet>
  );
}
