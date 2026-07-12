import { useCallback } from "react";
import { router } from "expo-router";
import { useAddRecipeMenu } from "@/state/add-recipe-menu";
import { useNutritionAiGate } from "@/ui/hooks/useNutritionAiGate";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { AddRecipeMenuPresenter } from "@/ui/presenters/AddRecipeMenuPresenter";

/**
 * <AddRecipeMenuContainer> — root-mounted (feedback_sheets_mount_at_root)
 * wiring for the Recipes library "+" menu. Reads `useAddRecipeMenu().open` to
 * drive the sheet's slide animation, routes each row to its flow, and gates
 * "Snap a recipe photo" behind `useNutritionAiGate()` (locked → the upgrade
 * prompt; offline → disabled, since the AI call couldn't succeed anyway).
 *
 * Implements: specs/milestones (Recipes AI PR3 brief) § C. AddRecipeMenu
 */
export function AddRecipeMenuContainer() {
  const open = useAddRecipeMenu((s) => s.open);
  const closeMenu = useAddRecipeMenu((s) => s.closeMenu);
  const online = useOnlineStatus();
  const aiGate = useNutritionAiGate();

  // Guard convention shared with the other root sheets: only a genuine
  // dismiss of THIS sheet (still visible) clears the store.
  const onClose = useCallback(() => {
    if (open) closeMenu();
  }, [open, closeMenu]);

  const onSaveMeal = useCallback(() => {
    closeMenu();
    router.push("/(app)/fuel/save-meal" as never);
  }, [closeMenu]);

  const onCreateRecipe = useCallback(() => {
    closeMenu();
    router.push("/(app)/fuel/recipe-create" as never);
  }, [closeMenu]);

  const onImportUrl = useCallback(() => {
    closeMenu();
    router.push("/(app)/fuel/recipe-import" as never);
  }, [closeMenu]);

  const { allowed, gateProps } = aiGate;
  const onUpgrade = gateProps.onUpgrade;
  const onSnapRecipe = useCallback(() => {
    closeMenu();
    if (!allowed) {
      onUpgrade();
      return;
    }
    router.push("/(app)/fuel/recipe-snap" as never);
  }, [closeMenu, allowed, onUpgrade]);

  return (
    <AddRecipeMenuPresenter
      visible={open}
      onClose={onClose}
      onSaveMeal={onSaveMeal}
      onCreateRecipe={onCreateRecipe}
      onSnapRecipe={onSnapRecipe}
      snapDisabled={!online}
      onImportUrl={onImportUrl}
    />
  );
}
