import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { ThemeProvider } from "@/components/theme-provider";

/** Render a marketing page with the router + theme context it depends on. */
export function renderPage(
  ui: ReactElement,
  { route = "/" }: { route?: string } = {},
) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ThemeProvider>{ui}</ThemeProvider>
    </MemoryRouter>,
  );
}
