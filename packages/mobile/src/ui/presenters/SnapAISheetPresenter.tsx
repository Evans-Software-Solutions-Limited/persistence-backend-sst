import { useEffect } from "react";
import type { RefObject } from "react";
import { Pressable } from "react-native";
import { CameraView } from "expo-camera";
import { Text, View } from "@tamagui/core";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconCamera, IconClipboard, IconSparkles } from "@/ui/components/icons";
import type { MealSlot } from "@/domain/models/nutrition";
import {
  AiDraftConfirmPresenter,
  type AiDraftItem,
} from "./AiDraftConfirmPresenter";

/**
 * <SnapAISheetPresenter> — M9.5 Tier B AI photo recognition sheet
 * (fuel-sheets.jsx SnapSheet). State machine: capture → recognizing →
 * confirm → added, plus an `error` state for 422/503 failures. Pure: all
 * state/handlers are props; the container owns the camera, downscale/
 * compress, the AI call, and the per-item log commands. The confirm/added
 * stages delegate to the shared <AiDraftConfirmPresenter> — the same UI the
 * Quick-add free-text ("Or describe it…") flow uses.
 *
 * Implements: specs/13-nutrition-tracking/design.md § Revised 2026-07-03
 *             › Mobile flow (SnapAISheet)
 *             specs/13-nutrition-tracking/tasks.md T-13.11.1
 */

export type SnapStage =
  | "capture"
  | "recognizing"
  | "confirm"
  | "added"
  | "error";

/** A draft item in the confirm stage — the AI item + its keep/edit UI state. */
export type SnapDraftItem = AiDraftItem;

export type SnapAISheetProps = {
  visible: boolean;
  onClose: () => void;
  stage: SnapStage;
  /** True when the device is offline — disables the capture affordances. */
  offline: boolean;
  hasPermission: boolean;
  onRequestPermission: () => void;
  /** Forwarded to the mounted <CameraView> — the container calls
   * `cameraRef.current?.takePictureAsync()` from `onShutterPress`. */
  cameraRef: RefObject<CameraView | null>;
  onShutterPress: () => void;
  onPickFromLibrary: () => void;
  /** Draft items for the confirm/added stages. */
  items: readonly SnapDraftItem[];
  onToggleItem: (index: number) => void;
  onEditGrams: (index: number, grams: number) => void;
  /** Sum of kept (on: true) items' kcal — container-computed. */
  totalKcal: number;
  slot: MealSlot;
  onSlotChange: (slot: MealSlot) => void;
  onConfirm: () => void;
  errorMessage: string | null;
  onRetry: () => void;
  onChooseAnother: () => void;
  testID?: string;
};

