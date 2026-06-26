import { CameraView } from "expo-camera";
import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn, Card, IconBtn } from "@/ui/components/foundation";
import { IconBack, IconMinus, IconPlus } from "@/ui/components/icons";
import type { Food, MealSlot } from "@/domain/models/nutrition";
import { MEAL_SLOTS, scaleFoodMacros } from "@/domain/services";

/**
 * <ScanBarcodeSheetPresenter> — barcode scanner sheet (fuel-sheets.jsx ScanSheet).
 * On-device EAN/UPC decode via expo-camera's CameraView (free, no key). Stages:
 * scanning → found (food card → serving + slot → Add). 404 → add-manually path;
 * offline-uncached → graceful notice. The camera mounts ONLY while scanning so it
 * releases on close / once a code resolves (battery + privacy).
 *
 * Pure: stage + handlers are props; the container owns resolve + log.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <ScanBarcodeSheet>
 */

const intl = (n: number) => Math.round(n).toLocaleString("en-US");

export type ScanStage =
  | "scanning"
  | "found"
  | "not-found"
  | "offline"
  | "unavailable";

export type ScanBarcodeSheetProps = {
  visible: boolean;
  onClose: () => void;
  stage: ScanStage;
  hasPermission: boolean;
  onRequestPermission: () => void;
  onBarcodeScanned: (code: string) => void;
  isResolving: boolean;
  food: Food | null;
  servings: number;
  onServingsChange: (n: number) => void;
  slot: MealSlot;
  onSlotChange: (slot: MealSlot) => void;
  onAdd: () => void;
  onRescan: () => void;
  testID?: string;
};

