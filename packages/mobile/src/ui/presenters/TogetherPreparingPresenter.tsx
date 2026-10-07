import { Text, View } from "@tamagui/core";

export function TogetherPreparingPresenter() {
  return (
    <View gap={12} testID="together-starting">
      <Text color="$text" fontFamily="$display" fontSize={17}>
        Preparing your session…
      </Text>
      <Text color="$text2" fontFamily="$body">
        We’re preparing the connection and your shared workout. Your logged sets
        stay yours.
      </Text>
    </View>
  );
}
