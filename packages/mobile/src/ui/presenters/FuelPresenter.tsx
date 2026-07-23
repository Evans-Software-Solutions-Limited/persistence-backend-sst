import { type RefObject, useEffect, useMemo, useState } from "react";
import { Modal, Pressable, RefreshControl, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HeaderBar, IconBtn } from "@/ui/components/foundation";
import { NEUTRAL_HEX, toneHex } from "@/ui/components/foundation/tones";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import {
  IconCalendar,
  IconChevronL,
  IconChevronR,
  IconTarget,
  IconX,
} from "@/ui/components/icons";
import { localDayISO } from "@/shared/utils";
import type { ApiError } from "@/shared/errors";
import type { MealSlot } from "@/domain/models/nutrition";
import { MacroHeroPresenter, type MacroLineVM } from "./MacroHeroPresenter";
import { QuickAddRowPresenter } from "./QuickAddRowPresenter";
import { MealLogPresenter, type MealSlotVM } from "./MealLogPresenter";
import { WaterTrackerPresenter } from "./WaterTrackerPresenter";

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

  // Meal log
  slots: readonly MealSlotVM[];

  // Water
  waterCups: number;
  waterGoal: number;

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
  onLog: () => void;
  /** Forwarded by the container for tab-press scroll-to-top. */
  scrollRef?: RefObject<ScrollView | null>;
  testID?: string;
};

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

/** First-of-month `YYYY-MM-01` containing `dayIso`. */
function firstOfMonthISO(dayIso: string): string {
  return `${dayIso.slice(0, 7)}-01`;
}

/** `monthIso` (`YYYY-MM-01`) stepped by `delta` whole months (UTC-anchored,
 * consistent with the other ISO-day helpers in shared/utils). */
