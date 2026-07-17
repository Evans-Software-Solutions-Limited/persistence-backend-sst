import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { color } from "@/ui/theme/tokens";
import type { Workout } from "@/domain/models/workout";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

/**
 * Coach Workout library (pure presenter). Lists every workout the coach has
 * authored — UNFILTERED (unlike their personal My Workouts, which hides
 * client-authored workouts). A "Create workout" CTA opens the creator in
 * coach context; tapping a row edits it (also coach context). Workouts hidden
 * from the coach's personal library get a quiet marker so the state is legible.
 *
 * `embedded` (specs/24-coach-authoring § B.3): when rendered as the Workouts
 * body of the coach library hub, drops the SafeAreaView top edge + the
 * back-button header row (the hub owns that chrome) and renders the create
 * CTA + list/empty/error inside a plain `View`; `onBack` is unused in this
 * mode. Not embedded (the standalone `workouts/library.tsx` route): unchanged.
 *
 * Spec: specs/milestones/WORKOUT-AUTHORING-V2/design.md § 11
 *       specs/24-coach-authoring/design.md § B.3
 */

export interface CoachWorkoutLibraryPresenterProps {
  readonly workouts: readonly Workout[];
  readonly isLoading: boolean;
  readonly isRefreshing: boolean;
  readonly error: string | null;
  readonly onBack: () => void;
  readonly onCreate: () => void;
  readonly onOpen: (workoutId: string) => void;
  readonly onRefresh: () => void;
  readonly embedded?: boolean;
}

export function CoachWorkoutLibraryPresenter({
  workouts,
  isLoading,
  isRefreshing,
  error,
  onBack,
  onCreate,
  onOpen,
  onRefresh,
  embedded = false,
}: CoachWorkoutLibraryPresenterProps) {
  const content = (
    <>
      {isLoading && workouts.length === 0 ? (
        <View style={styles.centre} testID="coach-library-loading">
          <PLogoDrawLoader />
          <Text style={styles.centreText}>Loading your workouts…</Text>
        </View>
      ) : error && workouts.length === 0 ? (
        <View style={styles.centre} testID="coach-library-error">
          <Ionicons
            name="alert-circle-outline"
            size={48}
            color={color.$error}
          />
          <Text style={styles.errorTitle}>Couldn&apos;t load workouts</Text>
          <Text style={styles.centreText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={onRefresh}
            testID="coach-library-retry"
          >
            <Text style={styles.retryButtonText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
          }
        >
          {/* Embedded in the hub, the hub's top-right contextual action owns
              "Create workout" — suppress this body CTA so it isn't duplicated
              (specs/24-coach-authoring § B.3). Standalone (deep-link route) has
              no hub chrome, so it keeps its own create button. */}
          {!embedded ? (
            <TouchableOpacity
              style={styles.createButton}
              onPress={onCreate}
              testID="coach-library-create"
            >
              <Ionicons name="add" size={20} color={color.$primary} />
              <Text style={styles.createButtonText}>Create workout</Text>
            </TouchableOpacity>
          ) : null}

          {workouts.length === 0 ? (
            <View style={styles.emptyBlock} testID="coach-library-empty">
              <Ionicons name="barbell-outline" size={44} color={color.$text3} />
              <Text style={styles.emptyTitle}>No workouts yet</Text>
              <Text style={styles.emptyMessage}>
                Build a workout to assign to your clients or keep for yourself.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {workouts.map((w) => (
                <TouchableOpacity
                  key={w.id}
                  style={styles.row}
                  onPress={() => onOpen(w.id)}
                  testID={`coach-library-row-${w.id}`}
                  activeOpacity={0.85}
                >
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {w.name}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {w.exercises.length} exercise
                      {w.exercises.length === 1 ? "" : "s"}
                      {w.showInOwnerLibrary ? "" : " · Hidden from my workouts"}
                    </Text>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={20}
                    color={color.$text3}
                  />
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </>
  );

  if (embedded) {
    // The hub owns chrome (top inset + title) — render just the content.
    return <View style={styles.safeArea}>{content}</View>;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onBack}
          style={styles.iconButton}
          testID="coach-library-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={color.$text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          Workout library
        </Text>
        <View style={styles.headerSpacer} />
      </View>
      {content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: color.$bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: color.$surface3,
  },
  iconButton: {
    padding: 8,
    minWidth: 40,
  },
  headerTitle: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  headerSpacer: {
    width: 40,
  },
  centre: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  centreText: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
    color: color.$text2,
    marginTop: 16,
    textAlign: "center",
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 28,
    color: color.$text,
    marginTop: 16,
    marginBottom: 8,
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: color.$primary,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  retryButtonText: {
    fontSize: 14,
    lineHeight: 20,
    color: color.$text,
    fontWeight: "600",
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  createButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: color.$primary,
    backgroundColor: color.$primary + "14",
    borderRadius: 12,
    paddingVertical: 14,
  },
  createButtonText: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$primary,
    fontWeight: "600",
  },
  list: {
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: color.$surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: color.$surface3,
    padding: 16,
  },
  rowInfo: {
    flex: 1,
    minWidth: 0,
  },
  rowName: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "600",
  },
  rowMeta: {
    fontWeight: "400",
    lineHeight: 20,
    fontSize: 12,
    color: color.$text3,
    marginTop: 2,
  },
  emptyBlock: {
    alignItems: "center",
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 28,
    color: color.$text,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyMessage: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
    color: color.$text2,
    textAlign: "center",
  },
});
