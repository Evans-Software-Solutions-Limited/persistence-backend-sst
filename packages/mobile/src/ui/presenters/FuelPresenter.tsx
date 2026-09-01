import { type RefObject, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HeaderBar, IconBtn } from "@/ui/components/foundation";
import { NEUTRAL_HEX, toneHex } from "@/ui/components/foundation/tones";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import { DateCalendarModal } from "@/ui/components/DatePickerField";
import {
  IconCalendar,
  IconChevronL,
  IconChevronR,
  IconEdit,
  IconTarget,
  IconTrash,
} from "@/ui/components/icons";
import { localDayISO, type VolumeUnit } from "@/shared/utils";
import type { ApiError } from "@/shared/errors";
import type { MealSlot } from "@/domain/models/nutrition";
import { MacroHeroPresenter, type MacroLineVM } from "./MacroHeroPresenter";
import { QuickAddRowPresenter } from "./QuickAddRowPresenter";
import { MealLogPresenter, type MealSlotVM } from "./MealLogPresenter";
import { WaterTrackerPresenter } from "./WaterTrackerPresenter";
import {
  MealprintEntryCard,
  type MealprintEntryState,
  type MealprintPlanProgress,
} from "./mealprint/MealprintEntryCard";
import { ClearPlanConfirmDialog } from "./mealprint/ClearPlanConfirmDialog";

/**
 * <FuelPresenter> — the Fuel (nutrition) screen (nutrition.jsx). Composes the
 * day-nav header → macro hero → quick-add row → meal log → water tracker,
 * top-to-bottom, under a large HeaderBar. Pure presentational; <FuelContainer>
 * wires the cache-first day aggregate + mutations + sheet opens + day state.
 *
 * Cache-first: renders whatever day aggregate is present immediately; a blocking
 * loader/error shows only when there's no cache at all.
 *
 * Day navigation (BRIEF-7 QA-19): prev/next chevrons step one day; the
 * calendar icon opens a lightweight month-grid modal for a bigger jump. Both
 * are past+today only — the forward chevron disables on today and the
 * modal's day cells / month-forward chevron disable past today, matching the
 * owner's locked Tier-A scope (targets aren't per-day, so a historical day
 * still shows today's targets — that's just `noTarget`/`targetKcal` computed
 * upstream, nothing this presenter needs to special-case).
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <FuelPresenter>
 *             specs/milestones/GO-LIVE-FINAL/BRIEF-7-device-qa-bugs.md § QA-19
 */

