import { styled, View, Text as TamaguiText } from "@tamagui/core";
import type { ReactNode } from "react";
import { ActivityIndicator } from "react-native";

const ButtonFrame = styled(View, {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "$md",
  gap: "$sm",
  minHeight: 44,
  pressStyle: { opacity: 0.85, scale: 0.98 },

  variants: {
    variant: {
      primary: {
        backgroundColor: "$primary",
        pressStyle: {
          backgroundColor: "$primaryDark",
          opacity: 0.85,
          scale: 0.98,
        },
      },
      secondary: {
        backgroundColor: "$surface",
        borderWidth: 1,
        borderColor: "$primary",
        pressStyle: {
          backgroundColor: "$backgroundPress",
          opacity: 0.85,
          scale: 0.98,
        },
      },
      outline: {
        backgroundColor: "transparent",
        borderWidth: 1,
        borderColor: "$borderColor",
        pressStyle: {
          backgroundColor: "$backgroundPress",
          opacity: 0.85,
          scale: 0.98,
        },
      },
      ghost: {
        backgroundColor: "transparent",
        pressStyle: {
          backgroundColor: "$backgroundPress",
          opacity: 0.85,
          scale: 0.98,
        },
      },
      danger: {
        backgroundColor: "$error",
        pressStyle: {
          backgroundColor: "$errorDark",
          opacity: 0.85,
          scale: 0.98,
        },
      },
    },
    size: {
      sm: { height: 36, paddingHorizontal: "$sm", minHeight: 36 },
      md: { height: 44, paddingHorizontal: "$base" },
      lg: { height: 52, paddingHorizontal: "$lg" },
    },
    fullWidth: {
      true: { width: "100%" },
    },
    disabled: {
      true: { opacity: 0.5, pointerEvents: "none" },
    },
  } as const,

  defaultVariants: {
    variant: "primary",
    size: "md",
  },
});

const ButtonText = styled(TamaguiText, {
  fontFamily: "$body",
  fontWeight: "600",
  textAlign: "center",

  variants: {
    variant: {
      primary: { color: "$colorInverse" },
      secondary: { color: "$primary" },
      outline: { color: "$color" },
      ghost: { color: "$primary" },
      danger: { color: "$white" },
    },
    size: {
      sm: { fontSize: 14 },
      md: { fontSize: 16 },
      lg: { fontSize: 18 },
    },
  } as const,

  defaultVariants: {
    variant: "primary",
    size: "md",
  },
});

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  isDisabled?: boolean;
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  testID?: string;
};

/**
 * @deprecated Legacy button. New screen work should use the design-system
 * primitive `@/ui/components/foundation/Btn` (variant × tone × size matrix,
 * icon slot, 44pt floor, a11y). Retired in M11 Polish (12-production-readiness).
 */
export function Button({
  label,
  onPress,
  variant = "primary",
  size = "md",
  isLoading = false,
  isDisabled = false,
  fullWidth = false,
  leftIcon,
  testID,
}: ButtonProps) {
  const textColor =
    variant === "primary" || variant === "danger" ? "#FFFFFF" : undefined;

  return (
    <ButtonFrame
      variant={variant}
      size={size}
      fullWidth={fullWidth}
      disabled={isDisabled || isLoading}
      onPress={onPress}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled || isLoading }}
    >
      {isLoading ? (
        <ActivityIndicator
          size="small"
          color={textColor ?? "#00D4FF"}
          testID={testID ? `${testID}-spinner` : undefined}
        />
      ) : (
        <>
          {leftIcon}
          <ButtonText variant={variant} size={size}>
            {label}
          </ButtonText>
        </>
      )}
    </ButtonFrame>
  );
}
