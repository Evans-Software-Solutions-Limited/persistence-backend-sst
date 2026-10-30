import { parseIngredientLine } from "../recipeIngredientLine";

describe("parseIngredientLine (PER-78)", () => {
  it.each([
    ["400g chicken thighs, diced", "chicken thighs, diced", 400, "g"],
    ["400 g chicken thighs", "chicken thighs", 400, "g"],
    ["1.5kg potatoes", "potatoes", 1.5, "kg"],
    ["1,5 kg potatoes", "potatoes", 1.5, "kg"],
    ["1,000g flour", "flour", 1000, "g"],
    ["½ kg rice", "rice", 0.5, "kg"],
    ["1½ lb beef mince", "beef mince", 1.5, "lb"],
    ["1 1/2 lbs pork", "pork", 1.5, "lb"],
    ["3/4 oz parmesan", "parmesan", 0.75, "oz"],
    ["200 grams of oats", "oats", 200, "g"],
    ["200g/7oz plain flour", "plain flour", 200, "g"],
    ["- 250 g. spinach", "spinach", 250, "g"],
    ["2 Kilograms carrots", "carrots", 2, "kg"],
  ])("reads %s", (line, name, quantity, unit) => {
    expect(parseIngredientLine(line)).toEqual({ name, quantity, unit });
  });

  it.each([
    "2 large eggs",
    "1 green pepper",
    "2 tbsp soy sauce",
    "1 cup rice",
    "300ml chicken stock",
    "2-3 garlic cloves",
    "2 to 3 cloves",
    "2 x 400g tins chopped tomatoes",
    "Salt and pepper",
    "200g",
    "0g sugar",
    "1/0 g mystery",
    "1 0/0 g mystery",
  ])("leaves %s for review, text intact", (line) => {
    expect(parseIngredientLine(line)).toEqual({
      name: line,
      quantity: null,
      unit: "",
    });
  });

  it("trims the kept text", () => {
    expect(parseIngredientLine("  a pinch of salt ").name).toBe(
      "a pinch of salt",
    );
  });
});
