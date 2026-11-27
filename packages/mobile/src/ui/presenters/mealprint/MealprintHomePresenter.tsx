import { Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import {
  IconChevronR,
  IconSettings,
  IconSparkles,
} from "@/ui/components/icons";
import {
  EFFORT_LEVELS,
  EFFORT_LEVEL_BLURBS,
  EFFORT_LEVEL_LABELS,
  MAX_STEER_LENGTH,
  type EffortLevel,
  type SuggestOccasion,
  type SuggestShape,
} from "@/domain/models/mealprint";
import {
  BackBtn,
  RoundIconBtn,
  SheetTitle,
} from "@/ui/presenters/fuel/plans/PlanChrome";
import {
  HeroNumber,
  Hint,
  MealprintPage,
  MealprintTitle,
  SectionEyebrow,
  SectionTitle,
  StatStrip,
  fmtKcal,
  macroCells,
} from "./MealprintChrome";

/**
 * <MealprintHomePresenter> — canvas N15 "What should I eat?" (PER-134): one
 * screen with One meal | Whole day.
 *
 * - One meal: what's left today (hero kcal and P/C/F), Occasion (On plan |
 *   Cheat meal), What are you after (Snack · Meal · Either, on plan only)
 *   and an optional steer. Cheat meal turns the button ember.
 * - Whole day: the target, Your meals (Edit), How much cooking, Food
 *   preferences and an optional steer.
 *
 * Pure: the container owns the form and the calls.
 */

export type MealprintTab = "meal" | "day";

export type MacroAmounts = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

/** The One meal tab. */
export type MealTabVM = {
  /** "Left today", or "Left on Mon 23 Nov" when Log is on another day. */
  leftLabel: string;
  /** Null until the day's target is known on this phone. */
  left: MacroAmounts | null;
  occasion: SuggestOccasion;
  onOccasion: (occasion: SuggestOccasion) => void;
  shape: SuggestShape;
  onShape: (shape: SuggestShape) => void;
};

/** The Whole day tab. */
export type DayTabVM = {
  target: MacroAmounts | null;
  /** "Breakfast, Lunch, Dinner, Snacks". */
  mealsText: string;
  onEditMeals: () => void;
  effortLevel: EffortLevel;
  effortSheetOpen: boolean;
  onOpenEffort: () => void;
  onPickEffort: (level: EffortLevel) => void;
  onCloseEffort: () => void;
  /** "Vegetarian · 2 allergens avoided", or null when none are set. */
  preferencesText: string | null;
};

export type MealprintHomeProps = {
  tab: MealprintTab;
  onTab: (tab: MealprintTab) => void;
  onBack: () => void;
  onPreferences: () => void;
  /** Set on the One meal tab. */
  meal?: MealTabVM;
  /** Set on the Whole day tab. */
  day?: DayTabVM;
  steer: string;
  onSteer: (text: string) => void;
  steerError: string | null;
  /** A problem to show above the button (e.g. the search is full). */
  notice: string | null;
  onSubmit: () => void;
  submitDisabled: boolean;
  testID?: string;
};

const SHAPES: readonly [SuggestShape, string][] = [
  ["snack", "Snack"],
  ["meal", "Meal"],
  ["either", "Either"],
];

/** The pill segmented control (canvas `.seg`). */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
  testID,
}: {
  options: readonly [T, string][];
  value: T;
  onChange: (v: T) => void;
  label: string;
  testID: string;
}) {
  return (
    <View
      flexDirection="row"
      alignSelf="flex-start"
      gap={2}
      padding={3}
      borderRadius={9999}
      backgroundColor="$surface"
      borderWidth={1}
      borderColor="$border"
      accessibilityRole="tablist"
      accessibilityLabel={label}
    >
      {options.map(([key, text]) => {
        const on = key === value;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            testID={`${testID}-${key}`}
          >
            <View
              height={36}
              paddingHorizontal={16}
              borderRadius={9999}
              backgroundColor={on ? "$surface4" : "transparent"}
              justifyContent="center"
            >
              <Text
                fontFamily="$body"
                fontSize={14}
                fontWeight="600"
                color={on ? "$text" : "$text3"}
              >
                {text}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A round outlined choice chip (canvas `.dchip`). */
export function ChoiceChip({
  label,
  selected,
  onPress,
  role = "radio",
  height = 38,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  role?: "radio" | "button";
  height?: number;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole={role}
      accessibilityState={
        role === "radio" ? { checked: selected } : { selected }
      }
      testID={testID}
    >
      <View
        height={height}
        paddingHorizontal={height < 36 ? 11 : 14}
        borderRadius={9999}
        borderWidth={1}
        borderColor={
          selected ? "rgba(34,211,238,0.5)" : "rgba(255,255,255,0.12)"
        }
        backgroundColor={selected ? "rgba(34,211,238,0.14)" : "transparent"}
        justifyContent="center"
      >
        <Text
          fontFamily="$body"
          fontSize={height < 36 ? 12 : 13}
          fontWeight="600"
          color={selected ? "$primary" : "$text2"}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

function SteerInput({
  value,
  onChange,
  placeholder,
  error,
  testID,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder: string;
  error: string | null;
  testID: string;
}) {
  return (
    <View gap={6}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#5C5C68"
        maxLength={MAX_STEER_LENGTH}
        returnKeyType="done"
        accessibilityLabel="Anything specific? (optional)"
        testID={testID}
        style={{
          height: 46,
          borderRadius: 12,
          backgroundColor: "#12141D",
          borderWidth: 1,
          borderColor: error ? "#F87171" : "rgba(255,255,255,0.10)",
          paddingHorizontal: 14,
          color: "#F4F4F8",
          fontSize: 14,
        }}
      />
      {error ? (
        <Text
          fontFamily="$body"
          fontSize={12}
          color="$error"
          testID={`${testID}-error`}
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function SettingRow({
  title,
  sub,
  right,
  onPress,
  testID,
}: {
  title: string;
  sub: string;
  right: "edit" | "chevron";
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}: ${sub}`}
      testID={testID}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={10}
        borderBottomWidth={1}
        borderColor="$border"
      >
        <View flex={1} gap={2}>
          <Text fontFamily="$body" fontSize={15} fontWeight="500" color="$text">
            {title}
          </Text>
          <Text fontFamily="$body" fontSize={12} color="$text3">
            {sub}
          </Text>
        </View>
        {right === "edit" ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            fontWeight="600"
            color="$primary"
          >
            Edit
          </Text>
        ) : (
          <IconChevronR size={16} color="#5C5C68" />
        )}
      </View>
    </Pressable>
  );
}

export function MealprintHomePresenter(p: MealprintHomeProps) {
  const testID = p.testID ?? "mealprint-home";
  const { meal, day } = p;
  const isMeal = p.tab === "meal";
  const cheat = meal?.occasion === "cheat_meal";
  const cta = isMeal
    ? cheat
      ? "Show me the options"
      : "Suggest a meal"
    : "Plan my day";
  const info = isMeal
    ? "Works from what you have left today and your food preferences."
    : "Fills your whole day. Nothing is logged until you log each meal.";

  return (
    <MealprintPage
      testID={testID}
      left={<BackBtn onPress={p.onBack} testID={`${testID}-back`} />}
      eyebrow="Mealprint"
      right={
        <RoundIconBtn
          label="Food preferences"
          onPress={p.onPreferences}
          testID={`${testID}-preferences`}
        >
          <IconSettings size={18} color="#F4F4F8" />
        </RoundIconBtn>
      }
      footer={
        <>
          {p.notice ? (
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$warning"
              textAlign="center"
              testID={`${testID}-notice`}
            >
              {p.notice}
            </Text>
          ) : null}
          <Hint center>{info}</Hint>
          <Btn
            variant="filled"
            tone={isMeal && cheat ? "ember" : "primary"}
            size="lg"
            full
            icon={<IconSparkles size={16} />}
            disabled={p.submitDisabled}
            onPress={p.onSubmit}
            testID={`${testID}-submit`}
          >
            {cta}
          </Btn>
        </>
      }
    >
      <MealprintTitle>What should I eat?</MealprintTitle>
      <View marginTop={14}>
        <Seg
          options={[
            ["meal", "One meal"],
            ["day", "Whole day"],
          ]}
          value={p.tab}
          onChange={p.onTab}
          label="What to plan"
          testID={`${testID}-tab`}
        />
      </View>

      {meal ? (
        <View testID={`${testID}-meal`}>
          <SectionEyebrow marginTop={26}>{meal.leftLabel}</SectionEyebrow>
          {meal.left ? (
            <>
              <HeroNumber
                value={fmtKcal(meal.left.kcal)}
                unit="kcal"
                testID={`${testID}-left-kcal`}
              />
              <StatStrip
                cells={macroCells(meal.left)}
                accessibilityLabel={`${meal.leftLabel}: ${Math.round(meal.left.proteinG)} grams protein, ${Math.round(meal.left.carbsG)} grams carbs, ${Math.round(meal.left.fatG)} grams fat`}
              />
            </>
          ) : (
            <Hint marginTop={6} testID={`${testID}-no-target`}>
              Set a target in Log to see what you have left.
            </Hint>
          )}

          <View marginTop={22} gap={10}>
            <SectionTitle>Occasion</SectionTitle>
            <Seg
              options={[
                ["on_plan", "On plan"],
                ["cheat_meal", "Cheat meal"],
              ]}
              value={meal.occasion === "cheat_meal" ? "cheat_meal" : "on_plan"}
              onChange={meal.onOccasion}
              label="Occasion"
              testID={`${testID}-occasion`}
            />
            <Text fontFamily="$body" fontSize={13} color="$text3">
              {cheat
                ? "Fancy a treat? See how it fits — or the lighter swap that scratches the itch."
                : "Meals that keep you on target."}
            </Text>
          </View>

          {!cheat ? (
            <View marginTop={14} gap={10}>
              <SectionTitle>What are you after</SectionTitle>
              <View
                flexDirection="row"
                flexWrap="wrap"
                gap={8}
                accessibilityRole="radiogroup"
                accessibilityLabel="Snack, meal or either"
              >
                {SHAPES.map(([key, label]) => (
                  <ChoiceChip
                    key={key}
                    label={label}
                    selected={meal.shape === key}
                    onPress={() => meal.onShape(key)}
                    testID={`${testID}-shape-${key}`}
                  />
                ))}
              </View>
            </View>
          ) : null}

          <View marginTop={14} gap={10}>
            <SectionTitle optional>Anything specific?</SectionTitle>
            <SteerInput
              value={p.steer}
              onChange={p.onSteer}
              placeholder="Add a steer — “something sweet”"
              error={p.steerError}
              testID={`${testID}-steer`}
            />
          </View>
        </View>
      ) : null}
      {day ? (
        <View testID={`${testID}-day`}>
          <SectionEyebrow marginTop={26}>Target</SectionEyebrow>
          {day.target ? (
            <>
              <HeroNumber
                value={fmtKcal(day.target.kcal)}
                unit="kcal"
                testID={`${testID}-target-kcal`}
              />
              <StatStrip cells={macroCells(day.target)} />
            </>
          ) : (
            <Hint marginTop={6} testID={`${testID}-no-target`}>
              Set a target in Log so Mealprint knows what to fill.
            </Hint>
          )}
          <View marginTop={14}>
            <SettingRow
              title="Your meals"
              sub={day.mealsText}
              right="edit"
              onPress={day.onEditMeals}
              testID={`${testID}-meals`}
            />
            <SettingRow
              title="How much cooking"
              sub={`${EFFORT_LEVEL_LABELS[day.effortLevel]} · ${EFFORT_LEVEL_BLURBS[day.effortLevel].toLowerCase()}`}
              right="chevron"
              onPress={day.onOpenEffort}
              testID={`${testID}-effort`}
            />
            <SettingRow
              title="Food preferences"
              sub={day.preferencesText ?? "Not set up yet"}
              right="chevron"
              onPress={p.onPreferences}
              testID={`${testID}-prefs-row`}
            />
          </View>
          <View marginTop={14} gap={10}>
            <SectionTitle optional>Anything specific?</SectionTitle>
            <SteerInput
              value={p.steer}
              onChange={p.onSteer}
              placeholder="High protein breakfast, light dinner…"
              error={p.steerError}
              testID={`${testID}-steer`}
            />
          </View>
        </View>
      ) : null}

      {day ? (
        <BottomSheet
          visible={day.effortSheetOpen}
          onClose={day.onCloseEffort}
          height="content"
          testID={`${testID}-effort-sheet`}
        >
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="How much cooking"
          >
            <SheetTitle>How much cooking</SheetTitle>
            {EFFORT_LEVELS.map((level) => (
              <EffortRadio
                key={level}
                level={level}
                selected={day.effortLevel === level}
                onPress={() => day.onPickEffort(level)}
                testID={`${testID}-effort-${level}`}
              />
            ))}
          </View>
        </BottomSheet>
      ) : null}
    </MealprintPage>
  );
}

/** One How-much-cooking option (canvas `.radio`), shared with N25. */
export function EffortRadio({
  level,
  selected,
  onPress,
  testID,
}: {
  level: EffortLevel;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      testID={testID}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={12}
        borderBottomWidth={1}
        borderColor="$border"
      >
        <View
          width={22}
          height={22}
          borderRadius={9999}
          borderWidth={2}
          borderColor={selected ? "$primary" : "$text4"}
          alignItems="center"
          justifyContent="center"
        >
          {selected ? (
            <View
              width={10}
              height={10}
              borderRadius={9999}
              backgroundColor="$primary"
            />
          ) : null}
        </View>
        <View flex={1} gap={2}>
          <Text fontFamily="$body" fontSize={15} fontWeight="500" color="$text">
            {EFFORT_LEVEL_LABELS[level]}
          </Text>
          <Text fontFamily="$body" fontSize={12} color="$text3">
            {EFFORT_LEVEL_BLURBS[level]}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}
