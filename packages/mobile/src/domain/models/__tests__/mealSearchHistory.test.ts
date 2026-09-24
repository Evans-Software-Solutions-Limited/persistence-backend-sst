import { addNotWantedMeals, MAX_NOT_WANTED_MEALS } from "../mealprint";

it("deduplicates retries and caps wire fields without mutating prior history", () => {
  const first = addNotWantedMeals(
    [],
    [{ name: " Bowl ", ingredients: ["Rice", "Tofu"] }],
  )!;
  expect(
    addNotWantedMeals(first, [{ name: "bowl", ingredients: ["tofu", "rice"] }]),
  ).toEqual(first);
  const next = addNotWantedMeals(first, [
    {
      name: "x".repeat(200),
      ingredients: Array.from({ length: 15 }, () => "y".repeat(200)),
    },
  ])!;
  expect(first).toHaveLength(1);
  expect(next[1]!.name).toHaveLength(120);
  expect(next[1]!.ingredients).toHaveLength(12);
  expect(next[1]!.ingredients[0]).toHaveLength(120);
});
it("does not forget rejected meals when request history is full", () => {
  const history = Array.from({ length: MAX_NOT_WANTED_MEALS }, (_, index) => ({
    name: `Meal ${index}`,
    ingredients: [],
  }));
  expect(
    addNotWantedMeals(history, [{ name: "Another", ingredients: [] }]),
  ).toBeNull();
  expect(addNotWantedMeals(history, [history[0]!])).toEqual(history);
});
