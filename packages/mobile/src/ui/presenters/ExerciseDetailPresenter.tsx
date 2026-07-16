import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";

import type { Exercise, ExerciseDifficulty } from "@/domain/models/exercise";
import { Btn, HeaderBar, IconBtn, Pill } from "@/ui/components/foundation";
import type { PillTone } from "@/ui/components/foundation";
import {
  IconAlert,
  IconBack,
  IconDumbbell,
  IconEdit,
} from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";
import type { ApiError } from "@/shared/errors";

/**
 * <ExerciseDetailPresenter> — full-screen exercise detail.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-007 (AC 7.1–7.3)
 *       design.md § <ExerciseDetailPresenter>
 *
 * Design-port to the foundation system (HeaderBar + Pill + Lucide), NOT a 1:1
 * port of the legacy `exercise-details` screen. The legacy PR-carousel /
 * recent-sets / accessibility sections are dropped — V2's `GET /exercises/:id`
 * carries no per-user history and there are no accessibility columns (see the
 * 04 design.md Revised 2026-06-05 note).
 *
 * Header: Back (leading) + an Edit button shown only to the owner (AC 7.3).
 * Body: photo (if any), name + level pill, then description / primary muscles /
 * secondary muscles / equipment / instructions sections — each rendered only
 * when it has content. Muscle/equipment text reads the adapter-resolved
 * `*Labels` (the raw arrays are DB UUIDs), matching <ExerciseCard>.
 */

/** Difficulty → pill tone, identical to <ExerciseCard> so the level reads the
 * same colour across the list and the detail. */
const DIFFICULTY_TONE: Record<ExerciseDifficulty, PillTone> = {
  beginner: "success",
  intermediate: "gold",
  advanced: "error",
  expert: "error",
};

function difficultyLabel(difficulty: ExerciseDifficulty): string {
  return difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
}

/** Drop the adapter's empty-string placeholders for ids it couldn't resolve
 * (partial reference-cache hydration) so we never render ghost pills. */
function resolvedLabels(labels: string[] | undefined): string[] {
  return (labels ?? []).filter((l) => l.length > 0);
}

export type ExerciseDetailProps = {
  exercise: Exercise | null;
  isLoading: boolean;
  error: ApiError | null;
  /** Owner of the exercise — gates the Edit affordance (AC 7.3). */
  isOwner: boolean;
  onClose: () => void;
  onEdit: () => void;
  onRetry: () => void;
};

