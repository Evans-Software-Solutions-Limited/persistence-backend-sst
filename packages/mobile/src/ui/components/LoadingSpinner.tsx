import { useTheme as useTamaguiTheme } from "@tamagui/core";
import { PLogoDrawLoader } from "./PLogoDrawLoader";

type LoadingSpinnerProps = {
  size?: "sm" | "md" | "lg";
  testID?: string;
  color?: string;
  accessibilityLabel?: string;
};

const sizeMap = {
  sm: 18,
  md: 24,
  lg: 40,
};

export function LoadingSpinner({
  size = "md",
  testID,
  color,
  accessibilityLabel = "Loading",
}: LoadingSpinnerProps) {
  const theme = useTamaguiTheme();

  return (
    <PLogoDrawLoader
      size={sizeMap[size]}
      color={color ?? theme.primary?.val}
      testID={testID}
      containerPadding={0}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
