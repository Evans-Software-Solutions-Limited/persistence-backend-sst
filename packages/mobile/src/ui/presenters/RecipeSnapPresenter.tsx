import type { RefObject } from "react";
import { Pressable } from "react-native";
import { CameraView } from "expo-camera";
import { Text, View } from "@tamagui/core";
import { SafeAreaView } from "react-native-safe-area-context";
import { Btn, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { IconBack, IconCamera, IconClipboard } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

/**
 * <RecipeSnapPresenter> — Snap-a-recipe-photo (recipes.jsx `SnapRecipePhoto`,
 * full-screen route rather than a bottom sheet — a recipe photo capture
 * needs the same reliable-scroll/keyboard posture as the create form it
 * hands off to). AI-GATED. Mirrors <SnapAISheetPresenter>'s capture/
 * recognizing/error stage shapes; a successful extraction hands off straight
 * to the create-recipe form (no separate preview stage — the form IS the
 * review step) rather than the prototype's inline preview card.
 *
 * Implements: specs/milestones (Recipes AI PR3 brief) § F. Snap-a-recipe-photo
 */

export type RecipeSnapStage = "capture" | "extracting" | "error";

export type RecipeSnapPresenterProps = {
  stage: RecipeSnapStage;
  /** True when offline — disables the capture affordances (the AI call
   * couldn't succeed anyway). */
  offline: boolean;
  hasPermission: boolean;
  onRequestPermission: () => void;
  cameraRef: RefObject<CameraView | null>;
  onShutterPress: () => void;
  onPickFromLibrary: () => void;
  errorMessage: string | null;
  onRetry: () => void;
  onChooseAnother: () => void;
  onBack: () => void;
  testID?: string;
};

function CaptureStage({
  offline,
  hasPermission,
  onRequestPermission,
  cameraRef,
  onShutterPress,
  onPickFromLibrary,
}: Pick<
  RecipeSnapPresenterProps,
  | "offline"
  | "hasPermission"
  | "onRequestPermission"
  | "cameraRef"
  | "onShutterPress"
  | "onPickFromLibrary"
>) {
  if (offline) {
    return (
      <View gap={16} testID="recipe-snap-offline">
        <Text fontFamily="$body" fontSize={14} color="$text2">
          Snap needs a connection — try again once you&rsquo;re back online, or
          enter the recipe manually.
        </Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View gap={16} testID="recipe-snap-permission">
        <Text fontFamily="$body" fontSize={14} color="$text2">
          Persistence needs camera access to snap a photo of your recipe.
        </Text>
        <Btn
          variant="filled"
          tone="gold"
          size="lg"
          full
          onPress={onRequestPermission}
          testID="recipe-snap-grant"
        >
          Enable camera
        </Btn>
        <Btn
          variant="outline"
          tone="gold"
          size="md"
          full
          onPress={onPickFromLibrary}
          testID="recipe-snap-pick-library-no-permission"
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
        testID="recipe-snap-camera-wrap"
        style={{ aspectRatio: 3 / 4, position: "relative" }}
      >
        <CameraView
          ref={cameraRef}
          testID="recipe-snap-camera"
          style={{ flex: 1 }}
        />
        <View
          position="absolute"
          bottom={16}
          left={0}
          right={0}
          alignItems="center"
        >
          <Pressable
            testID="recipe-snap-shutter"
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
              <IconCamera size={26} color={color.$goldInk} />
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
        testID="recipe-snap-pick-library"
      >
        Choose from photo library
      </Btn>
      <Text
        fontFamily="$body"
        fontSize={12.5}
        color="$text3"
        testID="recipe-snap-hint"
      >
        Cookbook page, printed sheet, or phone screenshot — AI works best in
        good lighting.
      </Text>
    </View>
  );
}

export function RecipeSnapPresenter({
  stage,
  offline,
  hasPermission,
  onRequestPermission,
  cameraRef,
  onShutterPress,
  onPickFromLibrary,
  errorMessage,
  onRetry,
  onChooseAnother,
  onBack,
  testID = "recipe-snap-screen",
}: RecipeSnapPresenterProps) {
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: color.$bg }}
      edges={["top", "bottom"]}
      testID={testID}
    >
      <HeaderBar
        eyebrow="PHOTO · AI"
        title="Snap a recipe"
        leading={
          <IconBtn
            icon={<IconBack size={22} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Back"
            testID="recipe-snap-back"
          />
        }
      />

      <View flex={1} padding={16} gap={14}>
        {stage === "capture" ? (
          <CaptureStage
            offline={offline}
            hasPermission={hasPermission}
            onRequestPermission={onRequestPermission}
            cameraRef={cameraRef}
            onShutterPress={onShutterPress}
            onPickFromLibrary={onPickFromLibrary}
          />
        ) : stage === "extracting" ? (
          <View
            flex={1}
            alignItems="center"
            justifyContent="center"
            gap={12}
            testID="recipe-snap-extracting"
          >
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={16}
              color="$text"
            >
              Reading recipe…
            </Text>
            <Text fontFamily="$body" fontSize={12.5} color="$text3">
              Recognising ingredients &amp; steps
            </Text>
          </View>
        ) : (
          <View gap={16} testID="recipe-snap-error">
            <Text fontFamily="$body" fontSize={14} color="$text2">
              {errorMessage ?? "Couldn't read this photo — try again."}
            </Text>
            <Btn
              variant="filled"
              tone="gold"
              size="lg"
              full
              onPress={onRetry}
              testID="recipe-snap-retry"
            >
              Retry
            </Btn>
            <Btn
              variant="outline"
              tone="gold"
              size="md"
              full
              onPress={onChooseAnother}
              testID="recipe-snap-choose-another"
            >
              Choose another photo
            </Btn>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
