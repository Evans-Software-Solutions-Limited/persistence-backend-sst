import { randomUUID } from "expo-crypto";
import { type ReactNode, useRef, useState } from "react";
import {
  ScrollView,
  Text as NativeText,
  View as NativeView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { styles as exerciseStyles } from "@/ui/components/session/SessionExerciseCard/styles";
import { styles as headerStyles } from "@/ui/components/session/SessionHeader/styles";
import { IconDumbbell } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation/Btn";
import { SetLogger } from "@/ui/components/session/SetLogger";
import type { ExerciseSet } from "@/domain/models/session";
import type { TogetherSharedSnapshot } from "@/domain/ports/togetherShared.port";

/** A recipient view never reads the viewer's own history or personal draft. */
export function TogetherPartnerPresenter(p: {
  snapshot: TogetherSharedSnapshot;
  ownerId: string;
  accountId: string;
  exerciseNames: Readonly<Record<string, string>>;
  togetherRow?: ReactNode;
  onMine(): void;
  onOperation(
    operation: Record<string, unknown>,
    observedRevision: number,
  ): Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const plan = p.snapshot.athletePlans[p.ownerId];
  const progress = p.snapshot.progress.find((row) => row.userId === p.ownerId);
  const privateExercises = plan?.exercises.length
    ? [
        ...plan.exercises,
        ...(progress?.exercises.filter(
          (ex) =>
            !plan.exercises.some((e) => e.planExerciseId === ex.planExerciseId),
        ) ?? []),
      ]
    : (progress?.exercises ?? []);
  const owner = p.snapshot.profiles[p.ownerId] ?? "Training partner";
  const grant = p.snapshot.grants.find(
    (g) => g.ownerId === p.ownerId && g.recipientId === p.accountId,
  );
  const projection = grant?.consent.numbers
    ? p.snapshot.athletes.find((a) => a.userId === p.ownerId)
    : undefined;
  const mayLog = !!(
    projection &&
    grant?.consent.numbers &&
    grant.consent.logging
  );
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="together-partner-safe-area"
    >
      <NativeView style={headerStyles.container}>
        <View flex={1} gap={4}>
          <NativeText style={headerStyles.workoutName}>
            {plan?.name ?? "Partner workout"}
          </NativeText>
          <Text color="$text2" fontFamily="$body" fontSize={12}>
            {owner} · {mayLog && editing ? "Partner logging" : "Read-only"}
          </Text>
        </View>
        {mayLog && (
          <Btn size="sm" variant="soft" onPress={() => setEditing(!editing)}>
            {editing ? "Read only" : `Log for ${owner}`}
          </Btn>
        )}
        <Btn size="sm" variant="ghost" onPress={p.onMine}>
          Mine
        </Btn>
      </NativeView>
      {p.togetherRow}
      <ScrollView
        testID="together-partner-view"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 24 + insets.bottom,
          gap: 16,
        }}
      >
        {!projection ? (
          <View gap={12}>
            <Text color="$text2">
              {grant?.consent.numbers
                ? "Waiting for live values."
                : "Numbers are private. Workout progress is shared."}
            </Text>
            {privateExercises.map((ex, index) => {
              const planned = plan?.exercises.find(
                (e) => e.planExerciseId === ex.planExerciseId,
              );
              const current = progress?.exercises.find(
                (e) => e.planExerciseId === ex.planExerciseId,
              );
              return (
                <NativeView
                  style={exerciseStyles.exerciseRow}
                  key={ex.planExerciseId}
                >
                  <ExerciseHeading
                    name={
                      planned
                        ? (p.exerciseNames[planned.exerciseId] ??
                          `Exercise ${index + 1}`)
                        : `Exercise ${index + 1}`
                    }
                  />
                  <Text color="$text2" fontFamily="$body" fontSize={13}>
                    {current?.skipped
                      ? "Skipped"
                      : `${current?.completedSets ?? 0} sets completed`}
                  </Text>
                </NativeView>
              );
            })}
            {!privateExercises.length && (
              <Text color="$text2">Waiting for their workout plan.</Text>
            )}
          </View>
        ) : (
          Object.entries(projection.exercises).map(
            ([planExerciseId, exercise], index) => (
              <View style={exerciseStyles.exerciseRow} key={planExerciseId}>
                <ExerciseHeading
                  name={
                    p.exerciseNames[exercise.exerciseId] ??
                    `Exercise ${index + 1}`
                  }
                />
                {exercise.skipped && <Text color="$text2">Skipped</Text>}
                <NativeView style={exerciseStyles.columnHeaders}>
                  <NativeText
                    style={[
                      exerciseStyles.columnHeader,
                      exerciseStyles.columnHeaderSet,
                    ]}
                  >
                    SET
                  </NativeText>
                  <NativeText
                    style={[
                      exerciseStyles.columnHeader,
                      exerciseStyles.columnHeaderPrevious,
                    ]}
                  >
                    PREV
                  </NativeText>
                  <NativeText
                    style={[
                      exerciseStyles.columnHeader,
                      exerciseStyles.columnHeaderReps,
                    ]}
                  >
                    REPS
                  </NativeText>
                  <NativeText
                    style={[
                      exerciseStyles.columnHeader,
                      exerciseStyles.columnHeaderKg,
                    ]}
                  >
                    KG
                  </NativeText>
                  <NativeView style={exerciseStyles.columnHeaderSpacer} />
                </NativeView>
                {!exercise.sets.length && (
                  <Text color="$text2" fontSize={13}>
                    No sets logged yet
                  </Text>
                )}
                {exercise.sets.map((set, i) => (
                  <PartnerSet
                    key={`${set.setId}:${projection.revision}:${grant?.version}`}
                    set={{
                      id: set.setId,
                      sessionExerciseId: planExerciseId,
                      setNumber: i + 1,
                      reps: set.reps,
                      weightKg: set.weightKg,
                      rpe: null,
                      durationSeconds: null,
                      distanceMeters: null,
                      isCompleted: set.completed,
                      completedAt: null,
                    }}
                    owner={owner}
                    editable={mayLog && editing}
                    previous={
                      grant?.consent.prev
                        ? (p.snapshot.previous[p.ownerId]?.find(
                            (row) =>
                              row.exerciseId === exercise.exerciseId &&
                              row.setNumber === i + 1,
                          ) ?? null)
                        : null
                    }
                    onSave={async (next) => {
                      setError("");
                      try {
                        await p.onOperation(
                          {
                            type: "upsertSet",
                            planExerciseId,
                            set: {
                              setId: next.id,
                              reps: next.reps,
                              weightKg: next.weightKg,
                              completed: true,
                            },
                          },
                          projection.revision,
                        );
                      } catch {
                        setError(
                          "That set could not be sent. Check the connection and current permission before trying again.",
                        );
                      }
                    }}
                  />
                ))}
                {mayLog && editing && (
                  <NewPartnerSet
                    key={`${planExerciseId}:${projection.revision}:${grant?.version}`}
                    owner={owner}
                    planExerciseId={planExerciseId}
                    setNumber={exercise.sets.length + 1}
                    onOperation={(operation) =>
                      p.onOperation(operation, projection.revision)
                    }
                  />
                )}
              </View>
            ),
          )
        )}
        {!!error && <Text color="$error">{error}</Text>}
        <Btn full variant="soft" onPress={p.onMine}>
          Back to my workout
        </Btn>
      </ScrollView>
    </View>
  );
}
function ExerciseHeading({ name }: { name: string }) {
  return (
    <NativeView style={exerciseStyles.exerciseHeader}>
      <NativeView style={exerciseStyles.iconTile}>
        <IconDumbbell size={14} color={color.$primary} />
      </NativeView>
      <NativeText style={[exerciseStyles.exerciseName, { flex: 1 }]}>
        {name}
      </NativeText>
    </NativeView>
  );
}
function PartnerSet(p: {
  set: ExerciseSet;
  owner: string;
  editable: boolean;
  previous: { reps: number; weightKg: number } | null;
  onSave(set: ExerciseSet): Promise<void>;
}) {
  const [draft, setDraft] = useState(p.set);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);
  return (
    <View gap={8}>
      <SetLogger
        hideRemove
        set={p.editable ? draft : p.set}
        setNumber={p.set.setNumber}
        previous={p.previous}
        readOnly={!p.editable || pending}
        onChange={(patch) => setDraft({ ...draft, ...patch })}
        onRemove={() => {}}
        onFillPrevious={() => {
          if (p.previous) setDraft({ ...draft, ...p.previous });
        }}
      />
      {p.editable && (
        <Btn
          size="sm"
          variant="outline"
          disabled={pending || draft.reps === null || draft.weightKg === null}
          onPress={() => {
            if (sending.current) return;
            sending.current = true;
            setPending(true);
            void p.onSave(draft).finally(() => {
              sending.current = false;
              setPending(false);
            });
          }}
        >
          Save set for {p.owner}
        </Btn>
      )}
    </View>
  );
}

