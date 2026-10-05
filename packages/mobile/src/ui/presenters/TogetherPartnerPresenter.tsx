import { randomUUID } from "expo-crypto";
import { useRef, useState } from "react";
import { ScrollView } from "react-native";
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
  onMine(): void;
  onOperation(
    operation: Record<string, unknown>,
    observedRevision: number,
  ): Promise<void>;
}) {
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
    <ScrollView
      testID="together-partner-view"
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
      <View flexDirection="row" alignItems="center" gap={8}>
        <Text flex={1} color="$text" fontFamily="$display">
          {owner} · {mayLog && editing ? "Partner logging" : "Read-only"}
        </Text>
        {mayLog && (
          <Btn size="sm" variant="soft" onPress={() => setEditing(!editing)}>
            {editing ? "Read only" : `Log for ${owner}`}
          </Btn>
        )}
        <Btn size="sm" variant="ghost" onPress={p.onMine}>
          Mine
        </Btn>
      </View>
      {!projection ? (
        <View gap={12}>
          <Text color="$text2">
            Numbers are private or sharing is interrupted. Their workout remains
            theirs.
          </Text>
          {p.snapshot.progress
            .find((row) => row.userId === p.ownerId)
            ?.exercises.map((ex, index) => {
              const plan = p.snapshot.athletePlans[p.ownerId]?.exercises.find(
                (e) => e.planExerciseId === ex.planExerciseId,
              );
              return (
                <View key={ex.planExerciseId} gap={4}>
                  <Text color="$text">
                    {plan
                      ? (p.exerciseNames[plan.exerciseId] ??
                        `Exercise ${index + 1}`)
                      : `Exercise ${index + 1}`}
                  </Text>
                  <Text color="$text2">
                    {ex.skipped
                      ? "Skipped"
                      : `${ex.completedSets} sets completed`}
                  </Text>
                </View>
              );
            })}
        </View>
      ) : (
        Object.entries(projection.exercises).map(
          ([planExerciseId, exercise], index) => (
            <View gap={12} key={planExerciseId}>
              <Text color="$text" fontFamily="$display" fontSize={18}>
                {p.exerciseNames[exercise.exerciseId] ??
                  `Exercise ${index + 1}`}
              </Text>
              {exercise.skipped && <Text color="$text2">Skipped</Text>}
              <Text color="$text2" fontSize={12}>
                SET PREV REPS KG
              </Text>
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
