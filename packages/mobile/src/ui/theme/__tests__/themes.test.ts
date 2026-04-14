import { darkTheme, lightTheme } from "../themes";

describe("themes", () => {
  it("dark and light themes have the same keys", () => {
    const darkKeys = Object.keys(darkTheme).sort();
    const lightKeys = Object.keys(lightTheme).sort();
    expect(darkKeys).toEqual(lightKeys);
  });

  it("dark theme has required semantic keys", () => {
    expect(darkTheme.background).toBeDefined();
    expect(darkTheme.color).toBeDefined();
    expect(darkTheme.surface).toBeDefined();
    expect(darkTheme.borderColor).toBeDefined();
    expect(darkTheme.primary).toBeDefined();
    expect(darkTheme.error).toBeDefined();
    expect(darkTheme.success).toBeDefined();
    expect(darkTheme.placeholderColor).toBeDefined();
  });

  it("light theme has required semantic keys", () => {
    expect(lightTheme.background).toBeDefined();
    expect(lightTheme.color).toBeDefined();
    expect(lightTheme.surface).toBeDefined();
    expect(lightTheme.borderColor).toBeDefined();
  });

  it("dark theme is dark-first (dark backgrounds)", () => {
    expect(darkTheme.background).toBe("#0A0A0F");
    expect(darkTheme.color).toBe("#FFFFFF");
  });

  it("light theme has light backgrounds", () => {
    expect(lightTheme.background).toBe("#F5F5F7");
    expect(lightTheme.color).toBe("#0A0A0F");
  });

  it("both themes share the same primary accent", () => {
    expect(darkTheme.primary).toBe(lightTheme.primary);
    expect(darkTheme.primary).toBe("#00D4FF");
  });
});
