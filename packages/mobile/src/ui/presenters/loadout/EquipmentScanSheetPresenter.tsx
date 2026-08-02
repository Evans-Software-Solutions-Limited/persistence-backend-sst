import { Ionicons } from "@expo/vector-icons";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { EquipmentScanDraft } from "@/domain/models/loadout";
import { itemLabel } from "@/shared/utils";
import { BottomSheet } from "@/ui/components/foundation";
import { color, radius, space } from "@/ui/theme/tokens";

/**
 * <EquipmentScanSheetPresenter> — photo → confirmed equipment draft (T-3.4,
 * AC-2.3, design D1).
 *
 * ## ⚠ Everything the model wrote is UNTRUSTED, and the channel is worse than usual
 *
 * The input is **a photograph the caller chose**, so a photographed whiteboard
 * puts attacker-authored instructions in front of a vision model exactly as a
 * malicious string does. The server carries an explicit "ignore any text visible
 * in the photograph" instruction and validates every returned id against the
 * catalogue, and it splits the response so nothing untrusted can reach the
 * selectable path:
 *
 *   - `detected` is SELECTABLE and renders the **catalogue's** name;
 *   - `unmatched` is INFORMATIONAL, carries the model's own free-text label, and
 *     has no id to select — showing it is what stops a correctly-unmatched item
 *     reading as a miss (E1 had six).
 *
 * Both `unmatched.label` and `notes` render as plain `<Text>` and nothing else.
 *
 * ## ⚠ A server-INJECTED detection cannot be unticked
 *
 * `Bodyweight` is withheld from the model and injected server-side (T-E1.7). It
 * is true of every room, and unticking it would make every bodyweight exercise
 * unavailable and get swapped or dropped for no reason. The store enforces this
 * too — belt and braces, because enforcing it in only one place makes the
 * guarantee depend on which store a future caller reaches for.
 *
 * ## ⚠ The draft is a DRAFT, and the scan is an accelerator, not the path
 *
 * E1's 0.966 recall was measured on mostly-stock photos, which are easy mode —
 * it is a ceiling, not a real-world rate. Confirming never implicitly saves a
 * gym, and every error state routes to the manual picker (AC-2.1/2.2 are the
 * floor, design § 1b).
 *
 * ## ⚠ Never "try rephrasing"
 *
 * There is no prompt to rephrase. That copy is the existing mistake at
 * `QuickAddSheetContainer.tsx:267` / `SnapAISheetContainer.tsx:100`.
 */

export type ScanStage = "capture" | "scanning" | "draft" | "error";

export type ScanErrorKind =
  /** 402 — not entitled. A conversion surface, not a dead end (design § 5.2). */
  | "entitlement"
  /** 422 — the model could not read the photo. */
  | "unreadable"
  /** 429 — 6 scans/day. */
  | "limit"
  /** 503 — Bedrock down, no fallback. */
  | "unavailable"
  | "generic";

export type EquipmentScanSheetPresenterProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly stage: ScanStage;
  readonly draft: EquipmentScanDraft | null;
  readonly deselectedIds: ReadonlySet<string>;
  readonly errorKind: ScanErrorKind | null;
  readonly hasCameraPermission: boolean;
  readonly offline: boolean;
  readonly onRequestPermission: () => void;
  readonly onTakePhoto: () => void;
  readonly onPickFromLibrary: () => void;
  readonly onToggleDetection: (equipmentTypeId: string) => void;
  readonly onUseDraft: () => void;
  readonly onRetry: () => void;
  readonly onPickManually: () => void;
  readonly onUpgrade: () => void;
};

type ScanErrorCopy = {
  readonly title: string;
  readonly body: string;
  readonly retryable: boolean;
  readonly upgrade: boolean;
};

