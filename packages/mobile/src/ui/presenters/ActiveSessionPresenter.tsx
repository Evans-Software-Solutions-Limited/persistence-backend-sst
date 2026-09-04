/**
 * ActiveSessionPresenter — full-screen session UI. (M3, Stories
 * 002 + 005 + 007.)
 *
 * Ported 1:1 from `persistence-mobile/components/workouts/ActiveWorkoutScreen`
 * — vertical list with all exercises stacked, flush header at
 * top (no top-bar chrome), "+ Add Exercise" link below the list,
 * Discard / Complete buttons at the very bottom. Substituted exercises
 * render in place — sets stay visible and the source list mirrors what
 * gets flushed in the bulk-record payload (Story-004 AC).
 *
 * The Discard button delegates to the container, which fires a native
 * `Alert.alert` ("Cancel Workout", "Are you sure...", Cancel + Discard)
 * matching legacy `ActiveWorkoutModal.handleDiscardWorkout`. NO
 * confirmation Popover, NO routed Summary screen for discard. The
 * Summary screen is save-only.
 *
 * `RestTimerDisplay` overlays the bottom when active.
 *
 * Spec: specs/05-active-session/requirements.md STORY-002, STORY-005, STORY-007
 *       persistence-mobile/components/workouts/ActiveWorkoutScreen
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DraggableFlatList, {
  type RenderItemParams,
} from "react-native-draggable-flatlist";
import type { FlatList } from "react-native-gesture-handler";
import type { SharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActiveSupersetRow } from "@/ui/components/session/ActiveSupersetRow";
import { RestTimerDisplay } from "@/ui/components/session/RestTimerDisplay";
import { SessionExerciseCard } from "@/ui/components/session/SessionExerciseCard";
import {
  COMPACT_REORDER_ROW_HEIGHT,
  CompactReorderRow,
} from "@/ui/components/workouts/CompactReorderRow";
import { SessionHeader } from "@/ui/components/session/SessionHeader";
import { TrainerBannerPresenter } from "@/ui/presenters/TrainerBannerPresenter";
import { Btn } from "@/ui/components/foundation/Btn";
import { IconCheck } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import type { ExerciseSet, SessionExercise } from "@/domain/models/session";
import type { WeightUnit } from "@/shared/utils";
import { localDayISO } from "@/shared/utils/date";
import { DatePickerField } from "@/ui/components/DatePickerField";

/**
 * Per-exercise template metadata threaded from the container's
 * `useWorkout` lookup. `restSeconds` is required (defaults to a
 * sensible global at the container if no template); the rest are
 * optional and drive the legacy "{N} sets × {min}-{max} reps" caption
 * + thumbnail when present.
 */
export type SessionExerciseTemplate = {
  category?: string;
  imageUrl?: string;
  targetSets?: number;
  targetRepsMin?: number;
  targetRepsMax?: number;
  targetDurationSeconds?: number;
  restSeconds: number;
};

