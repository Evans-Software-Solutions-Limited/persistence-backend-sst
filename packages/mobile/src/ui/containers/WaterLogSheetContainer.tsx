import { useCallback, useEffect, useState } from "react";
import * as Haptics from "expo-haptics";
import { useGetWaterToday } from "@/ui/hooks/useGetWaterToday";
import { useSetWater } from "@/ui/hooks/useSetWater";
import { localDayISO } from "@/shared/utils";
import { WaterLogSheetPresenter } from "@/ui/presenters/WaterLogSheetPresenter";

/**
 * <WaterLogSheetContainer> — wires the Home quick-log Water sheet to the M9
 * water log (absolute cups, last-write-wins). Seeds from today's cached water,
 * fires a selection haptic per tap, and queues the optimistic mutation.
 *
 * Implements: specs/06-progress-goals/design.md § Home quick-log
 */
export function WaterLogSheetContainer({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const date = localDayISO();
  const water = useGetWaterToday(date);
  const setWater = useSetWater();

  const serverCups = water.data?.cups ?? 0;
  const goal = water.data?.goal ?? 8;
  const [cups, setCups] = useState(serverCups);

  // Seed local cups from the cached value each time the sheet opens.
  useEffect(() => {
    if (visible) setCups(serverCups);
  }, [visible, serverCups]);

  const onSetCups = useCallback(
    (next: number) => {
      const clamped = Math.max(0, next);
      setCups(clamped);
      void Haptics.selectionAsync();
      void setWater.mutate({ date, cups: clamped });
    },
    [setWater, date],
  );

  return (
    <WaterLogSheetPresenter
      visible={visible}
      onClose={onClose}
      cups={cups}
      goal={goal}
      onSetCups={onSetCups}
    />
  );
}
