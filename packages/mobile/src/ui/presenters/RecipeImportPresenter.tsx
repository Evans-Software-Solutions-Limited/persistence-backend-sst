import { TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  Btn,
  Card,
  HeaderBar,
  IconBtn,
  Pill,
} from "@/ui/components/foundation";
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

export type ImportStage = "input" | "importing" | "no-microdata" | "error";

const SUPPORTED_SITES = [
  "BBC Good Food",
  "Serious Eats",
  "AllRecipes",
  "NYT Cooking",
  "Bon Appétit",
];

export type RecipeImportPresenterProps = {
  stage: ImportStage;
  url: string;
  onUrlChange: (url: string) => void;
  onImport: () => void;
  onCreateManually: () => void;
  onRetry: () => void;
  onBack: () => void;
  testID?: string;
};

export function RecipeImportPresenter({
  stage,
  url,
  onUrlChange,
  onImport,
  onCreateManually,
  onRetry,
  onBack,
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

      <View flex={1} padding={16} gap={14}>
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
            </Card>

            <View>
              <Text
                fontFamily="$display"
                fontSize={10.5}
                fontWeight="600"
                letterSpacing={1.7}
                textTransform="uppercase"
                color="$text3"
                marginBottom={8}
              >
                SUPPORTED SITES
              </Text>
              <Card pad={0} radius={12}>
                {SUPPORTED_SITES.map((site, i) => (
                  <View
                    key={site}
                    flexDirection="row"
                    alignItems="center"
                    gap={10}
                    padding={12}
                    borderTopWidth={i ? 1 : 0}
                    borderColor="$border"
                  >
                    <Text
                      flex={1}
                      fontFamily="$body"
                      fontSize={13}
                      color="$text2"
                    >
                      {site}
                    </Text>
                    <Pill tone="success" size="xs">
                      VERIFIED
                    </Pill>
                  </View>
                ))}
                <View
                  flexDirection="row"
                  padding={12}
                  borderTopWidth={1}
                  borderColor="$border"
                >
                  <Text fontFamily="$body" fontSize={13} color="$text3">
                    + 200 more
                  </Text>
                </View>
              </Card>
            </View>

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
          </>
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
                Couldn&rsquo;t read a recipe from that page — enter it manually.
              </Text>
            </Card>
            <Btn
              full
              variant="filled"
              tone="primary"
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
                Something went wrong importing that recipe.
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
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}
