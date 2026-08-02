import { Ionicons } from "@expo/vector-icons";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type {
  LoadoutPreview,
  LoadoutPreviewRow,
} from "@/domain/models/loadout";
import type {
  LoadoutRowCopy,
  LoadoutRowTone,
} from "@/domain/services/loadout.service";
import { Pill } from "@/ui/components/foundation";
import type { PillTone } from "@/ui/components/foundation";
import { LoadoutScaffold } from "./LoadoutScaffold";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <LoadoutReviewStep> — the adapted plan, with a reason on every row (T-2.6,
 * AC-3.3/3.4/3.5b, design D7 step 6).
 *
 * ## ⚠ Copy comes from `describeLoadoutRow`, never from `reason.code` inline
 *
 * The backend deliberately emits no UI strings, and `describeLoadoutRow` is the
 * one place the code becomes a sentence. This presenter takes the finished
 * `LoadoutRowCopy` so nobody can write a second, drifting version of the same
 * sentence next to the first.
 *
 * ## ⚠ `modelNote` is UNTRUSTED and is rendered as PLAIN TEXT, in its own block
 *
 * AC-1.2 makes a stranger's PUBLIC workout adaptable, and neither `workouts.name`
 * nor `exercises.name` is length-bounded — so an attacker can publish a workout
 * whose exercise names steer what the model writes into `reason.note`. The server
 * caps it and strips unpaired surrogates; the render boundary is here. It is
 * therefore:
 *
 *   - a `<Text>` and nothing else — never markup, never a link, never pressable;
 *   - visually quoted and attributed, so it reads as the model talking rather
 *     than as our copy;
 *   - kept in its own field by `describeLoadoutRow` precisely so it cannot be
 *     concatenated into `explanation` by accident.
 *
 * ## ⚠ `intensity_mismatch` offers exactly three actions
 *
 * Accept it as accessory volume · swap it yourself · drop the row.
 * **Never "adjust the target".** Rewriting the prescription to suit the kit
 * relaxes design § 1 rule 2 (targets are the parent's, copied, never authored)
 * and is a Brad decision with its own slice.
 *
 * ## ⚠ Rows left un-actioned are DROPPED on save, and the banner says so
 *
 * `buildVariationExercises` cannot send a row with no `exerciseId` — the wire
 * schema requires one — so an unresolved row that the user never resolves does
 * not survive the save. That is the right behaviour, and it is only honest if the
 * screen states it before the user taps Save rather than after.
 */

export type LoadoutRowView = {
  readonly row: LoadoutPreviewRow;
  readonly copy: LoadoutRowCopy;
  /** Superset letter ("A1") or the plain index ("2"). */
  readonly tag: string;
  readonly isSupersetMember: boolean;
  /** The exercise currently shown — the pick's name once one is made. */
  readonly displayName: string;
  /** The exercise currently shown — null only while a row is unresolved. */
  readonly displayExerciseId: string | null;
  /** The user replaced this row by hand. */
  readonly isManualPick: boolean;
  /** The user chose to leave this row out. */
  readonly isDropped: boolean;
  /** The user accepted an `intensity_mismatch` as accessory volume. */
  readonly isAccepted: boolean;
  /** Still awaiting a decision — drives the banner count and the row's actions. */
  readonly needsAttention: boolean;
};

export type LoadoutReviewStepProps = {
  readonly workoutName: string;
  readonly gymLabel: string;
  readonly preview: LoadoutPreview;
  readonly rows: readonly LoadoutRowView[];
  /** Rows still awaiting a decision. Drives the banner; does NOT block Save. */
  readonly attentionCount: number;
  readonly isSaving: boolean;
  /** A failed save, already turned into a sentence by the container. */
  readonly saveError: string | null;
  readonly onBack: () => void;
  readonly onExercisePress: (exerciseId: string) => void;
  readonly onSwapRow: (row: LoadoutPreviewRow) => void;
  readonly onAcceptMismatch: (sortOrder: number) => void;
  readonly onDropRow: (sortOrder: number) => void;
  readonly onRestoreRow: (sortOrder: number) => void;
  readonly onSave: () => void;
  readonly onSaveAndStart: () => void;
};

const TONE_PILL: Record<LoadoutRowTone, PillTone> = {
  kept: "success",
  swapped: "primary",
  attention: "ember",
};

/** "3 × 8–10" / "3 × 10" / "45s" — the parent's targets, never edited here. */
export function formatTarget(row: LoadoutPreviewRow): string {
  if (row.targetDurationSeconds != null && row.targetDurationSeconds > 0) {
    return `${row.targetSets ?? 1} × ${row.targetDurationSeconds}s`;
  }
  const reps =
    row.targetRepsMin === row.targetRepsMax
      ? `${row.targetRepsMin}`
      : `${row.targetRepsMin}–${row.targetRepsMax}`;
  return `${row.targetSets ?? 1} sets × ${reps} reps`;
}

export function LoadoutReviewStep({
  workoutName,
  gymLabel,
  preview,
  rows,
  attentionCount,
  isSaving,
  saveError,
  onBack,
  onExercisePress,
  onSwapRow,
  onAcceptMismatch,
  onDropRow,
  onRestoreRow,
  onSave,
  onSaveAndStart,
}: LoadoutReviewStepProps) {
  const keptCount = preview.meta.keptCount;
  const swappedCount = preview.meta.swappedCount;

  return (
    <LoadoutScaffold
      title="Review adaptation"
      eyebrow="LOADOUT"
      onBack={onBack}
      testID="loadout-review"
      footer={
        <>
          <TouchableOpacity
            style={[styles.footerSecondary, isSaving && styles.ctaBusy]}
            onPress={onSave}
            disabled={isSaving}
            testID="loadout-review-save"
            accessibilityRole="button"
            accessibilityState={{ disabled: isSaving }}
          >
            <Text style={styles.footerSecondaryText}>
              {isSaving ? "Saving…" : "Save variation"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.footerPrimary, isSaving && styles.ctaBusy]}
            onPress={onSaveAndStart}
            disabled={isSaving}
            testID="loadout-review-save-start"
            accessibilityRole="button"
            accessibilityState={{ disabled: isSaving }}
          >
            <Ionicons name="play" size={15} color={color.$primaryInk} />
            <Text style={styles.footerPrimaryText}>Save &amp; start</Text>
          </TouchableOpacity>
        </>
      }
    >
      <View style={styles.banner}>
        <View style={styles.bannerIcon}>
          <Ionicons name="sparkles" size={18} color={color.$primaryInk} />
        </View>
        <View style={styles.bannerBody}>
          <Text style={styles.bannerTitle} numberOfLines={1}>
            {workoutName} · <Text style={styles.bannerGym}>{gymLabel}</Text>
          </Text>
          <Text style={styles.bannerSub}>
            {swappedCount === 0
              ? "Everything fits your kit — nothing swapped"
              : `${swappedCount} swapped, ${keptCount} kept`}
          </Text>
        </View>
      </View>

      {attentionCount > 0 ? (
        <View style={styles.attentionBanner} testID="loadout-review-attention">
          <Ionicons name="alert-circle" size={16} color={color.$warning} />
          <Text style={styles.attentionText}>
            {attentionCount === 1
              ? "1 exercise needs a decision. Anything you leave undecided is dropped from this variation."
              : `${attentionCount} exercises need a decision. Anything you leave undecided is dropped from this variation.`}
          </Text>
        </View>
      ) : null}

      {saveError !== null ? (
        <View style={styles.errorBanner} testID="loadout-review-save-error">
          <Ionicons name="alert-circle" size={16} color={color.$error} />
          <Text style={styles.errorText}>{saveError}</Text>
        </View>
      ) : null}

      <View style={styles.planHeader}>
        <Text style={styles.eyebrow}>ADAPTED PLAN · {rows.length}</Text>
        <Text style={styles.planNote}>tap swap to change any pick</Text>
      </View>

      {rows.map((view) => (
        <ReviewRow
          key={view.row.sortOrder}
          view={view}
          onExercisePress={onExercisePress}
          onSwapRow={onSwapRow}
          onAcceptMismatch={onAcceptMismatch}
          onDropRow={onDropRow}
          onRestoreRow={onRestoreRow}
        />
      ))}

      {preview.meta.candidatePoolTruncated ? (
        <Text style={styles.truncated} testID="loadout-review-truncated">
          Your library is large enough that Loadout considered only the closest
          matches for some rows. Use swap to see more.
        </Text>
      ) : null}
    </LoadoutScaffold>
  );
}

