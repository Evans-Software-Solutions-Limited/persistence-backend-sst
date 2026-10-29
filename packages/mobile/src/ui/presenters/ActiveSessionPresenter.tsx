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
import React, { useMemo, type ReactNode } from "react";
import {
  AccessibilityInfo,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ActiveSupersetRow } from "@/ui/components/session/ActiveSupersetRow";
import { RestTimerDisplay } from "@/ui/components/session/RestTimerDisplay";
import { SessionExerciseCard } from "@/ui/components/session/SessionExerciseCard";
import {
  COMPACT_REORDER_ROW_HEIGHT,
  CompactReorderRow,
} from "@/ui/components/workouts/CompactReorderRow";
import {
  ReorderableList,
  type ReorderableRenderProps,
} from "@/ui/components/workouts/ReorderableList";
import { SessionHeader } from "@/ui/components/session/SessionHeader";
import { buildReorderBlocks } from "@/domain/services/workout.service";
import { TrainerBannerPresenter } from "@/ui/presenters/TrainerBannerPresenter";
import { Btn } from "@/ui/components/foundation/Btn";
import { IconCheck } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import type { ExerciseSet, SessionExercise } from "@/domain/models/session";
import type { WeightUnit } from "@/shared/utils";
import { localDayISO } from "@/shared/utils/date";
import { DatePickerField } from "@/ui/components/DatePickerField";
import { format, isValid, parseISO } from "date-fns";

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

export function retrospectiveDayValue(completedAt: string): string {
  const completed = parseISO(completedAt);
  return isValid(completed) ? format(completed, "yyyy-MM-dd") : "";
}

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

/**
 * Gap between compact rows. It lives INSIDE the measured row height the
 * sortable is told about, because absolutely-positioned rows ignore the
 * container's `gap`.
 */
const REORDER_ROW_GAP = 16;

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

/**
 * Seed height for a drag row, used only for the frame or two before the rows
 * report their own. A logged strength card is taller, an unstarted one
 * shorter; the list measures each of them.
 */
const ESTIMATED_BLOCK_HEIGHT = 220;

