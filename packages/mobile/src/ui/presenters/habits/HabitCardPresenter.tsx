import { Text, View } from "@tamagui/core";
import type { ComponentType } from "react";
import { Pressable } from "react-native";

import { Card, Pill } from "@/ui/components/foundation";
import { CoachAttribution } from "@/ui/components/composite";
import { toneHex, toneTokens } from "@/ui/components/foundation/tones";
import {
  IconChevronR,
  IconDroplet,
  IconDumbbell,
  IconFlame,
  IconMoon,
  IconSteps,
} from "@/ui/components/icons";
import {
  formatTarget,
  HABIT_CATEGORY_META,
  type HabitCategory,
  type HabitConfig,
} from "@/domain/models/habit-config";
import { Row, Stepper, Switch, WeekFreq } from "./HabitControls";

/**
 * <HabitCardPresenter> — one habit's card on the setup screen (18-habit-setup,
 * Phase 18.7 — T-18.7.7). Pure port of the prototype `HabitCard`
 * (~/Downloads/habit_design/habit-setup.jsx): header (icon tile + name +
 * NUTRITION pill for Calories + sub + Switch), then, when enabled, inline
 * control Rows — target Stepper (or a gold deep-link button for the read-only
 * Calories goal), a WeekFreq days/week row (daily habits), and a leniency
 * Stepper (Calories). Disabled collapses to the header.
 *
 * States beyond the prototype (all spec-required, design.md § 9):
 *  - coach-assigned → a <CoachAttribution> badge with the coach's name (Phase
 *    11); while the relationship is active the habit is also locked (controls
 *    disabled) for the ATHLETE viewing their own habits. Attribution persists
 *    as history after the relationship ends;
 *  - pending → a "Starts Monday" tag on the changed control's row.
 *
 * Lock is coach-aware (QA-6 fix): `config.locked` means "coach-assigned +
 * relationship active" from the backend's point of view, without regard to
 * WHO is looking. The assigning coach editing their own client must still be
 * able to change the habit they just assigned (the write-side already allows
 * this — only a DIFFERENT coach's habit 403s) — only the athlete's self-view
 * should render it locked. Hence `locked = config.locked && !isCoach`.
 */

const ICON_FOR: Record<
  HabitCategory,
  ComponentType<{ size?: number; color?: string }>
> = {
  water: IconDroplet,
  gym: IconDumbbell,
  steps: IconSteps,
  sleep: IconMoon,
  calories: IconFlame,
};

export type HabitCardProps = {
  config: HabitConfig;
  /** Toggle the habit on/off. */
  onToggle: (next: boolean) => void;
  /** Commit a new target value (already clamped to bounds). */
  onTargetChange: (next: number) => void;
  /** Commit a new days/week (daily habits). */
  onFreqChange: (next: number) => void;
  /** Commit a new leniency % (Calories). */
  onLeniencyChange: (next: number) => void;
  /** Calories deep-link → Fuel Targets editor. */
  onAdjustNutrition: () => void;
  /** The viewer is the assigning coach editing a client's habits — a
   *  coach-locked habit (`config.locked`) is never locked out for them, only
   *  for the athlete's own self-view. */
  isCoach?: boolean;
  testID?: string;
};

/** Round to 2dp to avoid FP drift when stepping fractional targets (0.1 l). */
function clampStep(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number(value.toFixed(2))));
}