function ReviewRow({
  view,
  onExercisePress,
  onSwapRow,
  onAcceptMismatch,
  onDropRow,
  onRestoreRow,
}: {
  readonly view: LoadoutRowView;
  readonly onExercisePress: (exerciseId: string) => void;
  readonly onSwapRow: (row: LoadoutPreviewRow) => void;
  readonly onAcceptMismatch: (sortOrder: number) => void;
  readonly onDropRow: (sortOrder: number) => void;
  readonly onRestoreRow: (sortOrder: number) => void;
}) {
  const { row, copy, isDropped } = view;
  const sortOrder = row.sortOrder;

  if (isDropped) {
    return (
      <View
        style={[styles.row, styles.rowDropped]}
        testID={`loadout-row-${sortOrder}`}
      >
        <View style={styles.rowHead}>
          <View style={styles.tag}>
            <Text style={styles.tagText}>{view.tag}</Text>
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowNameDropped} numberOfLines={1}>
              {view.displayName}
            </Text>
            <Text style={styles.rowTarget}>Left out of this variation</Text>
          </View>
          <TouchableOpacity
            onPress={() => onRestoreRow(sortOrder)}
            testID={`loadout-row-${sortOrder}-restore`}
            accessibilityRole="button"
            accessibilityLabel={`Put ${view.displayName} back`}
            hitSlop={8}
          >
            <Text style={styles.inlineAction}>Undo</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.row,
        view.isSupersetMember && styles.rowSuperset,
        view.needsAttention && styles.rowAttention,
      ]}
      testID={`loadout-row-${sortOrder}`}
    >
      <View style={styles.rowHead}>
        <View style={[styles.tag, view.isSupersetMember && styles.tagSuperset]}>
          <Text
            style={[
              styles.tagText,
              view.isSupersetMember && styles.tagTextSuperset,
            ]}
          >
            {view.tag}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.rowBody}
          onPress={() => {
            if (view.displayExerciseId !== null) {
              onExercisePress(view.displayExerciseId);
            }
          }}
          disabled={view.displayExerciseId === null}
          testID={`loadout-row-${sortOrder}-exercise`}
          accessibilityRole="button"
          accessibilityLabel={`View ${view.displayName} exercise details`}
          accessibilityState={{ disabled: view.displayExerciseId === null }}
        >
          <Text style={styles.rowName} numberOfLines={1}>
            {view.displayName}
          </Text>
          <Text style={styles.rowTarget}>{formatTarget(row)}</Text>
        </TouchableOpacity>
        <Pill tone={TONE_PILL[copy.tone]} size="xs">
          {copy.badge}
        </Pill>
        <TouchableOpacity
          onPress={() => onSwapRow(row)}
          style={styles.swapButton}
          testID={`loadout-row-${sortOrder}-swap`}
          accessibilityRole="button"
          accessibilityLabel={`Swap ${view.displayName}`}
          hitSlop={6}
        >
          <Ionicons name="swap-horizontal" size={16} color={color.$primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.reason}>
        <Ionicons
          name={copy.tone === "kept" ? "checkmark" : "sparkles"}
          size={12}
          color={copy.tone === "kept" ? color.$success : color.$primary}
        />
        <Text style={styles.reasonText}>{copy.explanation}</Text>
      </View>

      {/*
        ⚠ UNTRUSTED MODEL PROSE. Plain <Text>, nothing pressable, no markup, and
        attributed so it never reads as the app's own claim. See the file header.
      */}
      {copy.modelNote !== null ? (
        <View style={styles.note} testID={`loadout-row-${sortOrder}-note`}>
          <Text style={styles.noteLabel}>Loadout&apos;s note</Text>
          <Text style={styles.noteText}>{copy.modelNote}</Text>
        </View>
      ) : null}

      {view.needsAttention ? (
        <View
          style={styles.actions}
          testID={`loadout-row-${sortOrder}-actions`}
        >
          {copy.intensityMismatch ? (
            <>
              <Text style={styles.actionsLead}>
                Your kit can&apos;t load this rep range. Keep it as lighter
                accessory work, swap it, or leave it out.
              </Text>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.actionChip}
                  onPress={() => onAcceptMismatch(sortOrder)}
                  testID={`loadout-row-${sortOrder}-accept`}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionChipText}>Keep as accessory</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionChip}
                  onPress={() => onSwapRow(row)}
                  testID={`loadout-row-${sortOrder}-action-swap`}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionChipText}>Swap it</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionChip}
                  onPress={() => onDropRow(sortOrder)}
                  testID={`loadout-row-${sortOrder}-drop`}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionChipText}>Leave it out</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <Text style={styles.actionsLead}>
                Pick a replacement, or leave this one out.
              </Text>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.actionChip}
                  onPress={() => onSwapRow(row)}
                  testID={`loadout-row-${sortOrder}-action-swap`}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionChipText}>Choose one</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionChip}
                  onPress={() => onDropRow(sortOrder)}
                  testID={`loadout-row-${sortOrder}-drop`}
                  accessibilityRole="button"
                >
                  <Text style={styles.actionChipText}>Leave it out</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$md,
    padding: space.$md,
    borderRadius: radius.$lg,
    backgroundColor: color.$surface,
    borderWidth: 1,
    borderColor: color.$primaryDim,
  },
  bannerIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.$md,
    backgroundColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
  },
  bannerBody: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: 14, fontWeight: "700", color: color.$text },
  bannerGym: { color: color.$primary },
  bannerSub: { fontSize: 11.5, color: color.$text3 },
  attentionBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.$sm,
    padding: space.$md,
    borderRadius: radius.$md,
    backgroundColor: color.$surface2,
    borderWidth: 1,
    borderColor: color.$border2,
  },
  attentionText: { flex: 1, fontSize: 12, color: color.$text2, lineHeight: 17 },
  errorBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.$sm,
    padding: space.$md,
    borderRadius: radius.$md,
    backgroundColor: color.$errorDim,
  },
  errorText: { flex: 1, fontSize: 12, color: color.$text, lineHeight: 17 },
  planHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  eyebrow: {
    fontSize: 10.5,
    letterSpacing: 1,
    fontWeight: "700",
    color: color.$text3,
  },
  planNote: { fontSize: 10.5, color: color.$text4 },
  row: {
    gap: space.$sm,
    padding: space.$md,
    borderRadius: radius.$lg,
    backgroundColor: color.$surface,
    borderWidth: 1,
    borderColor: color.$border,
  },
  rowSuperset: { borderLeftWidth: 3, borderLeftColor: color.$primary },
  rowAttention: { borderColor: color.$ember },
  rowDropped: { opacity: 0.5 },
  rowHead: { flexDirection: "row", alignItems: "center", gap: space.$sm },
  tag: {
    minWidth: 26,
    height: 26,
    paddingHorizontal: 6,
    borderRadius: radius.$sm,
    backgroundColor: color.$surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  tagSuperset: { backgroundColor: color.$primary },
  tagText: { fontSize: 11, fontWeight: "700", color: color.$text2 },
  tagTextSuperset: { color: color.$primaryInk },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: 14, fontWeight: "700", color: color.$text },
  rowNameDropped: {
    fontSize: 14,
    fontWeight: "700",
    color: color.$text3,
    textDecorationLine: "line-through",
  },
  rowTarget: { fontSize: 11.5, color: color.$text3 },
  swapButton: {
    width: 30,
    height: 30,
    borderRadius: radius.$sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.$surface3,
  },
  reason: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.$sm,
    padding: space.$sm,
    borderRadius: radius.$sm,
    backgroundColor: color.$surface2,
  },
  reasonText: { flex: 1, fontSize: 11, color: color.$text3, lineHeight: 16 },
  note: {
    gap: 3,
    paddingHorizontal: space.$sm,
    paddingVertical: space.$sm,
    borderRadius: radius.$sm,
    backgroundColor: color.$surface2,
    borderLeftWidth: 2,
    borderLeftColor: color.$border3,
  },
  noteLabel: {
    fontSize: 9.5,
    letterSpacing: 0.9,
    fontWeight: "700",
    color: color.$text4,
    textTransform: "uppercase",
  },
  noteText: { fontSize: 11.5, color: color.$text3, lineHeight: 16 },
  actions: { gap: space.$sm },
  actionsLead: { fontSize: 11.5, color: color.$text2, lineHeight: 17 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: space.$sm },
  actionChip: {
    paddingVertical: space.$sm,
    paddingHorizontal: space.$md,
    borderRadius: radius.$pill,
    borderWidth: 1,
    borderColor: color.$border2,
    backgroundColor: color.$surface2,
  },
  actionChipText: { fontSize: 12, fontWeight: "600", color: color.$text },
  inlineAction: { fontSize: 12.5, fontWeight: "700", color: color.$primary },
  truncated: { fontSize: 11, color: color.$text4, lineHeight: 16 },
  footerSecondary: {
    flex: 1,
    height: 50,
    borderRadius: radius.$lg,
    borderWidth: 1.5,
    borderColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
  },
  footerSecondaryText: {
    fontSize: 14,
    fontWeight: "700",
    color: color.$primary,
  },
  footerPrimary: {
    flex: 1.3,
    height: 50,
    flexDirection: "row",
    gap: space.$sm,
    borderRadius: radius.$lg,
    backgroundColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
  },
  footerPrimaryText: {
    fontSize: 14,
    fontWeight: "700",
    color: color.$primaryInk,
  },
  ctaBusy: { opacity: 0.6 },
});
