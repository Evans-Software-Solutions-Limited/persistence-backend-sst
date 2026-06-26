import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { MacroHeroPresenter, type MacroHeroProps } from "../MacroHeroPresenter";

function render(over: Partial<MacroHeroProps> = {}) {
  const props: MacroHeroProps = {
    remainingKcal: 260,
    consumedKcal: 1840,
    targetKcal: 2100,
    ringPct: 0.88,
    macros: [
      {
        label: "Protein",
        value: 142,
        target: 170,
        color: "#22D3EE",
        pct: 0.83,
      },
      { label: "Carbs", value: 210, target: 240, color: "#F5C518", pct: 0.87 },
      { label: "Fat", value: 58, target: 70, color: "#FB923C", pct: 0.82 },
    ],
    celebrate: false,
    noTarget: false,
    onOpenTargets: jest.fn(),
    onLog: jest.fn(),
    ...over,
  };
  return { ...renderWithTheme(<MacroHeroPresenter {...props} />), props };
}

describe("MacroHeroPresenter", () => {
  it("renders the remaining-kcal ring and three macro lines", () => {
    const { getByTestId } = render();
    expect(getByTestId("fuel-hero-ring")).toBeTruthy();
    expect(getByTestId("fuel-macro-protein")).toBeTruthy();
    expect(getByTestId("fuel-macro-carbs")).toBeTruthy();
    expect(getByTestId("fuel-macro-fat")).toBeTruthy();
  });

  it("shows the REMAINING label by default and GOAL HIT when celebrating", () => {
    const { getByText, rerender } = render();
    expect(getByText("REMAINING")).toBeTruthy();
    rerender(
      <MacroHeroPresenter {...render({ celebrate: true }).props} celebrate />,
    );
    expect(getByText("GOAL HIT")).toBeTruthy();
  });

  it("renders a placeholder target when none is set", () => {
    const { getByText } = render({ noTarget: true });
    expect(getByText("/ — kcal")).toBeTruthy();
  });

  it("fires the edit + log handlers", () => {
    const { getByTestId, props } = render();
    fireEvent.press(getByTestId("fuel-hero-edit"));
    fireEvent.press(getByTestId("fuel-hero-log"));
    expect(props.onOpenTargets).toHaveBeenCalledTimes(1);
    expect(props.onLog).toHaveBeenCalledTimes(1);
  });
});
