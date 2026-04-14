import { useTheme as useTamaguiTheme } from "@tamagui/core";
import { ActivityIndicator } from "react-native";

type LoadingSpinnerProps = {
  size?: "sm" | "md" | "lg";
  testID?: string;
};

const sizeMap = {
  sm: "small" as const,
  md: "small" as const,
  lg: "large" as const,
};

export function LoadingSpinner({ size = "md", testID }: LoadingSpinnerProps) {
  const theme = useTamaguiTheme();

  return (
    <ActivityIndicator
      size={sizeMap[size]}
      color={theme.primary?.val}
      testID={testID}
      accessibilityLabel="Loading"
    />
  );
}
