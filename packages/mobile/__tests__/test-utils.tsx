import { TamaguiProvider } from "@tamagui/core";
import { render, type RenderOptions } from "@testing-library/react-native";
import type { ReactElement } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import config from "../tamagui.config";

const initialSafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 44, left: 0, right: 0, bottom: 34 },
};

function ThemeWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={initialSafeAreaMetrics}>
      <TamaguiProvider config={config} defaultTheme="dark">
        {children}
      </TamaguiProvider>
    </SafeAreaProvider>
  );
}

export function renderWithTheme(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: ThemeWrapper, ...options });
}

export {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