export function scanErrorCopy(kind: ScanErrorKind): ScanErrorCopy {
  switch (kind) {
    case "entitlement":
      return {
        title: "Scanning is a Premium+ feature",
        body: "Upgrade to read a whole gym from one photo.",
        retryable: false,
        upgrade: true,
      };
    case "unreadable":
      return {
        title: "We couldn't read that photo",
        body: "Try a wider shot with more of the room in frame, and make sure it's well lit.",
        retryable: true,
        upgrade: false,
      };
    case "limit":
      return {
        title: "That's your scans for today",
        body: "You've used today's scans — they reset tomorrow. You can still pick your equipment by hand.",
        retryable: false,
        upgrade: false,
      };
    case "unavailable":
      // Named, not generalised. There is no cheaper fallback for the scan, so
      // "try again" on its own would send the user at a call that will fail for
      // as long as the outage lasts.
      return {
        title: "Scanning is unavailable right now",
        body: "The scan service is down. Pick your equipment by hand — it takes a minute and works the same.",
        retryable: true,
        upgrade: false,
      };
    case "generic":
      return {
        title: "Couldn't scan that photo",
        body: "Check your connection and try again, or pick your equipment by hand.",
        retryable: true,
        upgrade: false,
      };
  }
}

export function EquipmentScanSheetPresenter(
  props: EquipmentScanSheetPresenterProps,
) {
  const { visible, onClose, stage, errorKind } = props;
  const title =
    stage === "draft"
      ? "Confirm equipment"
      : stage === "error"
        ? "Scan"
        : "Scan your gym";

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      eyebrow={stage === "draft" ? "AI SCAN" : "LOADOUT"}
      accent={errorKind !== null ? "ember" : "primary"}
      height="tall"
      testID="loadout-scan-sheet"
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {stage === "capture" ? <CaptureStage {...props} /> : null}
        {stage === "scanning" ? <ScanningStage /> : null}
        {stage === "draft" ? <DraftStage {...props} /> : null}
        {stage === "error" && errorKind !== null ? (
          <ErrorStage kind={errorKind} {...props} />
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

function CaptureStage({
  hasCameraPermission,
  offline,
  onRequestPermission,
  onTakePhoto,
  onPickFromLibrary,
  onPickManually,
}: EquipmentScanSheetPresenterProps) {
  return (
    <View style={styles.stage} testID="loadout-scan-capture">
      <View style={styles.frame}>
        <Ionicons name="camera-outline" size={30} color={color.$text3} />
        <Text style={styles.frameText}>
          One wide shot of the room works best
        </Text>
      </View>

      <View style={styles.headings}>
        <Text style={styles.title}>Point it at the gym</Text>
        <Text style={styles.blurb}>
          Loadout reads the kit it can see, then you confirm the list before
          anything is adapted.
        </Text>
      </View>

      {offline ? (
        <Text style={styles.inlineWarning} testID="loadout-scan-offline">
          Scanning needs a connection. Pick your equipment by hand instead.
        </Text>
      ) : null}

      {!hasCameraPermission ? (
        <TouchableOpacity
          style={styles.primaryCta}
          onPress={onRequestPermission}
          testID="loadout-scan-permission"
          accessibilityRole="button"
        >
          <Text style={styles.primaryCtaText}>Allow camera access</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.primaryCta, offline && styles.ctaDisabled]}
          onPress={onTakePhoto}
          disabled={offline}
          testID="loadout-scan-capture-photo"
          accessibilityRole="button"
          accessibilityState={{ disabled: offline }}
        >
          <Ionicons name="camera" size={17} color={color.$primaryInk} />
          <Text style={styles.primaryCtaText}>Take a photo</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[styles.softCta, offline && styles.ctaDisabled]}
        onPress={onPickFromLibrary}
        disabled={offline}
        testID="loadout-scan-library"
        accessibilityRole="button"
        accessibilityState={{ disabled: offline }}
      >
        <Ionicons name="image-outline" size={17} color={color.$primary} />
        <Text style={styles.softCtaText}>Choose from library</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.ghostCta}
        onPress={onPickManually}
        testID="loadout-scan-manual"
        accessibilityRole="button"
      >
        <Text style={styles.ghostCtaText}>Pick equipment by hand</Text>
      </TouchableOpacity>
    </View>
  );
}

function ScanningStage() {
  return (
    <View style={styles.stage} testID="loadout-scan-scanning">
      <View style={styles.frame}>
        <ActivityIndicator color={color.$primary} />
      </View>
      <Text style={styles.scanningText}>Reading your gym…</Text>
      <Text style={styles.scanningSub}>
        This one takes a few seconds — it&apos;s looking at the whole room.
      </Text>
    </View>
  );
}

function DraftStage({
  draft,
  deselectedIds,
  onToggleDetection,
  onUseDraft,
  onPickManually,
}: EquipmentScanSheetPresenterProps) {
  if (draft === null) return null;
  const selectedCount = draft.detected.filter(
    (detection) =>
      detection.source === "injected" ||
      !deselectedIds.has(detection.equipmentTypeId),
  ).length;

  return (
    <View style={styles.stage} testID="loadout-scan-draft">
      <View style={styles.draftHeader}>
        <Text style={styles.eyebrow}>DETECTED · {selectedCount} SELECTED</Text>
        <Text style={styles.draftHint}>tap to untick anything wrong</Text>
      </View>

      <View style={styles.chips}>
        {draft.detected.map((detection) => {
          const injected = detection.source === "injected";
          const on = injected || !deselectedIds.has(detection.equipmentTypeId);
          return (
            <TouchableOpacity
              key={detection.equipmentTypeId}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => onToggleDetection(detection.equipmentTypeId)}
              disabled={injected}
              testID={`loadout-scan-chip-${detection.equipmentTypeId}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on, disabled: injected }}
              accessibilityLabel={
                injected
                  ? `${detection.name}, always available`
                  : detection.name
              }
            >
              {on ? (
                <Ionicons name="checkmark" size={13} color={color.$primary} />
              ) : null}
              {/* CATALOGUE name — never the model's label. */}
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {detection.name}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {draft.detected.length === 0 ? (
        <Text style={styles.inlineWarning} testID="loadout-scan-draft-empty">
          Nothing recognisable in that photo. Try another shot, or pick your
          equipment by hand.
        </Text>
      ) : null}

      {draft.unmatched.length > 0 ? (
        <View style={styles.unmatched} testID="loadout-scan-unmatched">
          <Text style={styles.eyebrow}>SEEN BUT NOT IN OUR LIST</Text>
          {draft.unmatched.map((item, index) => (
            // ⚠ `label` is untrusted model text — plain <Text>, not pressable,
            // no id behind it. Keyed by index because labels are free text, not
            // a key, and the server deliberately does not deduplicate them.
            <Text key={`${item.label}-${index}`} style={styles.unmatchedText}>
              • {item.label}
            </Text>
          ))}
          <Text style={styles.unmatchedNote}>
            You can add these by hand on the equipment list.
          </Text>
        </View>
      ) : null}

      {/* ⚠ Untrusted model prose. Plain text, attributed, never actionable. */}
      {draft.notes !== null && draft.notes.trim().length > 0 ? (
        <View style={styles.note} testID="loadout-scan-note">
          <Text style={styles.noteLabel}>Scan note</Text>
          <Text style={styles.noteText}>{draft.notes}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.primaryCta, selectedCount === 0 && styles.ctaDisabled]}
        onPress={onUseDraft}
        disabled={selectedCount === 0}
        testID="loadout-scan-use"
        accessibilityRole="button"
        accessibilityState={{ disabled: selectedCount === 0 }}
      >
        <Text style={styles.primaryCtaText}>
          {selectedCount === 0
            ? "Select at least one item"
            : `Use these ${itemLabel(selectedCount)}`}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.ghostCta}
        onPress={onPickManually}
        testID="loadout-scan-draft-manual"
        accessibilityRole="button"
      >
        <Text style={styles.ghostCtaText}>Edit the full equipment list</Text>
      </TouchableOpacity>
    </View>
  );
}

function ErrorStage({
  kind,
  onRetry,
  onPickManually,
  onUpgrade,
}: { readonly kind: ScanErrorKind } & EquipmentScanSheetPresenterProps) {
  const copy = scanErrorCopy(kind);
  return (
    <View style={styles.stage} testID="loadout-scan-error">
      <View style={styles.errorIcon}>
        <Ionicons
          name={kind === "limit" ? "time-outline" : "alert-circle-outline"}
          size={26}
          color={kind === "limit" ? color.$gold : color.$warning}
        />
      </View>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.blurb}>{copy.body}</Text>

      {copy.upgrade ? (
        <TouchableOpacity
          style={styles.primaryCta}
          onPress={onUpgrade}
          testID="loadout-scan-upgrade"
          accessibilityRole="button"
        >
          <Text style={styles.primaryCtaText}>See Premium+</Text>
        </TouchableOpacity>
      ) : null}

      {copy.retryable ? (
        <TouchableOpacity
          style={styles.primaryCta}
          onPress={onRetry}
          testID="loadout-scan-retry"
          accessibilityRole="button"
        >
          <Text style={styles.primaryCtaText}>Try another photo</Text>
        </TouchableOpacity>
      ) : null}

      <TouchableOpacity
        style={styles.ghostCta}
        onPress={onPickManually}
        testID="loadout-scan-error-manual"
        accessibilityRole="button"
      >
        <Text style={styles.ghostCtaText}>Pick equipment by hand</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: space.$base, paddingBottom: space.$2xl },
  stage: { gap: space.$md, paddingTop: space.$md },
  frame: {
    aspectRatio: 4 / 3,
    borderRadius: radius.$xl,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.$border3,
    backgroundColor: color.$surface2,
    alignItems: "center",
    justifyContent: "center",
    gap: space.$sm,
  },
  frameText: { fontSize: 11.5, color: color.$text3 },
  headings: { gap: space.$xs },
  title: {
    fontSize: 19,
    fontWeight: "700",
    color: color.$text,
    textAlign: "center",
  },
  blurb: {
    fontSize: 13.5,
    color: color.$text2,
    lineHeight: 20,
    textAlign: "center",
  },
  scanningText: {
    fontSize: 15,
    fontWeight: "700",
    color: color.$text2,
    textAlign: "center",
  },
  scanningSub: { fontSize: 12, color: color.$text4, textAlign: "center" },
  inlineWarning: { fontSize: 12.5, color: color.$warning, lineHeight: 18 },
  draftHeader: {
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
  draftHint: { fontSize: 10.5, color: color.$text4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.$sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.$xs,
    paddingVertical: space.$sm,
    paddingHorizontal: space.$md,
    borderRadius: radius.$pill,
    borderWidth: 1.5,
    borderColor: color.$border2,
    backgroundColor: color.$surface2,
  },
  chipOn: { borderColor: color.$primary, backgroundColor: color.$primaryDim },
  chipText: { fontSize: 12.5, fontWeight: "600", color: color.$text2 },
  chipTextOn: { color: color.$primary },
  unmatched: {
    gap: space.$xs,
    padding: space.$md,
    borderRadius: radius.$md,
    backgroundColor: color.$surface2,
  },
  unmatchedText: { fontSize: 12, color: color.$text3, lineHeight: 17 },
  unmatchedNote: { fontSize: 11, color: color.$text4, paddingTop: space.$xs },
  note: {
    gap: 3,
    padding: space.$md,
    borderRadius: radius.$md,
    backgroundColor: color.$surface2,
    borderLeftWidth: 2,
    borderLeftColor: color.$border3,
  },
  noteLabel: {
    fontSize: 9.5,
    letterSpacing: 0.9,
    fontWeight: "700",
    color: color.$text4,
  },
  noteText: { fontSize: 11.5, color: color.$text3, lineHeight: 16 },
  errorIcon: {
    alignSelf: "center",
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: color.$surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryCta: {
    flexDirection: "row",
    gap: space.$sm,
    height: 50,
    borderRadius: radius.$lg,
    backgroundColor: color.$primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryCtaText: { fontSize: 15, fontWeight: "700", color: color.$primaryInk },
  softCta: {
    flexDirection: "row",
    gap: space.$sm,
    height: 50,
    borderRadius: radius.$lg,
    backgroundColor: color.$primaryDim,
    alignItems: "center",
    justifyContent: "center",
  },
  softCtaText: { fontSize: 15, fontWeight: "700", color: color.$primary },
  ghostCta: { height: 44, alignItems: "center", justifyContent: "center" },
  ghostCtaText: { fontSize: 14, fontWeight: "600", color: color.$text2 },
  ctaDisabled: { opacity: 0.5 },
});
