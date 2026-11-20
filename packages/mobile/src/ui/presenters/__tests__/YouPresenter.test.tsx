import { fireEvent } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { muscleCredit } from "@/domain/services/trainingMetrics/muscleCredit";
import { bodyMapShading } from "@/domain/services/youPage";
import {
  sparklinePoints,
  YouPresenter,
  type YouPresenterProps,
} from "../YouPresenter";

const handlers = () => ({
  onRefresh: jest.fn(),
  onOpenDrawer: jest.fn(),
  onOpenSettings: jest.fn(),
  onOpenRequests: jest.fn(),
  onOpenAcceptInvite: jest.fn(),
  onOpenBadges: jest.fn(),
  onOpenWeight: jest.fn(),
  onOpenBodyFat: jest.fn(),
  onOpenHistory: jest.fn(),
  onOpenRecap: jest.fn(),
});

/** A trained athlete with a week of data (canvas Y1 → Y1c values). */
function trainedProps(): YouPresenterProps {
  const rows = muscleCredit([
    {
      primary: ["chest", "back", "shoulders"],
      secondary: [],
      completedSets: 12,
    },
    { primary: ["hamstrings"], secondary: [], completedSets: 3 },
  ]);
  return {
    ...handlers(),
    initials: "BE",
    coaches: [
      {
        id: "r1",
        initials: "EH",
        name: "Ellie Hart",
        subtitle: "Personal Trainer · since Mar 2026",
      },
      { id: "r2", initials: "ML", name: "Marcus Lee", subtitle: "Trainer" },
    ],
    pendingRequestCount: 0,
    myPendingCoachRequests: [],
    gallery: null,
    badges: [
      { label: "1w", earned: true, icon: "flame" },
      { label: "2w", earned: false, icon: "bolt" },
      { label: "4w", earned: false, icon: "dumbbell" },
      { label: "2mo", earned: false, icon: "medal" },
      { label: "3mo", earned: false, icon: "crown" },
    ],
    muscles: {
      shading: bodyMapShading(rows, "Last 7 days."),
      gender: "male",
      trainNext: {
        text: "Hamstrings, calves, core",
        hint: "Short of their week · a lower day sorts it",
      },
      rest: {
        text: "Chest, back, shoulders",
        hint: "Hit their week · nice work",
      },
    },
    lastSevenDays: { workouts: "4", volume: "24.1 t", time: "4h 05m" },
    weight: {
      value: "82.4",
      unit: "kg",
      detail: "Today · +0.4 this week",
      series: [82, 82.2, 82.4],
    },
    bodyFat: {
      value: "14.8",
      unit: "%",
      detail: "22 Oct · −0.3 this month",
      series: [15.1, 14.8],
    },
    steps: {
      today: "8,240",
      detail: "Avg 7,840 · last 7 days",
      days: [6900, 9800, null, 5400, 10100, 7240, 8240],
      accessibilityLabel: "Steps last 7 days",
    },
    topLifts: [
      {
        key: "squat",
        rank: "1",
        name: "Back squat",
        detail: "120 kg × 7 · Mon",
        value: "148.0 kg",
        gold: true,
      },
      {
        key: "bench",
        rank: "2",
        name: "Bench press",
        detail: "95 kg × 5 · Thu",
        value: "111.0 kg",
        gold: false,
      },
    ],
    hasData: true,
    isLoading: false,
    isRefreshing: false,
    error: null,
  };
}

/** A brand-new athlete: nothing logged, no coach, no readings. */
function newUserProps(): YouPresenterProps {
  const rows = muscleCredit([]);
  return {
    ...trainedProps(),
    coaches: [],
    badges: trainedProps().badges.map((b) => ({ ...b, earned: false })),
    muscles: {
      shading: bodyMapShading(rows, "Last 7 days."),
      gender: "female",
      trainNext: { text: "Back, quads, chest", hint: "Short of their week" },
      rest: null,
    },
    lastSevenDays: { workouts: "0", volume: "0.0 t", time: "0h 00m" },
    weight: { value: null, unit: "kg", detail: null, series: [] },
    bodyFat: { value: null, unit: "%", detail: null, series: [] },
    steps: {
      today: null,
      detail: null,
      days: Array(7).fill(null),
      accessibilityLabel: "Steps last 7 days: none",
    },
    topLifts: [],
  };
}

const render = (props: YouPresenterProps) =>
  renderWithTheme(<YouPresenter {...props} />);

