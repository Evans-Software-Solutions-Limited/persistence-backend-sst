import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useCameraPermissions } from "expo-camera";
import { useCallback, useEffect, useRef, useState } from "react";
import type { EquipmentPickerGroup } from "@/domain/services/loadout.service";
import { scanDraftToEquipmentIds } from "@/domain/services/loadout.service";
import type { LoadoutApiError } from "@/domain/ports/api.port";
import { resizeToLongEdge } from "@/shared/utils";
import { useLoadoutFlow } from "@/state/loadout-flow";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  EquipmentScanSheetPresenter,
  type ScanErrorKind,
  type ScanStage,
} from "@/ui/presenters/loadout/EquipmentScanSheetPresenter";

/**
 * <EquipmentScanSheetContainer> — the gym-photo scan (T-3.4, AC-2.3, design D1).
 *
 * Rendered INSIDE `<LoadoutFlowContainer>` rather than at the layout root, so it
 * layers above the collect step it opens from (see that file's mount note).
 * Driven by `useLoadoutFlow`'s `scan` step.
 *
 * ## ⚠ Payload sizing is fixed here, not inherited
 *
 * `SnapAISheetContainer` resizes width-only despite documenting a long-edge cap,
 * so portrait photos ship a third over budget and small ones get upscaled. This
 * uses `resizeToLongEdge`, which caps the real long edge and never upscales —
 * see that helper for why the scan cares most: Opus-class, $0.0272 an inference,
 * a 6/day ceiling, and the slowest call in the app.
 *
 * ## ⚠ Error copy: every branch names its cause and offers the picker
 *
 * 402 is a conversion surface (design § 5.2 — there is no taster to fall back
 * on), 429 is the 6/day ceiling, 422 is an unreadable photo, and 503 means
 * Bedrock is down with **no cheaper fallback**. All four route to the manual
 * picker, which is the floor rather than a consolation (AC-2.1/2.2, design § 1b).
 * **None of them says "try rephrasing"** — there is no prompt to rephrase, and
 * that copy is the existing mistake at `QuickAddSheetContainer.tsx:267` and
 * `SnapAISheetContainer.tsx:100`.
 *
 * ## ⚠ Confirming a draft never saves a gym
 *
 * AC-2.3: the scan produces a DRAFT. "Use these" adapts against the confirmed
 * ids with `saveAsGym: false`; naming and saving is the manual step's job, which
 * is what "Edit the full equipment list" routes to (pre-selected). E1's 0.966
 * recall was measured on mostly-stock photos and is a ceiling, not a real-world
 * rate — silently persisting a gym from it would be persisting a guess.
 */

/** Long-edge cap + JPEG quality — design § 8.1's transport budget. */
const MAX_DIMENSION = 1080;
const JPEG_QUALITY = 0.7;

/** The label a scanned context carries when the user has not named it. */
export const SCANNED_GYM_LABEL = "Scanned gym";

export function classifyScanError(error: LoadoutApiError): ScanErrorKind {
  if (error.code === "entitlement_denied") return "entitlement";
  if (error.status === 422) return "unreadable";
  if (error.status === 429) return "limit";
  if (error.status === 503) return "unavailable";
  return "generic";
}

export type EquipmentScanSheetContainerProps = {
  /** Passed through only so the presenter's manual-picker routes have a target. */
  readonly equipmentGroups: readonly EquipmentPickerGroup[];
  /** Leave the scan for the checklist, optionally carrying the confirmed ids. */
  readonly onPickManually: (preselectedIds: readonly string[]) => void;
  readonly onUpgrade: () => void;
};

