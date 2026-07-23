import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import type { VolumeUnit } from "@/shared/utils";
import { WaterTrackerPresenter } from "./WaterTrackerPresenter";

/**
 * <WaterLogSheetPresenter> — a bottom-sheet wrapper around the shared
 * <WaterTrackerPresenter> so the Home quick-log "Water" tile can log water the
 * same way the WeighIn sheet logs body weight. Pure: cups/goal + handlers are
 * props; the container owns the absolute-cups (LWW) mutation.
 *
 * Implements: specs/06-progress-goals/design.md § Home quick-log
 */

export type WaterLogSheetProps = {
  visible: boolean;
  onClose: () => void;
  cups: number;
  goal: number;
  onSetCups: (cups: number) => void;
  /** Preferred display unit (device-QA #5/#7) — "l" (default) shows litres,
   *  "cups" shows the stored count directly. Display only. */
  volumeUnit?: VolumeUnit;
  testID?: string;
};

export function WaterLogSheetPresenter({
  visible,
  onClose,
  cups,
  goal,
  onSetCups,
  volumeUnit = "l",
  testID = "water-log-sheet",
}: WaterLogSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Log water"
      eyebrow="HYDRATION"
      accent="primary"
      height="peek"
      testID={testID}
    >
      <View gap={16}>
        <Text fontFamily="$body" fontSize={13} color="$text3">
          {volumeUnit === "cups"
            ? "Tap a cup or use +/- (1 cup each) to set how much water you've had today."
            : "Tap a cup or use +/- (0.25 L each) to set how much water you've had today."}
        </Text>
        <WaterTrackerPresenter
          cups={cups}
          goal={goal}
          onSetCups={onSetCups}
          volumeUnit={volumeUnit}
          testID="water-log-tracker"
        />
        <Btn
          variant="filled"
          tone="primary"
          size="lg"
          full
          onPress={onClose}
          testID="water-log-done"
        >
          Done
        </Btn>
      </View>
    </BottomSheet>
  );
}
