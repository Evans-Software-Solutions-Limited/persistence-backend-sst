import { Text, View } from "@tamagui/core";
import React from "react";
import { RefreshControl, ScrollView } from "react-native";

import type { Workout } from "@/domain/models/workout";
import type { WorkoutSplit } from "@/domain/services/workoutSplit";
import type { ApiError } from "@/shared/errors";
import { EmptyState } from "@/ui/components/EmptyState";
import { ErrorState } from "@/ui/components/ErrorState";
import { Btn } from "@/ui/components/foundation/Btn";
import { Card } from "@/ui/components/foundation/Card";
import { NEUTRAL_HEX } from "@/ui/components/foundation/tones";
import { IconPlus } from "@/ui/components/icons";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { Section } from "@/ui/components/composite/Section";
import { WorkoutLimitIndicator } from "@/ui/components/workouts/WorkoutLimitIndicator";
import { WorkoutRow } from "@/ui/components/workouts/WorkoutRow";

/**
 * Pure presenter for the Train > Workouts segment — the headerless body
 * under <TrainHubContainer> (the hub owns the eyebrow/title/search + the
 * Segmented switcher).
 *
 * Layout source: ~/Downloads/handoff/design-source/prototype-hubs.jsx:44–92
 * (`TrainWorkoutsContent`):
 *  - full-width "Create Workout" CTA,
 *  - "MY WORKOUTS · N SAVED" eyebrow section (mine + assigned; Dumbbell +
 *    Play rows),
 *  - "TEMPLATES · N" eyebrow section (public defaults; Book + chevron rows).
 *
 * Edit/Delete are surfaced via the owner long-press context menu (AC 1.6),
 * handled by the container through `onLongPress`.
 */

export interface WorkoutsListPresenterProps {
  isInitialLoading: boolean;
  error: ApiError | null;
  isRefreshing: boolean;
  /** mine + assigned, rendered under "MY WORKOUTS". */
  saved: Workout[];
  /** public defaults, rendered under "TEMPLATES". */
  templates: Workout[];
  /** Derived split per workout id (colours the tile + meta badge). */
  splits: ReadonlyMap<string, WorkoutSplit>;
  userWorkoutLimit: number | undefined;
  isAtLimit: boolean;
  currentUserId?: string;
  onCreate: () => void;
  onUpgrade: () => void;
  onOpen: (workoutId: string) => void;
  onStart: (workoutId: string) => void;
  /** Owner-only long-press → Edit/Delete context menu. */
  onLongPress: (workout: Workout) => void;
  onRetry: () => void;
  onRefresh: () => void;
}

export function WorkoutsListPresenter({
  isInitialLoading,
  error,
  isRefreshing,
  saved,
  templates,
  splits,
  userWorkoutLimit,
  isAtLimit,
  currentUserId,
  onCreate,
  onUpgrade,
  onOpen,
  onStart,
  onLongPress,
  onRetry,
  onRefresh,
}: WorkoutsListPresenterProps) {
  // Blocking error ONLY when the cache is empty + refresh failed. A cached
  // user offline must always see their list (matches V2 behaviour).
  const cachedHasAnyWorkout = saved.length > 0 || templates.length > 0;
  if (error && !cachedHasAnyWorkout && !isInitialLoading) {
    return (
      <ErrorState
        title="Failed to load workouts"
        message={error.message}
        onRetry={onRetry}
      />
    );
  }

  if (isInitialLoading) {
    return (
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        backgroundColor="$bg"
      >
        <PLogoDrawLoader />
        <Text fontFamily="$body" color="$text2" marginTop={16}>
          Loading workouts...
        </Text>
      </View>
    );
  }

  return (
    <View flex={1} backgroundColor="$bg">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: 140,
          gap: 14,
        }}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={NEUTRAL_HEX.text3}
          />
        }
      >
        <Btn
          full
          variant="filled"
          tone="primary"
          size="lg"
          icon={<IconPlus size={16} />}
          onPress={onCreate}
          testID="create-workout-cta"
        >
          Create Workout
        </Btn>

        {isAtLimit && (
          <WorkoutLimitIndicator
            userWorkoutLimit={userWorkoutLimit}
            isLoadingUserRole={false}
            onUpgrade={onUpgrade}
          />
        )}

        <Section eyebrow={`MY WORKOUTS · ${saved.length} SAVED`} hideHr>
          {saved.length === 0 ? (
            <EmptyState
              title="No workouts yet"
              description="Create your first workout template to get started."
            />
          ) : (
            <Card pad={0} radius={14}>
              {saved.map((w, i) => {
                const isOwner =
                  currentUserId != null && w.createdBy === currentUserId;
                return (
                  <WorkoutRow
                    key={w.id}
                    workout={w}
                    variant="saved"
                    split={splits.get(w.id) ?? null}
                    isLast={i === saved.length - 1}
                    onPress={() => onOpen(w.id)}
                    onStart={() => onStart(w.id)}
                    onLongPress={isOwner ? () => onLongPress(w) : undefined}
                  />
                );
              })}
            </Card>
          )}
        </Section>

        {templates.length > 0 && (
          <Section eyebrow={`TEMPLATES · ${templates.length}`} hideHr>
            <Card pad={0} radius={14}>
              {templates.map((w, i) => (
                <WorkoutRow
                  key={w.id}
                  workout={w}
                  variant="template"
                  split={splits.get(w.id) ?? null}
                  isLast={i === templates.length - 1}
                  onPress={() => onOpen(w.id)}
                />
              ))}
            </Card>
          </Section>
        )}
      </ScrollView>
    </View>
  );
}
