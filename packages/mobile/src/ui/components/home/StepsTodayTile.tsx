import { Platform, Pressable } from "react-native";
import { View } from "@tamagui/core";
import type { HealthPermissionStatus } from "@/domain/ports/health.port";
import { Card } from "@/ui/components/Card";
import { Column } from "@/ui/components/Column";
import { Row } from "@/ui/components/Row";
import { Text } from "@/ui/components/Text";

/**
 * Three-state Steps-today tile.
 *
 * - "granted" + value: renders the count with a `$success` dot + last-synced caption.
 * - "denied" / "not_determined": renders a "Connect Health" CTA tile.
 * - "unavailable": renders a platform-aware muted copy.
 *
 * Spec: specs/07-health-integration/design.md § M1 scope > UI tiles
 *       · requirements.md STORY-007 AC 7.3, 7.5
 */

/**
 * Pick the "Not available" copy that actually describes the user's
 * platform. `StubHealthAdapter` reports `isAvailable: false` on web /
 * unknown platforms too — hardcoding Android in that branch was a
 * factual error flagged by bugbot on PR #37.
 */
function unavailableMessage(platformOS: typeof Platform.OS): string {
  if (platformOS === "android") return "Not available on Android yet";
  if (platformOS === "ios") return "Health not available on this iOS build";
  return "Health data not available";
}

export type StepsTodayTileProps = {
  stepsToday: number | null;
  isAvailable: boolean;
  permissionStatus: HealthPermissionStatus;
  lastReadAt: string | null;
  onConnectPress: () => void;
};

function formatLastReadAt(iso: string | null): string | null {
  if (!iso) return null;
  const diffMs = Date.now() - Date.parse(iso);
  if (Number.isNaN(diffMs)) return null;
  if (diffMs < 60 * 1000) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

export function StepsTodayTile({
  stepsToday,
  isAvailable,
  permissionStatus,
  lastReadAt,
  onConnectPress,
}: StepsTodayTileProps) {
  if (!isAvailable) {
    return (
      <Card testID="steps-tile-unavailable" padding="$base" gap="$xs">
        <Text variant="label" muted>
          STEPS TODAY
        </Text>
        <Text variant="body" muted>
          {unavailableMessage(Platform.OS)}
        </Text>
      </Card>
    );
  }

  const granted = permissionStatus.steps === "granted";
  if (!granted) {
    return (
      <Pressable onPress={onConnectPress} testID="steps-tile-connect">
        <Card pressable padding="$base" gap="$xs">
          <Text variant="label" muted>
            STEPS TODAY
          </Text>
          <Text variant="body">Connect Health</Text>
          <Text variant="caption" muted>
            Tap to grant permission
          </Text>
        </Card>
      </Pressable>
    );
  }

  const caption = formatLastReadAt(lastReadAt);
  return (
    <Card testID="steps-tile-granted" padding="$base" gap="$xs">
      <Row gap="xs">
        <View
          width={8}
          height={8}
          borderRadius="$full"
          backgroundColor="$success"
        />
        <Text variant="label" muted>
          STEPS TODAY
        </Text>
      </Row>
      <Text variant="h3" testID="steps-tile-value">
        {stepsToday ?? 0}
      </Text>
      {caption ? (
        <Text variant="caption" muted>
          Last synced {caption}
        </Text>
      ) : null}
      <Column />
    </Card>
  );
}
