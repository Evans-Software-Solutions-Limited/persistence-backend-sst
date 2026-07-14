import { CameraView } from "expo-camera";
import { Text, View } from "@tamagui/core";
import {
  BottomSheet,
  Btn,
  Card,
  Pill,
  Segmented,
  Stat,
} from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconBarcode, IconCheck } from "@/ui/components/icons";
import type { Food, MealSlot } from "@/domain/models/nutrition";
import type { PortionMode } from "@/domain/services";
import { MealPickerPresenter } from "./MealPickerPresenter";
import { PortionStepperPresenter } from "./PortionStepperPresenter";

/**
 * <ScanBarcodeSheetPresenter> — barcode scanner sheet (fuel-sheets.jsx ScanSheet).
 * Camera viewfinder + scanning/found status <Pill>, a recognised-item <Card>
 * (macro <Pill>s + kcal <Stat>), a 3-mode portion picker (<Segmented> +
 * <PortionStepper>), the shared <MealPicker>, and an Add button. On-device
 * EAN/UPC decode via expo-camera; camera mounts only while scanning.
 *
 * Pure: stage + portion + handlers are props; the container owns resolve, the
 * portion math, and the log. The offline / not-found / unavailable states are
 * V2 offline-first additions (design.md § Offline behaviour) on top of the
 * prototype's scanning→found flow.
 *
 * Implements: specs/milestones/M9-nutrition/FRONTEND_BRIEF.md § <ScanBarcodeSheet>
 */

const PORTION_OPTIONS: { value: PortionMode; label: string }[] = [
  { value: "serving", label: "Serving" },
  { value: "grams", label: "Grams" },
  { value: "cups", label: "Cups" },
];

const intl = (n: number) => Math.round(n).toLocaleString("en-US");
const round1 = (n: number) => Math.round(n * 10) / 10;

export type ScanStage =
  | "scanning"
  | "found"
  | "not-found"
  | "offline"
  | "unavailable";

