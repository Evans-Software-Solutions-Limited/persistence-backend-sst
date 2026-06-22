import {
  fireEvent,
  renderWithTheme,
} from "../../../../../__tests__/test-utils";
import { ProgramStatsPresenter } from "../ProgramStatsPresenter";

describe("ProgramStatsPresenter", () => {
  it("renders a row per programme with singular/plural client copy", () => {
    const { getByText } = renderWithTheme(
      <ProgramStatsPresenter
        programs={[
          { id: "p1", name: "Strength Foundations", activeClients: 5 },
          { id: "p2", name: "Mobility Reset", activeClients: 1 },
        ]}
      />,
    );
    expect(getByText("Programmes in use")).toBeTruthy();
    expect(getByText("Strength Foundations")).toBeTruthy();
    expect(getByText("5 clients active")).toBeTruthy();
    expect(getByText("1 client active")).toBeTruthy();
  });

  it("renders the empty placeholder when there are no programmes", () => {
    const { getByTestId, getByText } = renderWithTheme(
      <ProgramStatsPresenter programs={[]} />,
    );
    expect(getByTestId("coach-programs-empty")).toBeTruthy();
    expect(getByText("No active programmes yet")).toBeTruthy();
  });

  it("fires onViewAll from the header link", () => {
    const onViewAll = jest.fn();
    const { getByText } = renderWithTheme(
      <ProgramStatsPresenter programs={[]} onViewAll={onViewAll} />,
    );
    fireEvent.press(getByText("View all"));
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });
});
