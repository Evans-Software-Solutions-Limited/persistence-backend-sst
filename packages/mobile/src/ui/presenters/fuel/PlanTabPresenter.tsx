import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { Utensils } from "lucide-react-native";
import {
  IconBasket,
  IconCheck,
  IconChevronD,
  IconChevronR,
  IconEdit,
  IconPlus,
  IconSparkles,
} from "@/ui/components/icons";
import type { TargetComparison } from "@/domain/services/nutritionPlans.service";

/**
 * <PlanTabPresenter> — Fuel → Plan (canvas N6 coach plan, N8 my plan, N10 no
 * plan yet; PER-133). Rendered under the shared Fuel header.
 *
 * Plans have no days or dates (Brad, 17–18 Nov): the canvas's "Mon · Wed ·
 * Fri" line is gone. The strip compares the plan with the person's OWN
 * target. Mine are cyan and editable; a coach's are violet and read-only.
 * Pure: <PlanTabContainer> builds the view model.
 */

export const PLAN_CYAN = "#22D3EE";
export const COACH_VIOLET = "#A78BFA";
const GOLD = "#F5C518";
const MACRO = {
  C: { bg: "rgba(34,211,238,0.12)", fg: "#22D3EE" },
  F: { bg: "rgba(251,146,60,0.12)", fg: "#FB923C" },
  P: { bg: "rgba(52,211,153,0.12)", fg: "#34D399" },
} as const;

export type PlanMealVM = {
  id: string;
  /** "BREAKFAST" eyebrow text (the plan meal's name). */
  slot: string;
  kcal: string;
  /** What's in it, e.g. "Bagel, egg and chicken sausage". */
  name: string;
  carbsG: number;
  fatG: number;
  proteinG: number;
};

export type PlanViewVM = {
  id: string;
  name: string;
  kind: "mine" | "coach";
  /** Coach plans: the coach changed it since it was last opened. */
  updated: boolean;
  ownerInitial: string;
  ownerText: string;
  comparison: TargetComparison;
  /** "181 / 178g P"-style chips, in P · C · F order. */
  macroChips: { letter: "P" | "C" | "F"; text: string }[];
  meals: PlanMealVM[];
  /** The first empty meal's name (the gap row), or null. */
  gapMeal: string | null;
  inShoppingList: boolean;
  /** The edit lost to another device; the server's copy is shown. */
  conflict: boolean;
};

