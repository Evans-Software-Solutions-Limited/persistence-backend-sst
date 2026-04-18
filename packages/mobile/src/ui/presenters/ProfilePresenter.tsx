import { View } from "@tamagui/core";
import { ScrollView } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Column,
  Row,
  Text,
} from "@/ui/components";
import { useStaggeredEntry } from "@/ui/hooks/useStaggeredEntry";

export type ProfilePresenterProps = {
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  isSigningOut: boolean;
  error: string | null;
  onSignOut: () => void;
};

function deriveInitials(email: string | null, displayName: string | null) {
  const source = displayName ?? email ?? "";
  const trimmed = source.trim();
  if (trimmed.length === 0) return "?";
  const parts = trimmed.split(/[\s@._-]+/).filter((p) => p.length > 0);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function ProfilePresenter({
  email,
  displayName,
  avatarUrl,
  isSigningOut,
  error,
  onSignOut,
}: ProfilePresenterProps) {
  const insets = useSafeAreaInsets();
  const headerStyle = useStaggeredEntry(0);
  const accountStyle = useStaggeredEntry(1);
  const placeholderStyle = useStaggeredEntry(2);
  const dangerStyle = useStaggeredEntry(3);

  const initials = deriveInitials(email, displayName);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: 16,
        paddingTop: 16,
        paddingBottom: 32 + insets.bottom,
        gap: 16,
      }}
      testID="profile-screen"
    >
      <Animated.View style={headerStyle}>
        <Row gap="base">
          <Avatar
            source={avatarUrl ?? undefined}
            fallback={initials}
            size="lg"
            testID="profile-avatar"
          />
          <Column gap="xs" flex={1}>
            <Text variant="h3" numberOfLines={1}>
              {displayName ?? "Welcome"}
            </Text>
            <Text variant="bodySmall" secondary numberOfLines={1}>
              {email ?? "Signed in"}
            </Text>
            <Row gap="xs" marginTop="$xs">
              <Badge label="MEMBER" variant="primary" size="sm" />
            </Row>
          </Column>
        </Row>
      </Animated.View>

      <Animated.View style={accountStyle}>
        <Card>
          <Column gap="sm">
            <Text variant="label" secondary>
              ACCOUNT
            </Text>
            <Row gap="sm" justify="between">
              <Text variant="bodySmall" secondary>
                Email
              </Text>
              <Text variant="bodySmall" testID="profile-email">
                {email ?? "—"}
              </Text>
            </Row>
          </Column>
        </Card>
      </Animated.View>

      <Animated.View style={placeholderStyle}>
        <Card outlined>
          <Column gap="xs">
            <Text variant="label" secondary>
              COMING SOON
            </Text>
            <Text variant="bodySmall" secondary>
              Profile editing, units, notifications, subscriptions and trainer
              tools will land in milestones 08–11.
            </Text>
          </Column>
        </Card>
      </Animated.View>

      {error && (
        <View
          paddingHorizontal="$base"
          paddingVertical="$md"
          borderRadius="$md"
          backgroundColor="rgba(239, 68, 68, 0.1)"
          borderWidth={1}
          borderColor="rgba(239, 68, 68, 0.2)"
        >
          <Text
            variant="bodySmall"
            color="$error"
            align="center"
            testID="profile-error"
          >
            {error}
          </Text>
        </View>
      )}

      <Animated.View style={dangerStyle}>
        <Button
          label={isSigningOut ? "Signing out..." : "Sign out"}
          onPress={onSignOut}
          variant="danger"
          isLoading={isSigningOut}
          isDisabled={isSigningOut}
          fullWidth
          testID="sign-out-button"
        />
      </Animated.View>
    </ScrollView>
  );
}