export type FuelPresenterProps = {
  /** "Today" or "MONDAY · MAR 25" (container-computed, user-local). */
  dateLabel: string;
  /** The viewed day, `YYYY-MM-DD` — anchors the calendar modal's initial
   * month + highlighted cell. */
  selectedDate: string;
  /** False when `selectedDate` is today — disables the forward chevron. */
  canGoNext: boolean;
  hasData: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  error?: ApiError | null;
  onRefresh: () => void;

  // Day nav
  onPrevDay: () => void;
  onNextDay: () => void;
  calendarOpen: boolean;
  onCloseCalendar: () => void;
  onSelectDate: (dayIso: string) => void;

  // Hero
  remainingKcal: number;
  consumedKcal: number;
  targetKcal: number;
  ringPct: number;
  macros: readonly MacroLineVM[];
  celebrate: boolean;
  noTarget: boolean;

  // Quick add
  aiLocked: boolean;
  /** True when offline — Snap is disabled independently of the AI entitlement. */
  snapOffline?: boolean;

  // Mealprint (spec-26 T-0.6 entry point). Four states — see
  // <MealprintEntryCard> for why `pending` and `stalled` are not synonyms for
  // `locked`. The container resolves them via `useMealprintEntry`.
  mealprintState: MealprintEntryState;
  mealprintNeedsSetup: boolean;
  /** Present ⇒ the viewed day has an active plan (spec-26 Phase 2, AC 5.1). */
  mealprintPlanProgress: MealprintPlanProgress | null;
  onMealprint: () => void;
  onMealprintUpgrade: () => void;
  onMealprintRetry: () => void;
  /** "Plan my day" — the entry card's second CTA. */
  onMealprintPlan: () => void;
  /**
   * Fuel-page-level "Preferences" entry (amendment 2026-08 § C) — the
   * two-CTA offer card's header link. See `MealprintEntryCard`'s docstring.
   */
  onMealprintEditPreferences: () => void;
  /**
   * "Edit plan" (amendment 2026-08-fuel-plan-surfacing § B) — pushes the
   * Today/plan-config view where per-meal swap ("replace-meal") lives.
   * Rendered in the plan actions row, only shown when there's an active plan
   * (`mealprintPlanProgress !== null`).
   */
  onEditPlan: () => void;
  /**
   * "Clear plan" (amendment § B) — the container's DELETE mutation. Called
   * only after the in-presenter confirm dialog is accepted; logged entries
   * are never touched (`ON DELETE SET NULL` server-side).
   */
  onClearPlan: () => void;
  /** True while the clear-plan DELETE is in flight — disables the dialog's CTAs. */
  clearingPlan?: boolean;

  // Meal log
  slots: readonly MealSlotVM[];

  // Water
  waterCups: number;
  waterGoal: number;
  /** Preferred display unit for the water tracker (device-QA #5/#7) — "l"
   *  (default) shows litres, "cups" shows the stored count directly. */
  volumeUnit?: VolumeUnit;

  // Handlers
  onOpenTargets: () => void;
  onOpenCalendar: () => void;
  onScan: () => void;
  onSnap: () => void;
  onSearch: () => void;
  onRecipes: () => void;
  onAddToSlot: (slot: MealSlot) => void;
  onSetWater: (cups: number) => void;
  onPressRow?: (id: string, slot: MealSlot) => void;
  /** Swipe a logged entry left → tap Delete to remove it (handled in the container). */
  onDeleteEntry?: (id: string, slot: MealSlot) => void;
  /** "Log it" on a ghost row (spec-26 AC 5.2). */
  onLogGhost?: (planId: string, planMealId: string, slot: MealSlot) => void;
  onLog: () => void;
  /** Forwarded by the container for tab-press scroll-to-top. */
  scrollRef?: RefObject<ScrollView | null>;
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
    canGoNext,
    hasData,
    isLoading,
    isRefreshing,
    error,
    onRefresh,
    onPrevDay,
    onNextDay,
    calendarOpen,
    onCloseCalendar,
    onSelectDate,
    remainingKcal,
    consumedKcal,
    targetKcal,
    ringPct,
    macros,
    celebrate,
    noTarget,
    aiLocked,
    snapOffline = false,
    mealprintState,
    mealprintNeedsSetup,
    mealprintPlanProgress,
    onMealprint,
    onMealprintUpgrade,
    onMealprintRetry,
    onMealprintPlan,
    onMealprintEditPreferences,
    onEditPlan,
    onClearPlan,
    clearingPlan = false,
    slots,
    waterCups,
    waterGoal,
    volumeUnit = "l",
    onOpenTargets,
    onOpenCalendar,
    onScan,
    onSnap,
    onSearch,
    onRecipes,
    onAddToSlot,
    onSetWater,
    onPressRow,
    onDeleteEntry,
    onLogGhost,
    onLog,
    scrollRef,
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

  // Protein still owing today, for the Mealprint card's concrete pitch. Derived
  // from the hero's own view-model rather than added to the container's props, so
  // the two can never disagree about what "left" means.
  const proteinLine = macros.find((m) => m.label === "Protein");
  const remainingProteinG =
    proteinLine === undefined ? null : proteinLine.target - proteinLine.value;

  // ⚠ Fuel is DAY-NAVIGABLE, and the card's concrete line says "today".
  //
  // `remainingKcal`/`macros` describe the VIEWED day, so on a past day the card
  // would read "You have 1,160 kcal left today" over last Tuesday's numbers —
  // false, and an invitation to act: the suggest sheet generates and logs against
  // the active date, so "fill today's gap" would write food to a past day. The
  // generic subtitle makes no day claim, so it is the safe fallback.
  //
  // ⚠ Compared DIRECTLY, not derived from `canGoNext`. An earlier version used
  // `!canGoNext`, which is equivalent today but only by coincidence: that prop's
  // contract is "disables the forward chevron". spec-26 is meal PLANNING, so the
  // day forward-nav is likely to open up — at which point `canGoNext` goes true on
  // today (silently hiding the line on the one day it is correct) and false on a
  // future date (putting the false claim straight back).
  const viewingToday = selectedDate === localDayISO();

  const header = (
    <>
      <HeaderBar
        large
        title="Fuel"
        trailing={
          <IconBtn
            icon={<IconTarget size={18} />}
            tone="primary"
            onPress={onOpenTargets}
            testID="fuel-open-targets"
            accessibilityLabel="Edit nutrition targets"
          />
        }
      />
      {/* Compact day-nav (BRIEF-7 QA-19): ‹ steps back a day (unbounded —
          past days always readable); the date/calendar area opens the
          month-grid modal for a bigger jump; › steps forward, disabled on
          today (Tier A is past+today only). */}
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap={2}
        marginTop={-8}
        marginBottom={12}
        testID="fuel-day-nav"
      >
        <IconBtn
          icon={<IconChevronL size={16} />}
          tone="ghost"
          size={30}
          onPress={onPrevDay}
          testID="fuel-prev-day"
          accessibilityLabel="Previous day"
        />
        <Pressable
          onPress={onOpenCalendar}
          testID="fuel-open-calendar"
          accessibilityRole="button"
          accessibilityLabel="Pick a day"
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingHorizontal: 10,
            paddingVertical: 4,
          }}
        >
          <Text
            fontFamily="$display"
            fontSize={12.5}
            fontWeight="600"
            letterSpacing={0.4}
            color="$text2"
          >
            {dateLabel}
          </Text>
          <IconCalendar size={14} color={NEUTRAL_HEX.text3} />
        </Pressable>
        <IconBtn
          icon={<IconChevronR size={16} />}
          tone="ghost"
          size={30}
          disabled={!canGoNext}
          onPress={onNextDay}
          testID="fuel-next-day"
          accessibilityLabel="Next day"
        />
      </View>
      <DateCalendarModal
        visible={calendarOpen}
        selectedDate={selectedDate}
        maximumDate={localDayISO()}
        onSelectDate={onSelectDate}
        onClose={onCloseCalendar}
        label="Choose Fuel date"
        testID="fuel-calendar-modal"
      />
    </>
  );

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
        <View paddingHorizontal={16} gap={16}>
          <MacroHeroPresenter
            remainingKcal={remainingKcal}
            consumedKcal={consumedKcal}
            targetKcal={targetKcal}
            ringPct={ringPct}
            macros={macros}
            celebrate={celebrate}
            noTarget={noTarget}
            onOpenTargets={onOpenTargets}
            onLog={onLog}
          />
          <QuickAddRowPresenter
            aiLocked={aiLocked}
            snapOffline={snapOffline}
            onScan={onScan}
            onSnap={onSnap}
            onSearch={onSearch}
            onRecipes={onRecipes}
          />
          {/* Mealprint sits directly below QuickAddRow (design § 4 item 1):
              QuickAdd answers "log what I ate", Mealprint answers "what should I
              eat" — adjacent questions, and this is the point in the scroll where
              the user has just seen what they have left. */}
          <MealprintEntryCard
            state={mealprintState}
            needsSetup={mealprintNeedsSetup}
            // The card leads on the actual gap rather than a generic promise
            // (design § the AnyMeal entry card) — but ONLY for today, and only
            // with a target set. See `viewingToday` above; and note the card
            // itself also requires `remainingKcal > 0`, because `computeRemaining`
            // goes NEGATIVE when the user is over target (it is not 0-floored
            // except on the no-target branch).
            remainingKcal={noTarget || !viewingToday ? null : remainingKcal}
            remainingProteinG={
              noTarget || !viewingToday ? null : remainingProteinG
            }
            // ⚠ Separate from nulling the budget: the FALLBACK subtitles also say
            // "today", and without this the card contradicted the sheet it opens.
            isToday={viewingToday}
            planProgress={mealprintPlanProgress}
            onPress={onMealprint}
            onPlanMyDay={onMealprintPlan}
            onEditPreferences={onMealprintEditPreferences}
            onUpgrade={onMealprintUpgrade}
            onRetry={onMealprintRetry}
          />
          {/* Edit/Clear for today's active plan (amendment
              2026-08-fuel-plan-surfacing § B) — "where the plan is shown on
              Fuel", directly above its planned rows. Gated the same way the
              ACTIVE entry-card variant is: an active plan is what
              `mealprintPlanProgress` presence means. */}
          {mealprintPlanProgress !== null ? (
            <PlanActionsRow
              onEditPlan={onEditPlan}
              onOpenClearConfirm={() => setConfirmClearOpen(true)}
            />
          ) : null}
          <MealLogPresenter
            slots={slots}
            onAddToSlot={onAddToSlot}
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
