import { useCallback, useEffect, useRef, useState } from "react";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useFuelSheets } from "@/state/fuel-sheets";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import {
  draftItemsFromEstimate,
  useAiDraftItems,
} from "@/ui/hooks/useAiDraftItems";
import type { MealSlot } from "@/domain/models/nutrition";
import {
  SnapAISheetPresenter,
  type SnapStage,
} from "@/ui/presenters/SnapAISheetPresenter";

/**
 * <SnapAISheetContainer> — root-mounted M9.5 Tier B AI photo recognition
 * sheet. Owns the camera permission + ref, the library picker, the local
 * downscale/compress (expo-image-manipulator, ≤1080px long edge, JPEG ~0.7),
 * the `estimateFromPhoto` call, and delegates the confirm draft-card state
 * (toggle/edit/log) to the shared `useAiDraftItems` hook — the same one the
 * Quick-add free-text flow uses.
 *
 * Online-only: the AI call never enters the sync queue. When offline, the
 * capture affordances are disabled ("Snap needs a connection…") rather than
 * queuing — the caller (FuelContainer / QuickAddSheetContainer) should also
 * gate opening this sheet on `aiGate.allowed`, but this container defends
 * independently against the offline case in case it's reached anyway (e.g.
 * connectivity drops while the sheet is already open).
 *
 * Implements: specs/13-nutrition-tracking/design.md § Revised 2026-07-03
 *             › Mobile flow (SnapAISheet)
 *             specs/13-nutrition-tracking/tasks.md T-13.11.1, T-13.11.2
 */

/** Long-edge cap + JPEG quality for the downscale before the AI call —
 * matches design.md § Revised 2026-07-03 › Image transport exactly. */
const MAX_DIMENSION = 1080;
const JPEG_QUALITY = 0.7;

export function SnapAISheetContainer() {
  const { api } = useAdapters();
  const sheet = useFuelSheets((s) => s.sheet);
  const slotFromStore = useFuelSheets((s) => s.slot);
  const close = useFuelSheets((s) => s.close);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const visible = sheet === "snap";

  // Guard convention shared with Scan/Quick-add: only a genuine dismiss of
  // THIS sheet (still visible) clears the store — a controlled handoff to
  // another root sheet is a no-op (see fuel-sheets.ts § FuelSheet).
  const onSheetClose = useCallback(() => {
    if (visible) close();
  }, [visible, close]);

  const online = useOnlineStatus();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const draft = useAiDraftItems();

  const [stage, setStage] = useState<SnapStage>("capture");
  const [slot, setSlot] = useState<MealSlot>(slotFromStore);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Retained so "Retry" can re-send the same photo without recapturing.
  const lastPhotoRef = useRef<{
    base64: string;
    mediaType: "image/jpeg";
  } | null>(null);

  const { setItems } = draft;
  useEffect(() => {
    if (visible) {
      setStage("capture");
      setItems([]);
      setSlot(slotFromStore);
      setErrorMessage(null);
      lastPhotoRef.current = null;
    }
  }, [visible, slotFromStore, setItems]);

  const runEstimate = useCallback(
    async (base64: string, mediaType: "image/jpeg") => {
      lastPhotoRef.current = { base64, mediaType };
      setStage("recognizing");
      const result = await api.estimateFromPhoto({
        imageBase64: base64,
        mediaType,
        mealType: slot,
      });
      if (!result.ok) {
        // 402 entitlement_denied shouldn't normally arrive here (the caller
        // gates opening this sheet on aiGate.allowed), but handle it
        // defensively with the same generic error copy — the gate is the
        // primary defence, not this fallback.
        setErrorMessage("Couldn't read this photo — try Quick Add instead.");
        setStage("error");
        return;
      }
      setItems(draftItemsFromEstimate(result.value));
      setStage("confirm");
    },
    [api, slot, setItems],
  );

  const onShutterPress = useCallback(async () => {
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
    if (!photo?.uri) return;
    const manipulated = await ImageManipulator.manipulateAsync(
      photo.uri,
      [{ resize: { width: MAX_DIMENSION } }],
      {
        compress: JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      },
    );
    if (!manipulated.base64) return;
    await runEstimate(manipulated.base64, "image/jpeg");
  }, [runEstimate]);

  const onPickFromLibrary = useCallback(async () => {
    const permissionResult =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) return;
    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (pickerResult.canceled) return;
    const asset = pickerResult.assets?.[0];
    if (!asset?.uri) return;
    const manipulated = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: MAX_DIMENSION } }],
      {
        compress: JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      },
    );
    if (!manipulated.base64) return;
    await runEstimate(manipulated.base64, "image/jpeg");
  }, [runEstimate]);

  const onRetry = useCallback(() => {
    const last = lastPhotoRef.current;
    if (!last) {
      setStage("capture");
      return;
    }
    void runEstimate(last.base64, last.mediaType);
  }, [runEstimate]);

  const onChooseAnother = useCallback(() => {
    lastPhotoRef.current = null;
    setStage("capture");
  }, []);

  const { confirm } = draft;
  const onConfirm = useCallback(async () => {
    const count = await confirm(slot);
    if (count === 0) return;
    notifyMutated();
    setStage("added");
    setTimeout(() => {
      close();
    }, 900);
  }, [confirm, slot, notifyMutated, close]);

  return (
    <SnapAISheetPresenter
      visible={visible}
      onClose={onSheetClose}
      stage={stage}
      offline={!online}
      hasPermission={permission?.granted ?? false}
      onRequestPermission={() => void requestPermission()}
      cameraRef={cameraRef}
      onShutterPress={() => void onShutterPress()}
      onPickFromLibrary={() => void onPickFromLibrary()}
      items={draft.items}
      onToggleItem={draft.onToggleItem}
      onEditGrams={draft.onEditGrams}
      totalKcal={draft.totalKcal}
      slot={slot}
      onSlotChange={setSlot}
      onConfirm={() => void onConfirm()}
      confirming={draft.confirming}
      errorMessage={errorMessage}
      onRetry={onRetry}
      onChooseAnother={onChooseAnother}
    />
  );
}
