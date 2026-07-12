import { estimateFoodMacros } from "./recipeExtraction";
import type {
  FoodDTO,
  FoodRepository,
} from "../../repositories/foodRepository";
import type { MinimalBedrockClient } from "./aiBedrockClient";

/**
 * AI-CREATE path for an unresolved recipe ingredient (Recipes AI). Callers
 * have already tried the DB via `GET /foods` (name search) and missed —
 * this is the fallback that fabricates a food row from a Bedrock macro
 * estimate rather than leaving the ingredient unresolved.
 *
 * Pure orchestration: `estimateFoodMacros` → `foodRepo.create(...)`. Kept
 * out of the handler so it's independently unit-testable with injected
 * fakes for both the AI call and the repository.
 */
export async function resolveIngredientFood(
  name: string,
  userId: string,
  deps: {
    foodRepo: Pick<FoodRepository, "create">;
    estimate?: typeof estimateFoodMacros;
    client?: MinimalBedrockClient;
  },
): Promise<{ food: FoodDTO; source: "ai" }> {
  const estimate = deps.estimate ?? estimateFoodMacros;

  const macros = await estimate({ name }, { client: deps.client });

  // Macros are per-100g, so the created food's serving is 100 g — the
  // recipe-ingredient scaling math (quantity × unit → grams) then scales
  // from that canonical base, same as any other 100g-serving food row.
  const food = await deps.foodRepo.create(userId, {
    name: macros.name,
    kcal: macros.kcal,
    proteinG: macros.proteinG,
    carbsG: macros.carbsG,
    fatG: macros.fatG,
    servingSize: 100,
    servingUnit: "g",
    source: "ai_recognized",
  });

  return { food, source: "ai" };
}
