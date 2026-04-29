import * as workoutsTheme from "@/ui/theme/workoutsLegacyTheme";
import * as homeTheme from "@/ui/theme/homeLegacyTheme";

/**
 * `workoutsLegacyTheme` is a re-export shim — verifying the re-exports
 * match the source module is enough to catch accidental drift if the
 * shim picks up local overrides in a future revision.
 */
describe("workoutsLegacyTheme", () => {
  it("re-exports the same Colors / Spacing / BorderRadius / Shadows / Typography schema as homeLegacyTheme", () => {
    expect(workoutsTheme.Colors).toBe(homeTheme.Colors);
    expect(workoutsTheme.Spacing).toBe(homeTheme.Spacing);
    expect(workoutsTheme.BorderRadius).toBe(homeTheme.BorderRadius);
    expect(workoutsTheme.Shadows).toBe(homeTheme.Shadows);
    expect(workoutsTheme.Typography).toBe(homeTheme.Typography);
  });
});
