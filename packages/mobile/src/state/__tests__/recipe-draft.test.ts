import { useRecipeDraft, type RecipeDraftSeed } from "@/state/recipe-draft";

describe("useRecipeDraft", () => {
  beforeEach(() => {
    useRecipeDraft.getState().clear();
  });

  it("starts with a null seed", () => {
    expect(useRecipeDraft.getState().seed).toBeNull();
  });

  it("setSeed stores the seed", () => {
    const seed: RecipeDraftSeed = {
      title: "Chicken & rice bowl",
      servings: 2,
      instructions: "Cook it.",
      ingredients: [{ name: "Chicken breast", quantity: 300, unit: "g" }],
      source: "import",
    };
    useRecipeDraft.getState().setSeed(seed);
    expect(useRecipeDraft.getState().seed).toEqual(seed);
  });

  it("clear resets the seed to null", () => {
    useRecipeDraft.getState().setSeed({
      title: "x",
      servings: null,
      instructions: null,
      ingredients: [],
      source: "snap",
    });
    useRecipeDraft.getState().clear();
    expect(useRecipeDraft.getState().seed).toBeNull();
  });
});
