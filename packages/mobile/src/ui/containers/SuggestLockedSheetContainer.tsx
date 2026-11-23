import { useCallback } from "react";
import { useFuelSheets } from "@/state/fuel-sheets";
import { useMealprintGate } from "@/ui/hooks/useMealprintGate";
import { SuggestLockedSheetPresenter } from "@/ui/presenters/fuel/SuggestLockedSheetPresenter";

/**
 * <SuggestLockedSheetContainer> — root-mounted locked Mealprint page (N26)
 * that Free and Premium see from Suggest (PER-132). "See Premium+" goes to the
 * same paywall as every other Mealprint entry point.
 */
export function SuggestLockedSheetContainer() {
  const sheet = useFuelSheets((s) => s.sheet);
  const close = useFuelSheets((s) => s.close);
  const visible = sheet === "suggestLocked";
  const gate = useMealprintGate();

  const onClose = useCallback(() => {
    if (visible) close();
  }, [visible, close]);

  return (
    <SuggestLockedSheetPresenter
      visible={visible}
      onClose={onClose}
      onUpgrade={() => {
        close();
        gate.onUpgrade();
      }}
    />
  );
}
