import { Text, View } from "@tamagui/core";
import { Pressable } from "react-native";
import { toneHex } from "@/ui/components/foundation/tones";
import {
  IconBarcode,
  IconBook,
  IconCamera,
  IconLock,
  IconSearch,
} from "@/ui/components/icons";

/**
 * <QuickAddRowPresenter> — the 4-button quick-add strip (Conflict C5:
 * Scan / Snap / Search / Recipes). Snap is the Tier-B AI affordance: when
 * `aiLocked` it renders a gold lock badge and routes to the upgrade prompt
 * instead of the camera. Independently, when `snapOffline` (device offline —
 * the AI call is online-only and never queues, design.md § Revised
 * 2026-07-03 › Mobile flow) it renders disabled with a neutral lock badge
 * and doesn't fire `onSnap` at all — connectivity, not entitlement, is the
 * blocker, so it's a dead button rather than an upgrade routing.
 *
 * Pure: handlers + `aiLocked` / `snapOffline` are props.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <QuickAddRowPresenter>
 *             specs/13-nutrition-tracking/design.md § Revised 2026-07-03 › Mobile flow
 */

export type QuickAddRowProps = {
  aiLocked: boolean;
  /** True when offline — disables Snap independently of the AI entitlement. */
  snapOffline?: boolean;
  onScan: () => void;
  onSnap: () => void;
  onSearch: () => void;
  onRecipes: () => void;
  testID?: string;
};

function QuickBtn({
  icon,
  label,
  onPress,
  locked = false,
  disabled = false,
  lockTone = "gold",
  accessibilityLabel,
  testID,
}: {
  icon: React.ReactNode;
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
        borderWidth={1}
        borderColor="$border"
        backgroundColor="$surface2"
        borderRadius={14}
        paddingVertical={12}
        paddingHorizontal={6}
        alignItems="center"
        gap={6}
        position="relative"
      >
        {icon}
        <Text fontFamily="$body" fontSize={11} fontWeight="500" color="$text">
          {label}
        </Text>
        {locked ? (
          <View
            position="absolute"
            top={6}
            right={6}
            width={16}
            height={16}
            borderRadius={9999}
            alignItems="center"
            justifyContent="center"
            backgroundColor={lockTone === "gold" ? "$goldDim" : "$surface3"}
            testID={`${testID}-lock`}
          >
            <IconLock
              size={9}
              color={lockTone === "gold" ? toneHex("gold").base : "#8A8A98"}
            />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export function QuickAddRowPresenter({
  aiLocked,
  snapOffline = false,
  onScan,
  onSnap,
  onSearch,
  onRecipes,
  testID = "fuel-quick-add",
}: QuickAddRowProps) {
  const ink = toneHex("primary").base;
  const snapLocked = aiLocked || snapOffline;
  return (
    <View flexDirection="row" gap={10} testID={testID}>
      <QuickBtn
        testID="fuel-quick-scan"
        icon={<IconBarcode size={20} color={ink} />}
        label="Scan"
        onPress={onScan}
      />
      <QuickBtn
        testID="fuel-quick-snap"
        icon={
          <IconCamera
            size={20}
            color={snapLocked ? toneHex("gold").base : ink}
          />
        }
        label="Snap"
        onPress={onSnap}
        locked={snapLocked}
        disabled={snapOffline}
        lockTone={snapOffline ? "neutral" : "gold"}
        accessibilityLabel={
          snapOffline
            ? "Snap needs a connection — try Quick Add instead"
            : undefined
        }
      />
      <QuickBtn
        testID="fuel-quick-search"
        icon={<IconSearch size={20} color={ink} />}
        label="Search"
        onPress={onSearch}
      />
      <QuickBtn
        testID="fuel-quick-recipes"
        icon={<IconBook size={20} color={ink} />}
        label="Recipes"
        onPress={onRecipes}
      />
    </View>
  );
}