export function ActiveSessionPresenter(props: ActiveSessionPresenterProps) {
  const insets = useSafeAreaInsets();
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

  /**
   * Reorder is ONE gesture on the real card: hold the grip and drag.
   *
   * There is no reorder mode any more, and nothing to tap in or out. The two
   * earlier designs both existed to work around a belief that the sortable
   * could only drag uniform rows — first by collapsing the list mid-drag
   * (which left the library holding stale measurements of the taller cards),
   * then by making the collapse a mode you entered with one hold and dragged
   * with a second. The belief was wrong: the library measures rows when told
   * to (`enableDynamicHeights`), so the cards themselves drag. See
   * `ReorderableList`.
   */

  /**
   * Reorder rows are NOT the display items.
   *
   * `buildDisplayItems` splits a superset containing a cardio or plyometric
   * exercise into individual rows, because those need the metric logger rather
   * than the strength table. The reorder command groups purely by
   * `supersetGroup`. Deriving the drag rows from the display items therefore
   * handed the command an index from a different index space: past the end it
   * silently no-oped, and inside it the row landed after the wrong exercise.
   * `buildReorderBlocks` is the command's own grouping, shared.
   */
  const rows = useMemo(
    () =>
      buildReorderBlocks(orderedExercises).map((block) => ({
        id:
          block[0].supersetGroup != null
            ? `superset-${block[0].supersetGroup}`
            : block[0].id,
        exercises: block,
      })),
    [orderedExercises],
  );

  // Counts BLOCKS, not display rows: a session of one cardio-bearing superset
  // renders two cards but is a single block, so there is nothing to move.
  const canReorder = rows.length > 1 && props.onReorderExercise !== undefined;

  /**
   * Block position for a display row, and whether it leads its block.
   *
   * The accessible Move up/down actions go through the same command as a drag,
   * which works in BLOCK space — but the cards render in DISPLAY space, which
   * splits a cardio-bearing superset into separate rows. Announcing
   * `index + 1` of `displayItems.length` therefore described a move the command
   * would not make, and offered "Move up" on a peer the command rejects. Only
   * the block lead carries a grip, and it speaks block numbers.
   */
  const blockOf = (exerciseId: string) => {
    const blockIndex = rows.findIndex((row) =>
      row.exercises.some((exercise) => exercise.id === exerciseId),
    );
    if (blockIndex < 0) return null;
    return {
      position: blockIndex + 1,
      total: rows.length,
      isLead: rows[blockIndex].exercises[0].id === exerciseId,
    };
  };

  /**
   * Commit a drop. `toIndex` is a BLOCK index — a superset moves as one — and
   * `onReorderExercise` takes that block's lead exercise.
   */
  const handleReorder = (movedId: string, toIndex: number) => {
    const moved = rows.find((row) => row.id === movedId);
    const lead = moved?.exercises[0];
    if (!lead) return;
    props.onReorderExercise?.(lead.id, toIndex);
    const label =
      moved.exercises.length > 1
        ? `Superset starting with ${lead.exerciseName}`
        : lead.exerciseName;
    void AccessibilityInfo.announceForAccessibility(
      `${label} moved to position ${toIndex + 1} of ${rows.length}`,
    );
  };

  /**
   * The display items that belong to each drag block.
   *
   * A block is what MOVES (`buildReorderBlocks`, shared with the command); a
   * display item is what RENDERS (`buildDisplayItems`, which splits a superset
   * containing a cardio or plyometric exercise into separate rows so they get
   * the metric logger instead of the strength table). So a block can render
   * more than one card, and all of them travel together.
   */
  const displayItemsByBlock = useMemo(() => {
    const byBlock = new Map<string, DisplayItem[]>();
    displayItems.forEach((item) => {
      const leadId =
        item.kind === "exercise" ? item.exercise.id : item.exercises[0].id;
      const block = rows.find((row) =>
        row.exercises.some((exercise) => exercise.id === leadId),
      );
      if (!block) return;
      const existing = byBlock.get(block.id);
      if (existing) existing.push(item);
      else byBlock.set(block.id, [item]);
    });
    return byBlock;
  }, [displayItems, rows]);

  const displayItemsOfBlock = (blockId: string) =>
    displayItemsByBlock.get(blockId) ?? [];

  /**
   * One display item. Only the block LEAD advertises a draggable grip — the
   * gesture itself belongs to `ReorderableList`, which puts an invisible
   * target over the row's top-left corner.
   */
  const renderDisplayItem = (item: DisplayItem, draggable: boolean) => {
    if (item.kind === "exercise") {
      const ex = item.exercise;
      const template = props.templateByExercise[ex.id] ?? DEFAULT_TEMPLATE;
      return (
        <SessionExerciseCard
          key={ex.id}
          exercise={ex}
          previousSetsBySetNumber={props.previousSetsByExercise[ex.id] ?? {}}
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
          onUpdateSet={(setId, patch) => props.onUpdateSet(ex.id, setId, patch)}
          onRemoveSet={(setId) => props.onRemoveSet(ex.id, setId)}
          onOpenNotes={() => props.onOpenNotes(ex.id)}
          onSubstitute={() => props.onSubstitute(ex.id)}
          onRemoveExercise={() => props.onRemoveExercise(ex.id)}
          onTapExercise={() => props.onTapExercise(ex.exerciseId)}
          onStartRest={() => props.onStartRest(ex.id)}
          reorderPosition={blockOf(ex.id)?.position}
          reorderTotal={rows.length}
          onMove={
            props.onMoveExercise && blockOf(ex.id)?.isLead
              ? (direction) => props.onMoveExercise?.(ex.id, direction)
              : undefined
          }
          draggable={draggable && blockOf(ex.id)?.isLead === true}
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
        reorderPosition={blockOf(item.exercises[0].id)?.position}
        reorderTotal={rows.length}
        onMove={
          props.onMoveExercise
            ? (direction) =>
                props.onMoveExercise?.(item.exercises[0].id, direction)
            : undefined
        }
        draggable={draggable}
      />
    );
  };

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
        <ReorderableList
          testID="active-session-list"
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          // Only the seed used before the rows report their own heights, so a
          // rough average of a card is right. Cards are NOT this tall and do
          // not match each other; the list measures them.
          estimatedItemHeight={ESTIMATED_BLOCK_HEIGHT}
          compactItemHeight={COMPACT_REORDER_ROW_HEIGHT + REORDER_ROW_GAP}
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
          data={rows}
          onReorder={handleReorder}
          header={
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
                        value={retrospectiveDayValue(
                          props.retrospectiveCompletedAt,
                        )}
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
            </>
          }
          footer={
            orderedExercises.length > 0 ? (
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
            ) : (
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
            )
          }
          renderItem={(row, { index, isCompact }: ReorderableRenderProps) => (
            <View
              style={styles.dragBlock}
              testID={`active-session-drag-block-${index + 1}`}
            >
              {isCompact ? (
                /*
                 * Collapsed for the drag, so the whole list is visible while
                 * you move a row. The swap happens on the hold, BEFORE the
                 * drag activates — see `ReorderableList`.
                 */
                <View style={{ paddingBottom: REORDER_ROW_GAP }}>
                  <CompactReorderRow
                    exerciseNames={row.exercises.map(
                      (exercise) => exercise.exerciseName,
                    )}
                    position={index + 1}
                    total={rows.length}
                    // No `onMove` in compact mode: a move arriving from
                    // outside the drag would desync the sortable's position
                    // map against what is on screen. The full cards carry the
                    // accessible Move actions.
                  />
                </View>
              ) : (
                displayItemsOfBlock(row.id).map((item) =>
                  renderDisplayItem(item, canReorder),
                )
              )}
            </View>
          )}
        />
      </KeyboardAvoidingView>

      {/* Sticky Finish CTA — floats above the content per the prototype
          (`active-workout.jsx:110–112`). Discard moved to the header "End"
          pill (STORY-002). */}
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
  reorderContent: {
    // Horizontal only — see the contentContainerStyle note on the reorder
    // list. The bottom clearance is for the floating Finish CTA, which keeps
    // floating in compact mode; content BELOW the rows is harmless.
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
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
