import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useFuelSheets } from "@/state/fuel-sheets";
import { useResolveBarcode } from "@/ui/hooks/useResolveBarcode";
import { useLogEntry } from "@/ui/hooks/useLogEntry";
import { dayLabel, loggedAtNoonUtc, localDayISO } from "@/shared/utils";
import {
  portionToServings,
  scaleFoodMacros,
  type PortionMode,
} from "@/domain/services";
import type { Food, MealSlot } from "@/domain/models/nutrition";
import {
  ScanBarcodeSheetPresenter,
  type ScanStage,
} from "@/ui/presenters/ScanBarcodeSheetPresenter";

/**
 * <ScanBarcodeSheetContainer> — root-mounted barcode scanner. Owns the camera
 * permission, debounces duplicate reads, resolves the code (cache-first, offline
 * fallback), runs the Serving/Grams/Cups portion math (fuel-sheets.jsx), and
 * logs the chosen food optimistically into the active slot.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <ScanBarcodeSheet>
 */

/** Ignore repeat reads of the same code within this window (debounce). */
const DUPLICATE_MS = 2000;

export function ScanBarcodeSheetContainer() {
  const sheet = useFuelSheets((s) => s.sheet);
  const slotFromStore = useFuelSheets((s) => s.slot);
  // The day this scan flow logs into (QA-20) — kept in sync with the Fuel
  // screen's viewed day by <FuelContainer>.
  const activeDate = useFuelSheets((s) => s.date);
  const close = useFuelSheets((s) => s.close);
  const notifyMutated = useFuelSheets((s) => s.notifyMutated);
  const visible = sheet === "scan";
  // Day-context line (QA-20) — only surfaced on a past day.
  const dayContext =
    activeDate === localDayISO() ? undefined : dayLabel(activeDate);

  // gorhom fires onClose on any close (incl. a controlled handoff). Only a
  // genuine dismiss of THIS sheet should clear the shared store — mirrors the
  // Quick-add guard so the two root-mounted sheets can't clobber each other.
  const onSheetClose = useCallback(() => {
    if (visible) close();
  }, [visible, close]);

  const [permission, requestPermission] = useCameraPermissions();
  const { resolve, isResolving } = useResolveBarcode();
  const logEntry = useLogEntry();

  const [stage, setStage] = useState<ScanStage>("scanning");
  const [food, setFood] = useState<Food | null>(null);
  const [slot, setSlot] = useState<MealSlot>(slotFromStore);

  // Portion entry — three independent values per the prototype.
  const [portionMode, setPortionMode] = useState<PortionMode>("serving");
  const [servings, setServings] = useState(1);
  const [grams, setGrams] = useState(100);
  const [cups, setCups] = useState(1);

  const lastScanRef = useRef<{ code: string; at: number } | null>(null);

  const resetPortion = useCallback((f: Food | null) => {
    setPortionMode("serving");
    setServings(1);
    setGrams(f?.servingSize && f.servingSize > 0 ? f.servingSize : 100);
    setCups(1);
  }, []);

  useEffect(() => {
    if (visible) {
      setStage("scanning");
      setFood(null);
      setSlot(slotFromStore);
      resetPortion(null);
      lastScanRef.current = null;
    }
  }, [visible, slotFromStore, resetPortion]);

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
            resetPortion(result.food);
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
    [resolve, resetPortion],
  );

  const onRescan = useCallback(() => {
    setFood(null);
    setStage("scanning");
    lastScanRef.current = null;
  }, []);

  // Active portion value + the servings multiple it maps to.
  const portionValue =
    portionMode === "serving"
      ? servings
      : portionMode === "grams"
        ? grams
        : cups;
  const servingsScale = useMemo(
    () => (food ? portionToServings(food, portionMode, portionValue) : 0),
    [food, portionMode, portionValue],
  );
  // Mirror the service's 100 g fallback so the "= N g" readout shows the real
  // gram-equivalent (not 0 g) for foods with no serving size.
  const effSize = food && food.servingSize > 0 ? food.servingSize : 100;
  const effectiveGrams = Math.round(servingsScale * effSize);
  const scaled = useMemo(
    () =>
      food
        ? scaleFoodMacros(food, servingsScale)
        : { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
    [food, servingsScale],
  );

  const onPortionDec = useCallback(() => {
    if (portionMode === "serving")
      setServings((v) => Math.max(0.5, +(v - 0.5).toFixed(1)));
    else if (portionMode === "grams") setGrams((v) => Math.max(10, v - 10));
    else setCups((v) => Math.max(0.25, +(v - 0.25).toFixed(2)));
  }, [portionMode]);

  const onPortionInc = useCallback(() => {
    if (portionMode === "serving") setServings((v) => +(v + 0.5).toFixed(1));
    else if (portionMode === "grams") setGrams((v) => v + 10);
    else setCups((v) => +(v + 0.25).toFixed(2));
  }, [portionMode]);

  const onAdd = useCallback(async () => {
    if (!food) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await logEntry.mutate({
      foodId: food.id,
      mealSlot: slot,
      servings: servingsScale,
      // Noon-UTC of the ACTIVE day (QA-20 — not always today) keeps the
      // optimistic entry in that day's cache bucket for every timezone (the
      // command slices this for the day-key).
      loggedAt: loggedAtNoonUtc(activeDate),
    });
    notifyMutated();
    close();
  }, [food, slot, servingsScale, logEntry, notifyMutated, close, activeDate]);

  return (
    <ScanBarcodeSheetPresenter
      visible={visible}
      onClose={onSheetClose}
      dayContext={dayContext}
      stage={stage}
      hasPermission={permission?.granted ?? false}
      onRequestPermission={() => void requestPermission()}
      onBarcodeScanned={onBarcodeScanned}
      isResolving={isResolving}
      food={food}
      portionMode={portionMode}
      onPortionModeChange={setPortionMode}
      portionValue={portionValue}
      onPortionDec={onPortionDec}
      onPortionInc={onPortionInc}
      effectiveGrams={effectiveGrams}
      scaled={scaled}
      slot={slot}
      onSlotChange={setSlot}
      onAdd={() => void onAdd()}
      onRescan={onRescan}
    />
  );
}