export function ExerciseDetailPresenter({
  exercise,
  isLoading,
  error,
  isOwner,
  onClose,
  onEdit,
  onRetry,
}: ExerciseDetailProps) {
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: color.$bg }}
      edges={["top", "bottom"]}
      testID="exercise-detail-screen"
    >
      {/* Minimal header — just Back + (owner) Edit. The name lives in the body
          alongside the level pill, so we don't repeat it as a centred title. */}
      <HeaderBar
        leading={
          <IconBtn
            icon={<IconBack size={22} />}
            tone="ghost"
            onPress={onClose}
            accessibilityLabel="Back"
          />
        }
        trailing={
          isOwner && exercise ? (
            <IconBtn
              icon={<IconEdit size={20} />}
              tone="ghost"
              onPress={onEdit}
              accessibilityLabel="Edit exercise"
              testID="exercise-detail-edit"
            />
          ) : null
        }
      />

      {isLoading && !exercise ? (
        <View
          flex={1}
          alignItems="center"
          justifyContent="center"
          gap={10}
          testID="exercise-detail-loading"
        >
          <IconDumbbell size={24} color={color.$text3} />
          <Text fontFamily="$body" fontSize={13} color="$text3">
            Loading exercise…
          </Text>
        </View>
      ) : error && !exercise ? (
        <View
          flex={1}
          alignItems="center"
          justifyContent="center"
          paddingHorizontal={32}
          gap={10}
          testID="exercise-detail-error"
        >
          <IconAlert size={24} color={color.$ember} />
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={16}
            color="$text"
          >
            Couldn’t load exercise
          </Text>
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$text3"
            textAlign="center"
          >
            {error.message}
          </Text>
          <Btn
            variant="outline"
            tone="primary"
            size="sm"
            onPress={onRetry}
            testID="exercise-detail-retry"
          >
            Try again
          </Btn>
        </View>
      ) : exercise ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 32, gap: 18 }}
          showsVerticalScrollIndicator={false}
          testID="exercise-detail-scroll"
        >
          {/* Photo / placeholder */}
          {exercise.thumbnailUrl ? (
            <Image
              source={{ uri: exercise.thumbnailUrl }}
              style={{ width: "100%", aspectRatio: 16 / 9, borderRadius: 14 }}
              contentFit="cover"
              transition={200}
              cachePolicy="memory-disk"
              testID="exercise-detail-photo"
            />
          ) : (
            <View
              aspectRatio={16 / 9}
              borderRadius={14}
              backgroundColor="$surface2"
              borderWidth={1}
              borderColor="$border"
              alignItems="center"
              justifyContent="center"
              gap={6}
              testID="exercise-detail-photo-placeholder"
            >
              <IconDumbbell size={26} color={color.$text3} />
              <Text fontFamily="$body" fontSize={12} color="$text3">
                No photo yet
              </Text>
            </View>
          )}

          {/* Name + level */}
          <View flexDirection="row" alignItems="center" gap={10}>
            <Text
              flex={1}
              fontFamily="$display"
              fontWeight="800"
              fontSize={24}
              letterSpacing={-0.6}
              color="$text"
            >
              {exercise.name}
            </Text>
            <Pill tone={DIFFICULTY_TONE[exercise.difficulty]} size="sm">
              {difficultyLabel(exercise.difficulty)}
            </Pill>
          </View>

          {exercise.description ? (
            <Section label="DESCRIPTION">
              <Text
                fontFamily="$body"
                fontSize={14}
                lineHeight={21}
                color="$text2"
              >
                {exercise.description}
              </Text>
            </Section>
          ) : null}

          <MusclePills
            label="PRIMARY MUSCLES"
            labels={resolvedLabels(exercise.primaryMuscleGroupLabels)}
            tone="primary"
            testID="exercise-detail-primary"
          />
          <MusclePills
            label="SECONDARY MUSCLES"
            labels={resolvedLabels(exercise.secondaryMuscleGroupLabels)}
            tone="neutral"
            testID="exercise-detail-secondary"
          />
          <MusclePills
            label="EQUIPMENT"
            labels={resolvedLabels(exercise.equipmentLabels)}
            tone="gold"
            testID="exercise-detail-equipment"
          />

          {exercise.instructions ? (
            <Section label="INSTRUCTIONS">
              <Text
                fontFamily="$body"
                fontSize={14}
                lineHeight={21}
                color="$text2"
              >
                {exercise.instructions}
              </Text>
            </Section>
          ) : null}
        </ScrollView>
      ) : (
        <View
          flex={1}
          alignItems="center"
          justifyContent="center"
          paddingHorizontal={32}
          gap={8}
          testID="exercise-detail-empty"
        >
          <IconDumbbell size={26} color={color.$text3} />
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={16}
            color="$text"
          >
            Exercise not found
          </Text>
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$text3"
            textAlign="center"
          >
            This exercise may have been removed or isn’t accessible.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

/** Eyebrow-labelled content block, matching the form's `FieldLabel` eyebrow. */
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View gap={8}>
      <SectionLabel>{label}</SectionLabel>
      {children}
    </View>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
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

/** A labelled row of pills; renders nothing when there are no resolved labels
 * (keeps the empty-section-hidden rule out of the parent's JSX). */
function MusclePills({
  label,
  labels,
  tone,
  testID,
}: {
  label: string;
  labels: string[];
  tone: PillTone;
  testID?: string;
}) {
  if (labels.length === 0) return null;
  return (
    <View gap={8} testID={testID}>
      <SectionLabel>{label}</SectionLabel>
      <View flexDirection="row" flexWrap="wrap" gap={6}>
        {labels.map((l, i) => (
          <Pill key={`${i}-${l}`} tone={tone} size="sm">
            {l}
          </Pill>
        ))}
      </View>
    </View>
  );
}
