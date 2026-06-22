import Elysia from "elysia";
import { RecipeRepository } from "./recipeRepository";

export const RecipeService = new Elysia({ name: "RecipeService" }).decorate(
  "RecipeRepository",
  new RecipeRepository(),
);
