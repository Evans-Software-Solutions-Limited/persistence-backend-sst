import type { ReactNode } from "react";
import { View } from "@tamagui/core";
import { IconBtn, Stat } from "@/ui/components/foundation";
import { IconMinus, IconPlus } from "@/ui/components/icons";

/**
 * <PortionStepperPresenter> — value + unit with -/+ IconBtns (fuel-sheets.jsx
 * PortionStepper). The value renders via the design-system <Stat> (mono,
 * tabular). Optional `children` slot for presets (grams mode).
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <ScanBarcodeSheet>
 */

export type PortionStepperProps = {
  value: number;
  unit: string;
  onDec: () => void;
  onInc: () => void;
  children?: ReactNode;
  testID?: string;
};

export function PortionStepperPresenter({
  value,
  unit,
  onDec,
  onInc,
  children,
  testID = "portion-stepper",
}: PortionStepperProps) {
  return (
    <View testID={testID}>
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
      >
        <View flexDirection="row" alignItems="baseline" gap={6}>
          <Stat
            value={value}
            unit={unit}
            size="md"
            testID={`${testID}-value`}
          />
        </View>
        <View flexDirection="row" gap={8}>
          <IconBtn
            icon={<IconMinus size={14} strokeWidth={2.5} />}
            tone="neutral"
            onPress={onDec}
            testID={`${testID}-dec`}
            accessibilityLabel="Decrease portion"
          />
          <IconBtn
            icon={<IconPlus size={14} strokeWidth={2.5} />}
            tone="primary"
            onPress={onInc}
            testID={`${testID}-inc`}
            accessibilityLabel="Increase portion"
          />
        </View>
      </View>
      {children}
    </View>
  );
}