export function EquipmentScanSheetContainer({
  onPickManually,
  onUpgrade,
}: EquipmentScanSheetContainerProps) {
  const { api } = useAdapters();
  const online = useOnlineStatus();
  const [permission, requestPermission] = useCameraPermissions();

  const step = useLoadoutFlow((s) => s.step);
  const scanDraft = useLoadoutFlow((s) => s.scanDraft);
  const deselectedIds = useLoadoutFlow((s) => s.scanDeselectedIds);
  const setScanDraft = useLoadoutFlow((s) => s.setScanDraft);
  const toggleScanDetection = useLoadoutFlow((s) => s.toggleScanDetection);
  const selectEquipmentIds = useLoadoutFlow((s) => s.selectEquipmentIds);
  const goToStep = useLoadoutFlow((s) => s.goToStep);

  const visible = step === "scan";
  const [stage, setStage] = useState<ScanStage>("capture");
  const [errorKind, setErrorKind] = useState<ScanErrorKind | null>(null);
  /**
   * Bumped on every open and every capture, so a settled request can tell
   * whether it still owns the sheet.
   *
   * ⚠ Needed because the scan is the SLOWEST call in the app (E1: ~10 s mean)
   * and the sheet is dismissable throughout. Without it: start a scan, dismiss,
   * reopen for a different room, and the first response paints the previous
   * photo's detections over the fresh sheet — after which `scanDraftToEquipmentIds`
   * adapts the workout against equipment from another gym.
   */
  const runIdRef = useRef(0);

  // Reset on every open. A draft left from a previous photo would otherwise be
  // the first thing the user sees, and every chip in it would look like a
  // detection from the room they are standing in now.
  useEffect(() => {
    if (!visible) return;
    runIdRef.current += 1;
    setStage("capture");
    setErrorKind(null);
    setScanDraft(null);
  }, [visible, setScanDraft]);

  const runScan = useCallback(
    async (uri: string, width: number, height: number) => {
      runIdRef.current += 1;
      const runId = runIdRef.current;
      const isCurrent = () => runIdRef.current === runId;

      setStage("scanning");
      setErrorKind(null);
      // ⚠ The whole body is guarded, and the `scanning` stage is why.
      // `manipulateAsync` THROWS on a corrupt or undecodable asset and on OOM
      // for a large image — and the stage has already been set, so an escaped
      // rejection leaves the sheet on a spinner with no error branch, no retry
      // and no way out but dismissing it. (`SnapAISheetContainer` avoids this
      // only by accident: it manipulates before entering its scanning stage.)
      try {
        const manipulated = await ImageManipulator.manipulateAsync(
          uri,
          resizeToLongEdge(width, height, MAX_DIMENSION),
          {
            compress: JPEG_QUALITY,
            format: ImageManipulator.SaveFormat.JPEG,
            base64: true,
          },
        );
        if (!isCurrent()) return;
        if (!manipulated.base64) {
          setErrorKind("generic");
          setStage("error");
          return;
        }
        const result = await api.scanEquipment({
          imageBase64: manipulated.base64,
          mediaType: "image/jpeg",
        });
        if (!isCurrent()) return;
        if (!result.ok) {
          setErrorKind(classifyScanError(result.error));
          setStage("error");
          return;
        }
        setScanDraft(result.value);
        setStage("draft");
      } catch {
        if (!isCurrent()) return;
        setErrorKind("generic");
        setStage("error");
      }
    },
    [api, setScanDraft],
  );

  const onTakePhoto = useCallback(async () => {
    // The system camera UI rather than an inline `<CameraView>`: the sheet is
    // ~88% of the screen with a scrolling body, which is the wrong frame for
    // composing the wide room shot the model needs (E1: framing is the single
    // biggest driver of recall on real photos).
    let result: ImagePicker.ImagePickerResult;
    try {
      // Throws outright when the camera is unavailable (simulator, in use by
      // another app). Unhandled, that is a rejection with no visible effect —
      // the user taps and nothing happens at all.
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 1,
      });
    } catch {
      setErrorKind("generic");
      setStage("error");
      return;
    }
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    await runScan(asset.uri, asset.width, asset.height);
  }, [runScan]);

  const onPickFromLibrary = useCallback(async () => {
    let result: ImagePicker.ImagePickerResult;
    try {
      const permissionResult =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) return;
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
      });
    } catch {
      setErrorKind("generic");
      setStage("error");
      return;
    }
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    await runScan(asset.uri, asset.width, asset.height);
  }, [runScan]);

  const confirmedIds = useCallback(
    () =>
      scanDraft === null
        ? []
        : scanDraftToEquipmentIds(scanDraft, deselectedIds),
    [scanDraft, deselectedIds],
  );

  const onUseDraft = useCallback(() => {
    const ids = confirmedIds();
    // ⚠ Survives mutation, and is kept deliberately. The presenter already
    // disables the CTA at zero, so this cannot fire from the UI today — but the
    // two checks guard different things: that one is a visual affordance, this
    // one stops an empty `equipmentTypeIds` reaching the store, where it would
    // preview against no kit and return a plan of nothing but unresolved rows.
    // The presenter's disable is what is mutation-tested; this is the backstop.
    if (ids.length === 0) return;
    // `saveAsGym: false` — confirming a draft is not a decision to keep it
    // (AC-2.3). The manual step is where naming and saving happen.
    selectEquipmentIds(ids, SCANNED_GYM_LABEL, false);
  }, [confirmedIds, selectEquipmentIds]);

  const onRetry = useCallback(() => {
    setErrorKind(null);
    setStage("capture");
  }, []);

  /**
   * ⚠ gorhom fires `onClose` for a PROGRAMMATIC close too — including the one
   * our own CTAs cause by flipping `step` away from `"scan"`, which drops
   * `visible` and makes `BottomSheet` call `ref.current.close()`. Unguarded,
   * this callback then ran a beat later and overwrote the step the CTA had
   * just set, so BOTH exits from the sheet landed back on `collect`:
   * "Use these N items" never reached `adapting` (the scan result was
   * discarded and nothing was ever adapted) and "Edit the full equipment list"
   * never reached the pre-seeded checklist. Device-verified 2026-08-02; no
   * test could catch it because Jest mocks gorhom, so `onClose` never fires.
   *
   * Read the step from `getState()` rather than the subscribed `step` above:
   * this closure is invoked from the animation callback, after the store has
   * already moved on. A close that still finds the flow on `"scan"` is the
   * only one that is a genuine user dismissal.
   *
   * `ScanBarcodeSheetContainer`, `QuickAddSheetContainer` and
   * `SnapAISheetContainer` guard the same gorhom hazard with the render-time
   * `if (visible)` form instead. Both are correct — `ref.current.close()` runs
   * in an effect AFTER the render that dropped `visible`, so the closure gorhom
   * captured is the post-CTA one either way — but this sheet's step lives in a
   * store rather than a prop, so reading it directly is the closer statement of
   * the rule.
   */
  const onSheetClose = useCallback(() => {
    if (useLoadoutFlow.getState().step !== "scan") return;
    goToStep("collect");
  }, [goToStep]);

  const goManual = useCallback(() => {
    onPickManually(confirmedIds());
    goToStep("manual");
  }, [confirmedIds, onPickManually, goToStep]);

  return (
    <EquipmentScanSheetPresenter
      visible={visible}
      onClose={onSheetClose}
      stage={stage}
      draft={scanDraft}
      deselectedIds={deselectedIds}
      errorKind={errorKind}
      hasCameraPermission={permission?.granted ?? false}
      offline={!online}
      onRequestPermission={() => void requestPermission()}
      onTakePhoto={() => void onTakePhoto()}
      onPickFromLibrary={() => void onPickFromLibrary()}
      onToggleDetection={toggleScanDetection}
      onUseDraft={onUseDraft}
      onRetry={onRetry}
      onPickManually={goManual}
      onUpgrade={onUpgrade}
    />
  );
}
