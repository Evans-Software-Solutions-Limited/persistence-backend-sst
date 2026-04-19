import { ExerciseListContainer } from "../../../src/ui/containers/ExerciseListContainer";

/**
 * Thin wrapper: this file IS the Exercises tab. It is a flat `.tsx` rather
 * than a directory with `_layout.tsx` by design — the detail, creator, and
 * filters screens are registered as siblings of `(tabs)` in the parent
 * `(app)/_layout.tsx` Stack so they push OVER the tab bar, not inside it.
 *
 * If you ever need sub-routes that render WITHIN the tab (e.g. a nested
 * browse-by-category view), convert this file to `exercises/index.tsx` +
 * `exercises/_layout.tsx` but leave detail/create/filters where they are.
 */
export default function ExercisesTab() {
  return <ExerciseListContainer />;
}
