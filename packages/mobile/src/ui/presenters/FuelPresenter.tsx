import { type RefObject } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { View } from "@tamagui/core";
import { HeaderBar, IconBtn } from "@/ui/components/foundation";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import { IconCalendar, IconTarget } from "@/ui/components/icons";
import type { ApiError } from "@/shared/errors";
import type { MealSlot } from "@/domain/models/nutrition";
import { MacroHeroPresenter, type MacroLineVM } from "./MacroHeroPresenter";
import { QuickAddRowPresenter } from "./QuickAddRowPresenter";
import { MealLogPresenter, type MealSlotVM } from "./MealLogPresenter";
import { WaterTrackerPresenter } from "./WaterTrackerPresenter";

/**
 * <FuelPresenter> — the Fuel (nutrition) screen (nutrition.jsx). Composes the
 * macro hero → quick-add row → meal log → water tracker, top-to-bottom, under a
 * large HeaderBar. Pure presentational; <FuelContainer> wires the cache-first
 * day aggregate + mutations + sheet opens.
 *
 * Cache-first: renders whatever day aggregate is present immediately; a blocking
 * loader/error shows only when there's no cache at all.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <FuelPresenter>
 */

export type FuelPresenterProps = {
  /** Eyebrow, e.g. "MONDAY · MAR 25" (container-computed, user-local). */
  dateLabel: string;
  hasData: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  error?: ApiError | null;
  onRefresh: () => void;

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
  onLog: () => void;
  /** Forwarded by the container for tab-press scroll-to-top. */
  scrollRef?: RefObject<ScrollView | null>;
  testID?: string;
};

export function FuelPresenter(props: FuelPresenterProps) {
  const {
    dateLabel,
    hasData,
    isLoading,
    isRefreshing,
    error,
    onRefresh,
    remainingKcal,
    consumedKcal,
    targetKcal,
    ringPct,
    macros,
    celebrate,
    noTarget,
    aiLocked,
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
    onLog,
    scrollRef,
    testID = "fuel-screen",
  } = props;

  const header = (
    <HeaderBar
      large
      title="Fuel"
      eyebrow={dateLabel}
      trailing={
        <>
          <IconBtn
            icon={<IconTarget size={18} />}
            tone="primary"
            onPress={onOpenTargets}
            testID="fuel-open-targets"
            accessibilityLabel="Edit nutrition targets"
          />
          <IconBtn
            icon={<IconCalendar size={18} />}
            tone="ghost"
            onPress={onOpenCalendar}
            testID="fuel-open-calendar"
            accessibilityLabel="Pick a day"
          />
        </>
      }
    />
  );

  if (isLoading && !hasData) {
    return (
      <View flex={1} testID={testID}>
        {header}
        <View flex={1} alignItems="center" justifyContent="center">
          <PLogoDrawLoader />
        </View>
      </View>
    );
  }

  if (error && !hasData) {
    return (
      <View flex={1} testID={testID}>
        {header}
        <ErrorState
          message="Couldn't load your day. Pull to retry."
          onRetry={onRefresh}
        />
      </View>
    );
  }

  return (
    <View flex={1} testID={testID}>
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
            onScan={onScan}
            onSnap={onSnap}
            onSearch={onSearch}
            onRecipes={onRecipes}
          />
          <MealLogPresenter
            slots={slots}
            onAddToSlot={onAddToSlot}
            onPressRow={onPressRow}
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
