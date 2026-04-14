import { View } from "@tamagui/core";

import { Button } from "./Button";
import { Text } from "./Text";

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
  testID?: string;
};

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  testID,
}: ErrorStateProps) {
  return (
    <View
      flex={1}
      justifyContent="center"
      alignItems="center"
      padding="$2xl"
      gap="$base"
      testID={testID}
    >
      <Text variant="h3" align="center">
        {title}
      </Text>
      <Text variant="body" secondary align="center">
        {message}
      </Text>
      {onRetry && (
        <View marginTop="$sm">
          <Button label="Retry" onPress={onRetry} variant="secondary" />
        </View>
      )}
    </View>
  );
}
