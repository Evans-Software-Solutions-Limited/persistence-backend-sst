import { ProgressContainer } from "../../../src/ui/containers/ProgressContainer";

/**
 * Progress tab — thin wrapper around `ProgressContainer`. M10.5 Wave 2
 * scaffolds the screen so the feature-gate primitives have a real
 * surface to render against; the full M4 content (PRs over time,
 * volume trends, body-measurement charts) ships separately.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Per-screen feature-
 *       gate integration (Wave 2) · specs/05-progress/
 */
export default function ProgressTab() {
  return <ProgressContainer />;
}
