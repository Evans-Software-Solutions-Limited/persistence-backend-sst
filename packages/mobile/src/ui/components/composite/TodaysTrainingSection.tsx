import { Text, View } from "@tamagui/core";
import { Card, Pill } from "@/ui/components/foundation";
import { Section } from "./Section";
import { CoachAttribution } from "./CoachAttribution";
import { IconChevronR } from "@/ui/components/icons";
import type { TodaysTrainingItem } from "@/domain/models/progress";

/**
 * <TodaysTrainingSection> — the schedule-aware "Today's training" list, shared
 * by the athlete Home dashboard and the Train-tab Training overview (M16). Each
 * row is a due-ordered assigned occurrence (programme assignment or standalone
 * coach workout-assignment) with coach attribution (Phase 11 / cross-cuts
 * § 1.5). Extracted from HomePresenter so the two surfaces can't diverge.
 *
 * Renders null when empty (the caller shows nothing). Pure presentational.
 */

export type TodaysTrainingSectionProps = {
  items: TodaysTrainingItem[];
  onOpenWorkout: (workoutId: string) => void;
  /** Injected today (YYYY-MM-DD) for deterministic due-label tests. */
  todayISO?: string;
  /** Wrapper testID (e.g. "home-todays-training" / "train-todays-training"). */
  testID?: string;
  eyebrow?: string;
  title?: string;
};

/**
 * Generic (nameless) attribution pill — the fallback when the trainer's name
 * isn't resolved (older cached payload / nameless profile). The named path uses
 * <CoachAttribution>.
 */
function attributionLabel(
  assignedByType: TodaysTrainingItem["assignedByType"],
): string | null {
  if (assignedByType === "personal_trainer") return "Set by coach";
  if (assignedByType === "physiotherapist") return "From physio";
  return null;
}

/**
 * Leading copy for the NAMED attribution line. A physio keeps a role-neutral
 * "Set by" (so "Set by Jane Doe"); a PT / unknown assigner reads "Set by
 * Coach".
 */
function attributionPrefix(
  assignedByType: TodaysTrainingItem["assignedByType"],
): string {
  return assignedByType === "physiotherapist" ? "Set by" : "Set by Coach";
}

/** Short due label: Today / Overdue / the ISO date. Null due → no label. */
function dueLabel(dueDate: string | null, todayISO: string): string | null {
  if (!dueDate) return null;
  if (dueDate === todayISO) return "Today";
  if (dueDate < todayISO) return "Overdue";
  return dueDate;
}

export function TodaysTrainingSection({
  items,
  onOpenWorkout,
  todayISO = new Date().toISOString().slice(0, 10),
  testID,
  eyebrow = "TODAY",
  title = "Today's training",
}: TodaysTrainingSectionProps) {
  if (items.length === 0) return null;

  return (
    <View testID={testID}>
      <Section eyebrow={eyebrow} title={title}>
        <View gap={8}>
          {items.map((item) => {
            // Only attribute when the assigner is currently classified as a
            // coach/physio (assignedByType set), so both the named line and the
            // fallback pill gate identically — a former coach whose role
            // reverted to `user` attributes on neither path.
            const coachName = item.assignedByType
              ? (item.assignedByName ?? null)
              : null;
            const fallbackBadge = coachName
              ? null
              : attributionLabel(item.assignedByType);
            const due = dueLabel(item.dueDate, todayISO);
            const meta = [
              item.estimatedDurationMinutes != null
                ? `${item.estimatedDurationMinutes} min`
                : null,
              due,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Card
                key={item.assignmentId ?? item.workoutId}
                pad={12}
                radius={12}
                onPress={() => onOpenWorkout(item.workoutId)}
                testID={`todays-training-${item.workoutId}`}
                accessibilityLabel={`Today's training: ${item.name ?? "Workout"}`}
              >
                <View flexDirection="row" alignItems="center" gap={12}>
                  <View flex={1} minWidth={0}>
                    <View
                      flexDirection="row"
                      alignItems="center"
                      gap={6}
                      marginBottom={coachName || meta ? 2 : 0}
                    >
                      <Text
                        fontFamily="$display"
                        fontWeight="600"
                        fontSize={14}
                        color="$text"
                        numberOfLines={1}
                      >
                        {item.name ?? "Workout"}
                      </Text>
                      {fallbackBadge ? (
                        <Pill tone="trainer" size="xs">
                          {fallbackBadge}
                        </Pill>
                      ) : null}
                    </View>
                    {coachName ? (
                      <View marginBottom={meta ? 2 : 0}>
                        <CoachAttribution
                          name={coachName}
                          label={attributionPrefix(item.assignedByType)}
                          testID={`todays-training-${item.workoutId}-coach`}
                        />
                      </View>
                    ) : null}
                    {meta ? (
                      <Text fontFamily="$body" fontSize={11} color="$text3">
                        {meta}
                      </Text>
                    ) : null}
                  </View>
                  <IconChevronR size={14} color="#8A8A98" />
                </View>
              </Card>
            );
          })}
        </View>
      </Section>
    </View>
  );
}