export function HabitCardPresenter({
  config,
  onToggle,
  onTargetChange,
  onFreqChange,
  onLeniencyChange,
  onAdjustNutrition,
  isCoach = false,
  testID,
}: HabitCardProps) {
  const meta = HABIT_CATEGORY_META[config.category];
  const tone = meta.tone;
  const t = toneTokens(tone);
  const on = config.enabled;
  // Coach-aware lock (QA-6): the assigning coach can always edit; only the
  // athlete's self-view is locked out of a coach-assigned habit.
  const locked = config.locked && !isCoach;
  const Glyph = ICON_FOR[config.category];

  // Display value: while a pending edit is queued, the UI shows the NEW value
  // with a "Starts Monday" tag (the live value still scores this week).
  const pendingTarget = config.pending?.targetValue;
  const displayTarget = pendingTarget ?? config.targetValue;
  const pendingDays = config.pending?.daysPerWeek;
  const displayDays =
    (pendingDays === undefined ? config.daysPerWeek : pendingDays) ??
    meta.freq?.default ??
    0;
  const pendingTol = config.pending?.tolerancePct;
  const displayTol =
    (pendingTol === undefined ? config.tolerancePct : pendingTol) ??
    meta.leniency?.default ??
    0;

  const startsMonday = (field: "target" | "days" | "tol"): boolean => {
    if (!config.pending) return false;
    if (field === "target") return pendingTarget !== undefined;
    if (field === "days") return pendingDays !== undefined;
    return pendingTol !== undefined;
  };

  const stepTarget = (dir: number) =>
    onTargetChange(
      clampStep(
        displayTarget + dir * meta.target.step,
        meta.target.min,
        meta.target.max,
      ),
    );

  return (
    <Card
      pad={0}
      radius={18}
      accent={on ? tone : undefined}
      testID={testID}
      style={{ overflow: "hidden", opacity: on ? 1 : 0.9 }}
    >
      {/* Header */}
      <View flexDirection="row" alignItems="center" gap={12} padding={15}>
        <View
          width={42}
          height={42}
          borderRadius={12}
          alignItems="center"
          justifyContent="center"
          borderWidth={1}
          backgroundColor={on ? t.dim : "$surface3"}
          borderColor={on ? t.dim : "$border"}
          style={{ flexShrink: 0 }}
        >
          <Glyph size={21} color={on ? toneHex(tone).base : "#5A5A66"} />
        </View>
        <View flex={1} style={{ minWidth: 0 }}>
          <View flexDirection="row" alignItems="center" gap={7}>
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={18}
              color={on ? "$text" : "$text2"}
            >
              {meta.name}
            </Text>
            {meta.target.readOnly ? (
              <Pill tone="gold" size="xs">
                NUTRITION
              </Pill>
            ) : null}
          </View>
          <Text fontFamily="$body" fontSize={11.5} color="$text3" marginTop={1}>
            {meta.sub}
          </Text>
          {config.assignedByCoach ? (
            <View
              marginTop={2}
              testID={testID ? `${testID}-attribution` : undefined}
            >
              {config.assignedByName ? (
                <CoachAttribution name={config.assignedByName} />
              ) : (
                <Text fontFamily="$body" fontSize={11} color="$accentTrainer">
                  Set by your coach
                </Text>
              )}
            </View>
          ) : null}
        </View>
        <Switch
          on={on}
          onChange={onToggle}
          tone={tone}
          disabled={locked}
          testID={testID ? `${testID}-switch` : undefined}
          accessibilityLabel={`${meta.name} habit`}
        />
      </View>

      {/* Inline controls — only when enabled */}
      {on ? (
        <View paddingHorizontal={15} paddingBottom={6}>
          {/* Target */}
          {meta.target.readOnly ? (
            <Row label={meta.target.label} first>
              <View alignItems="flex-end" gap={2}>
                <Pressable
                  testID={testID ? `${testID}-nutrition-link` : undefined}
                  accessibilityRole="button"
                  accessibilityLabel="Adjust in Nutrition"
                  onPress={onAdjustNutrition}
                >
                  <View
                    flexDirection="row"
                    alignItems="center"
                    gap={6}
                    paddingVertical={7}
                    paddingHorizontal={11}
                    borderRadius={10}
                    backgroundColor="$goldDim"
                    borderWidth={1}
                    borderColor="$goldDim"
                  >
                    <Text
                      fontFamily="$mono"
                      fontWeight="600"
                      fontSize={14}
                      color="$gold"
                    >
                      {formatTarget(config.category, displayTarget)}
                    </Text>
                    <Text fontFamily="$mono" fontSize={11} color="$gold">
                      kcal
                    </Text>
                    <IconChevronR
                      size={13}
                      strokeWidth={2.5}
                      color={toneHex("gold").base}
                    />
                  </View>
                </Pressable>
                {startsMonday("target") ? (
                  <StartsMonday testID={testID} />
                ) : null}
              </View>
            </Row>
          ) : (
            <Row label={meta.target.label} first>
              <View alignItems="flex-end" gap={2}>
                <Stepper
                  value={displayTarget}
                  unit={meta.unit}
                  format={(v) => formatTarget(config.category, v)}
                  tone={tone}
                  onDec={() => stepTarget(-1)}
                  onInc={() => stepTarget(1)}
                  atMin={locked || displayTarget <= meta.target.min}
                  atMax={locked || displayTarget >= meta.target.max}
                  testID={testID ? `${testID}-target` : undefined}
                />
                {startsMonday("target") ? (
                  <StartsMonday testID={testID} />
                ) : null}
              </View>
            </Row>
          )}

          {/* Days / week */}
          {meta.freq ? (
            <Row label={meta.freq.label}>
              <View alignItems="flex-end" gap={2}>
                <WeekFreq
                  value={displayDays}
                  tone={tone}
                  onChange={onFreqChange}
                  disabled={locked}
                  testID={testID ? `${testID}-freq` : undefined}
                />
                {startsMonday("days") ? <StartsMonday testID={testID} /> : null}
              </View>
            </Row>
          ) : null}

          {/* Leniency (Calories) */}
          {meta.leniency ? (
            <Row label={meta.leniency.label}>
              <View alignItems="flex-end" gap={2}>
                <Stepper
                  value={displayTol}
                  unit="%"
                  format={(v) => `±${v}`}
                  tone={tone}
                  onDec={() =>
                    onLeniencyChange(
                      Math.max(
                        meta.leniency!.min,
                        displayTol - meta.leniency!.step,
                      ),
                    )
                  }
                  onInc={() =>
                    onLeniencyChange(
                      Math.min(
                        meta.leniency!.max,
                        displayTol + meta.leniency!.step,
                      ),
                    )
                  }
                  atMin={locked || displayTol <= meta.leniency.min}
                  atMax={locked || displayTol >= meta.leniency.max}
                  testID={testID ? `${testID}-leniency` : undefined}
                />
                {startsMonday("tol") ? <StartsMonday testID={testID} /> : null}
              </View>
            </Row>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

/** The "Starts Monday" tag shown next to a control with a queued edit. */
function StartsMonday({ testID }: { testID?: string }) {
  return (
    <Text
      fontFamily="$mono"
      fontSize={10}
      color="$text4"
      testID={testID ? `${testID}-starts-monday` : undefined}
    >
      Starts Monday
    </Text>
  );
}
