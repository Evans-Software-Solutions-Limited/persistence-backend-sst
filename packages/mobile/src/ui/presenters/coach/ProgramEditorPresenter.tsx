import { useState } from "react";
import { Pressable, ScrollView, TextInput } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation/Btn";
import { Card } from "@/ui/components/foundation/Card";
import { HeaderBar } from "@/ui/components/foundation/HeaderBar";
import { IconBtn } from "@/ui/components/foundation/IconBtn";
import { Pill } from "@/ui/components/foundation/Pill";
import { Segmented } from "@/ui/components/foundation/Segmented";
import { BottomSheet } from "@/ui/components/foundation/BottomSheet";
import {
  IconBack,
  IconChevronD,
  IconChevronUp,
  IconPlus,
  IconTrash,
} from "@/ui/components/icons";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import type { ApiError } from "@/shared/errors";
import type { ProgramAssignmentEntry } from "@/domain/models/program";

/**
 * <ProgramEditorPresenter> — create/edit a programme (specs/19-programs
 * STORY-001). No prototype screen exists for the editor (audit-confirmed), so
 * this is a clean, on-brand composition of the foundation primitives per the
 * spec's field list — NOT a re-skin of an existing screen.
 *
 * Metadata (name, description, Fixed-weeks|Ongoing duration, days/wk stepper) →
 * the ordered workout cycle (add via picker, up/down reorder, remove,
 * duplicates allowed) → (edit mode) the assigned-clients list + "Assign to
 * client" CTA. A "changes apply to future weeks" note surfaces the v1
 * materialisation policy (AC 1.4).
 *
 * Pure presentational: all form state + async are owned by the container; the
 * only local state here is the workout-picker sheet's open flag (view state,
 * mirroring ClientsListPresenter's legend toggle).
 */

const INPUT_STYLE = {
  minHeight: 44,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: "#232735",
  backgroundColor: "#1A1D29",
  paddingHorizontal: 14,
  paddingVertical: 10,
  color: "#F4F4F8",
  fontSize: 14,
} as const;

export type EditorWorkout = { workoutId: string; name: string };

export type ProgramEditorPresenterProps = {
  mode: "create" | "edit";
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  durationMode: "fixed" | "ongoing";
  onDurationModeChange: (m: "fixed" | "ongoing") => void;
  /** Weeks when durationMode === "fixed". */
  durationWeeks: number;
  onDurationWeeksChange: (n: number) => void;
  daysPerWeek: number;
  onDaysPerWeekChange: (n: number) => void;

  workouts: EditorWorkout[];
  onMoveWorkout: (index: number, dir: -1 | 1) => void;
  onRemoveWorkout: (index: number) => void;
  /** The coach's own workouts (+ public) for the add picker. */
  availableWorkouts: { id: string; name: string }[];
  onAddWorkout: (id: string, name: string) => void;

  /** Edit mode only. */
  assignments?: ProgramAssignmentEntry[];
  onAssignClient?: () => void;

  onSave: () => void;
  saving: boolean;
  saveError?: string | null;
  canSave: boolean;

  onDelete?: () => void;
  deleting?: boolean;

  onBack: () => void;
  /** Edit-mode initial detail fetch. */
  isLoading?: boolean;
  loadError?: ApiError | null;
  onRetryLoad?: () => void;
  testID?: string;
};

function SectionLabel({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$display"
      fontSize={10.5}
      fontWeight="600"
      letterSpacing={1.7}
      textTransform="uppercase"
      color="$text3"
    >
      {children}
    </Text>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
  testID,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  testID?: string;
}) {
  const step = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta));
    if (next !== value) onChange(next);
  };
  return (
    <View flexDirection="row" alignItems="center" gap={12} testID={testID}>
      <StepBtn
        label="−"
        disabled={value <= min}
        onPress={() => step(-1)}
        testID={`${testID}-dec`}
      />
      <Text
        fontFamily="$mono"
        fontSize={16}
        fontWeight="700"
        color="$text"
        minWidth={24}
        textAlign="center"
      >
        {value}
      </Text>
      <StepBtn
        label="+"
        disabled={value >= max}
        onPress={() => step(1)}
        testID={`${testID}-inc`}
      />
    </View>
  );
}