export type ActiveSessionPresenterProps = {
  sessionName: string;
  startedAt: string;
  exercises: SessionExercise[];
  /**
   * Cross-session "Previous" hint per `(sessionExerciseId, setNumber)`,
   * populated by the container from the local recent-sets cache. Mirrors
   * legacy `user_history.recent_sets`. Empty inner map for exercises the
   * user has never logged before — SetLogger renders an em-dash for
   * unmatched setNumbers.
   */
  previousSetsByExercise: Record<
    string,
    Record<number, { weightKg: number; reps: number }>
  >;
  /**
   * Display-unit preference for the previous-set chips + weight column
   * headers. Weight TextInputs are unaffected — inputs write kg regardless
   * of display unit. Defaults to "kg".
   */
  weightUnit?: WeightUnit;
  preferredUnits?: "metric" | "imperial";
  /**
   * Map of `sessionExerciseId → template metadata`. Container builds it
   * from `useWorkout`; missing entries fall back to a default
   * `restSeconds` and skip the description caption.
   */
  templateByExercise: Record<string, SessionExerciseTemplate>;
  restTimer: {
    isActive: boolean;
    remainingSeconds: number;
    totalSeconds: number;
    progress: number;
    onSkip: () => void;
    onDismiss: () => void;
  };
  onLogSet: (sessionExerciseId: string) => void;
  onUpdateSet: (
    sessionExerciseId: string,
    setId: string,
    patch: Partial<
      Pick<
        ExerciseSet,
        "weightKg" | "reps" | "rpe" | "durationSeconds" | "distanceMeters"
      >
    >,
  ) => void;
  onRemoveSet: (sessionExerciseId: string, setId: string) => void;
  onOpenNotes: (sessionExerciseId: string) => void;
  onSubstitute: (sessionExerciseId: string) => void;
  onRemoveExercise: (sessionExerciseId: string) => void;
  onMoveExercise?: (sessionExerciseId: string, direction: -1 | 1) => void;
  onReorderExercise?: (sessionExerciseId: string, toPosition: number) => void;
  onTapExercise: (exerciseId: string) => void;
  onAddExercise: () => void;
  /**
   * Add an empty set to every exercise in a superset group at the
   * same setNumber. Container delegates to `addSupersetSetCommand`
   * so paired logging stays in sync (Story-005 AC).
   */
  onLogSupersetSet: (sessionExerciseIds: readonly string[]) => void;
  /**
   * Drop the Nth set from every peer in a superset group. Container
   * delegates to `removeSupersetSetCommand` (renumbers survivors so
   * the bulk-record flush stays a contiguous 1..n).
   */
  onRemoveSupersetSet: (
    sessionExerciseIds: readonly string[],
    setNumber: number,
  ) => void;
  /**
   * Open the container-owned notes popover keyed to a set inside a
   * superset group. Title shows "Superset Set N"; the saved note is
   * written to every peer (legacy parity — per-set notes are
   * cosmetic, the storage is shared per superset).
   */
  onOpenSupersetNotes: (
    sessionExerciseIds: readonly string[],
    setNumber: number,
  ) => void;
  /**
   * Open the picker filtered for adding another exercise into the
   * given superset group (legacy "Add Exercise to Superset" link).
   */
  onAddExerciseToSuperset: (supersetGroup: number) => void;
  /**
   * Start the rest timer for the given exercise (legacy `START NS REST`
   * button). User-tap-driven — no auto-fire on set completion.
   */
  onStartRest: (sessionExerciseId: string) => void;
  /**
   * Coach on-behalf context (M8 / `10-trainer-features`). Defaults undefined —
   * the trainer banner renders only when `withClient` is present (STORY-004
   * AC 4.6); athletes never see it. Wired by M8.
   */
  withClient?: { initials: string; name: string };
  retroactive?: boolean;
  activityEnvironment?: "indoor" | "outdoor" | null;
  locationName?: string;
  retrospectiveCompletedAt?: string | null;
  retrospectiveDurationSeconds?: number;
  onActivityEnvironmentChange?: (value: "indoor" | "outdoor" | null) => void;
  onLocationNameChange?: (value: string) => void;
  onRetrospectiveDateChange?: (value: string) => void;
  onRetrospectiveDurationChange?: (seconds: number) => void;
  /** Collapse the session to the floating bar (header chevron-down). */
  onMinimize: () => void;
  /**
   * End the session WITHOUT completing it (header "End" pill → end-confirm).
   * Wired to the cancel/discard flow — "progress won't be saved as a
   * completed workout". The styled end-confirm dialog lands in 05.4; until
   * then this routes through the container's existing discard confirmation.
   */
  onDiscard: () => void;
  /** Complete + save the session (sticky "Finish Workout" CTA). */
  onFinish: () => void;
};

const DEFAULT_TEMPLATE: SessionExerciseTemplate = { restSeconds: 90 };

type DisplayItem =
  | { kind: "exercise"; exercise: SessionExercise }
  | {
      kind: "superset";
      supersetGroup: number;
      exercises: SessionExercise[];
    };

