import { RefreshControl, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { Avatar, Card } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { color } from "@/ui/theme/tokens";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import { IconSettings, IconSwap } from "@/ui/components/icons";
import type { ApiError } from "@/shared/errors";
import type { CoachOverview } from "@/domain/models/coachOverview";
import { BusinessStatsPresenter } from "./coach/BusinessStatsPresenter";
import { ClientOverviewDonutPresenter } from "./coach/ClientOverviewDonutPresenter";
import { YourTrainingPeekPresenter } from "./coach/YourTrainingPeekPresenter";
import { ProgramStatsPresenter } from "./coach/ProgramStatsPresenter";
import { RecentActivityFeedPresenter } from "./coach/RecentActivityFeedPresenter";

/**
 * <CoachYouPresenter> — the coach's own dashboard ("Your practice").
 * Ports the prototype's `CoachYouScreen` 1:1 (design-source/screens/coach.jsx:
 * 12-281): Header (COACH eyebrow + "Your practice" + COACH-badged avatar) →
 * ModeSwitchCard → BusinessStats (with the invite affordance) →
 * ClientOverview donut → YourTrainingPeek → ProgramStats → RecentActivity.
 *
 * Pure presentational; cache-first (renders whatever overview data is present,
 * blocking loader/error only when there's nothing at all). Trainer-purple
 * accent throughout the header + mode card; the stat tiles, donut, training
 * peek, programmes, and feed keep the prototype's per-section tones.
 */

export type CoachYouPresenterProps = {
  overview: CoachOverview | null;
  /** Header avatar initials (falls back to overview.trainer.initials). */
  initials: string;
  /** Coach name for the mode card, e.g. "Bradley Evans". */
  coachName: string;
  /** Mode-card sub line, e.g. "Coach since Feb 2024 · 8 active clients". */
  coachMeta: string;
  /** Current-month label for the business section, e.g. "March". */
  monthLabel: string;

  /** Own-training peek (athlete-side, reused). */
  streakCount: number;
  streakUnit?: string;
  sessionCaption: string | null;

  isLoading: boolean;
  isRefreshing: boolean;
  error?: ApiError | null;

  onRefresh: () => void;
  onOpenDrawer: () => void;
  onSwitchToAthlete: () => void;
  onOpenCoachSettings: () => void;
  onInvite: () => void;
  onStartSession?: () => void;
  onViewAllPrograms?: () => void;
};

export function CoachYouPresenter(props: CoachYouPresenterProps) {
  const {
    overview,
    initials,
    coachName,
    coachMeta,
    monthLabel,
    streakCount,
    streakUnit,
    sessionCaption,
    isLoading,
    isRefreshing,
    error,
    onRefresh,
    onOpenDrawer,
    onSwitchToAthlete,
    onOpenCoachSettings,
    onInvite,
    onStartSession,
    onViewAllPrograms,
  } = props;

  const insets = useSafeAreaInsets();

  if (isLoading && overview === null) {
    return (
      <View flex={1} testID="coach-you-loader">
        <PLogoDrawLoader />
      </View>
    );
  }
  if (error && overview === null) {
    return (
      <View flex={1} testID="coach-you-error-state">
        <ErrorState
          message="Couldn't load your practice."
          onRetry={onRefresh}
        />
      </View>
    );
  }

  const primaryHex = toneHex("primary").base;
  // Concrete hex for the icon props below (SVG consumers can't take a token).
  const text2Hex = color.$text2;

  return (
    <View flex={1} paddingTop={insets.top}>
      <ScrollView
        testID="coach-you-scroll"
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        {/* Header. */}
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          paddingHorizontal={20}
          paddingTop={8}
          paddingBottom={16}
        >
          <View>
            <Text
              fontFamily="$display"
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1.7}
              textTransform="uppercase"
              color="$accentTrainer"
              marginBottom={4}
            >
              Coach
            </Text>
            <Text
              fontFamily="$display"
              fontWeight="800"
              fontSize={32}
              letterSpacing={-1}
              color="$text"
              numberOfLines={1}
            >
              Your practice
            </Text>
          </View>
          <Avatar
            initials={initials}
            size={40}
            tone="trainer"
            badge="COACH"
            onPress={onOpenDrawer}
            testID="coach-you-avatar"
          />
        </View>

        <View paddingHorizontal={16} gap={16}>
          {/* Mode switch card. */}
          <Card pad={0} radius={16} accent="trainer">
            <View
              flexDirection="row"
              alignItems="center"
              gap={12}
              padding={14}
              paddingHorizontal={16}
            >
              <Avatar
                initials={initials}
                size={48}
                tone="trainer"
                badge="COACH"
              />
              <View flex={1}>
                <Text
                  fontFamily="$display"
                  fontWeight="700"
                  fontSize={18}
                  color="$text"
                >
                  {coachName}
                </Text>
                <Text
                  fontFamily="$body"
                  fontSize={12}
                  color="$text3"
                  marginTop={2}
                >
                  {coachMeta}
                </Text>
              </View>
            </View>
            <View flexDirection="row" borderTopWidth={1} borderColor="$border">
              <Pressable
                onPress={onSwitchToAthlete}
                accessibilityRole="button"
                accessibilityLabel="Switch to Athlete"
                testID="coach-switch-athlete"
                style={({ pressed }) => ({
                  flex: 1,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="center"
                  gap={8}
                  padding={14}
                  paddingHorizontal={12}
                  borderRightWidth={1}
                  borderColor="$border"
                >
                  <IconSwap size={14} color={primaryHex} />
                  <Text
                    fontFamily="$display"
                    fontWeight="600"
                    fontSize={13}
                    color="$text2"
                  >
                    Switch to Athlete
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={onOpenCoachSettings}
                accessibilityRole="button"
                accessibilityLabel="Coach settings"
                testID="coach-settings"
                style={({ pressed }) => ({
                  flex: 1,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="center"
                  gap={8}
                  padding={14}
                  paddingHorizontal={12}
                >
                  <IconSettings size={14} color={text2Hex} />
                  <Text
                    fontFamily="$display"
                    fontWeight="600"
                    fontSize={13}
                    color="$text2"
                  >
                    Coach settings
                  </Text>
                </View>
              </Pressable>
            </View>
          </Card>

          {overview ? (
            <>
              <BusinessStatsPresenter
                stats={overview.businessStats}
                monthLabel={monthLabel}
                onInvite={onInvite}
                testID="coach-business-stats"
              />
              <ClientOverviewDonutPresenter
                breakdown={overview.clientHealthBreakdown}
                testID="coach-client-overview"
              />
              <YourTrainingPeekPresenter
                streakCount={streakCount}
                streakUnit={streakUnit}
                sessionCaption={sessionCaption}
                onStartSession={onStartSession}
                testID="coach-training-peek"
              />
              <ProgramStatsPresenter
                programs={overview.programStats.programs}
                onViewAll={onViewAllPrograms}
                testID="coach-program-stats"
              />
              <RecentActivityFeedPresenter
                events={overview.recentActivity}
                testID="coach-recent-activity"
              />
            </>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}
