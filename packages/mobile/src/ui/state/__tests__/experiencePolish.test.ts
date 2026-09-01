import { isExperiencePolishEnabled } from "../experiencePolish";

describe("isExperiencePolishEnabled", () => {
  it.each([undefined, "", "false", "TRUE", "1"])(
    "is safe-off for %p",
    (value) => expect(isExperiencePolishEnabled(value)).toBe(false),
  );

  it("enables only for the explicit true value", () => {
    expect(isExperiencePolishEnabled("true")).toBe(true);
  });
});