function NewPartnerSet(p: {
  owner: string;
  planExerciseId: string;
  setNumber: number;
  onOperation(operation: Record<string, unknown>): Promise<void>;
}) {
  const [draft, setDraft] = useState<ExerciseSet | null>(null);
  const [error, setError] = useState("");
  return (
    <View gap={8}>
      {draft ? (
        <PartnerSet
          set={draft}
          owner={p.owner}
          editable
          previous={null}
          onSave={async (set) => {
            setError("");
            try {
              await p.onOperation({
                type: "upsertSet",
                planExerciseId: p.planExerciseId,
                set: {
                  setId: set.id,
                  reps: set.reps,
                  weightKg: set.weightKg,
                  completed: true,
                },
              });
              setDraft(null);
            } catch {
              setError(
                "Could not send this set. Check current permission and connection.",
              );
            }
          }}
        />
      ) : (
        <Btn
          size="sm"
          variant="outline"
          onPress={() => {
            setError("");
            setDraft({
              id: randomUUID(),
              sessionExerciseId: p.planExerciseId,
              setNumber: p.setNumber,
              reps: null,
              weightKg: null,
              rpe: null,
              durationSeconds: null,
              distanceMeters: null,
              isCompleted: false,
              completedAt: null,
            });
          }}
        >
          Add set for {p.owner}
        </Btn>
      )}
      {!!error && <Text color="$error">{error}</Text>}
    </View>
  );
}
