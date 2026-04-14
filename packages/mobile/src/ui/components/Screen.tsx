import { styled, View } from "@tamagui/core";
import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const ScreenFrame = styled(View, {
  flex: 1,
  backgroundColor: "$background",

  variants: {
    padded: {
      true: {
        paddingHorizontal: "$base",
      },
    },
    centered: {
      true: {
        justifyContent: "center",
        alignItems: "center",
      },
    },
  } as const,
});

type ScreenProps = {
  children: ReactNode;
  scroll?: boolean;
  padded?: boolean;
  centered?: boolean;
  testID?: string;
};

export function Screen({
  children,
  scroll = false,
  padded = false,
  centered = false,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();

  if (scroll) {
    return (
      <ScreenFrame
        padded={padded}
        testID={testID}
        style={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
        }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </ScreenFrame>
    );
  }

  return (
    <ScreenFrame
      padded={padded}
      centered={centered}
      testID={testID}
      style={{
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}
    >
      {children}
    </ScreenFrame>
  );
}
