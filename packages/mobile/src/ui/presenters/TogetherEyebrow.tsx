import { Text } from "@tamagui/core";

/** Canvas `.eb`: wide-tracked uppercase section label. */
export function TogetherEyebrow({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$display"
      fontSize={10.5}
      fontWeight="600"
      letterSpacing={1.7}
      textTransform="uppercase"
      color="$text3"
    >
      {children}
    </Text>
  );
}