export type PlanTabProps = {
  state: "loading" | "empty" | "plan";
  plan: PlanViewVM | null;
  /** A short confirmation after adding to today (not on the canvas). */
  notice: string | null;
  onOpenSwitch: () => void;
  onOwnerAction: () => void;
  onLogMeal: (mealId: string) => void;
  /** My plans: tapping a meal opens the plan to change it. */
  onOpenMeal: (mealId: string) => void;
  onLogAll: () => void;
  onAddFood: () => void;
  onFillWithMealprint: () => void;
  onShoppingList: () => void;
  onDismissConflict: () => void;
  onBuildOwn: () => void;
  onStartFromDay: () => void;
  onMealprintBuild: () => void;
  testID?: string;
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

function Chip({
  label,
  icon,
  onPress,
  testID,
  color = "$text2",
  borderColor = "rgba(255,255,255,0.10)",
  disabled = false,
  flex,
}: {
  label: string;
  icon?: React.ReactNode;
  onPress: () => void;
  testID: string;
  color?: string;
  borderColor?: string;
  disabled?: boolean;
  flex?: number;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      testID={testID}
      style={flex ? { flex } : undefined}
    >
      <View
        height={40}
        paddingHorizontal={12}
        borderRadius={9999}
        borderWidth={1}
        borderColor={borderColor}
        backgroundColor="$surface"
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap={6}
      >
        {icon}
        <Text fontFamily="$body" fontSize={12} fontWeight="600" color={color}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function MacroChip({
  letter,
  text,
}: {
  letter: "P" | "C" | "F";
  text: string;
}) {
  return (
    <View
      height={22}
      paddingHorizontal={8}
      borderRadius={9999}
      justifyContent="center"
      backgroundColor={MACRO[letter].bg}
    >
      <Text
        fontFamily="$mono"
        fontSize={11}
        fontWeight="600"
        color={MACRO[letter].fg}
      >
        {text}
      </Text>
    </View>
  );
}

function StripCell({
  value,
  label,
  color,
  first,
  testID,
}: {
  value: string;
  label: string;
  color: string;
  first?: boolean;
  testID: string;
}) {
  return (
    <View
      flex={1}
      gap={2}
      paddingLeft={first ? 0 : 12}
      borderLeftWidth={first ? 0 : 1}
      borderLeftColor="rgba(255,255,255,0.08)"
      testID={testID}
    >
      <Text fontFamily="$mono" fontSize={16} fontWeight="700" color={color}>
        {value}
      </Text>
      <Text
        fontFamily="$body"
        fontSize={10}
        fontWeight="600"
        letterSpacing={1.6}
        textTransform="uppercase"
        color="$text3"
      >
        {label}
      </Text>
    </View>
  );
}

function EmptyRow({
  title,
  sub,
  onPress,
  testID,
  gold,
}: {
  title: string;
  sub: string;
  onPress: () => void;
  testID: string;
  gold?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={10}
        borderBottomWidth={1}
        borderBottomColor="rgba(255,255,255,0.06)"
      >
        <View flex={1} gap={2}>
          <Text fontFamily="$body" fontSize={15} fontWeight="500" color="$text">
            {title}
          </Text>
          <Text fontFamily="$body" fontSize={12} color="$text3">
            {gold ? (
              <Text color={GOLD} fontWeight="600">
                Premium+
              </Text>
            ) : null}
            {sub}
          </Text>
        </View>
        <IconChevronR size={16} color="#8A8A98" />
      </View>
    </Pressable>
  );
}

function NoPlan(p: PlanTabProps) {
  return (
    <View testID="plan-tab-empty">
      <View marginTop={40} gap={10}>
        <Text
          fontFamily="$body"
          fontSize={11}
          fontWeight="600"
          letterSpacing={2.6}
          textTransform="uppercase"
          color="$text3"
        >
          Plan
        </Text>
        <Text
          fontFamily="$display"
          fontSize={28}
          lineHeight={34}
          fontWeight="800"
          letterSpacing={-0.6}
          color="$text"
          accessibilityRole="header"
        >
          Plan what you&apos;ll eat, then tick it off
        </Text>
        <Text fontFamily="$body" fontSize={14} lineHeight={20} color="$text2">
          Add a meal or the whole plan to your Log when you eat it. Make one for
          training days and one for rest days.
        </Text>
      </View>
      <View marginTop={18}>
        <EmptyRow
          title="Build my own plan"
          sub="Pick meals from your foods, saved meals and recipes"
          onPress={p.onBuildOwn}
          testID="plan-empty-build"
        />
        <EmptyRow
          title="Start from a past day"
          sub="Turn a day you logged into a plan"
          onPress={p.onStartFromDay}
          testID="plan-empty-day"
        />
        <EmptyRow
          title="Let Mealprint build it"
          sub=" · ideas that fit your targets"
          onPress={p.onMealprintBuild}
          testID="plan-empty-mealprint"
          gold
        />
      </View>
      <Text
        marginTop={18}
        fontFamily="$body"
        fontSize={12.5}
        lineHeight={18}
        color="$text3"
      >
        Have a coach? Plans they send you appear here automatically.
      </Text>
    </View>
  );
}

function stripValues(c: TargetComparison): {
  target: string;
  toPlan: string;
  toPlanLabel: string;
} {
  if (c.targetKcal === null) {
    return { target: "—", toPlan: "—", toPlanLabel: "To plan" };
  }
  const left = c.toPlanKcal ?? 0;
  return {
    target: fmt(c.targetKcal),
    toPlan: left < 0 ? `+${fmt(-left)}` : fmt(left),
    toPlanLabel: left < 0 ? "Over" : "To plan",
  };
}

export function PlanTabPresenter(props: PlanTabProps) {
  const { state, plan, testID = "plan-tab" } = props;
  if (state === "loading") {
    return (
      <View testID={`${testID}-loading`} marginTop={40} alignItems="center">
        <Text fontFamily="$body" fontSize={13} color="$text3">
          Loading your plans…
        </Text>
      </View>
    );
  }
  if (state === "empty" || plan === null) return <NoPlan {...props} />;

  const coach = plan.kind === "coach";
  const accent = coach ? COACH_VIOLET : PLAN_CYAN;
  const strip = stripValues(plan.comparison);
  const gapKcal =
    plan.comparison.toPlanKcal !== null && plan.comparison.toPlanKcal > 0
      ? fmt(plan.comparison.toPlanKcal)
      : null;

  return (
    <View testID={testID}>
      <Pressable
        onPress={props.onOpenSwitch}
        accessibilityRole="button"
        accessibilityLabel={`${plan.name}. Switch plans`}
        testID="plan-tab-switch"
      >
        <View
          flexDirection="row"
          alignItems="center"
          gap={8}
          marginTop={18}
          minHeight={44}
        >
          <Text
            fontFamily="$display"
            fontSize={26}
            lineHeight={32}
            fontWeight="800"
            letterSpacing={-0.6}
            color="$text"
            flexShrink={1}
          >
            {plan.name}
          </Text>
          <IconChevronD size={20} color="#8A8A98" />
          {plan.updated ? (
            <View
              height={22}
              paddingHorizontal={8}
              borderRadius={9999}
              justifyContent="center"
              backgroundColor="rgba(167,139,250,0.14)"
              testID="plan-tab-updated"
            >
              <Text
                fontFamily="$body"
                fontSize={11}
                fontWeight="600"
                color={COACH_VIOLET}
              >
                Updated
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {plan.conflict ? (
        <Pressable
          onPress={props.onDismissConflict}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          testID="plan-tab-conflict"
        >
          <Text
            marginTop={6}
            fontFamily="$body"
            fontSize={12.5}
            lineHeight={17}
            color="$warning"
          >
            This plan was changed on another device, so your last edit
            wasn&apos;t saved. You&apos;re seeing the latest version.
          </Text>
        </Pressable>
      ) : null}

      <View
        flexDirection="row"
        alignItems="center"
        gap={10}
        paddingVertical={10}
        paddingHorizontal={12}
        borderRadius={14}
        marginTop={12}
        backgroundColor={
          coach ? "rgba(167,139,250,0.10)" : "rgba(34,211,238,0.06)"
        }
        borderWidth={1}
        borderColor={coach ? "rgba(167,139,250,0.30)" : "rgba(34,211,238,0.20)"}
        testID="plan-tab-owner"
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
            {plan.ownerInitial}
          </Text>
        </View>
        <Text
          flex={1}
          fontFamily="$body"
          fontSize={12.5}
          lineHeight={17}
          color="$text2"
        >
          {plan.ownerText}
        </Text>
        <Pressable
          onPress={props.onOwnerAction}
          accessibilityRole="button"
          accessibilityLabel={coach ? "Duplicate" : "Edit"}
          testID="plan-tab-owner-action"
        >
          <View
            height={32}
            paddingHorizontal={12}
            borderRadius={9999}
            borderWidth={1}
            borderColor={
              coach ? "rgba(167,139,250,0.4)" : "rgba(34,211,238,0.4)"
            }
            backgroundColor="$surface"
            justifyContent="center"
          >
            <Text
              fontFamily="$body"
              fontSize={12}
              fontWeight="600"
              color={accent}
            >
              {coach ? "Duplicate" : "Edit"}
            </Text>
          </View>
        </Pressable>
      </View>

      <View
        flexDirection="row"
        marginTop={14}
        paddingVertical={10}
        borderTopWidth={1}
        borderBottomWidth={1}
        borderColor="rgba(255,255,255,0.10)"
        testID="plan-tab-strip"
      >
        <StripCell
          first
          value={strip.target}
          label="Target"
          color="#C2C2CE"
          testID="plan-strip-target"
        />
        <StripCell
          value={fmt(plan.comparison.plannedKcal)}
          label="Planned"
          color="#F4F4F8"
          testID="plan-strip-planned"
        />
        <StripCell
          value={strip.toPlan}
          label={strip.toPlanLabel}
          color={PLAN_CYAN}
          testID="plan-strip-to-plan"
        />
      </View>
      <View flexDirection="row" gap={6} marginTop={10}>
        {plan.macroChips.map((m) => (
          <MacroChip key={m.letter} letter={m.letter} text={m.text} />
        ))}
      </View>

      {plan.meals.map((m) => (
        <Pressable
          key={m.id}
          onPress={coach ? undefined : () => props.onOpenMeal(m.id)}
          disabled={coach}
          accessibilityLabel={coach ? undefined : `${m.name}. Change it`}
          testID={`plan-meal-open-${m.id}`}
        >
          <View
            flexDirection="row"
            alignItems="center"
            gap={12}
            padding={12}
            marginTop={10}
            borderRadius={16}
            backgroundColor="rgba(18,20,29,0.85)"
            borderWidth={1}
            borderColor="rgba(255,255,255,0.06)"
            testID={`plan-meal-${m.id}`}
          >
            <View
              width={64}
              height={64}
              borderRadius={14}
              backgroundColor="$surface3"
              alignItems="center"
              justifyContent="center"
            >
              <Utensils size={22} color="#5C5C68" />
            </View>
            <View flex={1} gap={6}>
              <Text
                fontFamily="$body"
                fontSize={10.5}
                fontWeight="600"
                letterSpacing={1.6}
                textTransform="uppercase"
                color="$text3"
              >
                {m.slot} · {m.kcal} kcal
              </Text>
              <Text
                fontFamily="$body"
                fontSize={15}
                fontWeight="600"
                color="$text"
              >
                {m.name}
              </Text>
              <View flexDirection="row" gap={6}>
                <MacroChip letter="C" text={`${m.carbsG}g C`} />
                <MacroChip letter="F" text={`${m.fatG}g F`} />
                <MacroChip letter="P" text={`${m.proteinG}g P`} />
              </View>
            </View>
            <Pressable
              onPress={() => props.onLogMeal(m.id)}
              accessibilityRole="button"
              accessibilityLabel={`Log ${m.name} today`}
              testID={`plan-meal-log-${m.id}`}
              hitSlop={6}
            >
              <View
                width={32}
                height={32}
                borderRadius={10}
                backgroundColor="$surface2"
                borderWidth={1}
                borderColor="rgba(255,255,255,0.08)"
                alignItems="center"
                justifyContent="center"
              >
                <IconPlus size={16} color={PLAN_CYAN} />
              </View>
            </Pressable>
          </View>
        </Pressable>
      ))}

      {plan.gapMeal !== null && gapKcal !== null ? (
        <View
          padding={12}
          marginTop={10}
          gap={10}
          borderRadius={16}
          borderWidth={1}
          borderStyle="dashed"
          borderColor="rgba(255,255,255,0.16)"
          testID="plan-tab-gap"
        >
          <Text
            fontFamily="$body"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.6}
            textTransform="uppercase"
            color="$text3"
          >
            {plan.gapMeal} · {gapKcal} kcal to plan
          </Text>
          <View flexDirection="row" gap={8}>
            <Chip
              flex={1}
              label="Add food"
              icon={<IconPlus size={14} color="#C2C2CE" />}
              onPress={props.onAddFood}
              testID="plan-gap-add-food"
              disabled={coach}
            />
            <Chip
              flex={1}
              label="Fill with Mealprint"
              icon={<IconSparkles size={14} color={coach ? "#5C5C68" : GOLD} />}
              onPress={props.onFillWithMealprint}
              testID="plan-gap-mealprint"
              color={coach ? "#5C5C68" : GOLD}
              borderColor={
                coach ? "rgba(255,255,255,0.10)" : "rgba(245,197,24,0.35)"
              }
              disabled={coach}
            />
          </View>
        </View>
      ) : null}

      <View flexDirection="row" gap={8} marginTop={12} flexWrap="wrap">
        <Chip
          label={
            plan.inShoppingList
              ? "In your shopping list"
              : "Add to shopping list"
          }
          icon={
            plan.inShoppingList ? (
              <IconCheck size={14} color="#34D399" />
            ) : (
              <IconBasket size={14} color="#C2C2CE" />
            )
          }
          onPress={props.onShoppingList}
          testID="plan-tab-shopping"
        />
        <Chip
          label="Add all to today"
          icon={<IconEdit size={14} color="#C2C2CE" />}
          onPress={props.onLogAll}
          testID="plan-tab-log-all"
          disabled={plan.meals.every((m) => m.kcal === "0")}
        />
      </View>
      {props.notice ? (
        <Text
          marginTop={10}
          fontFamily="$body"
          fontSize={12.5}
          color="$success"
          testID="plan-tab-notice"
          accessibilityLiveRegion="polite"
        >
          {props.notice}
        </Text>
      ) : null}
    </View>
  );
}
