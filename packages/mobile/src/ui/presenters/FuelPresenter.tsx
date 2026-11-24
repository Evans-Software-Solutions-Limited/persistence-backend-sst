import { type ReactNode, type RefObject, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { NEUTRAL_HEX, toneHex } from "@/ui/components/foundation/tones";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import { DateCalendarModal } from "@/ui/components/DatePickerField";
import { IconEdit, IconTrash } from "@/ui/components/icons";
import { localDayISO, type VolumeUnit } from "@/shared/utils";
import type { ApiError } from "@/shared/errors";
import type { MealSlot } from "@/domain/models/nutrition";
import { MealLogPresenter, type MealSlotVM } from "./MealLogPresenter";
import { WaterTrackerPresenter } from "./WaterTrackerPresenter";
import type { MealprintPlanProgress } from "./mealprint/MealprintEntryCard";
import { ClearPlanConfirmDialog } from "./mealprint/ClearPlanConfirmDialog";
import {
  FuelLogHeaderPresenter,
  type FuelSection,
  type WeekDayVM,
} from "./fuel/FuelLogHeaderPresenter";
import {
  FuelLogSummaryPresenter,
  type MacroColumnVM,
} from "./fuel/FuelLogSummaryPresenter";
import {
  FuelQuickActionsPresenter,
  type FuelQuickActionsProps,
} from "./fuel/FuelQuickActionsPresenter";

/**
 * <FuelPresenter> — the Fuel Log screen, canvas N1 (PER-132): header with
 * Log · Plan · Meals and the week strip → compact rings with Eaten · Target ·
 * Left → the five quick buttons → the Mealprint plan row (when the day has
 * one) → Your meals → water. Pure presentational; <FuelContainer> wires the
 * cache-first day aggregate, Your meals, mutations, sheet opens and day state.
 *
 * Mealprint's entry card is replaced by Suggest (One meal) and the Plan tab
 * (Brad, 23 Nov: follow the canvas, keep the entry points). Water stays below
 * the meals so it keeps an entry point.
 *
 * Cache-first: renders whatever day aggregate is present immediately; a blocking
 * loader/error shows only when there's no cache at all.
 *
 * Day navigation (BRIEF-7 QA-19, PER-132): the week strip picks a day this
 * week; the calendar button opens the month-grid modal for earlier weeks.
 * Both are past+today only (Tier A).
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <FuelPresenter>
 *             specs/milestones/GO-LIVE-FINAL/BRIEF-7-device-qa-bugs.md § QA-19
 */

export type FuelPresenterProps = {
  /** "Fri 23 Oct" — the viewed day (container-computed, user-local). */
  dateLabel: string;
  /** The viewed day, `YYYY-MM-DD` — anchors the calendar modal. */
  selectedDate: string;
  hasData: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  error?: ApiError | null;
  onRefresh: () => void;

  // Header (canvas N1): Log · Plan · Meals and the week strip.
  section: FuelSection;
  onSection: (section: FuelSection) => void;
  week: readonly WeekDayVM[];
  onSelectDay: (dayIso: string) => void;
  calendarOpen: boolean;
  onOpenCalendar: () => void;
  onCloseCalendar: () => void;
  onSelectDate: (dayIso: string) => void;

  // Compact rings + Eaten · Target · Left.
  consumedKcal: number;
  targetKcal: number;
  consumedProteinG: number;
  consumedCarbsG: number;
  consumedFatG: number;
  macros: readonly MacroColumnVM[];
  noTarget: boolean;

  // Five quick buttons.
  quickActions: Omit<FuelQuickActionsProps, "testID">;

  /**
   * Present ⇒ the viewed day has an accepted Mealprint plan (spec-26 Phase 2):
   * its Edit/Clear row shows above the meals and its meals show as ghost rows.
   */
  mealprintPlanProgress: MealprintPlanProgress | null;
  onEditPlan: () => void;
  onClearPlan: () => void;
  clearingPlan?: boolean;

  // Meals (Your meals).
  slots: readonly MealSlotVM[];
  onAddToMeal: (mealKey: string) => void;
  onMealOptions: (mealKey: string) => void;
  onEditMeals: () => void;

  // Water
  waterCups: number;
  waterGoal: number;
  volumeUnit?: VolumeUnit;

  onOpenTargets: () => void;
  onSetWater: (cups: number) => void;
  onPressRow?: (id: string, slot: MealSlot) => void;
  onDeleteEntry?: (id: string, slot: MealSlot) => void;
  onLogGhost?: (planId: string, planMealId: string, slot: MealSlot) => void;
  scrollRef?: RefObject<ScrollView | null>;
  /**
   * PER-133: the Plan (N6–N10) or Meals (N11–N12) section's content, shown
   * under the header instead of the day's log when `section` isn't "log".
   */
  sectionContent?: ReactNode;
  /** Meals: the header's "New meal or recipe" button. */
  onNew?: () => void;
  testID?: string;
};

const ERROR_TONE = toneHex("error");

/**
 * <PlanActionsRow> — "Edit"/"Clear" for the day's active Mealprint plan
 * (spec-26 amendment 2026-08-fuel-plan-surfacing § B). Sits between the
 * Mealprint entry card and the meal log — "where the plan is shown on Fuel"
 * per the amendment — only rendered while there IS an active plan
 * (`mealprintPlanProgress !== null`, mirrored by <FuelPresenter>'s gate).
 *
 * Two independent, sibling `Pressable`s (not nested inside one outer
 * Pressable) — same reasoning as `MealprintOfferCard`'s two real CTAs: each
 * needs its own a11y label, and a shared outer Pressable would swallow one of
 * them on iOS.
 */
function PlanActionsRow({
  onEditPlan,
  onOpenClearConfirm,
  testID = "fuel-plan-actions",
}: {
  onEditPlan: () => void;
  onOpenClearConfirm: () => void;
  testID?: string;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      paddingHorizontal={2}
      testID={testID}
    >
      <Text
        fontFamily="$display"
        fontSize={10.5}
        fontWeight="600"
        letterSpacing={1.5}
        textTransform="uppercase"
        color="$gold"
      >
        Mealprint plan
      </Text>
      <View flexDirection="row" alignItems="center" gap={16}>
        <Pressable
          onPress={onEditPlan}
          testID={`${testID}-edit`}
          accessibilityRole="button"
          accessibilityLabel="Edit plan"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View flexDirection="row" alignItems="center" gap={4}>
            <IconEdit size={12} color={NEUTRAL_HEX.text3} />
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={11.5}
              color="$text3"
            >
              Edit
            </Text>
          </View>
        </Pressable>
        <Pressable
          onPress={onOpenClearConfirm}
          testID={`${testID}-clear`}
          accessibilityRole="button"
          accessibilityLabel="Clear plan"
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View flexDirection="row" alignItems="center" gap={4}>
            <IconTrash size={12} color={ERROR_TONE.base} />
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={11.5}
              color="$error"
            >
              Clear
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

export function FuelPresenter(props: FuelPresenterProps) {
  const {
    dateLabel,
    selectedDate,
    hasData,
    isLoading,
    isRefreshing,
    error,
    onRefresh,
    section,
    onSection,
    week,
    onSelectDay,
    calendarOpen,
    onOpenCalendar,
    onCloseCalendar,
    onSelectDate,
    consumedKcal,
    targetKcal,
    consumedProteinG,
    consumedCarbsG,
    consumedFatG,
    macros,
    noTarget,
    quickActions,
    mealprintPlanProgress,
    onEditPlan,
    onClearPlan,
    clearingPlan = false,
    slots,
    onAddToMeal,
    onMealOptions,
    onEditMeals,
    waterCups,
    waterGoal,
    volumeUnit = "l",
    onOpenTargets,
    onSetWater,
    onPressRow,
    onDeleteEntry,
    onLogGhost,
    scrollRef,
    sectionContent,
    onNew,
    testID = "fuel-screen",
  } = props;

  const insets = useSafeAreaInsets();

  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  // The plan can disappear out from under an open dialog (cleared elsewhere,
  // or this device's own clear just succeeded) — reset so a LATER plan
  // doesn't inherit a stale "confirm open" flag from a previous one.
  useEffect(() => {
    if (mealprintPlanProgress === null) setConfirmClearOpen(false);
  }, [mealprintPlanProgress]);

  const header = (
    <View paddingHorizontal={20}>
      <FuelLogHeaderPresenter
        section={section}
        onSection={onSection}
        dayLabel={dateLabel}
        week={week}
        onSelectDay={onSelectDay}
        onOpenCalendar={onOpenCalendar}
        onOpenTargets={onOpenTargets}
        onNew={onNew}
      />
      <DateCalendarModal
        visible={calendarOpen}
        selectedDate={selectedDate}
        maximumDate={localDayISO()}
        onSelectDate={onSelectDate}
        onClose={onCloseCalendar}
        label="Choose Fuel date"
        testID="fuel-calendar-modal"
      />
    </View>
  );

  if (section !== "log") {
    return (
      <View flex={1} paddingTop={insets.top} testID={testID}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={{ paddingBottom: 140 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor="#22D3EE"
            />
          }
        >
          {header}
          <View paddingHorizontal={20} testID={`${testID}-${section}`}>
            {sectionContent}
          </View>
        </ScrollView>
      </View>
    );
  }

  if (isLoading && !hasData) {
    return (
      <View flex={1} paddingTop={insets.top} testID={testID}>
        {header}
        <View flex={1} alignItems="center" justifyContent="center">
          <PLogoDrawLoader />
        </View>
      </View>
    );
  }

  if (error && !hasData) {
    return (
      <View flex={1} paddingTop={insets.top} testID={testID}>
        {header}
        <ErrorState
          message="Couldn't load your day. Pull to retry."
          onRetry={onRefresh}
        />
      </View>
    );
  }

  return (
    <View flex={1} paddingTop={insets.top} testID={testID}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#22D3EE"
          />
        }
      >
        {header}
        <View paddingHorizontal={20} gap={14}>
          <FuelLogSummaryPresenter
            eatenKcal={consumedKcal}
            targetKcal={targetKcal}
            eatenProteinG={consumedProteinG}
            eatenCarbsG={consumedCarbsG}
            eatenFatG={consumedFatG}
            macros={macros}
            noTarget={noTarget}
            onOpenTargets={onOpenTargets}
          />
          <FuelQuickActionsPresenter {...quickActions} />
          {/* Edit/Clear for the day's accepted Mealprint plan (amendment
              2026-08-fuel-plan-surfacing § B), directly above its planned
              rows. */}
          {mealprintPlanProgress !== null ? (
            <PlanActionsRow
              onEditPlan={onEditPlan}
              onOpenClearConfirm={() => setConfirmClearOpen(true)}
            />
          ) : null}
          <MealLogPresenter
            slots={slots}
            onAddToMeal={onAddToMeal}
            onMealOptions={onMealOptions}
            onEditMeals={onEditMeals}
            onPressRow={onPressRow}
            onDeleteEntry={onDeleteEntry}
            onLogGhost={onLogGhost}
          />
          <WaterTrackerPresenter
            cups={waterCups}
            goal={waterGoal}
            onSetCups={onSetWater}
            volumeUnit={volumeUnit}
          />
        </View>
      </ScrollView>
      {mealprintPlanProgress !== null && confirmClearOpen ? (
        <ClearPlanConfirmDialog
          isProcessing={clearingPlan}
          onCancel={() => setConfirmClearOpen(false)}
          onConfirm={onClearPlan}
        />
      ) : null}
    </View>
  );
}