function StepBtn({
  label,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label === "+" ? "Increase" : "Decrease"}
      testID={testID}
      style={({ pressed }) => ({
        opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
      })}
    >
      <View
        width={34}
        height={34}
        borderRadius={10}
        borderWidth={1}
        borderColor="$border2"
        backgroundColor="$surface2"
        alignItems="center"
        justifyContent="center"
      >
        <Text
          fontFamily="$display"
          fontSize={20}
          fontWeight="700"
          color="$text2"
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

export function ProgramEditorPresenter(props: ProgramEditorPresenterProps) {
  const {
    mode,
    name,
    onNameChange,
    description,
    onDescriptionChange,
    durationMode,
    onDurationModeChange,
    durationWeeks,
    onDurationWeeksChange,
    daysPerWeek,
    onDaysPerWeekChange,
    workouts,
    onMoveWorkout,
    onRemoveWorkout,
    availableWorkouts,
    onAddWorkout,
    assignments = [],
    onAssignClient,
    onSave,
    saving,
    saveError,
    canSave,
    onDelete,
    deleting,
    onBack,
    isLoading,
    loadError,
    onRetryLoad,
    testID,
  } = props;

  const insets = useSafeAreaInsets();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (isLoading) {
    return (
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        testID="program-editor-loader"
      >
        <PLogoDrawLoader />
      </View>
    );
  }
  if (loadError) {
    return (
      <View flex={1} testID="program-editor-error">
        <ErrorState
          message="Couldn't load this programme."
          onRetry={onRetryLoad ?? onBack}
        />
      </View>
    );
  }

  return (
    <View flex={1} paddingTop={insets.top} testID={testID}>
      <HeaderBar
        title={mode === "create" ? "New programme" : "Edit programme"}
        leading={
          <IconBtn
            icon={<IconBack size={20} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Back"
            testID="program-editor-back"
          />
        }
      />

      <ScrollView
        testID="program-editor-scroll"
        contentContainerStyle={{ paddingBottom: 160, paddingHorizontal: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View gap={16}>
          {/* Metadata. */}
          <View gap={8}>
            <SectionLabel>Name</SectionLabel>
            <TextInput
              value={name}
              onChangeText={onNameChange}
              placeholder="e.g. Strength Foundations"
              placeholderTextColor="#8A8A98"
              testID="program-name"
              style={INPUT_STYLE}
            />
          </View>

          <View gap={8}>
            <SectionLabel>Description</SectionLabel>
            <TextInput
              value={description}
              onChangeText={onDescriptionChange}
              placeholder="Optional — a short line clients will see"
              placeholderTextColor="#8A8A98"
              multiline
              testID="program-description"
              style={INPUT_STYLE}
            />
          </View>

          <View gap={8}>
            <SectionLabel>Duration</SectionLabel>
            <Segmented
              options={["Fixed weeks", "Ongoing"]}
              value={durationMode === "fixed" ? "Fixed weeks" : "Ongoing"}
              onChange={(v) =>
                onDurationModeChange(v === "Fixed weeks" ? "fixed" : "ongoing")
              }
              accent="trainer"
              testID="program-duration-mode"
            />
            {durationMode === "fixed" ? (
              <View
                flexDirection="row"
                alignItems="center"
                gap={10}
                marginTop={4}
              >
                <TextInput
                  value={String(durationWeeks)}
                  onChangeText={(t) => {
                    const n = parseInt(t.replace(/[^0-9]/g, ""), 10);
                    onDurationWeeksChange(Number.isFinite(n) ? n : 0);
                  }}
                  keyboardType="number-pad"
                  testID="program-duration-weeks"
                  style={{ ...INPUT_STYLE, width: 80, textAlign: "center" }}
                />
                <Text fontFamily="$body" fontSize={13} color="$text3">
                  weeks
                </Text>
              </View>
            ) : (
              <Text
                fontFamily="$body"
                fontSize={12}
                color="$text3"
                marginTop={2}
              >
                Runs indefinitely — sessions roll forward automatically.
              </Text>
            )}
          </View>

          <View
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <SectionLabel>Days per week</SectionLabel>
            <Stepper
              value={daysPerWeek}
              min={1}
              max={7}
              onChange={onDaysPerWeekChange}
              testID="program-days"
            />
          </View>

          {/* Workout cycle. */}
          <View gap={8}>
            <View
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <SectionLabel>Workouts</SectionLabel>
              <Text fontFamily="$body" fontSize={11} color="$text3">
                Repeats as a cycle
              </Text>
            </View>

            {workouts.length === 0 ? (
              <Text fontFamily="$body" fontSize={13} color="$text3">
                No workouts yet — add at least one to assign this programme.
              </Text>
            ) : (
              <View gap={8}>
                {workouts.map((w, i) => (
                  <Card
                    key={`${w.workoutId}-${i}`}
                    pad={12}
                    radius={12}
                    testID={`editor-workout-${i}`}
                  >
                    <View flexDirection="row" alignItems="center" gap={10}>
                      <Text
                        fontFamily="$mono"
                        fontSize={12}
                        color="$text3"
                        minWidth={20}
                      >
                        {i + 1}
                      </Text>
                      <Text
                        flex={1}
                        fontFamily="$display"
                        fontWeight="600"
                        fontSize={14}
                        color="$text"
                        numberOfLines={1}
                      >
                        {w.name}
                      </Text>
                      <IconBtn
                        icon={<IconChevronUp size={16} />}
                        tone="ghost"
                        size={30}
                        disabled={i === 0}
                        onPress={() => onMoveWorkout(i, -1)}
                        accessibilityLabel="Move up"
                        testID={`editor-workout-${i}-up`}
                      />
                      <IconBtn
                        icon={<IconChevronD size={16} />}
                        tone="ghost"
                        size={30}
                        disabled={i === workouts.length - 1}
                        onPress={() => onMoveWorkout(i, 1)}
                        accessibilityLabel="Move down"
                        testID={`editor-workout-${i}-down`}
                      />
                      <IconBtn
                        icon={<IconTrash size={16} />}
                        tone="ghost"
                        size={30}
                        onPress={() => onRemoveWorkout(i)}
                        accessibilityLabel="Remove workout"
                        testID={`editor-workout-${i}-remove`}
                      />
                    </View>
                  </Card>
                ))}
              </View>
            )}

            <Pressable
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Add workout"
              testID="editor-add-workout"
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <View
                paddingVertical={12}
                borderRadius={12}
                borderWidth={1.5}
                borderColor="$border2"
                alignItems="center"
                justifyContent="center"
                flexDirection="row"
                gap={8}
                style={{ borderStyle: "dashed" }}
              >
                <IconPlus size={14} strokeWidth={2.5} color="#A78BFA" />
                <Text
                  fontFamily="$display"
                  fontWeight="600"
                  fontSize={13}
                  color="$accentTrainer"
                >
                  Add workout
                </Text>
              </View>
            </Pressable>

            <Text fontFamily="$body" fontSize={11} color="$text3">
              Changes apply to future weeks only — already-scheduled sessions
              stay as they are.
            </Text>
          </View>

          {/* Assignments (edit mode). */}
          {mode === "edit" ? (
            <View gap={8}>
              <SectionLabel>Clients</SectionLabel>
              {assignments.length === 0 ? (
                <Text fontFamily="$body" fontSize={13} color="$text3">
                  Not assigned to anyone yet.
                </Text>
              ) : (
                <View gap={8}>
                  {assignments.map((a) => (
                    <Card
                      key={a.id}
                      pad={12}
                      radius={12}
                      testID={`editor-assignment-${a.id}`}
                    >
                      <View flexDirection="row" alignItems="center" gap={10}>
                        <Text
                          flex={1}
                          fontFamily="$display"
                          fontWeight="600"
                          fontSize={14}
                          color="$text"
                          numberOfLines={1}
                        >
                          {a.clientName}
                        </Text>
                        <Text fontFamily="$mono" fontSize={12} color="$text3">
                          {a.endDate
                            ? `Wk ${a.currentWeek}`
                            : `Wk ${a.currentWeek} · Ongoing`}
                        </Text>
                        <Pill
                          tone={
                            a.status === "assigned" || a.status === "started"
                              ? "success"
                              : "neutral"
                          }
                          size="xs"
                        >
                          {a.status.toUpperCase()}
                        </Pill>
                      </View>
                    </Card>
                  ))}
                </View>
              )}
              <Btn
                variant="soft"
                tone="trainer"
                onPress={onAssignClient ?? (() => {})}
                testID="editor-assign-client"
              >
                Assign to client
              </Btn>
            </View>
          ) : null}

          {saveError ? (
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$error"
              testID="program-save-error"
            >
              {saveError}
            </Text>
          ) : null}

          <Btn
            variant="filled"
            tone="trainer"
            disabled={!canSave || saving}
            onPress={onSave}
            testID="program-save"
          >
            {saving
              ? "Saving…"
              : mode === "create"
                ? "Create programme"
                : "Save changes"}
          </Btn>

          {mode === "edit" && onDelete ? (
            <Btn
              variant="ghost"
              tone="error"
              disabled={deleting}
              onPress={onDelete}
              testID="program-delete"
            >
              {deleting ? "Deleting…" : "Delete programme"}
            </Btn>
          ) : null}
        </View>
      </ScrollView>

      {/* Workout picker. */}
      <BottomSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Add a workout"
        accent="trainer"
        height="default"
      >
        <View gap={8} testID="editor-workout-picker">
          {availableWorkouts.length === 0 ? (
            <Text fontFamily="$body" fontSize={13} color="$text3">
              No workouts to add — create one from the Train tab first.
            </Text>
          ) : (
            availableWorkouts.map((w) => (
              <Pressable
                key={w.id}
                onPress={() => {
                  onAddWorkout(w.id, w.name);
                  setPickerOpen(false);
                }}
                accessibilityRole="button"
                testID={`picker-workout-${w.id}`}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <View
                  padding={12}
                  borderRadius={12}
                  borderWidth={1}
                  borderColor="$border"
                  backgroundColor="$surface2"
                >
                  <Text
                    fontFamily="$display"
                    fontWeight="600"
                    fontSize={14}
                    color="$text"
                    numberOfLines={1}
                  >
                    {w.name}
                  </Text>
                </View>
              </Pressable>
            ))
          )}
        </View>
      </BottomSheet>
    </View>
  );
}
