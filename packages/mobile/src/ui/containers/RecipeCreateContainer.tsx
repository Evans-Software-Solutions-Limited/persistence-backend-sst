import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router } from "expo-router";
import { useRecipeDraft } from "@/state/recipe-draft";
import { computeRecipeDraftMacros, type MacroSum } from "@/domain/services";
import type {
  CreateRecipeInput,
  Food,
  RecipeIngredientInput,
} from "@/domain/models/nutrition";
import type { ApiError } from "@/shared/errors";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useCreateRecipe } from "@/ui/hooks/useCreateRecipe";
import { useSearchFoods } from "@/ui/hooks/useSearchFoods";
import { useResolveIngredient } from "@/ui/hooks/useResolveIngredient";
import { useEstimateRecipe } from "@/ui/hooks/useEstimateRecipe";
import { useNutritionAiGate } from "@/ui/hooks/useNutritionAiGate";
import {
  RecipeCreatePresenter,
  type IngredientRowVM,
} from "@/ui/presenters/RecipeCreatePresenter";

/**
 * <RecipeCreateContainer> — the manual create-recipe form's data layer
 * (recipes.jsx `CreateRecipeManual`; Recipes AI PR3 § D). Every creation path
 * lands here: a direct "Create a recipe" tap starts blank; Import-from-URL /
 * Snap-a-recipe pre-fill via `useRecipeDraft` — this container reads the seed
 * ONCE (via lazy `useState` initializers, so it applies before first paint)
 * then clears the store so a later blank visit doesn't inherit stale state.
 *
 * Owns: row CRUD, per-row inline food search (`useSearchFoods`, one active
 * row at a time), AI ingredient resolve on a search miss (`useResolveIngredient`,
 * gated by `useNutritionAiGate`), the live client-side macro total
 * (`computeRecipeDraftMacros`), and the save (`useCreateRecipe`).
 *
 * Implements: specs/milestones (Recipes AI PR3 brief) § D. Create-recipe form
 */

type RowState = {
  id: string;
  name: string;
  quantity: number | null;
  unit: string;
  foodId: string | null;
  foodName: string | null;
};

function emptyRow(id: string): RowState {
  return {
    id,
    name: "",
    quantity: null,
    unit: "",
    foodId: null,
    foodName: null,
  };
}

const RESOLVE_LIMIT_MESSAGE =
  "Daily AI limit reached — it resets tomorrow. Link a food manually instead.";
const RESOLVE_GENERIC_MESSAGE =
  "Couldn't create that ingredient — try again or link a food manually.";