export type ScanScaledMacros = {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type ScanBarcodeSheetProps = {
  visible: boolean;
  onClose: () => void;
  stage: ScanStage;
  hasPermission: boolean;
  onRequestPermission: () => void;
  onBarcodeScanned: (code: string) => void;
  isResolving: boolean;
  food: Food | null;
  /** Portion entry. */
  portionMode: PortionMode;
  onPortionModeChange: (mode: PortionMode) => void;
  /** The active mode's value (servings / grams / cups). */
  portionValue: number;
  onPortionDec: () => void;
  onPortionInc: () => void;
  /** Effective grams for the "= N g" readout (container-computed). */
  effectiveGrams: number;
  /** Macros scaled to the chosen portion (container-computed). */
  scaled: ScanScaledMacros;
  slot: MealSlot;
  onSlotChange: (slot: MealSlot) => void;
  onAdd: () => void;
  onRescan: () => void;
  testID?: string;
};

function FoundCard({ food, scaled }: { food: Food; scaled: ScanScaledMacros }) {
  return (
    <Card pad={14} radius={14} accent="primary" testID="scan-found-card">
      <View flexDirection="row" alignItems="center" gap={12}>
        <View
          width={50}
          height={50}
          borderRadius={10}
          backgroundColor="$goldDim"
          alignItems="center"
          justifyContent="center"
        >
          <IconBarcode size={22} color={toneHex("gold").base} />
        </View>
        <View flex={1}>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={14}
            color="$text"
            numberOfLines={1}
          >
            {food.name}
          </Text>
          <Text
            fontFamily="$body"
            fontSize={11.5}
            color="$text3"
            numberOfLines={1}
          >
            {food.barcode ? `${food.barcode} · ` : ""}per {food.servingSize}
            {food.servingUnit}
          </Text>
          <View flexDirection="row" gap={6} marginTop={6}>
            <Pill
              tone="neutral"
              size="xs"
            >{`P ${round1(scaled.proteinG)}g`}</Pill>
            <Pill
              tone="neutral"
              size="xs"
            >{`C ${round1(scaled.carbsG)}g`}</Pill>
            <Pill tone="neutral" size="xs">{`F ${round1(scaled.fatG)}g`}</Pill>
          </View>
          {food.source === "openfoodfacts" ? (
            <Text
              fontFamily="$body"
              fontSize={10.5}
              color="$text3"
              marginTop={4}
              testID="scan-off-credit"
            >
              Data: Open Food Facts
            </Text>
          ) : null}
        </View>
        <Stat
          value={intl(scaled.kcal)}
          unit="kcal"
          tone="gold"
          size="md"
          align="center"
          testID="scan-kcal"
        />
      </View>
    </Card>
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
  portionMode,
  onPortionModeChange,
  portionValue,
  onPortionDec,
  onPortionInc,
  effectiveGrams,
  scaled,
  slot,
  onSlotChange,
  onAdd,
  onRescan,
  testID = "scan-sheet",
}: ScanBarcodeSheetProps) {
  // A "serving" means the real pack serving (OFF `servingQuantity`) when known,
  // else the food's own `servingSize` — matches portionToServings.
  const servingGrams =
    food?.servingQuantity && food.servingQuantity > 0
      ? food.servingQuantity
      : (food?.servingSize ?? 0);
  const portionUnit =
    portionMode === "serving"
      ? `× ${servingGrams}${food?.servingUnit ?? "g"}`
      : portionMode === "grams"
        ? "grams"
        : portionValue === 1
          ? "cup"
          : "cups";

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Scan barcode"
      eyebrow="QUICK LOG"
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
          <View gap={14}>
            <View
              borderRadius={16}
              overflow="hidden"
              backgroundColor="$bg"
              borderColor="$border2"
              borderWidth={1}
              testID="scan-camera-wrap"
              style={{ aspectRatio: 16 / 9, position: "relative" }}
            >
              <CameraView
                testID="scan-camera"
                style={{ flex: 1 }}
                barcodeScannerSettings={{ barcodeTypes: ["ean13", "upc_a"] }}
                onBarcodeScanned={({ data }: { data: string }) =>
                  onBarcodeScanned(data)
                }
              />
              <View
                position="absolute"
                bottom={12}
                left={0}
                right={0}
                alignItems="center"
              >
                <Pill tone={isResolving ? "primary" : "neutral"} size="md">
                  {isResolving ? "Looking up…" : "Scanning…"}
                </Pill>
              </View>
            </View>
            <Text
              fontFamily="$body"
              fontSize={12.5}
              color="$text3"
              testID="scan-hint"
            >
              Centre the barcode in the frame. Hold still.
            </Text>
          </View>
        )
      ) : stage === "found" && food ? (
        <View gap={14} testID="scan-found">
          <FoundCard food={food} scaled={scaled} />

          <Card pad={14} radius={14}>
            <View
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              marginBottom={12}
            >
              <Text
                fontFamily="$display"
                fontSize={10.5}
                fontWeight="600"
                letterSpacing={1.5}
                textTransform="uppercase"
                color="$text3"
              >
                Portion
              </Text>
              <Text
                fontFamily="$mono"
                fontSize={10.5}
                color="$text3"
                fontVariant={["tabular-nums"]}
              >
                = {intl(effectiveGrams)} g
              </Text>
            </View>
            <View marginBottom={14}>
              <Segmented
                testID="scan-portion-mode"
                options={PORTION_OPTIONS}
                value={portionMode}
                onChange={(v) => onPortionModeChange(v as PortionMode)}
              />
            </View>
            <PortionStepperPresenter
              testID="scan-portion"
              value={portionValue}
              unit={portionUnit}
              onDec={onPortionDec}
              onInc={onPortionInc}
            />
          </Card>

          <MealPickerPresenter
            value={slot}
            onChange={onSlotChange}
            testID="scan-meal-picker"
          />

          <Btn
            variant="filled"
            tone="primary"
            size="lg"
            full
            onPress={onAdd}
            testID="scan-confirm"
            icon={<IconCheck size={16} strokeWidth={2.5} />}
          >
            Add
          </Btn>
          <Btn
            variant="ghost"
            tone="primary"
            size="sm"
            full
            onPress={onRescan}
            testID="scan-rescan"
          >
            Scan again
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
