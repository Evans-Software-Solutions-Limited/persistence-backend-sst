import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useUserMode } from "@/state/user-mode";
import { useAssignProgramSheet } from "@/state/assign-program-sheet";
import {
  ProgramEditorPresenter,
  type EditorWorkout,
} from "@/ui/presenters/coach/ProgramEditorPresenter";
import type { ApiError } from "@/shared/errors";
import type { ProgramApiError } from "@/domain/ports/api.port";
import type {
  ProgramAssignmentEntry,
  ProgramDetail,
} from "@/domain/models/program";

/**
 * Coach programme create/edit container (specs/19-programs STORY-001).
 * `programId` present ⇒ edit mode (fetch detail, show assignments, allow
 * delete); absent ⇒ create mode. Backing both are the sibling routes
 * `app/(app)/programs/create.tsx` + `[id].tsx`.
 *
 * Coach writes are DIRECT online calls (create/update/delete) — not queued.
 * Edit-mode form state is seeded from the async detail via a REF-GUARDED
 * one-shot effect keyed on the fetched payload (never `useState(initializer)`
 * — the detail isn't available at first render, and re-seeding on every render
 * would stomp the coach's edits: a recurring bug class).
 *
 * Mode gate: a non-coach who deep-links here is redirected to the tabs index.
 */

function mapSaveError(error: ProgramApiError | ApiError): string {
  const code = (error as ProgramApiError).programCode;
  if (code === "invalid_workouts") {
    return "Every workout must be your own or a public one.";
  }
  if (code === "not_found") {
    return "This programme no longer exists.";
  }
  return "Couldn't save the programme. Please try again.";
}

