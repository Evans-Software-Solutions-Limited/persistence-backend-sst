import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { muscleCredit } from "@/domain/services/trainingMetrics/muscleCredit";
import { bodyMapShading } from "@/domain/services/youPage";
import {
  RecapPresenter,
  type RecapPage,
  type RecapPresenterProps,
} from "../RecapPresenter";

const pages: RecapPage[] = [
  {
    kind: "big",
    id: "totals",
    eyebrow: "This week",
    big: "4",
    unit: "workouts",
    sub: "1 more than last week",
    trio: [
      { value: "24.1 t", label: "Volume" },
      { value: "4h 05m", label: "Time" },
      { value: "6 wk", label: "Streak" },
    ],
  },
  {
    kind: "muscles",
    id: "muscles",
    eyebrow: "This week · muscle balance",
    shading: bodyMapShading(
      muscleCredit([{ primary: ["back"], secondary: [], completedSets: 4 }]),
      "Muscle balance: Back 100 percent",
      true,
    ),
    rows: [
      { label: "Back", share: 22 },
      { label: "Arms", share: 9 },
      { label: "Core", share: 5 },
      { label: "Calves", share: 3 },
    ],
  },
  {
    kind: "list",
    id: "lifts",
    eyebrow: "This week · top lifts",
    lifts: [
      {
        key: "s",
        rank: "1",
        name: "Back squat",
        detail: "120 kg × 7 · Mon",
        value: "148.0 kg",
        gold: true,
      },
    ],
  },
  {
    kind: "big",
    id: "records",
    eyebrow: "This week · records",
    big: "1",
    unit: "PR",
    sub: "",
    trio: [{ value: "142.5", label: "Squat" }],
    gold: true,
  },
];

function setup(over: Partial<RecapPresenterProps> = {}) {
  const p: RecapPresenterProps = {
    period: "week",
    pages,
    gender: "male",
    coverageNote: null,
    onPeriod: jest.fn(),
    onClose: jest.fn(),
    onShare: jest.fn(),
    ...over,
  };
  const q = renderWithTheme(<RecapPresenter {...p} />);
  fireEvent(q.getByTestId("recap-pages"), "layout", {
    nativeEvent: { layout: { width: 400, height: 600 } },
  });
  return { p, q };
}

describe("RecapPresenter (Y4)", () => {
  it("shows the periods, every page and a dot per page", () => {
    const { q } = setup();
    expect(q.getAllByText("This week")).toHaveLength(2);
    expect(q.getByText("This month")).toBeTruthy();
    expect(q.getByText("3 months")).toBeTruthy();
    expect(q.getByText("1 more than last week")).toBeTruthy();
    expect(q.getByText("6 wk")).toBeTruthy();
    expect(q.getByText("This week · muscle balance")).toBeTruthy();
    expect(q.getByText("22%")).toBeTruthy();
    expect(q.getByText("Back squat")).toBeTruthy();
    expect(q.getByText("142.5")).toBeTruthy();
    expect(q.queryAllByTestId(/^recap-dot-/)).toHaveLength(4);
    expect(q.queryByTestId("recap-coverage")).toBeNull();
  });

  it("switches period, closes, and shares the page on screen", () => {
    const { p, q } = setup();
    fireEvent.press(q.getByTestId("recap-period-3months"));
    expect(p.onPeriod).toHaveBeenCalledWith("3months");
    fireEvent.press(q.getByTestId("recap-close"));
    expect(p.onClose).toHaveBeenCalled();
    fireEvent.press(q.getByTestId("recap-share"));
    expect(p.onShare).toHaveBeenCalledWith(pages[0]);
    // Tap a page → next page; tap a dot → that page.
    fireEvent(q.getByTestId("recap-page-totals"), "pressIn");
    fireEvent.press(q.getByTestId("recap-page-totals"));
    fireEvent.press(q.getByTestId("recap-share"));
    expect(p.onShare).toHaveBeenLastCalledWith(pages[1]);
    fireEvent.press(q.getByTestId("recap-dot-records"));
    fireEvent.press(q.getByTestId("recap-share"));
    expect(p.onShare).toHaveBeenLastCalledWith(pages[3]);
  });

  it("new user: only the totals page, with the coverage note", () => {
    const { q } = setup({
      pages: [
        { ...(pages[0] as RecapPage & { kind: "big" }), big: "0", sub: "" },
      ],
      coverageNote:
        "From 20 Nov, when this phone started keeping your history.",
    });
    expect(q.queryAllByTestId(/^recap-dot-/)).toHaveLength(1);
    expect(q.getByTestId("recap-coverage")).toBeTruthy();
  });
});
