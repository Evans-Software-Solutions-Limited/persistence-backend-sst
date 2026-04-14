import { View } from "@tamagui/core";
import type { ReactNode } from "react";

import { Button } from "./Button";
import { Text } from "./Text";

type EmptyStateProps = {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void };
  testID?: string;
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  testID,
}: EmptyStateProps) {
  return (
    <View
      flex={1}
      justifyContent="center"
      alignItems="center"
      padding="$2xl"
      gap="$base"
      testID={testID}
    >
      {icon}
      <Text variant="h3" align="center">
        {title}
      </Text>
      {description && (
        <Text variant="body" secondary align="center">
          {description}
        </Text>
      )}
      {action && (
        <View marginTop="$sm">
          <Button
            label={action.label}
            onPress={action.onPress}
            variant="primary"
          />
        </View>
      )}
    </View>
  );
}