/**
 * Group consecutive exercises sharing the same `supersetGroup` into a
 * single `superset` display item. Mirrors legacy `ActiveWorkoutScreen`
 * lines 83-113. Each `supersetGroup` is rendered exactly once even
 * if the group's exercises are interleaved with non-superset rows.
 */
function buildDisplayItems(exercises: SessionExercise[]): DisplayItem[] {
  const sorted = [...exercises].sort((a, b) => a.sortOrder - b.sortOrder);
  const usedGroups = new Set<number>();
  const items: DisplayItem[] = [];
  for (const ex of sorted) {
    const group = ex.supersetGroup;
    if (group != null) {
      if (usedGroups.has(group)) continue;
      const peers = sorted.filter(
        (candidate) => candidate.supersetGroup === group,
      );
      if (
        peers.some(
          (peer) =>
            peer.category === "cardio" || peer.category === "plyometric",
        )
      ) {
        // Metric-based rows need the dedicated logger rather than the
        // strength-only compact superset table.
        items.push({ kind: "exercise", exercise: ex });
        continue;
      }
      usedGroups.add(group);
      // A "superset" of one is rendered as a plain exercise card.
      if (peers.length < 2) {
        items.push({ kind: "exercise", exercise: ex });
        continue;
      }
      items.push({ kind: "superset", supersetGroup: group, exercises: peers });
      continue;
    }
    items.push({ kind: "exercise", exercise: ex });
  }
  return items;
}

function displayItemKey(item: DisplayItem) {
  return item.kind === "exercise"
    ? item.exercise.id
    : `superset-${item.supersetGroup}`;
}

