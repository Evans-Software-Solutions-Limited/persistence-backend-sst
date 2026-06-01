import { initialsOf } from "../initials";

describe("initialsOf", () => {
  it("returns the en-dash placeholder for null / undefined / empty", () => {
    expect(initialsOf(null)).toBe("–");
    expect(initialsOf(undefined)).toBe("–");
    expect(initialsOf("")).toBe("–");
    expect(initialsOf("   ")).toBe("–");
  });

  it("takes the first two tokens' initials, uppercased", () => {
    expect(initialsOf("Bradley Simms-Evans")).toBe("BS");
    expect(initialsOf("ada lovelace")).toBe("AL");
  });

  it("uses a single initial for a single-token name", () => {
    expect(initialsOf("Cher")).toBe("C");
  });

  it("ignores a third token", () => {
    expect(initialsOf("Mary Jane Watson")).toBe("MJ");
  });

  it("collapses extra interior whitespace", () => {
    expect(initialsOf("  John   Doe  ")).toBe("JD");
  });
});
