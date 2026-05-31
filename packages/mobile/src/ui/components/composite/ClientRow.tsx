import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";

import { Avatar, type AvatarTone } from "../foundation/Avatar";
import { Bar } from "../foundation/Bar";
import { Pill } from "../foundation/Pill";
import { IconChevronR, iconDefaults } from "../icons";
import { Skeleton } from "../Skeleton";

/**
 * <ClientRow> — trainer client list row: avatar + name + status badge + meta +
 * adherence bar + chevron. Composes Avatar, Pill, Bar.
 * Used by Trainer Clients list + Client detail headers.
 * Source: extra.jsx:257.
 * Implements 01-design-system/design.md § Composite primitives #7 +
 * STORY-004 AC 4.6 (loading skeleton).
 */

const TABULAR: ["tabular-nums"] = ["tabular-nums"];

export type ClientStatus = "active" | "attention" | "pr" | "missed";

export type ClientRowProps = {
  avatar: { initials: string; tone?: AvatarTone };
  name: string;
  status?: ClientStatus;
  tags?: string;
  lastSeen?: string;
  /** 0..100. */
  adherence?: number;
  onPress?: () => void;
  isLast?: boolean;
  loading?: boolean;
  testID?: string;
};

// Concrete adherence-bar colours by threshold (Bar takes a concrete colour).
const SUCCESS = "#34D399";
const GOLD = "#F5C518";
const ERROR = "#F87171";

function adherenceColor(adh: number): string {
  if (adh > 80) return SUCCESS;
  if (adh >= 50) return GOLD;
  return ERROR;
}

function StatusBadge({ status }: { status: ClientStatus }) {
  switch (status) {
    case "attention":
      return (
        <Pill tone="ember" size="xs">
          2 missed
        </Pill>
      );
    case "pr":
      return (
        <Pill tone="gold" size="xs">
          NEW PR
        </Pill>
      );
    case "missed":
      return (
        <Pill tone="error" size="xs">
          4 days idle
        </Pill>
      );
    case "active":
      return null;
  }
}

export function clientRowPressStyle({ pressed }: { pressed: boolean }) {
  return { opacity: pressed ? 0.8 : 1 };
}

export function ClientRow({
  avatar,
  name,
  status = "active",
  tags,
  lastSeen,
  adherence,
  onPress,
  isLast = false,
  loading = false,
  testID,
}: ClientRowProps) {
  const body = (
    <View
      flexDirection="row"
      alignItems="center"
      gap={12}
      paddingVertical={12}
      paddingHorizontal={14}
      borderBottomWidth={isLast ? 0 : 1}
      borderColor="$border"
      minHeight={44}
    >
      {loading ? (
        <Skeleton
          variant="circle"
          width={40}
          height={40}
          testID={testID ? `${testID}-skeleton` : undefined}
        />
      ) : (
        <Avatar
          initials={avatar.initials}
          size={40}
          tone={avatar.tone ?? "primary"}
        />
      )}

      <View flex={1} minWidth={0}>
        {loading ? (
          <View gap={6}>
            <Skeleton width={120} height={14} variant="text" />
            <Skeleton width={80} height={11} variant="text" />
          </View>
        ) : (
          <>
            <View
              flexDirection="row"
              alignItems="center"
              gap={6}
              marginBottom={2}
            >
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={20}
                color="$text"
                numberOfLines={1}
              >
                {name}
              </Text>
              <StatusBadge status={status} />
            </View>

            {tags || lastSeen ? (
              <Text
                fontFamily="$body"
                fontSize={11}
                color="$text3"
                numberOfLines={1}
              >
                {[tags, lastSeen ? `${lastSeen} ago` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            ) : null}

            {typeof adherence === "number" ? (
              <View
                flexDirection="row"
                alignItems="center"
                gap={6}
                marginTop={6}
              >
                <View flex={1}>
                  <Bar
                    pct={adherence / 100}
                    color={adherenceColor(adherence)}
                    height={3}
                    accessibilityLabel={`${name} adherence ${adherence}%`}
                  />
                </View>
                <Text
                  fontFamily="$mono"
                  fontSize={10}
                  color="$text3"
                  fontVariant={TABULAR}
                >
                  {`${adherence}%`}
                </Text>
              </View>
            ) : null}
          </>
        )}
      </View>

      {!loading ? (
        <IconChevronR {...iconDefaults({ size: 14 })} color="#8A8A98" />
      ) : null}
    </View>
  );

  if (!onPress || loading) {
    return (
      <View
        testID={testID}
        accessibilityLabel={loading ? "Loading client" : name}
      >
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={clientRowPressStyle}
    >
      {body}
    </Pressable>
  );
}
