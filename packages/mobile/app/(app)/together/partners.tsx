import { Text, View } from "@tamagui/core";
import { router } from "expo-router";
import { togetherTestEnabled } from "@/adapters/together/testGate";
import { TogetherPartnersContainer } from "@/ui/containers/TogetherPartnersContainer";
import { Btn } from "@/ui/components/foundation/Btn";
export default function TogetherPartnersRoute() {
  if (togetherTestEnabled(__DEV__, process.env.EXPO_PUBLIC_TOGETHER_TEST))
    return <TogetherPartnersContainer />;
  return (
    <View flex={1} backgroundColor="$bg" padding={24} paddingTop={72} gap={16}>
      <Text fontFamily="$body" color="$text">
        Training partners are unavailable in this app version.
      </Text>
      <Btn onPress={() => router.back()}>Back</Btn>
    </View>
  );
}