export function ProgramEditorContainer({ programId }: { programId?: string }) {
  const { api } = useAdapters();
  const mode: "create" | "edit" = programId ? "edit" : "create";
  const userMode = useUserMode((s) => s.mode);
  const openAssignSheet = useAssignProgramSheet((s) => s.openSheet);

  // Mode gate — coach-only surface (specs/19-programs risk table).
  useEffect(() => {
    if (userMode !== "coach") {
      router.replace("/(app)/(tabs)");
    }
  }, [userMode]);

  // Form state.
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [durationMode, setDurationMode] = useState<"fixed" | "ongoing">(
    "fixed",
  );
  const [durationWeeks, setDurationWeeks] = useState(8);
  const [daysPerWeek, setDaysPerWeek] = useState(3);
  const [workouts, setWorkouts] = useState<EditorWorkout[]>([]);
  const [assignments, setAssignments] = useState<ProgramAssignmentEntry[]>([]);

  // Async: edit-mode detail fetch.
  const [isLoading, setIsLoading] = useState(mode === "edit");
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [availableWorkouts, setAvailableWorkouts] = useState<
    { id: string; name: string }[]
  >([]);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const seededRef = useRef(false);

  const applyDetail = useCallback((detail: ProgramDetail) => {
    setName(detail.name);
    setDescription(detail.description ?? "");
    setDurationMode(detail.durationWeeks === null ? "ongoing" : "fixed");
    setDurationWeeks(detail.durationWeeks ?? 8);
    setDaysPerWeek(detail.daysPerWeek);
    setWorkouts(
      detail.workouts.map((w) => ({ workoutId: w.workoutId, name: w.name })),
    );
    setAssignments(detail.assignments);
  }, []);

  const loadDetail = useCallback(async () => {
    if (!programId) return;
    setLoadError(null);
    const result = await api.getProgram(programId);
    if (result.ok) {
      // Ref-guarded one-shot seed: only hydrate the editable form the FIRST
      // time detail arrives, so a later refetch (post-assign) refreshes the
      // assignments list without discarding in-progress metadata edits.
      if (!seededRef.current) {
        seededRef.current = true;
        applyDetail(result.value);
      } else {
        setAssignments(result.value.assignments);
      }
    } else {
      setLoadError(result.error);
    }
    setIsLoading(false);
  }, [api, programId, applyDetail]);

  useEffect(() => {
    if (mode === "edit") void loadDetail();
  }, [mode, loadDetail]);

  // Available workouts for the picker (the coach's own + public).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await api.getWorkouts({ type: "mine" });
      if (alive && result.ok) {
        setAvailableWorkouts(
          result.value.workouts.map((w) => ({ id: w.id, name: w.name })),
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [api]);

  const onMoveWorkout = useCallback((index: number, dir: -1 | 1) => {
    setWorkouts((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const onRemoveWorkout = useCallback((index: number) => {
    setWorkouts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const onAddWorkout = useCallback((id: string, workoutName: string) => {
    // Duplicates are allowed — the same workout may repeat in a cycle.
    setWorkouts((prev) => [...prev, { workoutId: id, name: workoutName }]);
  }, []);

  const canSave =
    name.trim().length > 0 &&
    daysPerWeek >= 1 &&
    daysPerWeek <= 7 &&
    (durationMode === "ongoing" || durationWeeks >= 1);

  const onSave = useCallback(async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setSaveError(null);
    const payload = {
      name: name.trim(),
      description: description.trim() === "" ? null : description.trim(),
      durationWeeks: durationMode === "ongoing" ? null : durationWeeks,
      daysPerWeek,
      workoutIds: workouts.map((w) => w.workoutId),
    };

    if (mode === "create") {
      const result = await api.createProgram(payload);
      setSaving(false);
      if (result.ok) {
        // Land on the new programme's editor so the coach can assign it.
        router.replace(`/(app)/programs/${result.value.id}`);
      } else {
        setSaveError(mapSaveError(result.error));
      }
      return;
    }

    const result = await api.updateProgram(programId as string, payload);
    setSaving(false);
    if (result.ok) {
      applyDetail(result.value);
    } else {
      setSaveError(mapSaveError(result.error));
    }
  }, [
    api,
    canSave,
    saving,
    mode,
    name,
    description,
    durationMode,
    durationWeeks,
    daysPerWeek,
    workouts,
    programId,
    applyDetail,
  ]);

  const onDelete = useCallback(async () => {
    if (!programId || deleting) return;
    setDeleting(true);
    const result = await api.deleteProgram(programId);
    setDeleting(false);
    if (result.ok) {
      router.back();
      return;
    }
    if (result.error.programCode === "PROGRAM_HAS_LIVE_ASSIGNMENTS") {
      Alert.alert(
        "Can't delete yet",
        "Unassign all clients before deleting this programme.",
      );
      return;
    }
    Alert.alert("Error", "Couldn't delete the programme. Please try again.");
  }, [api, programId, deleting]);

  const onAssignClient = useCallback(() => {
    if (!programId) return;
    openAssignSheet(programId, () => {
      void loadDetail();
    });
  }, [programId, openAssignSheet, loadDetail]);

  return (
    <ProgramEditorPresenter
      mode={mode}
      name={name}
      onNameChange={setName}
      description={description}
      onDescriptionChange={setDescription}
      durationMode={durationMode}
      onDurationModeChange={setDurationMode}
      durationWeeks={durationWeeks}
      onDurationWeeksChange={setDurationWeeks}
      daysPerWeek={daysPerWeek}
      onDaysPerWeekChange={setDaysPerWeek}
      workouts={workouts}
      onMoveWorkout={onMoveWorkout}
      onRemoveWorkout={onRemoveWorkout}
      availableWorkouts={availableWorkouts}
      onAddWorkout={onAddWorkout}
      assignments={assignments}
      onAssignClient={onAssignClient}
      onSave={onSave}
      saving={saving}
      saveError={saveError}
      canSave={canSave}
      onDelete={mode === "edit" ? onDelete : undefined}
      deleting={deleting}
      onBack={() => router.back()}
      isLoading={isLoading}
      loadError={loadError}
      onRetryLoad={() => void loadDetail()}
      testID="program-editor"
    />
  );
}
