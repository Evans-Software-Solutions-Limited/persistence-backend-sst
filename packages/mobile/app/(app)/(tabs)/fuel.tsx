import { FuelContainer } from "@/ui/containers/FuelContainer";

/**
 * Fuel tab — nutrition (M9 / 13-nutrition-tracking). Replaces the M9-era
 * <ComingSoon/> placeholder with the real Fuel surface: macro hero ring, quick-
 * add row, meal log, and water tracker, offline-first over the SQLite cache.
 *
 * Spec: specs/13-nutrition-tracking/design.md § Frontend — <FuelPresenter>
 *       specs/14-navigation/requirements.md STORY-006 (AC 6.2 — placeholder retired)
 *
 * Not rendered in coach mode (AC 6.3) — the tabs layout gates the Fuel tab.
 */
export default function FuelTab() {
  return <FuelContainer />;
}
