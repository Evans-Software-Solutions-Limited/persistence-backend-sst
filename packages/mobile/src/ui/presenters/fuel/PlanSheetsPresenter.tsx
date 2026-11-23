import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { IconCheck, IconPlus, IconSparkles } from "@/ui/components/icons";
import type {
  MacroVsTarget,
  TargetComparison,
} from "@/domain/services/nutritionPlans.service";
import { PlanTargetSummaryPresenter } from "./plans/PlanTargetSummaryPresenter";
import { COACH_VIOLET, PLAN_CYAN } from "./PlanTabPresenter";

/**
 * The Plan tab's two sheets (PER-133), root-mounted like the other Fuel
 * sheets:
 * - N7 "Your plans": coach plans (violet, under the coach's name) and mine
 *   (cyan), with New plan and Mealprint. The canvas's "This week" schedule
 *   and the weekdays on each row are gone (no days on plans).
 * - C6 "New meal plan from <coach>": note, ring against the person's target,
 *   meals, Not now / Add to my plans.
 */

export type SwitchRowVM = {
  id: string;
  name: string;
  /** "2,501 kcal", plus "New" or "Updated" for coach plans. */
  sub: string;
  initial: string;
  selected: boolean;
};

export type SwitchGroupVM = {
  key: string;
  /** "From Ellie · your coach" or "Mine". */
  title: string;
  coach: boolean;
  rows: SwitchRowVM[];
};

export type PlanSwitchSheetProps = {
  visible: boolean;
  groups: SwitchGroupVM[];
  onClose: () => void;
  onPick: (planId: string) => void;
  onNewPlan: () => void;
  onMealprint: () => void;
  testID?: string;
};