function RecognizingOverlay() {
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 900 }), -1, true);
  }, [pulse]);

  const dotStyle = useAnimatedStyle(() => ({
    opacity: 0.3 + pulse.value * 0.7,
    transform: [{ scale: 0.8 + pulse.value * 0.2 }],
  }));

  return (
    <View
      position="absolute"
      inset={0}
      backgroundColor="rgba(0,0,0,0.4)"
      alignItems="center"
      justifyContent="center"
      gap={10}
      testID="snap-recognizing"
    >
      <View flexDirection="row" alignItems="center" gap={6}>
        <IconSparkles size={18} color={toneHex("gold").base} />
        <Text
          fontFamily="$display"
          fontWeight="700"
          fontSize={14}
          color="$gold"
        >
          Recognizing…
        </Text>
      </View>
      <View flexDirection="row" gap={4}>
        {[0, 1, 2].map((i) => (
          <Animated.View
            key={i}
            style={[
              {
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: toneHex("gold").base,
              },
              dotStyle,
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function CaptureStage({
  offline,
  hasPermission,
  onRequestPermission,
  cameraRef,
  onShutterPress,
  onPickFromLibrary,
}: Pick<
  SnapAISheetProps,
  | "offline"
  | "hasPermission"
  | "onRequestPermission"
  | "cameraRef"
  | "onShutterPress"
  | "onPickFromLibrary"
>) {
  if (offline) {
    return (
      <View gap={16} testID="snap-offline">
        <Text fontFamily="$body" fontSize={14} color="$text2">
          Snap needs a connection — try Quick Add instead.
        </Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View gap={16} testID="snap-permission">
        <Text fontFamily="$body" fontSize={14} color="$text2">
          Persistence needs camera access to snap a photo of your meal.
        </Text>
        <Btn
          variant="filled"
          tone="gold"
          size="lg"
          full
          onPress={onRequestPermission}
          testID="snap-grant"
        >
          Enable camera
        </Btn>
        <Btn
          variant="outline"
          tone="gold"
          size="md"
          full
          onPress={onPickFromLibrary}
          testID="snap-pick-library-no-permission"
        >
          Choose from library instead
        </Btn>
      </View>
    );
  }

  return (
    <View gap={14}>
      <View
        borderRadius={16}
        overflow="hidden"
        backgroundColor="$bg"
        borderColor="$border2"
        borderWidth={1}
        testID="snap-camera-wrap"
        style={{ aspectRatio: 4 / 3, position: "relative" }}
      >
        <CameraView ref={cameraRef} testID="snap-camera" style={{ flex: 1 }} />
        <View
          position="absolute"
          bottom={16}
          left={0}
          right={0}
          alignItems="center"
        >
          <Pressable
            testID="snap-shutter"
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            onPress={onShutterPress}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <View
              width={64}
              height={64}
              borderRadius={32}
              backgroundColor="$gold"
              alignItems="center"
              justifyContent="center"
              borderWidth={3}
              borderColor="rgba(255,255,255,0.4)"
            >
              <IconCamera size={26} color={toneHex("gold").ink} />
            </View>
          </Pressable>
        </View>
      </View>
      <Btn
        variant="outline"
        tone="gold"
        size="md"
        full
        icon={<IconClipboard size={16} />}
        onPress={onPickFromLibrary}
        testID="snap-pick-library"
      >
        Choose from photo library
      </Btn>
      <Text
        fontFamily="$body"
        fontSize={12.5}
        color="$text3"
        testID="snap-hint"
      >
        Frame your plate. AI works best with good lighting.
      </Text>
    </View>
  );
}

export function SnapAISheetPresenter(props: SnapAISheetProps) {
  const {
    visible,
    onClose,
    stage,
    offline,
    hasPermission,
    onRequestPermission,
    cameraRef,
    onShutterPress,
    onPickFromLibrary,
    items,
    onToggleItem,
    onEditGrams,
    totalKcal,
    slot,
    onSlotChange,
    onConfirm,
    errorMessage,
    onRetry,
    onChooseAnother,
    testID = "snap-sheet",
  } = props;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="AI photo recognition"
      eyebrow="SNAP · AI"
      accent="gold"
      height={86}
      testID={testID}
    >
      {stage === "capture" ? (
        <CaptureStage
          offline={offline}
          hasPermission={hasPermission}
          onRequestPermission={onRequestPermission}
          cameraRef={cameraRef}
          onShutterPress={onShutterPress}
          onPickFromLibrary={onPickFromLibrary}
        />
      ) : stage === "recognizing" ? (
        <View gap={14}>
          <View
            borderRadius={16}
            overflow="hidden"
            backgroundColor="$bg"
            borderColor="$border2"
            borderWidth={1}
            style={{ aspectRatio: 4 / 3, position: "relative" }}
          >
            <RecognizingOverlay />
          </View>
        </View>
      ) : stage === "confirm" || stage === "added" ? (
        <AiDraftConfirmPresenter
          items={items}
          onToggleItem={onToggleItem}
          onEditGrams={onEditGrams}
          totalKcal={totalKcal}
          slot={slot}
          onSlotChange={onSlotChange}
          onConfirm={onConfirm}
          added={stage === "added"}
          testID="snap-confirm"
        />
      ) : (
        <View gap={16} testID="snap-error">
          <Text fontFamily="$body" fontSize={14} color="$text2">
            {errorMessage ??
              "Couldn't read this photo — try Quick Add instead."}
          </Text>
          <Btn
            variant="filled"
            tone="gold"
            size="lg"
            full
            onPress={onRetry}
            testID="snap-error-retry"
          >
            Retry
          </Btn>
          <Btn
            variant="outline"
            tone="gold"
            size="md"
            full
            onPress={onChooseAnother}
            testID="snap-error-choose-another"
          >
            Choose another photo
          </Btn>
        </View>
      )}
    </BottomSheet>
  );
}
