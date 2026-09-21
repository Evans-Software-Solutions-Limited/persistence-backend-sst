import { ScrollView, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { SafeAreaView } from "react-native-safe-area-context";
import { Btn, Card, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { IconArrowR, IconBack, IconInfo } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

/**
 * <RecipeImportPresenter> — Import-from-URL (recipes.jsx `ImportFromURL`,
 * simplified). DETERMINISTIC Tier-A scrape — NOT AI-gated ("FROM URL", no AI
 * pill on this actual flow; the prototype's "AI" eyebrow is aspirational).
 * A successful extraction hands off straight to the create-recipe form for
 * review/edit rather than the prototype's separate preview screen — there's
 * nothing AI-estimated here to preview; the form IS the review step.
 *
 * Implements: specs/milestones (Recipes AI PR3 brief) § E. Import-from-URL
 */

export type ImportStage =
  | "input"
  | "importing"
  | "no-microdata"
  | "error"
  | "paste";

export type RecipeImportPresenterProps = {
  stage: ImportStage;
  url: string;
  onUrlChange: (url: string) => void;
  onPasteUrl: () => void;
  pasteError: string | null;
  isPasting: boolean;
  onImport: () => void;
  onCreateManually: () => void;
  onRetry: () => void;
  onBack: () => void;
  onPasteRecipe: () => void;
  pastedTitle: string;
  pastedIngredients: string;
  pastedInstructions: string;
  onPastedTitleChange: (value: string) => void;
  onPastedIngredientsChange: (value: string) => void;
  onPastedInstructionsChange: (value: string) => void;
  onReviewPasted: () => void;
  testID?: string;
};

export function RecipeImportPresenter({
  stage,
  url,
  onUrlChange,
  onPasteUrl,
  pasteError,
  isPasting,
  onImport,
  onCreateManually,
  onRetry,
  onBack,
  onPasteRecipe,
  pastedTitle,
  pastedIngredients,
  pastedInstructions,
  onPastedTitleChange,
  onPastedIngredientsChange,
  onPastedInstructionsChange,
  onReviewPasted,
  testID = "recipe-import-screen",
}: RecipeImportPresenterProps) {
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: color.$bg }}
      edges={["top", "bottom"]}
      testID={testID}
    >
      <HeaderBar
        eyebrow="FROM URL"
        title="Import recipe"
        leading={
          <IconBtn
            icon={<IconBack size={22} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Back"
            testID="recipe-import-back"
          />
        }
      />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 16, gap: 14, flexGrow: 1 }}
      >
        {stage === "input" ? (
          <>
            <Card pad={14} radius={14}>
              <Text
                fontFamily="$display"
                fontSize={10.5}
                fontWeight="600"
                letterSpacing={1.7}
                textTransform="uppercase"
                color="$text3"
                marginBottom={8}
              >
                RECIPE URL
              </Text>
              <TextInput
                value={url}
                onChangeText={onUrlChange}
                placeholder="https://www.bbcgoodfood.com/recipes/…"
                placeholderTextColor={color.$text3}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={{
                  backgroundColor: color.$bg,
                  borderWidth: 1,
                  borderColor: color.$border2,
                  borderRadius: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                  color: color.$text,
                  fontSize: 12,
                }}
                testID="recipe-import-url-input"
              />
              <Btn
                full
                variant="ghost"
                onPress={onPasteUrl}
                disabled={isPasting}
                testID="recipe-import-paste-url"
              >
                {isPasting ? "Pasting…" : "Paste URL"}
              </Btn>
              {pasteError ? (
                <Text
                  fontFamily="$body"
                  fontSize={12}
                  color="$text2"
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  testID="recipe-import-paste-error"
                >
                  {pasteError}
                </Text>
              ) : null}
            </Card>

            <Card pad={14} radius={12}>
              <Text
                fontFamily="$body"
                fontSize={13}
                color="$text2"
                lineHeight={19}
              >
                Try any public recipe page. Some sites block imports or don’t
                provide a readable recipe. You can paste the ingredients and
                method instead.
              </Text>
            </Card>

            <View
              flexDirection="row"
              gap={10}
              padding={12}
              backgroundColor="$surface2"
              borderColor="$border"
              borderWidth={1}
              borderRadius={12}
            >
              <IconInfo size={14} color={color.$gold} />
              <Text
                flex={1}
                fontFamily="$body"
                fontSize={12}
                color="$text3"
                lineHeight={17}
              >
                We&rsquo;ll extract ingredients and instructions. You can edit
                everything before saving.
              </Text>
            </View>

            <Btn
              full
              variant="filled"
              tone="primary"
              size="lg"
              icon={<IconArrowR size={15} />}
              onPress={onImport}
              disabled={url.trim().length === 0}
              testID="recipe-import-submit"
            >
              {url.trim().length > 0 ? "Extract recipe" : "Paste a URL above"}
            </Btn>
            <Btn
              full
              variant="ghost"
              onPress={onPasteRecipe}
              testID="recipe-import-paste"
            >
              Paste recipe text instead
            </Btn>
          </>
        ) : stage === "paste" ? (
          <View gap={14} testID="recipe-import-paste-form">
            <Text
              fontFamily="$body"
              fontSize={13}
              color="$text2"
              lineHeight={19}
            >
              Copy the ingredients and method from your recipe. Review portions
              and nutrition on the next screen before saving.
            </Text>
            {[
              {
                label: "Recipe name",
                value: pastedTitle,
                change: onPastedTitleChange,
                id: "title",
                max: 200,
              },
              {
                label: "Ingredients — one per line",
                value: pastedIngredients,
                change: onPastedIngredientsChange,
                id: "ingredients",
                max: 16000,
              },
              {
                label: "Method (optional)",
                value: pastedInstructions,
                change: onPastedInstructionsChange,
                id: "instructions",
                max: 20000,
              },
            ].map((field) => (
              <View key={field.id} gap={8}>
                <Text fontFamily="$body" fontSize={13} color="$text2">
                  {field.label}
                </Text>
                <TextInput
                  accessibilityLabel={field.label}
                  value={field.value}
                  onChangeText={field.change}
                  multiline={field.id !== "title"}
                  maxLength={field.max}
                  textAlignVertical="top"
                  style={{
                    color: color.$text,
                    backgroundColor: color.$surface2,
                    borderColor: color.$border2,
                    borderWidth: 1,
                    borderRadius: 10,
                    padding: 14,
                    minHeight: field.id === "title" ? 48 : 120,
                  }}
                  testID={`recipe-paste-${field.id}`}
                />
              </View>
            ))}
            <Btn
              full
              variant="filled"
              tone="primary"
              onPress={onReviewPasted}
              disabled={!pastedTitle.trim() || !pastedIngredients.trim()}
              testID="recipe-paste-review"
            >
              Review recipe
            </Btn>
            <Btn full variant="ghost" onPress={onRetry}>
              Back to URL
            </Btn>
          </View>
        ) : stage === "importing" ? (
          <View flex={1} alignItems="center" justifyContent="center" gap={12}>
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={16}
              color="$text"
              testID="recipe-import-loading"
            >
              Extracting recipe…
            </Text>
            <Text fontFamily="$body" fontSize={12.5} color="$text3">
              Reading ingredients &amp; instructions
            </Text>
          </View>
        ) : stage === "no-microdata" ? (
          <View gap={14} testID="recipe-import-no-microdata">
            <Card pad={14} radius={14}>
              <Text
                fontFamily="$body"
                fontSize={13}
                color="$text2"
                lineHeight={19}
              >
                We couldn’t read a recipe from that page. Paste its ingredients
                and method, or add it manually.
              </Text>
            </Card>
            <Btn
              full
              variant="filled"
              tone="primary"
              onPress={onPasteRecipe}
              testID="recipe-import-paste"
            >
              Paste recipe text
            </Btn>
            <Btn
              full
              variant="ghost"
              onPress={onRetry}
              testID="recipe-import-retry"
            >
              Try another URL
            </Btn>
            <Btn
              full
              variant="ghost"
              size="lg"
              onPress={onCreateManually}
              testID="recipe-import-create-manually"
            >
              Create manually
            </Btn>
          </View>
        ) : (
          <View gap={14} testID="recipe-import-error">
            <Card pad={14} radius={14}>
              <Text
                fontFamily="$body"
                fontSize={13}
                color="$text2"
                lineHeight={19}
              >
                We couldn’t access that recipe. Try again, or paste the recipe
                text to continue.
              </Text>
            </Card>
            <Btn
              full
              variant="filled"
              tone="primary"
              size="lg"
              onPress={onRetry}
              testID="recipe-import-retry"
            >
              Retry
            </Btn>
            <Btn
              full
              variant="ghost"
              onPress={onPasteRecipe}
              testID="recipe-import-paste"
            >
              Paste recipe text
            </Btn>
            <Btn
              full
              variant="ghost"
              onPress={onCreateManually}
              testID="recipe-import-create-manually"
            >
              Create manually
            </Btn>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
