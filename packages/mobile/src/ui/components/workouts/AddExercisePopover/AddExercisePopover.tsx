import { Colors } from "@/ui/theme/workoutsLegacyTheme";
import { useAdapters } from "@/ui/hooks/useAdapters";
import {
  getExercisesQuery,
  refreshExerciseCache,
} from "@/application/queries/exercises.query";
import type { Exercise } from "@/domain/models/exercise";
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
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AddExerciseList } from "./AddExerciseList";
import { ExerciseDetailsModal } from "./ExerciseDetailsModal";
import { styles } from "./styles";

interface AddExercisePopoverProps {
  readonly visible: boolean;
  readonly onClose: () => void;

  readonly onAddExercises: (exercises: any[]) => void;

  readonly onAddSuperset: (exercises: any[]) => void;
  readonly existingExerciseIds?: string[];
  /**
   * When set, restricts the exercise list to entries whose
   * `primaryMuscleGroups` overlap with at least one of the supplied
   * UUIDs. Used by the substitute flow on the active-session screen
   * to surface alternatives that target the same muscle group as the
   * exercise being swapped out (Story-004 AC).
   */
  readonly filterByPrimaryMuscleGroups?: readonly string[];
}

/**
 * Maps V2 camelCase `Exercise` (label-enriched at the adapter boundary)
 * onto the snake_case shape the verbatim-ported popover/list/details
 * components expect. The shape mirrors the legacy `ExerciseRow` exactly
 * — same keys, same nested-object structure for muscles/equipment —
 * so the rendering subtree stays untouched. M11 polish revisits the
 * components themselves; the mapping deletes when they do.
 */

function toLegacyExerciseRow(ex: Exercise): any {
  const muscleLabels = ex.primaryMuscleGroupLabels ?? [];
  const equipmentLabels = ex.equipmentLabels ?? [];
  return {
    id: ex.id,
    name: ex.name,
    description: ex.description,
    instructions: ex.instructions,
    thumbnail_url: ex.thumbnailUrl,
    video_url: ex.videoUrl,
    difficulty_level: ex.difficulty,
    primary_muscles: muscleLabels.map((label) => ({
      name: label,
      display_name: label,
    })),
    equipment_required: equipmentLabels.map((label) => ({ name: label })),
  };
}

// Container Component - Handles logic and state
function AddExercisePopoverContainer({
  visible,
  onClose,
  onAddExercises,
  onAddSuperset,
  existingExerciseIds = [],
  filterByPrimaryMuscleGroups,
}: AddExercisePopoverProps) {
  const router = useRouter();
  const { api, storage } = useAdapters();

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedExerciseIds, setSelectedExerciseIds] = useState<string[]>([]);
  const [currentView, setCurrentView] = useState<"list" | "details">("list");

  const [selectedExercise, setSelectedExercise] = useState<any>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [cacheVersion, setCacheVersion] = useState(0);

  // Cache-first read of M0's exercise library. Filtering is local to
  // the picker — cheap substring match — to keep the popover responsive
  // without a refetch per keystroke.
  const cacheRead = useMemo(() => {
    void cacheVersion;
    return getExercisesQuery(storage);
  }, [storage, cacheVersion]);

  const enrichedExercises = useMemo(
    () => cacheRead.exercises.map((ex) => api.enrichExerciseLabels(ex)),
    [cacheRead.exercises, api],
  );

  // Substitute flow: narrow to exercises whose primary muscle groups
  // overlap with the source exercise (Story-004 AC: "Opens exercise
  // picker filtered by same muscle group"). Empty / undefined filter
  // leaves the list untouched.
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

  // Full mapped list — used for selection lookups so a search filter
  // can't silently drop exercises the user already selected before
  // typing. `filteredLegacy` is the search-filtered subset rendered
  // by the inner list; selection resolution and detail drill-in
  // always go through `allLegacy`.
  const allLegacy = useMemo(
    () => muscleGroupFilteredExercises.map(toLegacyExerciseRow),
    [muscleGroupFilteredExercises],
  );

  // Cap to 100 rendered rows — matches the legacy `useGetExercises({
  // limit: 100 })` ceiling and prevents the picker from rendering
  // 2k+ non-virtualised rows on a wide library, which made the modal
  // "take ages" to show selection feedback.
  const PICKER_DISPLAY_LIMIT = 100;

  const filteredLegacy = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matched =
      q.length === 0
        ? allLegacy
        : allLegacy.filter((ex) => ex.name.toLowerCase().includes(q));
    return matched.slice(0, PICKER_DISPLAY_LIMIT);
  }, [allLegacy, searchQuery]);

  // One-shot refresh when stale, mirroring ExerciseListContainer. The
  // initial visit warms the cache; subsequent opens reuse it.
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
    setSelectedExerciseIds((prev) =>
      prev.includes(exerciseId)
        ? prev.filter((id) => id !== exerciseId)
        : [...prev, exerciseId],
    );
  };

  const handleExerciseInfo = (exerciseId: string) => {
    const exercise = allLegacy.find((ex) => ex.id === exerciseId);
    if (exercise) {
      setSelectedExercise(exercise);
      setCurrentView("details");
    }
  };

  const handleBackToList = () => {
    setCurrentView("list");
    setSelectedExercise(null);
  };

  const handleCreateExercise = useCallback(() => {
    router.push("/coming-soon?feature=exercise-creator" as never);
  }, [router]);

  const handleClose = () => {
    setSearchQuery("");
    setSelectedExerciseIds([]);
    setCurrentView("list");
    setSelectedExercise(null);
    onClose();
  };

  const handleAddExercisesClick = () => {
    const selectedExercises = allLegacy.filter((ex) =>
      selectedExerciseIds.includes(ex.id),
    );
    onAddExercises(selectedExercises);
    setSelectedExerciseIds([]);
  };

  const handleAddSupersetClick = () => {
    const selectedExercises = allLegacy.filter((ex) =>
      selectedExerciseIds.includes(ex.id),
    );
    onAddSuperset(selectedExercises);
    setSelectedExerciseIds([]);
  };

  return (
    <AddExercisePopoverPresenter
      visible={visible}
      onClose={handleClose}
      onAddExercises={handleAddExercisesClick}
      onAddSuperset={handleAddSupersetClick}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      exercises={filteredLegacy}
      selectedExerciseIds={selectedExerciseIds}
      onToggleExercise={toggleExerciseSelection}
      onExerciseInfo={handleExerciseInfo}
      onBackToList={handleBackToList}
      onCreateExercise={handleCreateExercise}
      currentView={currentView}
      selectedExercise={selectedExercise}
      isLoading={showLoader}
      existingExerciseIds={existingExerciseIds}
    />
  );
}

