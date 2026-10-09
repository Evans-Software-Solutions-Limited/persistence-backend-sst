import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation/Btn";
import { Card } from "@/ui/components/foundation/Card";
import type { TogetherWorkoutReview } from "@/domain/ports/togetherWorkout.port";

export interface TogetherRecoveryPresenterProps {
  name: string;
  review: TogetherWorkoutReview | null;
  busy: boolean;
  available: boolean;
  error: string;
  exerciseNames: Readonly<Record<string, string>>;
  onReview(): void;
  onSave(): void;
  onBack(): void;
  onDone(): void;
  onDiscard?(): void;
}
const Copy = ({ children }: { children: React.ReactNode }) => (
  <Text fontFamily="$body" fontSize={13} lineHeight={20} color="$text2">
    {children}
  </Text>
);
/** Reviewed recovery heading/card/action layout; explicit review replaces prototype auto-save. */
export function TogetherRecoveryPresenter(p: TogetherRecoveryPresenterProps) {
  const saved =
    p.review?.status === "saved" || p.review?.status === "finished_empty";
  const sets =
    p.review?.execution.exercises.flatMap((e) =>
      e.skipped ? [] : e.sets.filter((s) => s.completed),
    ) ?? [];
  const volume = sets.reduce((n, s) => n + s.reps * s.weightKg, 0);
  return (
    <View gap={16} testID="together-recovery">
      <Btn variant="ghost" onPress={p.onBack}>
        Back
      </Btn>
      <Text
        fontFamily="$display"
        fontSize={10}
        letterSpacing={2}
        color="$text3"
      >
        MY TOGETHER WORKOUT
      </Text>
      <Text fontFamily="$display" fontSize={28} color="$text">
        {saved
          ? p.review?.status === "finished_empty"
            ? "Workout finished"
            : "Workout saved"
          : "Review your workout"}
      </Text>
      <Copy>{p.name}</Copy>
      <Card>
        <View gap={12}>
          <Text fontFamily="$display" fontSize={17} color="$text">
            {saved
              ? p.review?.status === "finished_empty"
                ? "Finished without a result"
                : `Saved with ${sets.length} sets`
              : p.review
                ? "Ready for your review"
                : "Your workout is on this device"}
          </Text>
          {p.review?.retainedLocalChanges && (
            <Copy>
              {saved
                ? "Reviewed sets saved; other changes remain on this device."
                : "Only the listed sets can be saved. Other changes remain on this device."}
            </Copy>
          )}
          {p.review ? (
            <>
              <Copy>
                {sets.length} completed sets · {volume.toLocaleString()} kg
              </Copy>
              {p.review.execution.exercises.map((e) => {
                const plan = p.review!.plan.exercises.find(
                  (row) => row.planExerciseId === e.planExerciseId,
                );
                const id = e.substituteExerciseId ?? plan?.exerciseId;
                return (
                  <View key={e.planExerciseId} gap={4}>
                    <Text fontFamily="$body" color="$text">
                      {id ? (p.exerciseNames[id] ?? "Exercise") : "Exercise"}
                      {e.skipped ? " · skipped" : ""}
                    </Text>
                    {!e.skipped &&
                      e.sets
                        .filter((s) => s.completed)
                        .map((s, i) => (
                          <Copy key={s.setId}>
                            Set {i + 1} · {s.reps} reps · {s.weightKg} kg
                          </Copy>
                        ))}
                  </View>
                );
              })}
              {p.review.omissions.map((value) => (
                <Copy key={value}>Kept on this device: {value}</Copy>
              ))}
              <Copy>
                {saved
                  ? p.review.status === "finished_empty"
                    ? "No completed sets were saved to history."
                    : "Your account has accepted this result."
                  : "Uploaded for review. Nothing is saved to workout history until you confirm."}
              </Copy>
              {p.review.effectsPending && (
                <Copy>
                  Your result is saved. Records and statistics are still
                  updating.
                </Copy>
              )}
            </>
          ) : (
            <Copy>
              Connect when you can to upload your own sets for review. You can
              keep your workout on this device without sharing or renewing a
              subscription.
            </Copy>
          )}
        </View>
      </Card>
      {p.error !== "" && (
        <Text color="$warning" accessibilityRole="alert">
          {p.error}
        </Text>
      )}
      {saved ? (
        <Btn full disabled={p.busy || !p.available} onPress={p.onDone}>
          Continue
        </Btn>
      ) : (
        <>
          <Btn full disabled={p.busy || !p.available} onPress={p.onReview}>
            {p.busy
              ? "Working…"
              : p.review
                ? "Refresh review"
                : "Review my result"}
          </Btn>
          {p.review && (
            <Btn
              full
              variant="outline"
              disabled={p.busy || !p.available}
              onPress={p.onSave}
            >
              Save reviewed result
            </Btn>
          )}
          {p.onDiscard && (
            <Btn
              full
              variant="ghost"
              tone="error"
              disabled={p.busy}
              onPress={p.onDiscard}
            >
              Discard without saving
            </Btn>
          )}
          <Copy>
            Each athlete saves their own result. A peer receipt does not mean it
            has reached your account.
          </Copy>
        </>
      )}
    </View>
  );
}
