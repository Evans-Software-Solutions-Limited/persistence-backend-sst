import {
  BOOTSTRAP_FRESH_MS,
  forgetBootstrapSections,
  recallBootstrapSection,
  rememberBootstrapSection,
} from "../freshness";

describe("bootstrap freshness", () => {
  it("recalls a write inside the window with its value and forgets per user", () => {
    rememberBootstrapSection("u1", "streaks", 1_000, [{ id: "s1" }]);
    rememberBootstrapSection("u2", "streaks", 1_000);
    expect(recallBootstrapSection("u1", "streaks", 500, 1_400)).toEqual({
      at: 1_000,
      value: [{ id: "s1" }],
    });
    expect(recallBootstrapSection("u1", "streaks", 500, 1_600)).toBeNull();
    expect(recallBootstrapSection("u1", "home", 500, 1_100)).toBeNull();
    forgetBootstrapSections("u1");
    expect(recallBootstrapSection("u1", "streaks", 500, 1_100)).toBeNull();
    expect(recallBootstrapSection("u2", "streaks", 500, 1_100)).toEqual({
      at: 1_000,
      value: undefined,
    });
    expect(BOOTSTRAP_FRESH_MS).toBeGreaterThan(0);
  });
});
