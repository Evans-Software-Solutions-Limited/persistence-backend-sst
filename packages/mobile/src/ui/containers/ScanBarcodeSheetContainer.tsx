import { useCallback, useEffect, useRef, useState } from "react";
import { useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useFuelSheets } from "@/state/fuel-sheets";
import { useResolveBarcode } from "@/ui/hooks/useResolveBarcode";
import { useLogEntry } from "@/ui/hooks/useLogEntry";
import { localDayISO } from "@/shared/utils";
import type { Food, MealSlot } from "@/domain/models/nutrition";
import {
  ScanBarcodeSheetPresenter,
  type ScanStage,
} from "@/ui/presenters/ScanBarcodeSheetPresenter";

/**
 * <ScanBarcodeSheetContainer> — root-mounted barcode scanner. Owns the camera
 * permission, debounces duplicate reads, resolves the code (cache-first, offline
 * fallback), and logs the chosen food optimistically into the active slot.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <ScanBarcodeSheet>
 */

/** Ignore repeat reads of the same code within this window (debounce). */
const DUPLICATE_MS = 2000;

export function ScanBarcodeSheetContainer() {
  const sheet = useFuelSheets((s) => s.sheet);
  const slotFromStore = useFuelSheets((s) => s.slot);
  const close = useFuelSheets((s) => s.close);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const visible = sheet === "scan";

  const [permission, requestPermission] = useCameraPermissions();
  const { resolve, isResolving } = useResolveBarcode();
  const logEntry = useLogEntry();

  const [stage, setStage] = useState<ScanStage>("scanning");
  const [food, setFood] = useState<Food | null>(null);
  const [servings, setServings] = useState(1);
  const [slot, setSlot] = useState<MealSlot>(slotFromStore);

  const lastScanRef = useRef<{ code: string; at: number } | null>(null);

  useEffect(() => {
    if (visible) {
      setStage("scanning");
      setFood(null);
      setServings(1);
      setSlot(slotFromStore);
      lastScanRef.current = null;
    }
  }, [visible, slotFromStore]);

  const onBarcodeScanned = useCallback(
    (code: string) => {
      const now = Date.now();
      const last = lastScanRef.current;
      if (last && last.code === code && now - last.at < DUPLICATE_MS) return;
      lastScanRef.current = { code, at: now };

      void resolve(code).then((result) => {
        switch (result.status) {
          case "found":
            void Haptics.selectionAsync();
            setFood(result.food);
            setStage("found");
            break;
          case "not-found":
            setStage("not-found");
            break;
          case "cache-miss-offline":
            setStage("offline");
            break;
          default:
            setStage("unavailable");
        }
      });
    },
    [resolve],
  );

  const onRescan = useCallback(() => {
    setFood(null);
    setStage("scanning");
    lastScanRef.current = null;
  }, []);

  const onAdd = useCallback(async () => {
    if (!food) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await logEntry.mutate({
      foodId: food.id,
      mealSlot: slot,
      servings,
      loggedAt: new Date(`${localDayISO()}T12:00:00`).toISOString(),
    });
    notifyMutated();
    close();
  }, [food, slot, servings, logEntry, notifyMutated, close]);

  return (
    <ScanBarcodeSheetPresenter
      visible={visible}
      onClose={close}
      stage={stage}
      hasPermission={permission?.granted ?? false}
      onRequestPermission={() => void requestPermission()}
      onBarcodeScanned={onBarcodeScanned}
      isResolving={isResolving}
      food={food}
      servings={servings}
      onServingsChange={setServings}
      slot={slot}
      onSlotChange={setSlot}
      onAdd={() => void onAdd()}
      onRescan={onRescan}
    />
  );
}
