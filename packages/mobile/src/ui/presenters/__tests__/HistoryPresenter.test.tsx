import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { muscleCredit } from "@persistence/training-metrics";
import { bodyMapShading, monthCells } from "@/domain/services/youPage";
import {
  HistoryPresenter,
  type HistoryDayView,
  type HistoryPresenterProps,
} from "../HistoryPresenter";

const NOW = new Date(2026, 9, 27, 12);
const handlers = () => ({
  onBack: jest.fn(),
  onPrevMonth: jest.fn(),
  onNextMonth: jest.fn(),
  onSelectDay: jest.fn(),
  onOpenWorkout: jest.fn(),
});

const values = (over: Partial<Record<string, string>> = {}) =>
  ["Calories", "Steps", "Weight", "Water", "Sleep"].map((label) => ({
    label,
    value: over[label] ?? "—",
    good: label === "Water" && !!over.Water,
  }));

const trainingDay: HistoryDayView = {
  key: "2026-10-26",
  title: "Mon 26 October",
  status: "Training day",
  trained: true,
  shading: bodyMapShading(
    muscleCredit([{ primary: ["chest"], secondary: [], completedSets: 4 }]),
    "Muscles worked: chest",
    true,
  ),
  gender: "male",
  musclesText: "Chest, back, shoulders, arms, core",
  summary: "2 workouts · 73 min · 7.6 t",
  workoutsTitle: "2 workouts",
  workouts: [
    {
      id: "w1",
      time: "07:10",
      name: "Upper A",
      detail: "58 min · 7.2 t · 22 sets · ★ 1 record",
      accessibilityLabel: "Upper A",
    },
    {
      id: "w2",
      time: "18:30",
      name: "Core finisher",
      detail: "15 min · 0.4 t · 6 sets",
      accessibilityLabel: "Core finisher",
    },
  ],
  values: values({
    Calories: "2,341 / 2,501",
    Steps: "9,120",
    Water: "8 cups ✓",
  }),
};

const restDay: HistoryDayView = {
  key: "2026-10-25",
  title: "Sun 25 October",
  status: "Rest day",
  trained: false,
  shading: bodyMapShading(muscleCredit([]), "No muscles worked", true),
  gender: "female",
  musclesText: "Nothing trained",
  summary: "Rest day",
  workoutsTitle: "Workout",
  workouts: [],
  values: values({ Steps: "6,400", Weight: "82.4 kg" }),
};

function props(
  day: HistoryDayView,
  over: Partial<HistoryPresenterProps> = {},
): HistoryPresenterProps {
  return {
    ...handlers(),
    monthTitle: "October 2026",
    cells: monthCells(2026, 9, new Set(["2026-10-26", "2026-10-25"]), NOW),
    selectedKey: day.key,
    canGoNext: false,
    coverageNote: null,
    day,
    ...over,
  };
}

describe("HistoryPresenter", () => {
  it("training day: the month, the day's muscles, its workouts and values", () => {
    const p = props(trainingDay);
    const q = renderWithTheme(<HistoryPresenter {...p} />);
    expect(q.getByText("History")).toBeTruthy();
    expect(q.getByText("October 2026")).toBeTruthy();
    expect(q.getByText("Mon 26 October")).toBeTruthy();
    expect(q.getByTestId("history-day-status").props.children).toBe(
      "Training day",
    );
    expect(q.getByText("Chest, back, shoulders, arms, core")).toBeTruthy();
    expect(q.getByText("2 workouts · 73 min · 7.6 t")).toBeTruthy();
    expect(q.getByText("2 workouts")).toBeTruthy();
    expect(q.getByText("58 min · 7.2 t · 22 sets · ★ 1 record")).toBeTruthy();
    expect(q.getByText("2,341 / 2,501")).toBeTruthy();
    expect(q.getByText("8 cups ✓")).toBeTruthy();
    fireEvent.press(q.getByTestId("history-workout-w1"));
    expect(p.onOpenWorkout).toHaveBeenCalledWith("w1");
  });

  it("rest day: grey figure, 'Nothing trained', no workouts list", () => {
    const q = renderWithTheme(<HistoryPresenter {...props(restDay)} />);
    expect(q.getByTestId("history-day-status").props.children).toBe("Rest day");
    expect(q.getByText("Nothing trained")).toBeTruthy();
    expect(q.getAllByText("Rest day").length).toBe(2);
    expect(q.queryByTestId("history-workout-w1")).toBeNull();
    expect(q.getByText("82.4 kg")).toBeTruthy();
    expect(q.getByTestId("history-muscle-map")).toBeTruthy();
  });

  it("selects past days, never future ones, and moves between months", () => {
    const p = props(trainingDay, { canGoNext: true });
    const q = renderWithTheme(<HistoryPresenter {...p} />);
    fireEvent.press(q.getByTestId("history-cell-2026-10-25"));
    expect(p.onSelectDay).toHaveBeenCalledWith("2026-10-25");
    fireEvent.press(q.getByTestId("history-cell-2026-10-30"));
    expect(p.onSelectDay).toHaveBeenCalledTimes(1);
    fireEvent.press(q.getByTestId("history-prev"));
    fireEvent.press(q.getByTestId("history-next"));
    fireEvent.press(q.getByTestId("history-back"));
    expect(p.onPrevMonth).toHaveBeenCalled();
    expect(p.onNextMonth).toHaveBeenCalled();
    expect(p.onBack).toHaveBeenCalled();
    expect(
      q.getByTestId("history-cell-2026-10-26").props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(q.getByLabelText("26 October, logged")).toBeTruthy();
    expect(q.getByLabelText("24 October, nothing logged")).toBeTruthy();
  });

  it("can't move past the current month", () => {
    const p = props(trainingDay, { canGoNext: false });
    const q = renderWithTheme(<HistoryPresenter {...p} />);
    fireEvent.press(q.getByTestId("history-next"));
    expect(p.onNextMonth).not.toHaveBeenCalled();
  });

  it("offline / before the phone's log: says what the phone covers", () => {
    const q = renderWithTheme(
      <HistoryPresenter
        {...props(restDay, {
          coverageNote: "This phone keeps your history from 20 Nov.",
        })}
      />,
    );
    expect(q.getByTestId("history-coverage")).toBeTruthy();
  });
});