export function ActiveSessionPresenter(props: ActiveSessionPresenterProps) {
  const insets = useSafeAreaInsets();
  const [isReordering, setIsReordering] = useState(false);
  const [dragAnchorPadding, setDragAnchorPadding] = useState(0);
  const [dragContentMinHeight, setDragContentMinHeight] = useState(0);
  const [dragListEpoch, setDragListEpoch] = useState(0);
  const listRef = useRef<FlatList<DisplayItem>>(null);
  const fullCellHeightsRef = useRef(new Map<string, number>());
  const fullContentHeightRef = useRef(0);
  const isReorderingRef = useRef(false);
  const pendingScrollFrameRef = useRef<number | null>(null);
  const restoreAfterRemountRef = useRef(false);
  const restoreScrollOffsetRef = useRef(0);
  const activeCellSizeRef = useRef<SharedValue<number> | null>(null);
  const activeCellOffsetRef = useRef<SharedValue<number> | null>(null);
  const scrollOffsetRef = useRef<SharedValue<number> | null>(null);
  const weightUnit = props.weightUnit ?? "kg";
  const orderedExercises = useMemo(
    () => [...props.exercises].sort((a, b) => a.sortOrder - b.sortOrder),
    [props.exercises],
  );
  const displayItems = useMemo(
    () => buildDisplayItems(props.exercises),
    [props.exercises],
  );
  const hasCardio = Object.values(props.templateByExercise).some(
    (template) => template.category === "cardio",
  );
  const today = localDayISO(new Date());

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active" || !isReorderingRef.current) return;

      // RNDFL 4.0.3 does not finalize a native CANCELLED pan. Resetting and
      // remounting prevents an OS interruption from leaving the workout in
      // compact mode with its scroll and Finish action disabled.
      if (pendingScrollFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollFrameRef.current);
        pendingScrollFrameRef.current = null;
      }
      isReorderingRef.current = false;
      restoreAfterRemountRef.current = true;
      setIsReordering(false);
      setDragAnchorPadding(0);
      setDragContentMinHeight(0);
      setDragListEpoch((epoch) => epoch + 1);
    });

    return () => {
      subscription.remove();
      if (pendingScrollFrameRef.current !== null) {
        cancelAnimationFrame(pendingScrollFrameRef.current);
        pendingScrollFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!restoreAfterRemountRef.current) return;
    restoreAfterRemountRef.current = false;
    pendingScrollFrameRef.current = requestAnimationFrame(() => {
      const restoreScrollOffset = restoreScrollOffsetRef.current;
      if (scrollOffsetRef.current) {
        scrollOffsetRef.current.value = restoreScrollOffset;
      }
      listRef.current?.scrollToOffset?.({
        offset: restoreScrollOffset,
        animated: false,
      });
      pendingScrollFrameRef.current = null;
    });
  }, [dragListEpoch]);
  const canReorder =
    displayItems.length > 1 && props.onReorderExercise !== undefined;

  return (
    <View
      style={[styles.container, { paddingTop: insets.top }]}
      testID="active-session-screen"
    >
      {/* SetLogger TextInputs sit inside the ScrollView; without an
          explicit KeyboardAvoidingView wrapper the keyboard slides over
          the active weight/reps field and the user can't see what they're
          typing. Same pattern as WorkoutCreator/Editor. */}
      <KeyboardAvoidingView
        style={styles.keyboardAvoider}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <DraggableFlatList
          key={`active-session-drag-list-${dragListEpoch}`}
          ref={listRef}
          testID="active-session-draggable-list"
          containerStyle={styles.scroll}
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            dragContentMinHeight > 0
              ? { minHeight: dragContentMinHeight }
              : undefined,
          ]}
          onContentSizeChange={(_width, height) => {
            if (!isReorderingRef.current) {
              fullContentHeightRef.current = height;
            }
          }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          scrollEnabled={!isReordering}
          data={displayItems}
          extraData={isReordering}
          onAnimValInit={({
            activeCellOffset,
            activeCellSize,
            scrollOffset,
          }) => {
            activeCellOffsetRef.current = activeCellOffset;
            activeCellSizeRef.current = activeCellSize;
            scrollOffsetRef.current = scrollOffset;
          }}
          keyExtractor={displayItemKey}
          autoscrollThreshold={48}
          autoscrollSpeed={60}
          activationDistance={20}
          renderPlaceholder={() => <View style={styles.dragPlaceholder} />}
          onDragBegin={(index) => {
            const shrinkAbove = displayItems
              .slice(0, index)
              .reduce(
                (total, item) =>
                  total +
                  Math.max(
                    0,
                    (fullCellHeightsRef.current.get(displayItemKey(item)) ??
                      COMPACT_REORDER_ROW_HEIGHT) - COMPACT_REORDER_ROW_HEIGHT,
                  ),
                0,
              );
            const originalScrollOffset = scrollOffsetRef.current?.value ?? 0;
            const compactScrollOffset = Math.max(
              0,
              originalScrollOffset - shrinkAbove,
            );
            const anchorPadding = Math.max(
              0,
              shrinkAbove - originalScrollOffset,
            );
            restoreScrollOffsetRef.current = originalScrollOffset;
            if (activeCellSizeRef.current) {
              activeCellSizeRef.current.value = COMPACT_REORDER_ROW_HEIGHT;
            }
            if (activeCellOffsetRef.current) {
              activeCellOffsetRef.current.value =
                activeCellOffsetRef.current.value - shrinkAbove + anchorPadding;
            }
            if (scrollOffsetRef.current) {
              scrollOffsetRef.current.value = compactScrollOffset;
            }
            // Keep the full list's scroll extent while its cells and footer
            // collapse. Without this lower anchor, native scrolling clamps a
            // lower item to the compact content boundary and pulls it away
            // from the stationary finger.
            isReorderingRef.current = true;
            setDragContentMinHeight(fullContentHeightRef.current);
            setDragAnchorPadding(anchorPadding);
            setIsReordering(true);
            pendingScrollFrameRef.current = requestAnimationFrame(() => {
              listRef.current?.scrollToOffset?.({
                offset: compactScrollOffset,
                animated: false,
              });
              pendingScrollFrameRef.current = null;
            });
          }}
          ListHeaderComponent={
            <>
              <SessionHeader
                startedAt={props.startedAt}
                sessionName={props.sessionName}
                onMinimize={props.onMinimize}
                onEnd={props.onDiscard}
              />
              {props.withClient && (
                <TrainerBannerPresenter
                  withClient={props.withClient}
                  retroactive={props.retroactive}
                />
              )}
              {(hasCardio || props.retroactive) && (
                <View
                  style={styles.activityMeta}
                  testID="session-activity-meta"
                >
                  {props.retroactive &&
                  props.retrospectiveCompletedAt &&
                  props.onRetrospectiveDateChange ? (
                    <>
                      <DatePickerField
                        label="Workout date"
                        value={props.retrospectiveCompletedAt.slice(0, 10)}
                        maximumDate={today}
                        allowClear={false}
                        onChange={props.onRetrospectiveDateChange}
                        testID="retrospective-workout-date"
                      />
                      <View style={styles.metaField}>
                        <Text style={styles.metaLabel}>DURATION (MIN)</Text>
                        <TextInput
                          style={styles.metaInput}
                          value={String(
                            Math.max(
                              1,
                              Math.round(
                                (props.retrospectiveDurationSeconds ?? 3600) /
                                  60,
                              ),
                            ),
                          )}
                          keyboardType="number-pad"
                          onChangeText={(value) => {
                            const minutes = Number.parseInt(value, 10);
                            if (minutes > 0 && minutes <= 24 * 60)
                              props.onRetrospectiveDurationChange?.(
                                minutes * 60,
                              );
                          }}
                          maxLength={4}
                          testID="retrospective-workout-duration"
                        />
                      </View>
                    </>
                  ) : null}
                  {hasCardio ? (
                    <>
                      <Text style={styles.metaLabel}>ENVIRONMENT</Text>
                      <View style={styles.environmentRow}>
                        {(["indoor", "outdoor"] as const).map((value) => (
                          <TouchableOpacity
                            key={value}
                            style={[
                              styles.environmentButton,
                              props.activityEnvironment === value &&
                                styles.environmentButtonActive,
                            ]}
                            onPress={() =>
                              props.onActivityEnvironmentChange?.(value)
                            }
                            testID={`session-environment-${value}`}
                          >
                            <Text style={styles.environmentText}>
                              {value.toUpperCase()}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={styles.metaField}>
                        <Text style={styles.metaLabel}>
                          LOCATION (OPTIONAL)
                        </Text>
                        <TextInput
                          style={styles.metaInput}
                          value={props.locationName ?? ""}
                          onChangeText={props.onLocationNameChange}
                          placeholder="Park, route or gym"
                          placeholderTextColor={color.$text4}
                          maxLength={120}
                          testID="session-location"
                        />
                      </View>
                    </>
                  ) : null}
                </View>
              )}
              {dragAnchorPadding > 0 ? (
                <View
                  style={{ height: dragAnchorPadding }}
                  testID="active-session-drag-anchor"
                />
              ) : null}
            </>
          }
          ListEmptyComponent={
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
                <Ionicons name="add" size={18} color={color.$text} />
                <Text style={styles.emptyAddLabel}>Add exercise</Text>
              </TouchableOpacity>
            </View>
          }
          ListFooterComponent={
            orderedExercises.length > 0 && !isReordering ? (
              <View
                style={styles.addExerciseSection}
                testID="active-session-add-exercise-row"
              >
                <View style={styles.divider} />
                <TouchableOpacity
                  onPress={props.onAddExercise}
                  style={styles.addExerciseLink}
                  testID="active-session-add-exercise"
                  accessibilityLabel="Add exercise"
                >
                  <Ionicons
                    name="add-circle-outline"
                    size={20}
                    color={color.$primary}
                  />
                  <Text style={styles.addExerciseText}>Add Exercise</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
          onDragEnd={({ from, to }) => {
            const restoreScrollOffset = restoreScrollOffsetRef.current;
            isReorderingRef.current = false;
            setIsReordering(false);
            setDragAnchorPadding(0);
            setDragContentMinHeight(0);
            if (pendingScrollFrameRef.current !== null) {
              cancelAnimationFrame(pendingScrollFrameRef.current);
            }
            pendingScrollFrameRef.current = requestAnimationFrame(() => {
              if (scrollOffsetRef.current) {
                scrollOffsetRef.current.value = restoreScrollOffset;
              }
              listRef.current?.scrollToOffset?.({
                offset: restoreScrollOffset,
                animated: false,
              });
              pendingScrollFrameRef.current = null;
            });
            if (from === to) return;
            const item = displayItems[from];
            const lead =
              item?.kind === "exercise" ? item.exercise : item?.exercises[0];
            if (!lead) return;
            props.onReorderExercise?.(lead.id, to);
            const label =
              item.kind === "superset"
                ? `Superset starting with ${lead.exerciseName}`
                : lead.exerciseName;
            void AccessibilityInfo.announceForAccessibility(
              `${label} moved to position ${to + 1} of ${displayItems.length}`,
            );
          }}
          renderItem={({
            item,
            drag,
            isActive,
            getIndex,
          }: RenderItemParams<DisplayItem>) => {
            const itemIndex = getIndex() ?? 0;
            const lead =
              item.kind === "exercise" ? item.exercise : item.exercises[0];
            const exerciseNames =
              item.kind === "exercise"
                ? [item.exercise.exerciseName]
                : item.exercises.map((exercise) => exercise.exerciseName);

            if (isReordering) {
              return (
                <CompactReorderRow
                  exerciseNames={exerciseNames}
                  position={itemIndex + 1}
                  total={displayItems.length}
                  onMove={
                    props.onMoveExercise
                      ? (direction) =>
                          props.onMoveExercise?.(lead.id, direction)
                      : undefined
                  }
                  onDrag={drag}
                  isDragging={isActive}
                />
              );
            }

            return (
              <View
                style={styles.dragBlock}
                testID={`active-session-drag-block-${itemIndex + 1}`}
                onLayout={({ nativeEvent: { layout } }) => {
                  fullCellHeightsRef.current.set(
                    displayItemKey(item),
                    layout.height,
                  );
                }}
              >
                {(() => {
                  if (item.kind === "exercise") {
                    const ex = item.exercise;
                    const template =
                      props.templateByExercise[ex.id] ?? DEFAULT_TEMPLATE;
                    return (
                      <SessionExerciseCard
                        key={ex.id}
                        exercise={ex}
                        previousSetsBySetNumber={
                          props.previousSetsByExercise[ex.id] ?? {}
                        }
                        weightUnit={weightUnit}
                        preferredUnits={props.preferredUnits}
                        category={template.category}
                        exerciseImageUrl={template.imageUrl}
                        targetSets={template.targetSets}
                        targetRepsMin={template.targetRepsMin}
                        targetRepsMax={template.targetRepsMax}
                        targetDurationSeconds={template.targetDurationSeconds}
                        restSeconds={template.restSeconds}
                        onLogSet={() => props.onLogSet(ex.id)}
                        onUpdateSet={(setId, patch) =>
                          props.onUpdateSet(ex.id, setId, patch)
                        }
                        onRemoveSet={(setId) => props.onRemoveSet(ex.id, setId)}
                        onOpenNotes={() => props.onOpenNotes(ex.id)}
                        onSubstitute={() => props.onSubstitute(ex.id)}
                        onRemoveExercise={() => props.onRemoveExercise(ex.id)}
                        onTapExercise={() => props.onTapExercise(ex.exerciseId)}
                        onStartRest={() => props.onStartRest(ex.id)}
                        reorderPosition={itemIndex + 1}
                        reorderTotal={displayItems.length}
                        onMove={
                          props.onMoveExercise
                            ? (direction) =>
                                props.onMoveExercise?.(ex.id, direction)
                            : undefined
                        }
                        onDrag={canReorder ? drag : undefined}
                        isDragging={isActive}
                      />
                    );
                  }
                  return (
                    <ActiveSupersetRow
                      key={`superset-${item.supersetGroup}`}
                      supersetGroup={item.supersetGroup}
                      exercises={item.exercises}
                      previousSetsByExercise={props.previousSetsByExercise}
                      weightUnit={weightUnit}
                      templateByExercise={props.templateByExercise}
                      onLogSupersetSet={props.onLogSupersetSet}
                      onUpdateSet={props.onUpdateSet}
                      onRemoveSupersetSet={props.onRemoveSupersetSet}
                      onStartRest={props.onStartRest}
                      onSubstitute={props.onSubstitute}
                      onRemoveExercise={props.onRemoveExercise}
                      onOpenSupersetNotes={props.onOpenSupersetNotes}
                      onAddExerciseToSuperset={props.onAddExerciseToSuperset}
                      reorderPosition={itemIndex + 1}
                      reorderTotal={displayItems.length}
                      onMove={
                        props.onMoveExercise
                          ? (direction) =>
                              props.onMoveExercise?.(
                                item.exercises[0].id,
                                direction,
                              )
                          : undefined
                      }
                      onDrag={canReorder ? drag : undefined}
                      isDragging={isActive}
                    />
                  );
                })()}
              </View>
            );
          }}
        />
      </KeyboardAvoidingView>

      {/* Sticky Finish CTA — floats above the content per the prototype
          (`active-workout.jsx:110–112`). Discard moved to the header "End"
          pill (STORY-002). */}
      {!isReordering && (
        <View style={styles.finishContainer} pointerEvents="box-none">
          <Btn
            full
            variant="filled"
            tone="primary"
            size="lg"
            icon={<IconCheck size={16} color={color.$primaryInk} />}
            onPress={props.onFinish}
            testID="active-session-finish"
            accessibilityLabel="Finish workout"
          >
            Finish Workout
          </Btn>
        </View>
      )}

      <RestTimerDisplay
        isActive={props.restTimer.isActive}
        remainingSeconds={props.restTimer.remainingSeconds}
        totalSeconds={props.restTimer.totalSeconds}
        progress={props.restTimer.progress}
        onSkip={props.restTimer.onSkip}
        onDismiss={props.restTimer.onDismiss}
      />
    </View>
  );
}

// Styles ported from legacy ActiveWorkoutScreen — same paddings,
// borders, button geometry. Workouts-legacy theme keeps the colour
// palette identical to the V1 app.
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.$bg,
  },
  keyboardAvoider: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: {
    padding: 16,
    // Clear the floating "Finish Workout" CTA (52pt + 24pt offset + breathing
    // room) so the last exercise's actions aren't hidden behind it.
    paddingBottom: 100,
    gap: 16,
  },
  dragBlock: {
    backgroundColor: color.$bg,
  },
  activityMeta: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 14,
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.$border,
    backgroundColor: color.$surface,
  },
  metaField: { gap: 6 },
  metaLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: color.$text3,
  },
  metaInput: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.$border,
    backgroundColor: color.$surface2,
    color: color.$text,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
  },
  environmentRow: { flexDirection: "row", gap: 8 },
  environmentButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: color.$border,
    backgroundColor: color.$surface2,
  },
  environmentButtonActive: {
    borderColor: color.$primary,
    backgroundColor: color.$primaryDim,
  },
  environmentText: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    color: color.$text2,
  },
  dragPlaceholder: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.$primary,
    backgroundColor: color.$primaryDim,
  },
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 28,
    color: color.$text,
    marginBottom: 8,
  },
  emptyBody: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
    color: color.$text2,
    textAlign: "center",
    marginBottom: 16,
  },
  emptyAddButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.$primary,
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 4,
  },
  emptyAddLabel: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "600",
  },
  addExerciseSection: {
    marginVertical: 24,
  },
  divider: {
    height: 1,
    backgroundColor: color.$surface3,
    marginBottom: 16,
  },
  addExerciseLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
  },
  addExerciseText: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$primary,
    fontWeight: "600",
  },
  finishContainer: {
    position: "absolute",
    bottom: 24,
    left: 16,
    right: 16,
  },
});
