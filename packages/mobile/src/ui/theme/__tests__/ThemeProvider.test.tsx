import AsyncStorage from "@react-native-async-storage/async-storage";
import { render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import { ThemeProvider } from "../ThemeProvider";
import type { ThemePreference } from "../theme.types";
import { useTheme } from "../useTheme";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => ({
  __esModule: true,
  default: jest.fn(() => "dark"),
}));

function ThemeConsumer({
  onSetPreference,
}: {
  onSetPreference?: (set: (p: ThemePreference) => void) => void;
}) {
  const { effectiveTheme, isDark, themePreference, setThemePreference } =
    useTheme();
  onSetPreference?.(setThemePreference);
  return (
    <>
      <Text testID="effective">{effectiveTheme}</Text>
      <Text testID="isDark">{isDark.toString()}</Text>
      <Text testID="preference">{themePreference}</Text>
    </>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders children", () => {
    const { getByText } = render(
      <ThemeProvider>
        <Text>Hello</Text>
      </ThemeProvider>,
    );
    expect(getByText("Hello")).toBeTruthy();
  });

  it("defaults to dark theme preference", () => {
    const { getByTestId } = render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(getByTestId("preference").props.children).toBe("dark");
    expect(getByTestId("effective").props.children).toBe("dark");
    expect(getByTestId("isDark").props.children).toBe("true");
  });

  it("reads persisted preference from AsyncStorage on mount", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce("light");
    const { getByTestId } = render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    await waitFor(() => {
      expect(getByTestId("effective").props.children).toBe("light");
    });
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(
      "@persistence/theme-preference",
    );
  });

  it("persists manual override to AsyncStorage", async () => {
    let setPreference: ((p: ThemePreference) => void) | undefined;
    render(
      <ThemeProvider>
        <ThemeConsumer
          onSetPreference={(set) => {
            setPreference = set;
          }}
        />
      </ThemeProvider>,
    );
    // Call setThemePreference
    setPreference!("light");
    await waitFor(() => {
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        "@persistence/theme-preference",
        "light",
      );
    });
  });

  it("handles AsyncStorage read failure gracefully", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(
      new Error("storage error"),
    );
    const { getByTestId } = render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    // Should still work with default dark theme
    expect(getByTestId("preference").props.children).toBe("dark");
  });
});