// Presenter Component - Handles UI rendering
interface AddExercisePopoverPresenterProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onAddExercises: () => void;
  readonly onAddSuperset: () => void;
  readonly searchQuery: string;
  readonly onSearchChange: (query: string) => void;

  readonly exercises: any[];
  readonly selectedExerciseIds: string[];
  readonly onToggleExercise: (id: string) => void;
  readonly onExerciseInfo: (id: string) => void;
  readonly onBackToList: () => void;
  readonly onCreateExercise: () => void;
  readonly currentView: "list" | "details";

  readonly selectedExercise: any;
  readonly isLoading: boolean;
  readonly existingExerciseIds: string[];
}

function AddExercisePopoverPresenter({
  visible,
  onClose,
  onAddExercises,
  onAddSuperset,
  searchQuery,
  onSearchChange,
  exercises,
  selectedExerciseIds,
  onToggleExercise,
  onExerciseInfo,
  onBackToList,
  onCreateExercise,
  currentView,
  selectedExercise,
  isLoading,
  existingExerciseIds,
}: AddExercisePopoverPresenterProps) {
  const hasAtLeastOne = selectedExerciseIds.length >= 1;
  const hasAtLeastTwo = selectedExerciseIds.length >= 2;

  // Full-screen slide-up modal — matches the create-workout modal's
  // presentation (stack-modal, slide animation) so the picker feels
  // like a navigational push within the modal flow rather than a
  // disconnected overlay. Header gets a back arrow (returns to the
  // creator/editor) instead of an X close.
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
              testID="details-back-button"
            >
              <Ionicons
                name="arrow-back"
                size={24}
                color={Colors.text.primary}
              />
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
    >
      <SafeAreaView style={styles.modalSafeArea} edges={["top"]}>
        {/* Sticky header — back arrow on the left (returns to the
            workout creator / editor), title centered, Create CTA on
            the right. */}
        <View style={styles.modalHeader}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.backButton}
            testID="close-button"
          >
            <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Add Exercises</Text>
          <TouchableOpacity
            onPress={onCreateExercise}
            style={styles.createButton}
            testID="create-exercise-button"
          >
            <Text style={styles.createButtonText}>Create</Text>
          </TouchableOpacity>
        </View>

        {/* Sticky search bar */}
        <View style={styles.searchWrapper}>
          <View style={styles.searchContainer}>
            <Ionicons
              name="search"
              size={20}
              color={Colors.text.secondary}
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search exercises..."
              placeholderTextColor={Colors.text.tertiary}
              value={searchQuery}
              onChangeText={onSearchChange}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => onSearchChange("")}
                style={styles.clearButton}
                testID="clear-search-button"
              >
                <Ionicons
                  name="close-circle"
                  size={20}
                  color={Colors.text.secondary}
                />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Scrollable list — fills the remaining vertical space
            between the sticky search bar and the sticky footer. */}
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

        {/* Sticky footer — Add + Superset CTAs */}
        <View style={styles.modalFooter}>
          <TouchableOpacity
            style={[
              styles.footerButton,
              !hasAtLeastOne && styles.footerButtonDisabled,
            ]}
            onPress={onAddExercises}
            disabled={!hasAtLeastOne}
            testID="add-exercises-button"
          >
            <Text
              style={[
                styles.footerButtonText,
                !hasAtLeastOne && styles.footerButtonTextDisabled,
              ]}
            >
              Add
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.footerButton,
              !hasAtLeastTwo && styles.footerButtonDisabled,
            ]}
            onPress={onAddSuperset}
            disabled={!hasAtLeastTwo}
            testID="add-superset-button"
          >
            <Text
              style={[
                styles.footerButtonText,
                !hasAtLeastTwo && styles.footerButtonTextDisabled,
              ]}
            >
              Superset
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

export const AddExercisePopover = AddExercisePopoverContainer;
