import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation/Btn";
import { Card } from "@/ui/components/foundation/Card";
export function RequiredUpdatePresenter(p: {
  minimum: string;
  storeAvailable: boolean;
  busy: boolean;
  error: string;
  onUpdate(): void;
  onRetry(): void;
}) {
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      padding={24}
      justifyContent="center"
      gap={20}
      testID="required-app-update"
    >
      <Text
        fontFamily="$display"
        fontSize={28}
        color="$text"
        accessibilityRole="header"
      >
        Update Persistence
      </Text>
      <Card pad={20} style={{ gap: 12 }}>
        <Text fontFamily="$body" color="$text">
          Install the latest app to continue. Version {p.minimum} or later is
          required.
        </Text>
        <Text fontFamily="$body" color="$text2">
          Your saved workouts stay on this device. Updating the app does not
          require uninstalling it.
        </Text>
        {!p.storeAvailable && (
          <Text color="$text2">
            Install the latest build from your testing distribution, then reopen
            the app.
          </Text>
        )}
      </Card>
      {p.error && (
        <Text accessibilityRole="alert" color="$error">
          {p.error}
        </Text>
      )}
      {p.storeAvailable && (
        <Btn full disabled={p.busy} onPress={p.onUpdate}>
          Update app
        </Btn>
      )}
      <Btn full variant="outline" disabled={p.busy} onPress={p.onRetry}>
        Check again
      </Btn>
    </View>
  );
}
