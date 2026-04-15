import { View, Text as TamaguiText } from "@tamagui/core";

type OAuthButtonProps = {
  label: string;
  onPress: () => void;
  isLoading: boolean;
  isDisabled: boolean;
  icon: string;
  testID: string;
  marginTop?: "none" | "sm" | "md" | "lg" | "xl";
};

export function OAuthButton({
  label,
  onPress,
  isLoading,
  isDisabled,
  icon,
  testID,
  marginTop = "none",
}: OAuthButtonProps) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      justifyContent="center"
      height={52}
      marginTop={
        marginTop === "none"
          ? 0
          : marginTop === "sm"
            ? 4
            : marginTop === "md"
              ? 8
              : marginTop === "lg"
                ? 12
                : 16
      }
      borderRadius="$lg"
      borderWidth={1}
      borderColor="$borderColor"
      backgroundColor="$surface"
      opacity={isDisabled ? 0.5 : 1}
      pressStyle={{ opacity: 0.7, scale: 0.98 }}
      onPress={isDisabled ? undefined : onPress}
      testID={testID}
      gap="$md"
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {isLoading ? (
        <TamaguiText
          fontFamily="$body"
          fontSize={15}
          color="$colorSecondary"
          fontWeight="500"
        >
          Connecting...
        </TamaguiText>
      ) : (
        <>
          <TamaguiText
            fontFamily="$body"
            fontSize={18}
            fontWeight="700"
            color="$color"
          >
            {icon}
          </TamaguiText>
          <TamaguiText
            fontFamily="$body"
            fontSize={15}
            color="$color"
            fontWeight="500"
          >
            {label}
          </TamaguiText>
        </>
      )}
    </View>
  );
}