export function RecipeCreateContainer() {
  const { storage } = useAdapters();
  const createRecipe = useCreateRecipe();
  const resolveIngredient = useResolveIngredient();
  const estimateRecipe = useEstimateRecipe();
  const aiGate = useNutritionAiGate();

  const nextRowIdRef = useRef(0);
  const nextRowId = useCallback(() => {
    const id = `row-${nextRowIdRef.current}`;
    nextRowIdRef.current += 1;
    return id;
  }, []);

  const [name, setName] = useState(
    () => useRecipeDraft.getState().seed?.title ?? "",
  );
  const [servings, setServings] = useState<number | null>(
    () => useRecipeDraft.getState().seed?.servings ?? null,
  );
  const [instructions, setInstructions] = useState(
    () => useRecipeDraft.getState().seed?.instructions ?? "",
  );
  const [rows, setRows] = useState<RowState[]>(() => {
    const seed = useRecipeDraft.getState().seed;
    if (seed && seed.ingredients.length > 0) {
      return seed.ingredients.map((ing) => ({
        id: nextRowId(),
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit ?? "",
        foodId: null,
        foodName: null,
      }));
    }
    return [emptyRow(nextRowId())];
  });

  // Recipe-import macros fix — consume the import seed's scraped nutrition
  // (per-serving) as a WHOLE-recipe `providedTotals`, and carry the seed's
  // source/sourceUrl through to the save payload. Only an "import" seed
  // (RecipeImportContainer) sets `source`/`sourceUrl`/`nutrition` at all — a
  // direct "Create a recipe" visit or a Snap-a-recipe seed stays "manual".
  const [providedTotals, setProvidedTotals] = useState<MacroSum | null>(() => {
    const seed = useRecipeDraft.getState().seed;
    if (!seed || seed.source !== "import" || !seed.nutrition) return null;
    const multiplier = seed.servings ?? 1;
    const n = seed.nutrition;
    return {
      kcal: (n.kcal ?? 0) * multiplier,
      proteinG: (n.proteinG ?? 0) * multiplier,
      carbsG: (n.carbsG ?? 0) * multiplier,
      fatG: (n.fatG ?? 0) * multiplier,
    };
  });
  const [source] = useState<NonNullable<CreateRecipeInput["source"]>>(() => {
    const seedSource = useRecipeDraft.getState().seed?.source;
    if (seedSource === "import") return "url_import";
    if (seedSource === "snap") return "ai_extracted";
    return "manual";
  });
  const [sourceUrl] = useState<string | undefined>(
    () => useRecipeDraft.getState().seed?.sourceUrl ?? undefined,
  );

  // Read once — clear immediately after the initial render so a later blank
  // visit to this same route never inherits a stale seed.
  useEffect(() => {
    useRecipeDraft.getState().clear();
  }, []);

  const [activeSearchRowId, setActiveSearchRowId] = useState<string | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const search = useSearchFoods(activeSearchRowId ? searchQuery : "");

  const [resolvingRowId, setResolvingRowId] = useState<string | null>(null);
  const [rowMessages, setRowMessages] = useState<Record<string, string>>({});
  const pendingResolveRowIdRef = useRef<string | null>(null);

  const [saving, setSaving] = useState(false);

  const onAddRow = useCallback(() => {
    setRows((prev) => [...prev, emptyRow(nextRowId())]);
  }, [nextRowId]);

  const onRemoveRow = useCallback((id: string) => {
    setRows((prev) => prev.filter((r) => r.id !== id));
    setActiveSearchRowId((current) => (current === id ? null : current));
  }, []);

  const onChangeRowName = useCallback((id: string, newName: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        // Editing the name after a link diverges from the linked food —
        // unlink rather than leave a stale foodId pointing at mismatched text.
        if (r.foodId !== null) {
          return { ...r, name: newName, foodId: null, foodName: null };
        }
        return { ...r, name: newName };
      }),
    );
  }, []);

  const onChangeRowQuantity = useCallback(
    (id: string, quantity: number | null) => {
      setRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, quantity } : r)),
      );
    },
    [],
  );

  const onChangeRowUnit = useCallback((id: string, unit: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, unit } : r)));
  }, []);

  const onOpenRowSearch = useCallback(
    (id: string) => {
      const row = rows.find((r) => r.id === id);
      setActiveSearchRowId(id);
      setSearchQuery(row?.name ?? "");
    },
    [rows],
  );

  const onCloseRowSearch = useCallback(() => {
    setActiveSearchRowId(null);
    setSearchQuery("");
  }, []);

  const onLinkFood = useCallback((id: string, food: Food) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              foodId: food.id,
              foodName: food.name,
              name: food.name,
              // A blank quantity/unit means the row was never given one (e.g.
              // an import seed's free-text line) — default it from the linked
              // food's own serving so the ingredient-derived macro total has
              // something to scale, rather than silently contributing 0.
              quantity: r.quantity === null ? food.servingSize : r.quantity,
              unit: r.unit ? r.unit : food.servingUnit,
            }
          : r,
      ),
    );
    // Linking a food switches the recipe back into ingredient-derived mode —
    // any AI/import whole-recipe total no longer reflects the current rows.
    setProvidedTotals(null);
    setActiveSearchRowId(null);
    setSearchQuery("");
  }, []);

  const onCreateWithAi = useCallback(
    async (id: string) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      if (!aiGate.allowed) {
        aiGate.gateProps.onUpgrade();
        return;
      }
      const ingredientName = (row.name || searchQuery).trim();
      if (!ingredientName) return;
      setRowMessages((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      pendingResolveRowIdRef.current = id;
      setResolvingRowId(id);
      const food = await resolveIngredient.mutate(ingredientName);
      setResolvingRowId(null);
      if (food) {
        pendingResolveRowIdRef.current = null;
        // The AI-resolved food is brand new server-side — cache it locally so
        // the live macro total (and a later `useCreateRecipe` optimistic
        // total) can resolve it, exactly like `useSearchFoods` already does
        // for a manually-picked search result.
        storage.cacheFoods([food]);
        setRows((prev) =>
          prev.map((r) =>
            r.id === id
              ? {
                  ...r,
                  foodId: food.id,
                  foodName: food.name,
                  name: food.name,
                  quantity: r.quantity === null ? food.servingSize : r.quantity,
                  unit: r.unit ? r.unit : food.servingUnit,
                }
              : r,
          ),
        );
        setProvidedTotals(null);
        setActiveSearchRowId(null);
        setSearchQuery("");
      }
      // On failure `pendingResolveRowIdRef` stays set — the effect below
      // attributes the message once the hook's `error` state lands (avoids
      // reading the stale `resolveIngredient` closure captured at call time).
    },
    [rows, aiGate, searchQuery, resolveIngredient, storage],
  );

  useEffect(() => {
    const err: ApiError | null = resolveIngredient.error;
    const rowId = pendingResolveRowIdRef.current;
    if (!err || !rowId) return;
    setRowMessages((prev) => ({
      ...prev,
      [rowId]:
        err.status === 429 ? RESOLVE_LIMIT_MESSAGE : RESOLVE_GENERIC_MESSAGE,
    }));
    pendingResolveRowIdRef.current = null;
  }, [resolveIngredient.error]);

  const derivedMacroTotal = useMemo(
    () =>
      computeRecipeDraftMacros(
        rows.map((r) => ({
          foodId: r.foodId,
          quantity: r.quantity,
          unit: r.unit,
        })),
        (foodId) => storage.getCachedFoodById(foodId),
      ),
    [rows, storage],
  );
  // A whole-recipe total (import scrape or AI estimate) takes precedence over
  // the ingredient-derived sum — see `providedTotals` / `onEstimateWholeRecipe`.
  const macroTotal = providedTotals ?? derivedMacroTotal;

  const [estimateMessage, setEstimateMessage] = useState<string | null>(null);
  const pendingEstimateRef = useRef(false);

  const onEstimateWholeRecipe = useCallback(async () => {
    if (!aiGate.allowed) {
      aiGate.gateProps.onUpgrade();
      return;
    }
    setEstimateMessage(null);
    // Feed the AI the structured quantity/unit when the user set them (import
    // seeds embed the amount in the free-text name; manually-added rows keep it
    // in quantity/unit) so a whole-recipe estimate isn't left guessing amounts.
    const ingredients = rows
      .map((r) => {
        const label = (r.foodName || r.name).trim();
        if (!label) return "";
        const amount =
          r.quantity !== null
            ? `${r.quantity}${r.unit ? ` ${r.unit}` : ""} `
            : "";
        return `${amount}${label}`;
      })
      .filter((s) => s.length > 0);
    pendingEstimateRef.current = true;
    const result = await estimateRecipe.mutate({
      name: name.trim(),
      ingredients,
      servings: servings ?? undefined,
    });
    if (result) {
      pendingEstimateRef.current = false;
      setProvidedTotals({
        kcal: result.kcal,
        proteinG: result.proteinG,
        carbsG: result.carbsG,
        fatG: result.fatG,
      });
    }
    // On failure `pendingEstimateRef` stays set — the effect below attributes
    // the message once the hook's `error` state lands (avoids reading the
    // stale `estimateRecipe` closure captured at call time — same reasoning
    // as `onCreateWithAi`'s `pendingResolveRowIdRef`).
  }, [aiGate, rows, name, servings, estimateRecipe]);

  useEffect(() => {
    const err: ApiError | null = estimateRecipe.error;
    if (!err || !pendingEstimateRef.current) return;
    setEstimateMessage(
      err.status === 429 ? RESOLVE_LIMIT_MESSAGE : RESOLVE_GENERIC_MESSAGE,
    );
    pendingEstimateRef.current = false;
  }, [estimateRecipe.error]);

  const validRows = useMemo(
    () => rows.filter((r) => r.foodId !== null || r.name.trim().length > 0),
    [rows],
  );
  const canSave = name.trim().length > 0 && validRows.length > 0 && !saving;

  const onBack = useCallback(() => router.back(), []);

  const onSave = useCallback(async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const ingredients: RecipeIngredientInput[] = validRows.map((r, i) =>
        r.foodId
          ? {
              foodId: r.foodId,
              quantity: r.quantity ?? 1,
              unit: r.unit || "",
              sortOrder: i,
            }
          : {
              customName: r.name.trim(),
              quantity: r.quantity ?? 1,
              unit: r.unit || "",
              sortOrder: i,
            },
      );
      const trimmedInstructions = instructions.trim();
      const recipe = await createRecipe.mutate({
        name: name.trim(),
        servings: servings ?? 1,
        instructions:
          trimmedInstructions.length > 0 ? trimmedInstructions : undefined,
        ingredients,
        source,
        ...(sourceUrl !== undefined ? { sourceUrl } : {}),
        ...(providedTotals !== null ? { providedTotals } : {}),
      });
      if (recipe) {
        router.replace(`/(app)/fuel/recipe/${recipe.id}` as never);
      }
    } finally {
      setSaving(false);
    }
  }, [
    canSave,
    validRows,
    name,
    servings,
    instructions,
    createRecipe,
    source,
    sourceUrl,
    providedTotals,
  ]);

  const rowVMs: IngredientRowVM[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    quantity: r.quantity,
    unit: r.unit,
    foodId: r.foodId,
    foodName: r.foodName,
  }));

  return (
    <RecipeCreatePresenter
      name={name}
      onNameChange={setName}
      servings={servings}
      onServingsChange={setServings}
      instructions={instructions}
      onInstructionsChange={setInstructions}
      rows={rowVMs}
      onAddRow={onAddRow}
      onRemoveRow={onRemoveRow}
      onChangeRowName={onChangeRowName}
      onChangeRowQuantity={onChangeRowQuantity}
      onChangeRowUnit={onChangeRowUnit}
      activeSearchRowId={activeSearchRowId}
      searchQuery={searchQuery}
      searchResults={search.results}
      isSearching={search.isSearching}
      onOpenRowSearch={onOpenRowSearch}
      onCloseRowSearch={onCloseRowSearch}
      onSearchQueryChange={setSearchQuery}
      onLinkFood={onLinkFood}
      onCreateWithAi={(id) => void onCreateWithAi(id)}
      resolvingRowId={resolvingRowId}
      rowMessages={rowMessages}
      macroTotal={macroTotal}
      macrosProvided={providedTotals !== null}
      onEstimateWholeRecipe={() => void onEstimateWholeRecipe()}
      isEstimatingRecipe={estimateRecipe.isEstimating}
      estimateRecipeMessage={estimateMessage}
      canSave={canSave}
      isSaving={saving}
      onSave={() => void onSave()}
      onBack={onBack}
    />
  );
}