function addMonthsISO(monthIso: string, delta: number): string {
  const [y, m] = monthIso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** "July 2026" for a `YYYY-MM-01` month anchor. */
function monthTitle(monthIso: string): string {
  const d = new Date(`${monthIso}T00:00:00.000Z`);
  return d.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Mon→Sun grid cells for `monthIso`'s month — `null` pads the leading/
 * trailing weeks so the grid is always a multiple of 7. Matches the
 * Monday-start convention `weekStartMondayISO` uses for the habit grid.
 */
function monthGrid(monthIso: string): (string | null)[] {
  const [y, m] = monthIso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const firstWeekday = first.getUTCDay(); // 0=Sun..6=Sat
  const leading = (firstWeekday + 6) % 7; // days before month start, Mon=0
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = new Array(leading).fill(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(
      `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

type FuelCalendarModalProps = {
  visible: boolean;
  selectedDate: string;
  onSelectDate: (dayIso: string) => void;
  onClose: () => void;
  testID?: string;
};

/**
 * <FuelCalendarModal> — the "bigger jump" month-grid picker behind the Fuel
 * header's calendar icon. No `@react-native-community/datetimepicker` (or
 * any calendar primitive) exists yet in this codebase — this is the
 * "lightweight inline month picker" fallback the brief calls for rather than
 * a new native dependency. Mirrors <SignOutConfirmDialog>'s centred-Modal +
 * backdrop-dismiss + inner-card-swallows-press shape.
 */
function FuelCalendarModal({
  visible,
  selectedDate,
  onSelectDate,
  onClose,
  testID = "fuel-calendar-modal",
}: FuelCalendarModalProps) {
  const todayIso = localDayISO();
  const [viewMonth, setViewMonth] = useState(() =>
    firstOfMonthISO(selectedDate),
  );

  // Re-anchor the shown month to the selected day on each open — otherwise a
  // prior session's month-paging would strand the next open on an unrelated
  // month.
  useEffect(() => {
    if (visible) setViewMonth(firstOfMonthISO(selectedDate));
  }, [visible, selectedDate]);

  const cells = useMemo(() => monthGrid(viewMonth), [viewMonth]);
  const canGoNextMonth = viewMonth < firstOfMonthISO(todayIso);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID={testID}
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Dismiss the date picker"
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.7)",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
        testID={`${testID}-backdrop`}
      >
        {/* Inner card swallows the press so a tap inside doesn't dismiss. */}
        <Pressable
          onPress={() => undefined}
          style={{ width: "100%", maxWidth: 340 }}
        >
          <View
            backgroundColor="$surface"
            borderColor="$border2"
            borderWidth={1}
            borderRadius={20}
            padding={20}
          >
            <View
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              marginBottom={16}
            >
              <IconBtn
                icon={<IconChevronL size={16} />}
                tone="ghost"
                size={32}
                onPress={() => setViewMonth((m) => addMonthsISO(m, -1))}
                testID={`${testID}-prev-month`}
                accessibilityLabel="Previous month"
              />
              <Text
                fontFamily="$display"
                fontWeight="700"
                fontSize={15}
                color="$text"
                testID={`${testID}-month-label`}
              >
                {monthTitle(viewMonth)}
              </Text>
              <IconBtn
                icon={<IconChevronR size={16} />}
                tone="ghost"
                size={32}
                disabled={!canGoNextMonth}
                onPress={() => setViewMonth((m) => addMonthsISO(m, 1))}
                testID={`${testID}-next-month`}
                accessibilityLabel="Next month"
              />
              <View position="absolute" top={-4} right={-4}>
                <IconBtn
                  icon={<IconX size={16} />}
                  tone="ghost"
                  size={28}
                  onPress={onClose}
                  testID={`${testID}-close`}
                  accessibilityLabel="Close"
                />
              </View>
            </View>

            <View flexDirection="row" marginBottom={6}>
              {WEEKDAY_LETTERS.map((letter, i) => (
                <View
                  key={`weekday-${i}`}
                  width={`${100 / 7}%`}
                  alignItems="center"
                >
                  <Text fontSize={11} fontWeight="600" color="$text3">
                    {letter}
                  </Text>
                </View>
              ))}
            </View>

            <View flexDirection="row" flexWrap="wrap">
              {cells.map((iso, i) => {
                if (iso === null) {
                  return (
                    <View
                      key={`blank-${i}`}
                      width={`${100 / 7}%`}
                      height={36}
                    />
                  );
                }
                const disabled = iso > todayIso;
                const selected = iso === selectedDate;
                const isToday = iso === todayIso;
                return (
                  <View
                    key={iso}
                    width={`${100 / 7}%`}
                    height={36}
                    alignItems="center"
                    justifyContent="center"
                  >
                    <Pressable
                      disabled={disabled}
                      onPress={() => onSelectDate(iso)}
                      testID={`${testID}-day-${iso}`}
                      accessibilityRole="button"
                      accessibilityLabel={iso}
                      accessibilityState={{ disabled, selected }}
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 15,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: selected
                          ? NEUTRAL_HEX.primary
                          : "transparent",
                        borderWidth: isToday && !selected ? 1 : 0,
                        borderColor: NEUTRAL_HEX.primary,
                        opacity: disabled ? 0.3 : 1,
                      }}
                    >
                      <Text
                        fontSize={13}
                        fontWeight={selected ? "700" : "500"}
                        color={selected ? toneHex("primary").ink : "$text"}
                      >
                        {Number(iso.slice(8, 10))}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
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
    slots,
    waterCups,
    waterGoal,
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
    onLog,
    scrollRef,
    testID = "fuel-screen",
  } = props;

  const insets = useSafeAreaInsets();

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
      <FuelCalendarModal
        visible={calendarOpen}
        selectedDate={selectedDate}
        onSelectDate={onSelectDate}
        onClose={onCloseCalendar}
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
          <MealLogPresenter
            slots={slots}
            onAddToSlot={onAddToSlot}
            onPressRow={onPressRow}
            onDeleteEntry={onDeleteEntry}
          />
          <WaterTrackerPresenter
            cups={waterCups}
            goal={waterGoal}
            onSetCups={onSetWater}
          />
        </View>
      </ScrollView>
    </View>
  );
}
