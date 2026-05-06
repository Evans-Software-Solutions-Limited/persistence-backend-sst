/**
 * ActiveSessionPresenter — full-screen session UI. (M3, Stories
 * 002 + 005 + 007.)
 *
 * Layout:
 *   - SessionHeader at top (live duration + close).
 *   - Horizontal pageable FlatList of `SessionExerciseCard`s; one
 *     screen-wide page per non-substituted exercise. Tap-strip above
 *     the list lets the user jump to any exercise (Story-005 AC).
 *     Substituted rows render as a thin "Substituted" stub the user
 *     can scroll past — sets are preserved (Story-004 AC) but the row
 *     no longer takes a full-screen slot.
 *   - `RestTimerDisplay` overlays the bottom when active.
 *   - Footer with Discard + Finish CTAs.
 *
 * Discard tapping opens a confirmation `Popover` (M2 learning #9 —
 * Popover is fine for confirmations; pageSheet Modal is for multi-
 * step nav, used by the AddExercisePopover beneath).
 *
 * Ported 1:1 from `persistence-mobile/components/workouts/ActiveWorkoutScreen`
 * with the V2 Container/Presenter shape — all mutation handlers come
 * in as props from `ActiveSessionContainer`. /frontend-design polish
 * runs after the port lands, not during (project memory: port-then-revamp).
 *
 * Spec: specs/05-active-session/requirements.md STORY-002, STORY-005, STORY-007
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 7
 */

import { Ionicons } from "@expo/vector-icons";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewToken,
} from "react-native";
import { Popover } from "@/ui/components/Popover";
import { RestTimerDisplay } from "@/ui/components/session/RestTimerDisplay";
import { SessionExerciseCard } from "@/ui/components/session/SessionExerciseCard";
import { SessionHeader } from "@/ui/components/session/SessionHeader";
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import type { ExerciseSet, SessionExercise } from "@/domain/models/session";

export type ActiveSessionPresenterProps = {
  sessionName: string;
  startedAt: string;
  exercises: SessionExercise[];
  /**
   * Map of `sessionExerciseId → previous { weightKg, reps }`. Populated
   * by the container from in-session completed sets (priority codified
   * in EXECUTION_PLAN § 3.5: in-session → PR cache → nothing).
   */
  previousByExercise: Record<string, { weightKg: number; reps: number } | null>;
  restTimer: {
    isActive: boolean;
    remainingSeconds: number;
    totalSeconds: number;
    progress: number;
    onSkip: () => void;
    onExtend: (seconds: number) => void;
    onDismiss: () => void;
  };
  onClose: () => void;
  onLogSet: (sessionExerciseId: string) => void;
  onCompleteSet: (sessionExerciseId: string, setId: string) => void;
  onUpdateSet: (
    sessionExerciseId: string,
    setId: string,
    patch: Partial<Pick<ExerciseSet, "weightKg" | "reps" | "rpe">>,
  ) => void;
  onRemoveSet: (sessionExerciseId: string, setId: string) => void;
  onSubstitute: (sessionExerciseId: string) => void;
  onTapExercise: (exerciseId: string) => void;
  onAddExercise: () => void;
  onDiscard: () => void;
  onFinish: () => void;
  /** Optional override for tests that want a deterministic page width. */
  pageWidth?: number;
};

const { width: SCREEN_WIDTH } = Dimensions.get("window");

