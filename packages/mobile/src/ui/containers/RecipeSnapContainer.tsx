import { useCallback, useRef, useState } from "react";
import { router } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useRecipeDraft } from "@/state/recipe-draft";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { useNutritionAiGate } from "@/ui/hooks/useNutritionAiGate";
import { useExtractRecipePhoto } from "@/ui/hooks/useExtractRecipePhoto";
import {
  RecipeSnapPresenter,
  type RecipeSnapStage,
} from "@/ui/presenters/RecipeSnapPresenter";

/**
 * <RecipeSnapContainer> — Snap-a-recipe-photo (recipes.jsx `SnapRecipePhoto`,
 * Recipes AI PR3 § F). Mirrors <SnapAISheetContainer>'s camera/library
 * capture + downscale (`expo-image-manipulator`, ≤1080px long edge, JPEG
 * ~0.7) and the ONLINE-ONLY, never-queued AI call posture — but as a
 * full-screen route rather than a sheet, and the confirm step is the
 * create-recipe form itself (via `useRecipeDraft`), not an inline draft card.
 *
 * AI-gated: <AddRecipeMenuContainer> gates opening this route on
 * `useNutritionAiGate().allowed`, but the capture actions re-check
 * defensively (connectivity/entitlement can change while this screen is
 * already open).
 *
 * Implements: specs/milestones (Recipes AI PR3 brief) § F. Snap-a-recipe-photo
 */

/** Long-edge cap + JPEG quality for the downscale before the AI call —
 * matches `SnapAISheetContainer`'s M9.5 Tier B posture exactly. */
const MAX_DIMENSION = 1080;
const JPEG_QUALITY = 0.7;

export function RecipeSnapContainer() {
  const online = useOnlineStatus();
  const aiGate = useNutritionAiGate();
  const setSeed = useRecipeDraft((s) => s.setSeed);
  const extractRecipePhoto = useExtractRecipePhoto();

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [stage, setStage] = useState<RecipeSnapStage>("capture");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Retained so "Retry" can re-send the same photo without recapturing.
  const lastPhotoRef = useRef<{
    base64: string;
    mediaType: "image/jpeg";
  } | null>(null);

  const onBack = useCallback(() => router.back(), []);

  const runExtract = useCallback(
    async (base64: string, mediaType: "image/jpeg") => {
      lastPhotoRef.current = { base64, mediaType };
      setStage("extracting");
      const result = await extractRecipePhoto.mutate(base64, mediaType);
      if (result.status === "ok") {
        const recipe = result.recipe;
        setSeed({
          title: recipe.title,
          servings: recipe.servings,
          instructions:
            recipe.steps.length > 0
              ? recipe.steps.map((step, i) => `${i + 1}. ${step}`).join("\n")
              : null,
          ingredients: recipe.ingredients.map((ing) => ({
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
          })),
          source: "snap",
        });
        router.replace("/(app)/fuel/recipe-create" as never);
        return;
      }
      if (result.status === "unreadable") {
        setErrorMessage(
          "Couldn't read a recipe in that photo — try a clearer shot or enter it manually.",
        );
      } else if (result.status === "limit") {
        setErrorMessage(
          "Daily AI limit reached — it resets tomorrow. Enter the recipe manually instead.",
        );
      } else {
        setErrorMessage("Couldn't read this photo — try again.");
      }
      setStage("error");
    },
    [extractRecipePhoto, setSeed],
  );

  const onShutterPress = useCallback(async () => {
    // Defensive re-guard: the menu already gates opening this screen, but
    // entitlement/connectivity can change while it's open.
    if (!aiGate.allowed || !online) return;
    if (!cameraRef.current) return;
    const photo = await cameraRef.current.takePictureAsync({ quality: 1 });
    if (!photo?.uri) return;
    const manipulated = await ImageManipulator.manipulateAsync(
      photo.uri,
      [{ resize: { width: MAX_DIMENSION } }],
      {
        compress: JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      },
    );
    if (!manipulated.base64) return;
    await runExtract(manipulated.base64, "image/jpeg");
  }, [aiGate.allowed, online, runExtract]);

  const onPickFromLibrary = useCallback(async () => {
    if (!aiGate.allowed || !online) return;
    const permissionResult =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) return;
    const pickerResult = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (pickerResult.canceled) return;
    const asset = pickerResult.assets?.[0];
    if (!asset?.uri) return;
    const manipulated = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: MAX_DIMENSION } }],
      {
        compress: JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      },
    );
    if (!manipulated.base64) return;
    await runExtract(manipulated.base64, "image/jpeg");
  }, [aiGate.allowed, online, runExtract]);

  const onRetry = useCallback(() => {
    const last = lastPhotoRef.current;
    if (!last) {
      setStage("capture");
      return;
    }
    void runExtract(last.base64, last.mediaType);
  }, [runExtract]);

  const onChooseAnother = useCallback(() => {
    lastPhotoRef.current = null;
    setStage("capture");
  }, []);

  return (
    <RecipeSnapPresenter
      stage={stage}
      offline={!online}
      hasPermission={permission?.granted ?? false}
      onRequestPermission={() => void requestPermission()}
      cameraRef={cameraRef}
      onShutterPress={() => void onShutterPress()}
      onPickFromLibrary={() => void onPickFromLibrary()}
      errorMessage={errorMessage}
      onRetry={onRetry}
      onChooseAnother={onChooseAnother}
      onBack={onBack}
    />
  );
}