function SlotChips({
  slot,
  onSlotChange,
}: {
  slot: MealSlot;
  onSlotChange: (slot: MealSlot) => void;
}) {
  return (
    <View flexDirection="row" gap={8} flexWrap="wrap">
      {MEAL_SLOTS.map((m) => {
        const active = slot === m.slot;
        return (
          <Pressable
            key={m.slot}
            testID={`scan-slot-${m.slot}`}
            onPress={() => onSlotChange(m.slot)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={m.label}
          >
            <View
              paddingVertical={6}
              paddingHorizontal={14}
              borderRadius={9999}
              borderWidth={1}
              backgroundColor={active ? "$primaryDim" : "$surface3"}
              borderColor={active ? "$primary" : "$border2"}
            >
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={12}
                color={active ? "$primary" : "$text2"}
              >
                {m.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ScanBarcodeSheetPresenter({
  visible,
  onClose,
  stage,
  hasPermission,
  onRequestPermission,
  onBarcodeScanned,
  isResolving,
  food,
  servings,
  onServingsChange,
  slot,
  onSlotChange,
  onAdd,
  onRescan,
  testID = "scan-sheet",
}: ScanBarcodeSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Scan barcode"
      eyebrow="ADD FOOD"
      accent="primary"
      height="tall"
      testID={testID}
    >
      {stage === "scanning" ? (
        !hasPermission ? (
          <View gap={16} testID="scan-permission">
            <Text fontFamily="$body" fontSize={14} color="$text2">
              Persistence needs camera access to scan food barcodes.
            </Text>
            <Btn
              variant="filled"
              tone="primary"
              size="lg"
              full
              onPress={onRequestPermission}
              testID="scan-grant"
            >
              Enable camera
            </Btn>
          </View>
        ) : (
          <View gap={12}>
            <View
              height={280}
              borderRadius={16}
              overflow="hidden"
              backgroundColor="$bg"
              testID="scan-camera-wrap"
            >
              <CameraView
                testID="scan-camera"
                style={{ flex: 1 }}
                barcodeScannerSettings={{ barcodeTypes: ["ean13", "upc_a"] }}
                onBarcodeScanned={({ data }: { data: string }) =>
                  onBarcodeScanned(data)
                }
              />
            </View>
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$text3"
              testID="scan-hint"
            >
              {isResolving ? "Looking up…" : "Point your camera at a barcode."}
            </Text>
          </View>
        )
      ) : stage === "found" && food ? (
        <View gap={16} testID="scan-found">
          <View flexDirection="row" alignItems="center" gap={10}>
            <IconBtn
              icon={<IconBack size={18} />}
              tone="neutral"
              onPress={onRescan}
              testID="scan-rescan"
              accessibilityLabel="Scan again"
            />
            <View flex={1}>
              <Text
                fontFamily="$display"
                fontWeight="700"
                fontSize={16}
                color="$text"
                numberOfLines={1}
              >
                {food.name}
              </Text>
              {food.source === "openfoodfacts" ? (
                <Text
                  fontFamily="$body"
                  fontSize={10.5}
                  color="$text3"
                  testID="scan-off-credit"
                >
                  Data: Open Food Facts
                </Text>
              ) : null}
            </View>
          </View>
          <Card pad={16} radius={14}>
            <View
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
            >
              <Text
                fontFamily="$display"
                fontSize={10.5}
                fontWeight="600"
                letterSpacing={1.5}
                textTransform="uppercase"
                color="$text3"
              >
                Servings
              </Text>
              <View flexDirection="row" alignItems="center" gap={12}>
                <IconBtn
                  icon={<IconMinus size={16} strokeWidth={2.5} />}
                  tone="neutral"
                  onPress={() =>
                    onServingsChange(Math.max(0.5, servings - 0.5))
                  }
                  testID="scan-servings-minus"
                  accessibilityLabel="Fewer servings"
                />
                <Text
                  fontFamily="$mono"
                  fontSize={20}
                  fontWeight="600"
                  color="$text"
                  fontVariant={["tabular-nums"]}
                  testID="scan-servings"
                >
                  {servings}
                </Text>
                <IconBtn
                  icon={<IconPlus size={16} strokeWidth={2.5} />}
                  tone="primary"
                  onPress={() => onServingsChange(servings + 0.5)}
                  testID="scan-servings-plus"
                  accessibilityLabel="More servings"
                />
              </View>
            </View>
            <Text fontFamily="$mono" fontSize={13} color="$text" marginTop={14}>
              {intl(scaleFoodMacros(food, servings).kcal)} kcal
            </Text>
          </Card>
          <SlotChips slot={slot} onSlotChange={onSlotChange} />
          <Btn
            variant="filled"
            tone="primary"
            size="lg"
            full
            onPress={onAdd}
            testID="scan-confirm"
            icon={<IconPlus size={16} strokeWidth={2.5} />}
          >
            Add to {MEAL_SLOTS.find((m) => m.slot === slot)?.label}
          </Btn>
        </View>
      ) : stage === "not-found" ? (
        <View gap={16} testID="scan-not-found">
          <Text fontFamily="$body" fontSize={14} color="$text2">
            We couldn&apos;t find that barcode in the database. You can add this
            food manually.
          </Text>
          <Btn
            variant="outline"
            tone="primary"
            size="lg"
            full
            onPress={onRescan}
            testID="scan-not-found-rescan"
          >
            Scan again
          </Btn>
        </View>
      ) : stage === "offline" ? (
        <View gap={16} testID="scan-offline">
          <Text fontFamily="$body" fontSize={14} color="$text2">
            Food not in cache — connect to the internet to fetch it from the
            database.
          </Text>
          <Btn
            variant="outline"
            tone="primary"
            size="lg"
            full
            onPress={onRescan}
            testID="scan-offline-rescan"
          >
            Scan again
          </Btn>
        </View>
      ) : (
        <View gap={16} testID="scan-unavailable">
          <Text fontFamily="$body" fontSize={14} color="$text2">
            The barcode service is unavailable right now. Please try again
            later.
          </Text>
          <Btn
            variant="outline"
            tone="primary"
            size="lg"
            full
            onPress={onRescan}
            testID="scan-unavailable-rescan"
          >
            Scan again
          </Btn>
        </View>
      )}
    </BottomSheet>
  );
}
