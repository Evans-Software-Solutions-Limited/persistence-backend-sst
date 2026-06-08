import { RefreshControl, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { Avatar, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { Section } from "@/ui/components/composite";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import { IconCalendar } from "@/ui/components/icons";
import type { ApiError } from "@/shared/errors";
import type { PersonalRecord } from "@/domain/models/record";
import type { VolumeStats } from "@/domain/models/progress";
import { StreakHeroPresenter } from "./StreakHeroPresenter";
import {
  MilestonesRowPresenter,
  type MilestoneTier,
} from "./MilestonesRowPresenter";
import { BodyTrendPresenter, type TrendData } from "./BodyTrendPresenter";
import { VolumeStatsPresenter } from "./VolumeStatsPresenter";
import { PRHistoryPresenter } from "./PRHistoryPresenter";

/**
 * <YouPresenter> — You/Progress lifetime view (06-progress-goals, STORY-003;
 * progress.jsx:16–58). StreakHero → MilestonesRow → BodyTrend → VolumeStats →
 * PRHistory. Pure presentational; cache-first (renders present data, blocking
 * loader/error only with no data at all).
 */

export type YouPresenterProps = {
  initials: string;
  workoutsLabel: string; // e.g. "THIS MONTH · 18 WORKOUTS"
  streak: {
    current: number;
    longest: number;
    freezeTokens: number;
    unit: string;
  } | null;
  milestones: MilestoneTier[];
  earnedCount: number;
  bodyTrend: { weight: TrendData & { unit: "kg" | "lb" }; bodyFat: TrendData };
  volumeStats: VolumeStats | null;
  prHistory: PersonalRecord[];

  isLoading: boolean;
  isRefreshing: boolean;
  error?: ApiError | null;
  busyToken?: boolean;

  onRefresh: () => void;
  onOpenDrawer: () => void;
  onOpenCalendar: () => void;
  onUseToken: () => void;
};

export function YouPresenter(props: YouPresenterProps) {
  const {
    initials,
    workoutsLabel,
    streak,
    milestones,
    earnedCount,
    bodyTrend,
    volumeStats,
    prHistory,
    isLoading,
    isRefreshing,
    error,
    busyToken,
    onRefresh,
    onOpenDrawer,
    onOpenCalendar,
    onUseToken,
  } = props;

  const hasAny =
    streak !== null || volumeStats !== null || prHistory.length > 0;

  if (isLoading && !hasAny) {
    return (
      <View flex={1} testID="you-loader">
        <PLogoDrawLoader />
      </View>
    );
  }
  if (error && !hasAny) {
    return (
      <View flex={1} testID="you-error-state">
        <ErrorState
          message="Couldn't load your progress."
          onRetry={onRefresh}
        />
      </View>
    );
  }

  return (
    <ScrollView
      testID="you-scroll"
      contentContainerStyle={{ paddingBottom: 140 }}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
      }
    >
      <HeaderBar
        large
        eyebrow={workoutsLabel}
        title="Progress"
        leading={<Avatar initials={initials} onPress={onOpenDrawer} />}
        trailing={
          <IconBtn
            icon={<IconCalendar size={18} />}
            tone="ghost"
            onPress={onOpenCalendar}
            accessibilityLabel="Open calendar"
          />
        }
      />

      <View paddingHorizontal={16} gap={16}>
        {streak && (
          <View testID="you-streak">
            <StreakHeroPresenter
              current={streak.current}
              longest={streak.longest}
              freezeTokens={streak.freezeTokens}
              unit={streak.unit}
              onUseToken={onUseToken}
              busy={busyToken}
            />
          </View>
        )}

        <Section
          eyebrow="MILESTONES"
          title="Badges"
          action={
            <Text fontSize={12} color="$text3">
              {earnedCount} of {milestones.length}
            </Text>
          }
          testID="you-milestones"
        >
          <MilestonesRowPresenter tiers={milestones} />
        </Section>

        <Section eyebrow="BODY" title="Trend" testID="you-body">
          <BodyTrendPresenter
            weight={bodyTrend.weight}
            bodyFat={bodyTrend.bodyFat}
          />
        </Section>

        {volumeStats && (
          <Section eyebrow="TRAINING" title="Volume" testID="you-volume">
            <VolumeStatsPresenter stats={volumeStats} />
          </Section>
        )}

        {prHistory.length > 0 && (
          <Section
            eyebrow="PERSONAL RECORDS"
            title="Top lifts"
            testID="you-prs"
          >
            <PRHistoryPresenter prs={prHistory} />
          </Section>
        )}
      </View>
    </ScrollView>
  );
}