describe("YouPresenter — trained athlete (canvas Y1–Y1c)", () => {
  it("shows the header, coaches, badges, muscles, strip, tiles, history and lifts", () => {
    const p = trainedProps();
    const s = render(p);
    expect(s.getByText("You")).toBeTruthy();
    expect(s.getByText("BE")).toBeTruthy();
    expect(s.getByText("COACHES")).toBeTruthy();
    expect(s.getByText("Ellie Hart")).toBeTruthy();
    expect(s.getByText("Personal Trainer · since Mar 2026")).toBeTruthy();
    expect(s.getByText("Have a coach's code?")).toBeTruthy();
    expect(s.getByText("1 of 5 · See all")).toBeTruthy();
    expect(s.getByTestId("you-badge-1w-earned")).toBeTruthy();
    expect(s.getByTestId("you-badge-2w")).toBeTruthy();
    expect(s.getByText("Muscles · last 7 days")).toBeTruthy();
    expect(s.getByText("Hamstrings, calves, core")).toBeTruthy();
    expect(
      s.getByText("Short of their week · a lower day sorts it"),
    ).toBeTruthy();
    expect(s.getByText("Chest, back, shoulders")).toBeTruthy();
    expect(s.getByText("Hit their week · nice work")).toBeTruthy();
    expect(s.getByText("24.1 t")).toBeTruthy();
    expect(s.getByText("4h 05m")).toBeTruthy();
    expect(s.getByText("Today · +0.4 this week")).toBeTruthy();
    expect(s.getByText("Avg 7,840 · last 7 days")).toBeTruthy();
    expect(
      s.getAllByTestId("you-sparkline", { includeHiddenElements: true }),
    ).toHaveLength(2);
    expect(s.getByText("History")).toBeTruthy();
    expect(s.getByText("Top lifts · last 7 days")).toBeTruthy();
    expect(s.getByText("120 kg × 7 · Mon")).toBeTruthy();
    expect(s.getByText("See a recap")).toBeTruthy();
    expect(
      s.getByText("This week, this month or 3 months · shareable"),
    ).toBeTruthy();
    // The gallery row waits for APP-F1.
    expect(s.queryByTestId("you-gallery")).toBeNull();
  });

  it("wires every action", () => {
    const p = { ...trainedProps(), onOpenCoach: jest.fn() };
    const s = render(p);
    fireEvent.press(s.getByTestId("you-profile"));
    fireEvent.press(s.getByTestId("you-settings"));
    fireEvent.press(s.getByTestId("you-coach-r1"));
    fireEvent.press(s.getByTestId("you-accept-invite-button"));
    fireEvent.press(s.getByTestId("you-badges-all"));
    fireEvent.press(s.getByTestId("you-weight"));
    fireEvent.press(s.getByTestId("you-bodyfat"));
    fireEvent.press(s.getByTestId("you-history"));
    fireEvent.press(s.getByTestId("you-recap"));
    expect(p.onOpenDrawer).toHaveBeenCalled();
    expect(p.onOpenSettings).toHaveBeenCalled();
    expect(p.onOpenCoach).toHaveBeenCalledWith("r1");
    expect(p.onOpenAcceptInvite).toHaveBeenCalled();
    expect(p.onOpenBadges).toHaveBeenCalled();
    expect(p.onOpenWeight).toHaveBeenCalled();
    expect(p.onOpenBodyFat).toHaveBeenCalled();
    expect(p.onOpenHistory).toHaveBeenCalled();
    expect(p.onOpenRecap).toHaveBeenCalled();
  });

  it("keeps coach requests reachable under the coaches list", () => {
    const p = {
      ...trainedProps(),
      pendingRequestCount: 2,
      myPendingCoachRequests: [{ relationshipId: "x", trainerName: "Sam" }],
    };
    const s = render(p);
    expect(s.getByText("2 pending requests")).toBeTruthy();
    expect(
      s.getByText("Request sent to Sam — awaiting acceptance"),
    ).toBeTruthy();
    fireEvent.press(s.getByTestId("you-trainer-review"));
    expect(p.onOpenRequests).toHaveBeenCalled();
    s.rerender(<YouPresenter {...p} pendingRequestCount={1} />);
    expect(s.getByText("1 pending request")).toBeTruthy();
  });

  it("shows a gallery seam once APP-F1 supplies one", () => {
    const s = render({
      ...trainedProps(),
      gallery: { dateLabel: "25 Oct", photos: [] },
    });
    expect(s.getByText("Gallery · 25 Oct")).toBeTruthy();
  });
});

describe("YouPresenter — new user", () => {
  it("shows empty tiles, no Rest group, no lifts and only the code row", () => {
    const s = render(newUserProps());
    expect(s.queryByTestId("you-coach-r1")).toBeNull();
    expect(s.getByText("Have a coach's code?")).toBeTruthy();
    expect(s.getByText("0 of 5 · See all")).toBeTruthy();
    expect(s.getByTestId("you-train-next")).toBeTruthy();
    expect(s.queryByTestId("you-rest")).toBeNull();
    expect(s.getByText("0h 00m")).toBeTruthy();
    expect(s.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(
      s.queryByTestId("you-sparkline", { includeHiddenElements: true }),
    ).toBeNull();
    expect(s.getByTestId("you-top-lifts-empty")).toBeTruthy();
    // Coach rows without a destination aren't buttons.
  });

  it("draws the figure for the profile's sex", () => {
    const s = render(newUserProps());
    expect(s.getByTestId("you-muscle-map")).toBeTruthy();
  });

  it("hides Train next when there's nothing to train", () => {
    const p = newUserProps();
    const s = render({ ...p, muscles: { ...p.muscles, trainNext: null } });
    expect(s.queryByTestId("you-train-next")).toBeNull();
  });
});

describe("YouPresenter — offline and loading", () => {
  it("offline with a cache: renders the cached page, never the error", () => {
    const s = render({
      ...trainedProps(),
      error: { kind: "network", message: "offline" } as never,
    });
    expect(s.queryByTestId("you-error-state")).toBeNull();
    expect(s.getByText("Ellie Hart")).toBeTruthy();
    expect(s.getByText("24.1 t")).toBeTruthy();
  });

  it("offline with nothing cached: shows the error with a retry", () => {
    const p = {
      ...trainedProps(),
      hasData: false,
      error: { kind: "network", message: "offline" } as never,
    };
    const s = render(p);
    expect(s.getByTestId("you-error-state")).toBeTruthy();
  });

  it("shows the loader before anything is cached", () => {
    const s = render({ ...trainedProps(), hasData: false, isLoading: true });
    expect(s.getByTestId("you-loader")).toBeTruthy();
  });
});

describe("sparklinePoints", () => {
  it("spreads readings across the tile, low at the bottom", () => {
    expect(sparklinePoints([1, 2])).toBe("0,30 150,4");
    expect(sparklinePoints([5, 5, 5])).toBe("0,30 75,30 150,30");
    expect(sparklinePoints([1])).toBeNull();
  });
});
