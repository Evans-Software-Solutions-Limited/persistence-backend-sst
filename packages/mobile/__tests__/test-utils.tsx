import { TamaguiProvider } from "@tamagui/core";
import { render, type RenderOptions } from "@testing-library/react-native";
import type { ReactElement } from "react";

import config from "../tamagui.config";

function ThemeWrapper({ children }: { children: React.ReactNode }) {
  return (
    <TamaguiProvider config={config} defaultTheme="dark">
      {children}
    </TamaguiProvider>
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
