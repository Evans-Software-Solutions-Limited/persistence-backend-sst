import { View } from "@tamagui/core";

import { Button } from "./Button";
import { Text } from "./Text";

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
  /**
   * Optional secondary action rendered below Retry as a ghost button.
   * Used as a strand-guard on coach screens: a 403 (e.g. a non-trainer
   * who reached coach mode) is persistent, so Retry alone keeps the user
   * stuck — the secondary action offers an escape ("Switch to athlete").
   */
  secondaryLabel?: string;
  onSecondary?: () => void;
  testID?: string;
};

export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  secondaryLabel,
  onSecondary,
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
      {secondaryLabel && onSecondary && (
        <Button
          label={secondaryLabel}
          onPress={onSecondary}
          variant="ghost"
          testID={testID ? `${testID}-secondary` : undefined}
        />
      )}
    </View>
  );
}
