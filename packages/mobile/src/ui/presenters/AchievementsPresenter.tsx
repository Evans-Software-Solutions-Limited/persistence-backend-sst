import { RefreshControl, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { Card, Pill } from "@/ui/components/foundation";
import { Section } from "@/ui/components/composite";
import { EmptyState, ErrorState, PLogoDrawLoader } from "@/ui/components";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconMedal } from "@/ui/components/icons";
import type { ApiError } from "@/shared/errors";
import type { Achievement } from "@/domain/models/achievement";
import type { PersonalRecord } from "@/domain/models/record";
import type { WeightUnit } from "@/shared/utils";
import {
  MilestonesRowPresenter,
  type MilestoneTier,
} from "./MilestonesRowPresenter";
import { PRHistoryPresenter } from "./PRHistoryPresenter";

/**
 * <AchievementsPresenter> — the go-live "Achievements" screen (drawer
 * "Achievements" row, previously a coming-soon placeholder). Legacy has no
 * standalone achievements screen to port 1:1, so this composes EXISTING
 * signed-off V2 pieces top-to-bottom, priority-ordered for what an athlete
 * actually wants here: streak milestones → unlocked trophies → personal
 * records. Mirrors <YouPresenter>'s Milestones/PRHistory composition
 * (06-progress-goals) and legacy's
 * components/workouts/AchievementsContainer/AchievementsContainer.tsx card
 * shape (icon well + name + description) for the trophy list.
 *
 * Pure presentational — no HeaderBar of its own; the route
 * (app/(app)/achievements.tsx) opts into the native header for the title +
 * back affordance, matching the `coming-soon` screen convention.
 */

export type AchievementsPresenterProps = {
  milestones: MilestoneTier[];
  earnedCount: number;
  achievements: Achievement[];
  prHistory: PersonalRecord[];
  /** Display-unit preference for PR weight values. Defaults to "kg". */
  weightUnit?: WeightUnit;
  isLoading: boolean;
  isRefreshing: boolean;
  error?: ApiError | null;
  onRefresh: () => void;
};

function categoryLabel(category: Achievement["category"]): string {
  return category.replace(/_/g, " ");
}

export function AchievementsPresenter({
  milestones,
  earnedCount,
  achievements,
  prHistory,
  weightUnit = "kg",
  isLoading,
  isRefreshing,
  error,
  onRefresh,
}: AchievementsPresenterProps) {
  const hasAny =
    milestones.some((m) => m.earned) ||
    achievements.length > 0 ||
    prHistory.length > 0;

  if (isLoading && !hasAny) {
    return (
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        testID="achievements-loader"
      >
        <PLogoDrawLoader />
      </View>
    );
  }

  if (error && !hasAny) {
    return (
      <View flex={1} testID="achievements-error-state">
        <ErrorState
          message="Couldn't load your achievements."
          onRetry={onRefresh}
        />
      </View>
    );
  }

  return (
    <View flex={1} testID="achievements-screen">
      <ScrollView
        testID="achievements-scroll"
        contentContainerStyle={{ paddingBottom: 140 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        <View paddingHorizontal={16} paddingTop={16} gap={16}>
          {milestones.length > 0 && (
            <Section
              eyebrow="MILESTONES"
              title="Streak milestones"
              action={
                <Text fontSize={12} color="$text3">
                  {earnedCount} of {milestones.length}
                </Text>
              }
              testID="achievements-milestones"
            >
              <MilestonesRowPresenter tiers={milestones} />
            </Section>
          )}

          <Section
            eyebrow="ACHIEVEMENTS"
            title="Trophies"
            testID="achievements-trophies"
          >
            {achievements.length === 0 ? (
              <EmptyState
                title="No achievements yet"
                description="Keep training to unlock achievements."
                testID="achievements-empty"
              />
            ) : (
              <View gap={10}>
                {achievements.map((a) => (
                  <Card
                    key={a.id}
                    pad={14}
                    radius={14}
                    testID={`achievement-card-${a.id}`}
                  >
                    <View flexDirection="row" alignItems="flex-start" gap={12}>
                      <View
                        width={44}
                        height={44}
                        borderRadius={22}
                        backgroundColor="$goldDim"
                        alignItems="center"
                        justifyContent="center"
                      >
                        <IconMedal size={20} color={toneHex("gold").base} />
                      </View>
                      <View flex={1} gap={4}>
                        <View
                          flexDirection="row"
                          alignItems="center"
                          gap={8}
                          flexWrap="wrap"
                        >
                          <Text fontSize={14} fontWeight="600" color="$text">
                            {a.name}
                          </Text>
                          <Pill size="xs" tone="gold">
                            {categoryLabel(a.category)}
                          </Pill>
                        </View>
                        {a.description ? (
                          <Text fontSize={12} color="$text3">
                            {a.description}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </Card>
                ))}
              </View>
            )}
          </Section>

          <Section
            eyebrow="PERSONAL RECORDS"
            title="Personal records"
            testID="achievements-prs"
          >
            {prHistory.length === 0 ? (
              <EmptyState
                title="No personal records yet"
                description="Log a workout to set your first PR."
                testID="prs-empty"
              />
            ) : (
              <PRHistoryPresenter prs={prHistory} weightUnit={weightUnit} />
            )}
          </Section>
        </View>
      </ScrollView>
    </View>
  );
}
