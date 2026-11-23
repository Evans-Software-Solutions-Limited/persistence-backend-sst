import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { toneHex } from "@/ui/components/foundation/tones";
import {
  IconBarcode,
  IconCamera,
  IconEdit,
  IconLock,
  IconSearch,
  IconSparkles,
} from "@/ui/components/icons";

/**
 * <FuelQuickActionsPresenter> — the five quick buttons (PER-132; canvas N1,
 * Brad 18 Nov): Scan · Snap · Search · Quick log · Suggest. Used on Log and at
 * the top of Add to a meal; each opens the drawer for that job.
 *
 * - Snap: AI, online only. Locked (gold badge) without the AI entitlement;
 *   disabled (neutral badge) offline, because the call never queues.
 * - Suggest: Mealprint One meal. Free and Premium see a gold badge and the
 *   locked page; it is never disabled.
 */

export type FuelQuickActionsProps = {
  aiLocked: boolean;
  snapOffline: boolean;
  suggestLocked: boolean;
  onScan: () => void;
  onSnap: () => void;
  onSearch: () => void;
  onQuickLog: () => void;
  onSuggest: () => void;
  testID?: string;
};

const INK = toneHex("primary").base;
const GOLD = toneHex("gold").base;

function QuickAction({
  icon,
  label,
  onPress,
  locked = false,
  disabled = false,
  lockTone = "gold",
  accessibilityLabel,
  testID,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  locked?: boolean;
  disabled?: boolean;
  lockTone?: "gold" | "neutral";
  accessibilityLabel?: string;
  testID: string;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={
        accessibilityLabel ?? (locked ? `${label} (locked)` : label)
      }
      style={({ pressed }) => ({
        flex: 1,
        opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
      })}
    >
      <View
        height={56}
        borderRadius={14}
        borderWidth={1}
        borderColor="$border"
        backgroundColor="$surface"
        alignItems="center"
        justifyContent="center"
        gap={4}
        position="relative"
      >
        {icon}
        <Text
          fontFamily="$body"
          fontSize={11}
          fontWeight="600"
          color="$text"
          numberOfLines={1}
        >
          {label}
        </Text>
        {locked ? (
          <View
            position="absolute"
            top={5}
            right={5}
            width={14}
            height={14}
            borderRadius={9999}
            alignItems="center"
            justifyContent="center"
            backgroundColor={lockTone === "gold" ? "$goldDim" : "$surface3"}
            testID={`${testID}-lock`}
          >
            <IconLock size={8} color={lockTone === "gold" ? GOLD : "#8A8A98"} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function FuelQuickActionsPresenter({
  aiLocked,
  snapOffline,
  suggestLocked,
  onScan,
  onSnap,
  onSearch,
  onQuickLog,
  onSuggest,
  testID = "fuel-quick-actions",
}: FuelQuickActionsProps) {
  const snapLocked = aiLocked || snapOffline;
  return (
    <View flexDirection="row" gap={6} testID={testID}>
      <QuickAction
        testID={`${testID}-scan`}
        icon={<IconBarcode size={20} color={INK} />}
        label="Scan"
        onPress={onScan}
      />
      <QuickAction
        testID={`${testID}-snap`}
        icon={<IconCamera size={20} color={snapLocked ? GOLD : INK} />}
        label="Snap"
        onPress={onSnap}
        locked={snapLocked}
        disabled={snapOffline}
        lockTone={snapOffline ? "neutral" : "gold"}
        accessibilityLabel={snapOffline ? "Snap needs a connection" : undefined}
      />
      <QuickAction
        testID={`${testID}-search`}
        icon={<IconSearch size={20} color={INK} />}
        label="Search"
        onPress={onSearch}
      />
      <QuickAction
        testID={`${testID}-quick-log`}
        icon={<IconEdit size={20} color={INK} />}
        label="Quick log"
        onPress={onQuickLog}
      />
      <QuickAction
        testID={`${testID}-suggest`}
        icon={<IconSparkles size={20} color={suggestLocked ? GOLD : INK} />}
        label="Suggest"
        onPress={onSuggest}
        locked={suggestLocked}
        accessibilityLabel={
          suggestLocked
            ? "Suggest a meal with Mealprint (Premium+)"
            : "Suggest a meal with Mealprint"
        }
      />
    </View>
  );
}
