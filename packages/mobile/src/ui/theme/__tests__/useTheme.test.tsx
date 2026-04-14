import { renderHook } from "@testing-library/react-native";

import { useTheme } from "../useTheme";
import { ThemeProvider } from "../ThemeProvider";
import type { ReactNode } from "react";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

describe("useTheme", () => {
  it("throws when used outside ThemeProvider", () => {
    // Silence console.error from the expected thrown error
    const consoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    expect(() => {
      renderHook(() => useTheme());
    }).toThrow("useTheme must be used within a ThemeProvider");

    consoleSpy.mockRestore();
  });

  it("returns theme values when inside ThemeProvider", () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ThemeProvider>{children}</ThemeProvider>
    );

    const { result } = renderHook(() => useTheme(), { wrapper });

    expect(result.current.themePreference).toBe("dark");
    expect(result.current.effectiveTheme).toBeDefined();
    expect(typeof result.current.isDark).toBe("boolean");
    expect(typeof result.current.setThemePreference).toBe("function");
  });
});
