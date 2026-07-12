import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Pill } from "@/ui/components/foundation";
import { toneHex, type Tone } from "@/ui/components/foundation/tones";
import {
  IconBook,
  IconCamera,
  IconChevronR,
  IconClipboard,
  IconLink,
} from "@/ui/components/icons";

/**
 * <AddRecipeMenuPresenter> — the Recipes library "+" bottom sheet
 * (recipes.jsx `AddRecipeMenu`). Four creation paths: Save a meal / Create a
 * recipe (always reachable) and, under an "OR IMPORT" divider, Snap a recipe
 * photo (AI, gated) / Import from URL (deterministic, never gated). Pure —
 * <AddRecipeMenuContainer> owns the sheet's open-state + AI-gate + routing.
 *
 * Implements: specs/milestones (Recipes AI PR3 brief) § C. AddRecipeMenu
 */

export type AddRecipeMenuPresenterProps = {
  visible: boolean;
  onClose: () => void;
  onSaveMeal: () => void;
  onCreateRecipe: () => void;
  /** Always fires — the container routes to the upgrade prompt when the AI
   * gate denies, or to the Snap screen when it allows. */
  onSnapRecipe: () => void;
  /** True while offline — disables the Snap row entirely (no AI call would
   * succeed; the deterministic Import row stays reachable). */
  snapDisabled: boolean;
  onImportUrl: () => void;
  testID?: string;
};

function AddMenuRow({
  icon,
  tone,
  title,
  sub,
  pill,
  disabled,
  onPress,
  testID,
}: {
  icon: ReactNode;
  tone: Tone;
  title: string;
  sub: string;
  pill?: string;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        backgroundColor="$surface2"
        borderColor="$border"
        borderWidth={1}
        borderRadius={12}
        padding={14}
        marginBottom={8}
      >
        <View
          width={40}
          height={40}
          borderRadius={10}
          alignItems="center"
          justifyContent="center"
          backgroundColor={`$${tone}Dim`}
        >
          {icon}
        </View>
        <View flex={1} gap={2}>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={14}
            color="$text"
          >
            {title}
          </Text>
          <Text fontFamily="$body" fontSize={11.5} color="$text3">
            {sub}
          </Text>
        </View>
        {pill ? (
          <Pill tone="gold" size="xs">
            {pill}
          </Pill>
        ) : null}
        <IconChevronR size={14} color="#8A8A98" />
      </View>
    </Pressable>
  );
}

export function AddRecipeMenuPresenter({
  visible,
  onClose,
  onSaveMeal,
  onCreateRecipe,
  onSnapRecipe,
  snapDisabled,
  onImportUrl,
  testID = "add-recipe-menu",
}: AddRecipeMenuPresenterProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      eyebrow="NEW"
      title="Add to your library"
      accent="gold"
      height="tall"
      testID={testID}
    >
      <View gap={0}>
        <AddMenuRow
          icon={<IconClipboard size={20} color={toneHex("primary").base} />}
          tone="primary"
          title="Save a meal"
          sub="Quick-log a combination you've used"
          onPress={onSaveMeal}
          testID="add-recipe-menu-save-meal"
        />
        <AddMenuRow
          icon={<IconBook size={20} color={toneHex("gold").base} />}
          tone="gold"
          title="Create a recipe"
          sub="Ingredients, instructions, macros"
          onPress={onCreateRecipe}
          testID="add-recipe-menu-create-recipe"
        />

        <View paddingVertical={8}>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
          >
            OR IMPORT
          </Text>
        </View>

        <AddMenuRow
          icon={<IconCamera size={20} color={toneHex("gold").base} />}
          tone="gold"
          title="Snap a recipe photo"
          sub="Cookbook page, screenshot, handwritten…"
          pill="AI"
          disabled={snapDisabled}
          onPress={onSnapRecipe}
          testID="add-recipe-menu-snap"
        />
        <AddMenuRow
          icon={<IconLink size={20} color={toneHex("primary").base} />}
          tone="primary"
          title="Import from URL"
          sub="BBC Good Food, Serious Eats, AllRecipes…"
          onPress={onImportUrl}
          testID="add-recipe-menu-import-url"
        />
      </View>
    </BottomSheet>
  );
}
