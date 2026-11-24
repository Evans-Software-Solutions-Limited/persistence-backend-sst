import { ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InDevelopment } from "./kit";

/** PER-129 K shell — the coach Messages tab. Chat is PER-92. */
export function CoachMessagesPresenter() {
  const insets = useSafeAreaInsets();
  return (
    <View flex={1} paddingTop={insets.top} testID="coach-messages">
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20 }}>
        <Text
          fontFamily="$display"
          fontWeight="800"
          fontSize={34}
          lineHeight={40}
          letterSpacing={-1}
          color="$text"
          marginTop={18}
          accessibilityRole="header"
        >
          Messages
        </Text>
        <InDevelopment
          title="Messages"
          ticket="PER-92"
          testID="coach-messages-placeholder"
        />
      </ScrollView>
    </View>
  );
}
