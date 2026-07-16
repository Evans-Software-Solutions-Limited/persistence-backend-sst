/**
 * SwapExercisePopover — the dedicated single-select picker for the
 * Substitute flow on the active-session screen.
 *
 * Distinct from AddExerciseToSupersetPopover (also single-select) in
 * three ways:
 *   1. Footer CTA reads "Swap" instead of "Add" — matches legacy
 *      `SwapExercisePopover` semantic that the user is replacing
 *      one row, not appending one.
 *   2. Header carries a Create CTA on the right (legacy parity); the
 *      Add-to-Superset picker drops it because supersets are a quick
 *      action and exercise creation lives elsewhere in the legacy
 *      flow.
 *   3. Renders a visible muscle-group filter chip below the search
 *      bar so the user can see WHY the list is narrowed (Story-004 AC
 *      "Opens exercise picker filtered by same muscle group"). Legacy
 *      hides this — its `useGetExercises({ similar_to })` boost is
 *      backend-side and invisible. V2 has no `similar_to` API so we
 *      surface the filter explicitly here, which is also better UX.
 *
 * Reuses `AddExerciseList`, `ExerciseDetailsModal`, and the shared
 * `toPickerExerciseRow` mapper from `../AddExercisePopover` so the
 * row contract stays in one place.
 *
 * Spec: specs/05-active-session/requirements.md STORY-004
 *       Modelled on persistence-mobile/components/workouts/SwapExercisePopover.tsx
 *       (single-select swap picker), used for structural reference
 *       only — V2 owns this surface going forward.
 */

import { color } from "@/ui/theme/tokens";
import { useAdapters } from "@/ui/hooks/useAdapters";
import {
  getExercisesQuery,
  refreshExerciseCache,
} from "@/application/queries/exercises.query";
import { tokenizeSearch } from "@/domain/services/exercise.service";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AddExerciseList } from "../AddExercisePopover/AddExerciseList";
import { ExerciseDetailsModal } from "../AddExercisePopover/ExerciseDetailsModal";
import { toPickerExerciseRow } from "../AddExercisePopover/picker-row";
import { styles } from "../AddExercisePopover/styles";

export type SwapExercisePopoverProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  /**
   * Fires with the picked exercise wrapped in a single-element array
   * so the dispatcher (`applyPickerSelection`) can reuse its `rows`
   * loop — matches `AddExercisePopover.onAddExercises` shape and
   * keeps the picker-routing wiring uniform across modes.
   */
  readonly onSwap: (rows: any[]) => void;
  /**
   * Exercise UUIDs already in the active session — disabled in the
   * list so the user can't pick a duplicate (legacy parity:
   * `useActiveWorkout.swapExercise` lines 949-954). The source row
   * being swapped out is part of this set, which also covers the
   * "can't no-op swap to itself" case.
   */
  readonly existingExerciseIds?: readonly string[];
  /**
   * Primary muscle-group UUIDs of the source exercise. Narrows the
   * picker to entries whose `primaryMuscleGroups` overlap with at
   * least one of these — same logic AddExercisePopover used for the
   * substitute flow before it was lifted out (Story-004 AC).
   */
  readonly filterByPrimaryMuscleGroups?: readonly string[];
  /**
   * Display labels for `filterByPrimaryMuscleGroups` (already resolved
   * via the cached source exercise's `primaryMuscleGroupLabels`). When
   * supplied and non-empty, drives the visible muscle-filter chip
   * shown below the search bar so the user knows WHY the list is
   * narrowed.
   */
  readonly filterMuscleGroupLabels?: readonly string[];
};