/** The canvas's `.btn.outline`: 52pt, 14 radius, hairline border. */
function OutlineBtn({
  label,
  icon,
  onPress,
  testID,
}: {
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <View
        height={52}
        borderRadius={14}
        borderWidth={1}
        borderColor="rgba(255,255,255,0.16)"
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap={8}
      >
        {icon}
        <Text fontFamily="$body" fontSize={15} fontWeight="600" color="$text">
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function Eyebrow({ text, color }: { text: string; color: string }) {
  return (
    <Text
      fontFamily="$body"
      fontSize={11}
      fontWeight="600"
      letterSpacing={2.6}
      textTransform="uppercase"
      color={color}
    >
      {text}
    </Text>
  );
}

export function PlanSwitchSheetPresenter({
  visible,
  groups,
  onClose,
  onPick,
  onNewPlan,
  onMealprint,
  testID = "plan-switch-sheet",
}: PlanSwitchSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Your plans"
      height="content"
      scrollable={false}
      testID={testID}
    >
      <View gap={14}>
        {groups.map((g) => (
          <View key={g.key} gap={4} testID={`${testID}-group-${g.key}`}>
            <Eyebrow
              text={g.title}
              color={g.coach ? COACH_VIOLET : "#8A8A98"}
            />
            {g.rows.map((r) => {
              const accent = g.coach ? COACH_VIOLET : PLAN_CYAN;
              return (
                <Pressable
                  key={r.id}
                  onPress={() => onPick(r.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: r.selected }}
                  accessibilityLabel={`${r.name}, ${r.sub}`}
                  testID={`${testID}-row-${r.id}`}
                >
                  <View
                    flexDirection="row"
                    alignItems="center"
                    gap={12}
                    paddingVertical={10}
                    borderBottomWidth={1}
                    borderBottomColor="rgba(255,255,255,0.06)"
                  >
                    <View
                      width={30}
                      height={30}
                      borderRadius={9999}
                      backgroundColor="$bg"
                      borderWidth={1.5}
                      borderColor={accent}
                      alignItems="center"
                      justifyContent="center"
                    >
                      <Text
                        fontFamily="$body"
                        fontSize={12}
                        fontWeight="600"
                        color={accent}
                      >
                        {r.initial}
                      </Text>
                    </View>
                    <View flex={1} gap={2}>
                      <Text
                        fontFamily="$body"
                        fontSize={15}
                        fontWeight="500"
                        color="$text"
                      >
                        {r.name}
                      </Text>
                      <Text fontFamily="$mono" fontSize={12} color="$text3">
                        {r.sub}
                      </Text>
                    </View>
                    {r.selected ? (
                      <IconCheck size={18} color={PLAN_CYAN} />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}
        <View flexDirection="row" gap={10}>
          <View flex={1}>
            <OutlineBtn
              icon={<IconPlus size={16} color="#F4F4F8" />}
              onPress={onNewPlan}
              testID={`${testID}-new`}
              label="New plan"
            />
          </View>
          <View flex={1}>
            <OutlineBtn
              icon={<IconSparkles size={16} color="#F5C518" />}
              onPress={onMealprint}
              testID={`${testID}-mealprint`}
              label="Mealprint"
            />
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}

export type CoachPlanSheetProps = {
  visible: boolean;
  coachName: string;
  coachInitials: string;
  planName: string;
  note: string | null;
  comparison: TargetComparison;
  planned: { proteinG: number; carbsG: number; fatG: number };
  macros: readonly MacroVsTarget[];
  meals: { id: string; slot: string; name: string; kcal: string }[];
  onClose: () => void;
  onNotNow: () => void;
  onAdd: () => void;
  testID?: string;
};

export function CoachPlanSheetPresenter(p: CoachPlanSheetProps) {
  const testID = p.testID ?? "coach-plan-sheet";
  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onClose}
      height="tall"
      accent="trainer"
      testID={testID}
      footer={
        <View flexDirection="row" gap={10}>
          <View flex={1}>
            <OutlineBtn
              onPress={p.onNotNow}
              testID={`${testID}-not-now`}
              label="Not now"
            />
          </View>
          <View flex={1.4}>
            <Btn full onPress={p.onAdd} testID={`${testID}-add`}>
              Add to my plans
            </Btn>
          </View>
        </View>
      }
    >
      <View gap={14}>
        <View flexDirection="row" alignItems="center" gap={12}>
          <View
            width={44}
            height={44}
            borderRadius={9999}
            backgroundColor="rgba(167,139,250,0.16)"
            alignItems="center"
            justifyContent="center"
          >
            <Text
              fontFamily="$body"
              fontSize={14}
              fontWeight="600"
              color={COACH_VIOLET}
            >
              {p.coachInitials}
            </Text>
          </View>
          <View flex={1}>
            <Eyebrow
              text={`From your coach · ${p.coachName}`}
              color={COACH_VIOLET}
            />
            <Text
              marginTop={2}
              fontFamily="$display"
              fontSize={21}
              lineHeight={27}
              fontWeight="700"
              color="$text"
              accessibilityRole="header"
            >
              {p.planName}
            </Text>
          </View>
        </View>
        {p.note ? (
          <View
            borderLeftWidth={2}
            borderLeftColor={COACH_VIOLET}
            paddingLeft={12}
            paddingVertical={2}
            testID={`${testID}-note`}
          >
            <Text
              fontFamily="$body"
              fontSize={14}
              lineHeight={20}
              color="$text2"
            >
              “{p.note}”
            </Text>
          </View>
        ) : null}
        <PlanTargetSummaryPresenter
          comparison={p.comparison}
          planned={p.planned}
          macros={p.macros}
          testID={`${testID}-summary`}
        />
        <View>
          {p.meals.map((m) => (
            <View
              key={m.id}
              flexDirection="row"
              alignItems="center"
              gap={12}
              paddingVertical={8}
              borderBottomWidth={1}
              borderBottomColor="rgba(255,255,255,0.06)"
            >
              <View flex={1} gap={2}>
                <Text
                  fontFamily="$body"
                  fontSize={10}
                  fontWeight="600"
                  letterSpacing={1.4}
                  textTransform="uppercase"
                  color="$text3"
                >
                  {m.slot}
                </Text>
                <Text fontFamily="$body" fontSize={14} color="$text">
                  {m.name}
                </Text>
              </View>
              <Text fontFamily="$mono" fontSize={13} color="$text">
                {m.kcal}
              </Text>
            </View>
          ))}
        </View>
        <Text fontFamily="$body" fontSize={12.5} lineHeight={18} color="$text3">
          It goes under Coach in your plans. Pick it in Plan whenever you want
          to follow it. Nothing is logged until you log it.
        </Text>
      </View>
    </BottomSheet>
  );
}
