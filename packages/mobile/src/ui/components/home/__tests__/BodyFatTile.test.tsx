import { BodyFatTile } from "@/ui/components/home/BodyFatTile";
import { renderWithTheme } from "../../../../../__tests__/test-utils";

describe("BodyFatTile", () => {
  it("renders em-dash when currentValue is null", () => {
    const { getByText } = renderWithTheme(
      <BodyFatTile currentValue={null} history={[]} />,
    );
    expect(getByText("—")).toBeTruthy();
  });

  it("renders value as percent with one decimal", () => {
    const { getByText } = renderWithTheme(
      <BodyFatTile currentValue={16.5} history={[]} />,
    );
    expect(getByText("16.5%")).toBeTruthy();
  });

  it("renders the SimpleLineGraph when history has points", () => {
    const history = [
      { date: new Date("2026-04-17"), value: 16.2 },
      { date: new Date("2026-04-18"), value: 16.4 },
      { date: new Date("2026-04-19"), value: 16.5 },
    ];
    const { toJSON } = renderWithTheme(
      <BodyFatTile currentValue={16.5} history={history} />,
    );
    expect(JSON.stringify(toJSON())).toContain('"d":"M ');
  });

  it("skips the graph when history is empty", () => {
    const { toJSON } = renderWithTheme(
      <BodyFatTile currentValue={16.5} history={[]} />,
    );
    expect(JSON.stringify(toJSON())).not.toContain('"d":"M ');
  });
});