function SwapExercisePopoverContainer({
  visible,
  onClose,
  onSwap,
  existingExerciseIds = [],
  filterByPrimaryMuscleGroups,
  filterMuscleGroupLabels,
}: SwapExercisePopoverProps) {
  const router = useRouter();
  const { api, storage } = useAdapters();

  const [searchQuery, setSearchQuery] = useState("");
  // Single-select: one id or null. Tapping the same id again
  // deselects (legacy SwapExercisePopover lines 47-50).
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(
    null,
  );
  const [currentView, setCurrentView] = useState<"list" | "details">("list");
  const [selectedExercise, setSelectedExercise] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cacheVersion, setCacheVersion] = useState(0);

  const cacheRead = useMemo(() => {
    void cacheVersion;
    return getExercisesQuery(storage);
  }, [storage, cacheVersion]);

  const enrichedExercises = useMemo(
    () => cacheRead.exercises.map((ex) => api.enrichExerciseLabels(ex)),
    [cacheRead.exercises, api],
  );

  // Apply the muscle-group filter (substitute flow) before mapping to
  // picker rows. Empty / undefined filter leaves the list untouched.
  const muscleGroupFilteredExercises = useMemo(() => {
    if (
      !filterByPrimaryMuscleGroups ||
      filterByPrimaryMuscleGroups.length === 0
    ) {
      return enrichedExercises;
    }
    const set = new Set(filterByPrimaryMuscleGroups);
    return enrichedExercises.filter((ex) =>
      (ex.primaryMuscleGroups ?? []).some((g) => set.has(g)),
    );
  }, [enrichedExercises, filterByPrimaryMuscleGroups]);

  const allRows = useMemo(
    () => muscleGroupFilteredExercises.map(toPickerExerciseRow),
    [muscleGroupFilteredExercises],
  );

  // Same 100-row display ceiling as AddExercisePopover.
  const PICKER_DISPLAY_LIMIT = 100;

  // AND-match all tokens against the row name — same shape as
  // AddExercisePopover so "press bench" finds "Bench Press".
  const filteredRows = useMemo(() => {
    const tokens = tokenizeSearch(searchQuery);
    const matched =
      tokens.length === 0
        ? allRows
        : allRows.filter((ex) => {
            const name = ex.name.toLowerCase();
            return tokens.every((t) => name.includes(t));
          });
    return matched.slice(0, PICKER_DISPLAY_LIMIT);
  }, [allRows, searchQuery]);

  const hasTriggeredRefreshRef = useRef(false);
  useEffect(() => {
    if (!visible) return;
    if (hasTriggeredRefreshRef.current) return;
    if (!cacheRead.isStale) return;
    hasTriggeredRefreshRef.current = true;
    setIsRefreshing(true);
    void refreshExerciseCache(api, storage).finally(() => {
      setCacheVersion((v) => v + 1);
      setIsRefreshing(false);
    });
  }, [visible, cacheRead.isStale, api, storage]);

  const showLoader = isRefreshing && enrichedExercises.length === 0;

  const toggleExerciseSelection = (exerciseId: string) => {
    setSelectedExerciseId((prev) => (prev === exerciseId ? null : exerciseId));
  };

  const handleExerciseInfo = (exerciseId: string) => {
    const exercise = allRows.find((ex) => ex.id === exerciseId);
    if (exercise) {
      setSelectedExercise(exercise);
      setCurrentView("details");
    }
  };

  const handleBackToList = () => {
    setCurrentView("list");
    setSelectedExercise(null);
  };

  // Reset every piece of internal state — search, selection, and the
  // details drill-in — so the next time the popover opens it starts
  // fresh. The component stays mounted when `visible` flips to false
  // (the parent just sets pickerMode=null), so without this reset the
  // user's previous search query / details view would persist into
  // the next open. Called from BOTH handleClose AND handleSwapClick
  // for parity (the swap-success path used to only clear selection,
  // leaving stale chrome behind).
  const resetInternalState = () => {
    setSearchQuery("");
    setSelectedExerciseId(null);
    setCurrentView("list");
    setSelectedExercise(null);
  };

  const handleClose = () => {
    resetInternalState();
    onClose();
  };

  const handleCreateExercise = useCallback(() => {
    // Close the picker first so the full-screen creator isn't stacked behind an
    // open bottom-sheet; then route to the real creator (was a /coming-soon
    // dead-end). After creating, the user returns and can search their new
    // exercise to swap it in.
    handleClose();
    router.push("/(app)/exercises/create" as never);
    // handleClose is a stable closure over setState + onClose; intentionally
    // omitted from deps to avoid re-creating this callback every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const handleSwapClick = () => {
    if (!selectedExerciseId) return;
    const exercise = allRows.find((ex) => ex.id === selectedExerciseId);
    if (!exercise) return;
    // Wrap in an array so the container's `applyPickerSelection`
    // dispatcher (which iterates `rows`) handles this uniformly with
    // every other picker mode.
    onSwap([exercise]);
    resetInternalState();
  };

  return (
    <SwapExercisePopoverPresenter
      visible={visible}
      onClose={handleClose}
      onSwap={handleSwapClick}
      onCreateExercise={handleCreateExercise}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      exercises={filteredRows}
      selectedExerciseId={selectedExerciseId}
      onToggleExercise={toggleExerciseSelection}
      onExerciseInfo={handleExerciseInfo}
      onBackToList={handleBackToList}
      currentView={currentView}
      selectedExercise={selectedExercise}
      isLoading={showLoader}
      existingExerciseIds={[...existingExerciseIds]}
      filterMuscleGroupLabels={filterMuscleGroupLabels ?? []}
    />
  );
}

type SwapExercisePopoverPresenterProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onSwap: () => void;
  readonly onCreateExercise: () => void;
  readonly searchQuery: string;
  readonly onSearchChange: (q: string) => void;
  readonly exercises: any[];
  readonly selectedExerciseId: string | null;
  readonly onToggleExercise: (id: string) => void;
  readonly onExerciseInfo: (id: string) => void;
  readonly onBackToList: () => void;
  readonly currentView: "list" | "details";
  readonly selectedExercise: any;
  readonly isLoading: boolean;
  readonly existingExerciseIds: string[];
  readonly filterMuscleGroupLabels: readonly string[];
};

function SwapExercisePopoverPresenter({
  visible,
  onClose,
  onSwap,
  onCreateExercise,
  searchQuery,
  onSearchChange,
  exercises,
  selectedExerciseId,
  onToggleExercise,
  onExerciseInfo,
  onBackToList,
  currentView,
  selectedExercise,
  isLoading,
  existingExerciseIds,
  filterMuscleGroupLabels,
}: SwapExercisePopoverPresenterProps) {
  const hasSelection = selectedExerciseId !== null;
  const selectedExerciseIds = useMemo(
    () => (selectedExerciseId ? [selectedExerciseId] : []),
    [selectedExerciseId],
  );
  const hasMuscleFilter = filterMuscleGroupLabels.length > 0;

  if (currentView === "details" && selectedExercise) {
    return (
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onBackToList}
      >
        <SafeAreaView style={styles.modalSafeArea} edges={["top"]}>
          <View style={styles.detailsHeader}>
            <TouchableOpacity
              onPress={onBackToList}
              style={styles.backButton}
              testID="swap-picker-details-back"
              accessibilityRole="button"
              accessibilityLabel="Back to list"
            >
              <Ionicons name="arrow-back" size={24} color={color.$text} />
            </TouchableOpacity>
            <Text style={styles.detailsTitle}>Exercise Details</Text>
            <View style={styles.headerSpacer} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <ExerciseDetailsModal exercise={selectedExercise} />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      testID="swap-picker-modal"
    >
      <SafeAreaView style={styles.modalSafeArea} edges={["top"]}>
        <View style={styles.modalHeader}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.backButton}
            testID="swap-picker-close"
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="arrow-back" size={24} color={color.$text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Swap Exercise</Text>
          <TouchableOpacity
            onPress={onCreateExercise}
            style={styles.createButton}
            testID="swap-picker-create"
          >
            <Text style={styles.createButtonText}>Create</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchWrapper}>
          <View style={styles.searchContainer}>
            <Ionicons
              name="search"
              size={20}
              color={color.$text2}
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search exercises..."
              placeholderTextColor={color.$text3}
              value={searchQuery}
              onChangeText={onSearchChange}
              autoCapitalize="none"
              autoCorrect={false}
              testID="swap-picker-search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => onSearchChange("")}
                style={styles.clearButton}
                testID="swap-picker-clear-search"
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={20} color={color.$text2} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {hasMuscleFilter && (
          <View
            style={muscleFilterStyles.chipWrapper}
            testID="swap-picker-muscle-filter"
          >
            <Ionicons
              name="filter"
              size={14}
              color={color.$text2}
              style={muscleFilterStyles.chipIcon}
            />
            <Text
              style={muscleFilterStyles.chipText}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              Filtered by{" "}
              <Text style={muscleFilterStyles.chipTextEmphasis}>
                {filterMuscleGroupLabels.join(", ")}
              </Text>
            </Text>
          </View>
        )}

        <ScrollView
          style={styles.modalScroll}
          showsVerticalScrollIndicator={false}
        >
          <AddExerciseList
            exercises={exercises}
            selectedExerciseIds={selectedExerciseIds}
            onToggleExercise={onToggleExercise}
            onExerciseInfo={onExerciseInfo}
            isLoading={isLoading}
            existingExerciseIds={existingExerciseIds}
          />
        </ScrollView>

        {/* Single Swap button — disabled until exactly one row is
            selected. Legacy SwapExercisePopover lines 237-244. */}
        <View style={styles.modalFooter}>
          <TouchableOpacity
            style={[
              styles.footerButton,
              !hasSelection && styles.footerButtonDisabled,
            ]}
            onPress={onSwap}
            disabled={!hasSelection}
            testID="swap-picker-swap"
          >
            <Text
              style={[
                styles.footerButtonText,
                !hasSelection && styles.footerButtonTextDisabled,
              ]}
            >
              Swap
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// Local styles for the muscle-filter chip — sits immediately below the
// search bar, above the list. Light-touch: pill-style, secondary
// surface, with the muscle-group labels emphasised in primary text.
const muscleFilterStyles = StyleSheet.create({
  chipWrapper: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  chipIcon: {
    marginRight: 4,
  },
  chipText: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
    color: color.$text2,
    flex: 1,
  },
  chipTextEmphasis: {
    color: color.$text,
    fontWeight: "600",
  },
});

export const SwapExercisePopover = SwapExercisePopoverContainer;
