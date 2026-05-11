/**
 * AddExerciseToSupersetPopover — the "Add Exercise to Superset" picker
 * for the active session.
 *
 * Single-select + one "Add" button — distinct from the multi-select
 * `AddExercisePopover` (which serves fresh adds + creating a new
 * superset). The two are intentionally separate components because
 * they have different selection semantics and different footer
 * surfaces; the container routes between them by `pickerMode.kind`.
 * Reuses `AddExerciseList`, `ExerciseDetailsModal`, and the shared
 * picker-row mapping from `../AddExercisePopover` so the row contract
 * stays in one place.
 *
 * Spec: specs/05-active-session/requirements.md STORY-005
 *       Modelled on the persistence-mobile reference repo's
 *       `AddExerciseToSupersetView` (single-select picker), used for
 *       structural reference only — the V2 implementation here owns
 *       the surface going forward.
 */

import { Colors } from "@/ui/theme/workoutsLegacyTheme";
import { useAdapters } from "@/ui/hooks/useAdapters";
import {
  getExercisesQuery,
  refreshExerciseCache,
} from "@/application/queries/exercises.query";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  ScrollView,
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

export type AddExerciseToSupersetPopoverProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  /**
   * Fires with the single picked exercise wrapped in an array so the
   * dispatcher (`applyPickerSelection`) can reuse its `rows` loop —
   * matches `AddExercisePopover.onAddExercises` shape and keeps the
   * picker-routing wiring uniform across modes.
   */
  readonly onAddExercise: (rows: any[]) => void;
  /**
   * Exercise ids already in the target superset group. Forwarded to
   * `AddExerciseList` so peers already in the group render disabled —
   * the user can still add a duplicate of a non-superset row, but
   * can't re-add a peer already in the group.
   */
  readonly existingExerciseIds?: readonly string[];
};

function AddExerciseToSupersetPopoverContainer({
  visible,
  onClose,
  onAddExercise,
  existingExerciseIds = [],
}: AddExerciseToSupersetPopoverProps) {
  const { api, storage } = useAdapters();

  const [searchQuery, setSearchQuery] = useState("");
  // Single-select: one id or null. Tapping the same id again
  // deselects (legacy AddExerciseToSupersetView lines 37-40).
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

  const allRows = useMemo(
    () => enrichedExercises.map(toPickerExerciseRow),
    [enrichedExercises],
  );

  // Same 100-row display ceiling as AddExercisePopover — the picker
  // would otherwise render the full library uncondensed.
  const PICKER_DISPLAY_LIMIT = 100;

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const matched =
      q.length === 0
        ? allRows
        : allRows.filter((ex) => ex.name.toLowerCase().includes(q));
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

  // Single-select toggle: tapping a different exercise replaces the
  // selection; tapping the currently-selected one clears it.
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
  // the next open. Called from BOTH handleClose AND handleAddClick
  // for parity.
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

  const handleAddClick = () => {
    if (!selectedExerciseId) return;
    const exercise = allRows.find((ex) => ex.id === selectedExerciseId);
    if (!exercise) return;
    // Wrap in an array so the container's `applyPickerSelection`
    // dispatcher (which iterates `rows`) handles this uniformly with
    // the multi-select Add flow. Single-element loop = single
    // addExerciseCommand call with the mode's supersetGroup.
    onAddExercise([exercise]);
    resetInternalState();
  };

  return (
    <AddExerciseToSupersetPopoverPresenter
      visible={visible}
      onClose={handleClose}
      onAdd={handleAddClick}
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
    />
  );
}

type AddExerciseToSupersetPopoverPresenterProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly onAdd: () => void;
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
};

function AddExerciseToSupersetPopoverPresenter({
  visible,
  onClose,
  onAdd,
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
}: AddExerciseToSupersetPopoverPresenterProps) {
  const hasSelection = selectedExerciseId !== null;
  // AddExerciseList accepts an `selectedExerciseIds: string[]` array;
  // adapt the single-select shape inline.
  const selectedExerciseIds = useMemo(
    () => (selectedExerciseId ? [selectedExerciseId] : []),
    [selectedExerciseId],
  );

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
              testID="superset-picker-details-back"
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
      testID="superset-picker-modal"
    >
      <SafeAreaView style={styles.modalSafeArea} edges={["top"]}>
        <View style={styles.modalHeader}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.backButton}
            testID="superset-picker-close"
          >
            <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Add to Superset</Text>
          {/* No "Create" CTA in this flow — adding to a superset is a
              quick action; the user creates new exercises elsewhere. */}
          <View style={styles.headerSpacer} />
        </View>

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
              testID="superset-picker-search"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity
                onPress={() => onSearchChange("")}
                style={styles.clearButton}
                testID="superset-picker-clear-search"
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

        {/* Single Add button — disabled until exactly one row is
            selected. Legacy AddExerciseToSupersetView line 132-138. */}
        <View style={styles.modalFooter}>
          <TouchableOpacity
            style={[
              styles.footerButton,
              !hasSelection && styles.footerButtonDisabled,
            ]}
            onPress={onAdd}
            disabled={!hasSelection}
            testID="superset-picker-add"
          >
            <Text
              style={[
                styles.footerButtonText,
                !hasSelection && styles.footerButtonTextDisabled,
              ]}
            >
              Add
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

export const AddExerciseToSupersetPopover =
  AddExerciseToSupersetPopoverContainer;
