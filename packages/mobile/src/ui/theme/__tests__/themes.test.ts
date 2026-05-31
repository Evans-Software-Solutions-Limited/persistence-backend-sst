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

  it("dark theme is dark-first using the handoff background + text ramp", () => {
    expect(darkTheme.background).toBe("#0A0B12");
    expect(darkTheme.color).toBe("#F4F4F8");
    expect(darkTheme.surface).toBe("#12141D");
    expect(darkTheme.colorSecondary).toBe("#C2C2CE");
  });

  it("light theme has light backgrounds", () => {
    expect(lightTheme.background).toBe("#F5F5F7");
    expect(lightTheme.color).toBe("#0A0B12");
  });

  it("both themes share the refreshed brand cyan (#22D3EE)", () => {
    expect(darkTheme.primary).toBe(lightTheme.primary);
    expect(darkTheme.primary).toBe("#22D3EE");
  });

  it("refreshes semantic tones to the handoff palette", () => {
    expect(darkTheme.success).toBe("#34D399");
    expect(darkTheme.warning).toBe("#FBBF24");
    expect(darkTheme.error).toBe("#F87171");
    expect(darkTheme.info).toBe("#60A5FA");
  });
});
