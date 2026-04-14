import { styled, View, Text as TamaguiText } from "@tamagui/core";

const BadgeFrame = styled(View, {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "$full",

  variants: {
    variant: {
      default: { backgroundColor: "$surfaceSecondary" },
      success: { backgroundColor: "$successDark" },
      warning: { backgroundColor: "$warningDark" },
      error: { backgroundColor: "$errorDark" },
      info: { backgroundColor: "$infoDark" },
      primary: { backgroundColor: "$primary" },
    },
    size: {
      sm: {
        paddingHorizontal: "$sm",
        paddingVertical: "$xxs",
        minWidth: 20,
        height: 20,
      },
      md: {
        paddingHorizontal: "$md",
        paddingVertical: "$xs",
        minWidth: 24,
        height: 24,
      },
    },
  } as const,

  defaultVariants: {
    variant: "default",
    size: "sm",
  },
});

const BadgeText = styled(TamaguiText, {
  fontFamily: "$body",
  fontWeight: "600",
  textAlign: "center",
  color: "$white",

  variants: {
    size: {
      sm: { fontSize: 11, lineHeight: 14 },
      md: { fontSize: 12, lineHeight: 16 },
    },
  } as const,

  defaultVariants: {
    size: "sm",
  },
});

type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "primary";
type BadgeSize = "sm" | "md";

type BadgeProps = {
  label: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
  testID?: string;
};

export function Badge({
  label,
  variant = "default",
  size = "sm",
  testID,
}: BadgeProps) {
  return (
    <BadgeFrame variant={variant} size={size} testID={testID}>
      <BadgeText size={size}>{label}</BadgeText>
    </BadgeFrame>
  );
}
