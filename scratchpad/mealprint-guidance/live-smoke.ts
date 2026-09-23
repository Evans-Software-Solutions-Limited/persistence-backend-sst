/** Synthetic live-model check; no customer data or application writes. */
import { composeSuggestions } from "../../microservices/core/src/application/nutrition/mealprint/ai/suggestModel";
import { verifySuggestions } from "../../microservices/core/src/application/nutrition/mealprint/ai/verifyComposition";
import { parseMealGuidance } from "../../microservices/core/src/application/nutrition/mealprint/ai/mealGuidance";
import { assessAvoidance } from "../../microservices/core/src/application/nutrition/mealprint/safety/avoidanceFilter";
import type { MealprintCandidate } from "../../microservices/core/src/application/repositories/mealprintCandidateRepository";

const food = (
  id: string,
  name: string,
  kcal: number,
  proteinG: number,
  carbsG: number,
  fatG: number,
  allergens: string[] = [],
): MealprintCandidate => ({
  id,
  name,
  kcal,
  proteinG,
  carbsG,
  fatG,
  kind: "food",
  servingLabel: "100 g",
  servingBasis: "declared",
  maxServings: 2,
  allergenTags: allergens,
  categoryTags: [],
  isOwn: false,
});
const fixtures = [
  food("chicken", "Cooked chicken breast", 165, 31, 0, 3.6),
  food("prawns", "Cooked prawns", 100, 24, 0, 0.4, ["en:crustaceans"]),
  food("bass", "Sea bass fillet", 124, 24, 0, 3, ["en:fish"]),
  food("mushrooms", "Mushrooms", 22, 3, 3, 0.3),
  food("rice", "Cooked rice", 130, 2.7, 28, 0.3),
  food("bread", "Wholemeal bread", 240, 10, 40, 4, ["en:gluten"]),
  food("wrap", "Tortilla wrap", 200, 6, 35, 4, ["en:gluten"]),
  food("broccoli", "Broccoli", 35, 2.5, 5, 0.4),
  food("tomatoes", "Tomatoes", 20, 1, 4, 0),
  food("tofu", "Firm tofu", 120, 14, 2, 6, ["en:soy"]),
];
const remaining = { kcal: 1200, proteinG: 100, carbsG: 140, fatG: 40 };
const cases = [
  {
    name: "quick-chicken",
    steer: "something quick and chicken based",
    avoidFoods: [],
  },
  {
    name: "quick-chicken-fish-disliked",
    steer: "something quick and chicken based",
    avoidFoods: ["fish"],
  },
];
if (!process.argv.includes("--live")) {
  console.log(
    "Ready: 2 live requests using synthetic food fixtures. Run with --live after refreshing development AWS credentials.",
  );
  process.exit(0);
}
for (const testCase of cases) {
  const preferences = {
    dietaryPatterns: [],
    avoidAllergens: [],
    avoidFoods: testCase.avoidFoods,
  };
  const candidates = fixtures.filter(
    (candidate) => assessAvoidance(candidate, preferences).allowed,
  );
  const guidance = parseMealGuidance(testCase.steer);
  const generated = await composeSuggestions({
    shape: "meal",
    occasion: "on_plan",
    remaining,
    maxMealKcal: 650,
    maxCheatMealKcal: 1000,
    steer: testCase.steer,
    candidates,
    likedFoods: [],
    effortLevel: "balanced",
    locale: "en-GB",
  });
  const verified = verifySuggestions({
    suggestions: generated.suggestions,
    candidates,
    remaining,
    preferences,
    guidance,
    maxMealKcal: 650,
    maxCheatMealKcal: 1000,
  });
  const passed =
    verified.suggestions.length > 0 && verified.rejected.length === 0;
  console.log(
    JSON.stringify({
      case: testCase.name,
      passed,
      model: generated.usage.modelId,
      latencyMs: generated.usage.latencyMs,
      suggestions: verified.suggestions.map((meal) => ({
        name: meal.name,
        ingredients: meal.items.map((item) => item.name),
      })),
      rejected: verified.rejected,
    }),
  );
  if (!passed) process.exitCode = 1;
}