export function ActiveSessionPresenter(props: ActiveSessionPresenterProps) {
  const pageWidth = props.pageWidth ?? SCREEN_WIDTH;
  const [activeIndex, setActiveIndex] = useState(0);
  const [discardVisible, setDiscardVisible] = useState(false);
  const listRef = useRef<FlatList<SessionExercise>>(null);

  // Active = non-substituted. Substituted rows still render so their
  // sets remain visible per Story-004 AC, but they don't count toward
  // the "Exercise N of M" indicator and don't get full-page slots.
  const orderedExercises = useMemo(
    () => [...props.exercises].sort((a, b) => a.sortOrder - b.sortOrder),
    [props.exercises],
  );
  const activeExercises = useMemo(
    () => orderedExercises.filter((ex) => !ex.isSubstituted),
    [orderedExercises],
  );

  // If the active list shrinks (substitution) below the current
  // index, snap back to the new last page. Avoids an empty page after
  // a swap on the trailing exercise.
  useEffect(() => {
    if (activeIndex >= activeExercises.length && activeExercises.length > 0) {
      setActiveIndex(activeExercises.length - 1);
    }
  }, [activeExercises.length, activeIndex]);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0];
      if (first && typeof first.index === "number") {
        setActiveIndex(first.index);
      }
    },
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 60,
  }).current;

  const jumpTo = useCallback(
    (idx: number) => {
      if (idx < 0 || idx >= activeExercises.length) return;
      listRef.current?.scrollToIndex({ index: idx, animated: true });
      setActiveIndex(idx);
    },
    [activeExercises.length],
  );

  const onConfirmDiscard = useCallback(() => {
    setDiscardVisible(false);
    props.onDiscard();
  }, [props]);

  const renderExercise = useCallback(
    ({ item }: { item: SessionExercise }) => (
      <View style={[styles.page, { width: pageWidth }]}>
        <SessionExerciseCard
          exercise={item}
          previous={props.previousByExercise[item.id] ?? null}
          onLogSet={() => props.onLogSet(item.id)}
          onCompleteSet={(setId) => props.onCompleteSet(item.id, setId)}
          onUpdateSet={(setId, patch) =>
            props.onUpdateSet(item.id, setId, patch)
          }
          onRemoveSet={(setId) => props.onRemoveSet(item.id, setId)}
          onSubstitute={() => props.onSubstitute(item.id)}
          onTapExercise={() => props.onTapExercise(item.exerciseId)}
        />
      </View>
    ),
    [pageWidth, props],
  );

  const substitutedCount = orderedExercises.length - activeExercises.length;

  return (
    <View style={styles.container} testID="active-session-screen">
      <SessionHeader
        startedAt={props.startedAt}
        sessionName={props.sessionName}
        exerciseIndex={activeExercises.length === 0 ? 0 : activeIndex + 1}
        totalExercises={activeExercises.length}
        onClose={props.onClose}
      />

      {activeExercises.length > 1 && (
        <View style={styles.tabStrip} testID="exercise-tab-strip">
          {activeExercises.map((ex, idx) => (
            <TouchableOpacity
              key={ex.id}
              onPress={() => jumpTo(idx)}
              style={[styles.tab, idx === activeIndex && styles.tabActive]}
              testID={`exercise-tab-${idx}`}
              accessibilityLabel={`Jump to ${ex.exerciseName}`}
            >
              <Text
                style={[
                  styles.tabLabel,
                  idx === activeIndex && styles.tabLabelActive,
                ]}
                numberOfLines={1}
              >
                {ex.exerciseName}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {activeExercises.length === 0 ? (
        <View style={styles.emptyWrap} testID="active-session-empty">
          <Text style={styles.emptyTitle}>No exercises yet</Text>
          <Text style={styles.emptyBody}>
            Add exercises from the library to start logging sets.
          </Text>
          <TouchableOpacity
            onPress={props.onAddExercise}
            style={styles.emptyAddButton}
            testID="active-session-empty-add"
            accessibilityLabel="Add exercise"
          >
            <Ionicons name="add" size={18} color={Colors.text.primary} />
            <Text style={styles.emptyAddLabel}>Add exercise</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={activeExercises}
          keyExtractor={(ex) => ex.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          renderItem={renderExercise}
          getItemLayout={(_, index) => ({
            length: pageWidth,
            offset: pageWidth * index,
            index,
          })}
          testID="exercise-pager"
        />
      )}

      {substitutedCount > 0 && (
        <Text style={styles.substitutedNote} testID="substituted-note">
          {substitutedCount} substituted exercise
          {substitutedCount === 1 ? "" : "s"} preserved in this session
        </Text>
      )}

      <RestTimerDisplay
        isActive={props.restTimer.isActive}
        remainingSeconds={props.restTimer.remainingSeconds}
        totalSeconds={props.restTimer.totalSeconds}
        progress={props.restTimer.progress}
        onSkip={props.restTimer.onSkip}
        onExtend={props.restTimer.onExtend}
        onDismiss={props.restTimer.onDismiss}
      />

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.footerButton, styles.discardButton]}
          onPress={() => setDiscardVisible(true)}
          testID="active-session-discard"
          accessibilityLabel="Discard session"
        >
          <Ionicons name="close" size={18} color={Colors.text.secondary} />
          <Text style={styles.discardLabel}>Discard</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.footerButton, styles.finishButton]}
          onPress={props.onFinish}
          testID="active-session-finish"
          accessibilityLabel="Finish session"
        >
          <Text style={styles.finishLabel}>Finish workout</Text>
          <Ionicons
            name="arrow-forward"
            size={18}
            color={Colors.text.primary}
          />
        </TouchableOpacity>
      </View>

      <Popover
        visible={discardVisible}
        onClose={() => setDiscardVisible(false)}
        title="Discard this session?"
        minHeight="30%"
        maxHeight="40%"
        content={
          <Text style={styles.discardPrompt}>
            Logged sets stay in your history but won&apos;t count toward
            progress.
          </Text>
        }
        footer={
          <View style={styles.discardFooter}>
            <TouchableOpacity
              style={[styles.dialogButton, styles.dialogButtonGhost]}
              onPress={() => setDiscardVisible(false)}
              testID="active-session-discard-cancel"
            >
              <Text style={styles.dialogButtonGhostLabel}>Keep session</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dialogButton, styles.dialogButtonDanger]}
              onPress={onConfirmDiscard}
              testID="active-session-discard-confirm"
            >
              <Text style={styles.dialogButtonDangerLabel}>Discard</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  tabStrip: {
    flexDirection: "row",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  tab: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface.tertiary,
    maxWidth: 140,
  },
  tabActive: {
    backgroundColor: Colors.primary.DEFAULT,
  },
  tabLabel: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
  tabLabelActive: {
    ...Typography.body2,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  page: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  substitutedNote: {
    ...Typography.caption,
    color: Colors.text.tertiary,
    textAlign: "center",
    paddingVertical: Spacing.sm,
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  emptyTitle: {
    ...Typography.h3,
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  emptyBody: {
    ...Typography.body2,
    color: Colors.text.secondary,
    textAlign: "center",
    marginBottom: Spacing.md,
  },
  emptyAddButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary.DEFAULT,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  emptyAddLabel: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  footer: {
    flexDirection: "row",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surface.border,
    backgroundColor: Colors.surface.primary,
  },
  footerButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  discardButton: {
    backgroundColor: Colors.surface.tertiary,
  },
  discardLabel: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
  finishButton: {
    backgroundColor: Colors.primary.DEFAULT,
    flex: 2,
  },
  finishLabel: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  discardPrompt: {
    ...Typography.body2,
    color: Colors.text.secondary,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  discardFooter: {
    flexDirection: "row",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  dialogButton: {
    flex: 1,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  dialogButtonGhost: {
    backgroundColor: Colors.surface.tertiary,
  },
  dialogButtonGhostLabel: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
  dialogButtonDanger: {
    backgroundColor: Colors.error.DEFAULT,
  },
  dialogButtonDangerLabel: {
    ...Typography.body2,
    color: Colors.text.primary,
    fontWeight: "600",
  },
});
