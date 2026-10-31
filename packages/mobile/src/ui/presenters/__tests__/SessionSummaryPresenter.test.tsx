/**
 * SessionSummaryPresenter — the finish pages (PER-60 canvas row 3c).
 * Every page, its hidden and empty cases, one record vs several, and solo
 * vs Together page counts.
 */

import { act, fireEvent } from "@testing-library/react-native";
import React from "react";
import Carousel from "react-native-reanimated-carousel";
import type { ExerciseSet, WorkoutSession } from "@/domain/models/session";
import {
  buildWorkoutSummary,
  muscleShare,
  type MuscleShare,
  type SummaryRecord,
} from "@/domain/services/workoutSummary";
import {
  SessionSummaryPresenter,
  type SessionSummaryPresenterProps,
} from "../SessionSummaryPresenter";
import { renderWithTheme } from "../../../../__tests__/test-utils";

let seq = 0;
const set = (
  weightKg: number | null,
  reps: number | null,
  extra: Partial<ExerciseSet> = {},
): ExerciseSet => ({
  id: `set-${++seq}`,
  sessionExerciseId: "x",
  setNumber: 1,
  weightKg,
  reps,
  rpe: null,
  durationSeconds: null,
  distanceMeters: null,
  isCompleted: true,
  completedAt: null,
  ...extra,
});

const workout = (
  exercises: { name: string; sets: ExerciseSet[] }[],
): WorkoutSession => ({
  id: "local-1",
  userId: "u1",
  workoutId: null,
  name: "Lower Body B",
  status: "completed",
  startedAt: "2026-10-23T12:00:00.000Z",
  completedAt: "2026-10-23T12:52:00.000Z",
  notes: null,
  exercises: exercises.map((e, i) => ({
    id: `se-${i}`,
    sessionId: "local-1",
    exerciseId: `ex-${i}`,
    exerciseName: e.name,
    sortOrder: i,
    supersetGroup: null,
    isSubstituted: false,
    originalExerciseId: null,
    notes: null,
    sets: e.sets,
  })),
});

const lowerBody = workout([
  { name: "Barbell Back Squat", sets: [set(60, 8), set(65, 7)] },
  { name: "Romanian Deadlift", sets: [set(45, 10)] },
]);
const model = buildWorkoutSummary(lowerBody, 3120);
const worked = muscleShare([
  { primary: ["quadriceps"], secondary: ["glutes"], completedSets: 2 },
  { primary: ["hamstrings"], secondary: ["glutes"], completedSets: 1 },
]);

const record = (
  exerciseName: string,
  overrides: Partial<SummaryRecord> = {},
): SummaryRecord => ({
  exerciseId: exerciseName,
  exerciseName,
  recordType: "max_weight",
  newValue: 65,
  previousValue: 62.5,
  ...overrides,
});

const handlers = {
  onDetails: jest.fn(),
  onContinue: jest.fn(),
  onClose: jest.fn(),
  onShare: jest.fn(),
};

function renderSummary(over: Partial<SessionSummaryPresenterProps> = {}) {
  const utils = renderWithTheme(
    <SessionSummaryPresenter
      model={model}
      muscles={worked}
      records={[]}
      workoutsThisMonth={null}
      rating={null}
      {...handlers}
      {...over}
    />,
  );
  // The pager sizes itself to the space between the top bar and the buttons.
  fireEvent(utils.getByTestId("summary-pages"), "layout", {
    nativeEvent: { layout: { width: 400, height: 600 } },
  });
  return utils;
}

const pageIds = (q: ReturnType<typeof renderSummary>) =>
  q.queryAllByTestId(/^summary-page-/).map((n) => n.props.testID);

beforeEach(() => jest.clearAllMocks());

describe("page counts", () => {
  it("shows four pages for a solo workout with no record", () => {
    const q = renderSummary();
    expect(pageIds(q)).toEqual([
      "summary-page-totals",
      "summary-page-muscles",
      "summary-page-exercises",
      "summary-page-volume",
    ]);
    expect(q.queryAllByTestId(/^summary-dot-/)).toHaveLength(4);
  });

  it("shows six pages for a Together workout with a record", () => {
    const q = renderSummary({
      records: [record("Barbell Back Squat")],
      together: {
        self: "Mia",
        names: ["Brad", "Tom", "Inés"],
        connection: "Nearby",
      },
    });
    expect(pageIds(q)).toHaveLength(6);
    expect(q.getByLabelText("Trained together, page 6 of 6")).toBeTruthy();
  });

  it("hides Muscles worked when no exercise has muscle groups", () => {
    const q = renderSummary({ muscles: muscleShare([]) });
    expect(q.queryByTestId("summary-page-muscles")).toBeNull();
    expect(q.queryByTestId("muscle-map")).toBeNull();
  });

  it("hides Volume by exercise for a bodyweight-only workout", () => {
    const q = renderSummary({
      model: buildWorkoutSummary(
        workout([{ name: "Push-up", sets: [set(null, 20)] }]),
        600,
      ),
    });
    expect(q.queryByTestId("summary-page-volume")).toBeNull();
  });

  it("hides Trained together when nobody else was in the session", () => {
    const q = renderSummary({
      together: { self: "Mia", names: [], connection: "Online" },
    });
    expect(q.queryByTestId("summary-page-together")).toBeNull();
  });

  it("does not render the pager before it has a size", () => {
    const q = renderWithTheme(
      <SessionSummaryPresenter
        model={model}
        muscles={worked}
        records={[]}
        workoutsThisMonth={null}
        rating={null}
        {...handlers}
      />,
    );
    fireEvent(q.getByTestId("summary-pages"), "layout", {
      nativeEvent: { layout: { width: 0, height: 0 } },
    });
    expect(q.queryByTestId("summary-carousel")).toBeNull();
  });
});

describe("Totals", () => {
  it("leads with volume, then sets, reps, duration, effort and the month", () => {
    const q = renderSummary({ rating: 8, workoutsThisMonth: 9 });
    expect(q.getByText("Workout complete")).toBeTruthy();
    expect(q.getByText("Lower Body B · 23 Oct")).toBeTruthy();
    expect(q.getByText("1,385")).toBeTruthy();
    expect(q.getByText("kg")).toBeTruthy();
    expect(q.getByText("3")).toBeTruthy();
    expect(q.getByText("25")).toBeTruthy();
    expect(q.getByText("52 min")).toBeTruthy();
    expect(q.getByText("Effort 8/10 · Hard")).toBeTruthy();
    expect(q.getByText("9 workouts this month")).toBeTruthy();
  });

  it("drops effort and the month count until they are known", () => {
    const q = renderSummary();
    expect(q.queryByTestId("summary-effort")).toBeNull();
    expect(q.queryByText(/this month/)).toBeNull();
  });

  it("says workout in the singular", () => {
    expect(
      renderSummary({ workoutsThisMonth: 1 }).getByText("1 workout this month"),
    ).toBeTruthy();
  });

  it("shows pounds for an imperial athlete", () => {
    const q = renderSummary({ weightUnit: "lb" });
    expect(q.getByText("3,053")).toBeTruthy();
    expect(q.getAllByText("lb").length).toBeGreaterThan(0);
  });

  it("leads a cardio-only workout with distance", () => {
    const run = buildWorkoutSummary(
      workout([
        {
          name: "Run",
          sets: [
            set(null, null, { distanceMeters: 5200, durationSeconds: 1500 }),
          ],
        },
      ]),
      1500,
    );
    const q = renderSummary({ model: run, muscles: muscleShare([]) });
    expect(q.getByText("5.2")).toBeTruthy();
    expect(q.getByText("km")).toBeTruthy();
    const miles = renderSummary({
      model: run,
      muscles: muscleShare([]),
      weightUnit: "lb",
    });
    expect(miles.getByText("3.2")).toBeTruthy();
    expect(miles.getByText("mi")).toBeTruthy();
  });
});

describe("Muscles worked", () => {
  it("labels the map with the top muscles and lists them with set counts", () => {
    const q = renderSummary();
    expect(
      q.getByLabelText("Muscles worked: quads 44%, glutes 33%, hamstrings 22%"),
    ).toBeTruthy();
    expect(q.getByText("Quads · 2 sets")).toBeTruthy();
    expect(q.getByText("Hamstrings · 1 set")).toBeTruthy();
    // Glutes was only ever secondary: no set count.
    expect(q.getByText("Glutes")).toBeTruthy();
  });

  it("shows fewer than three muscles when fewer were worked", () => {
    const one: MuscleShare = muscleShare([
      { primary: ["chest"], secondary: [], completedSets: 3 },
    ]);
    const q = renderSummary({ muscles: one });
    expect(q.getByText("100%")).toBeTruthy();
    expect(q.getByText("Chest · 3 sets")).toBeTruthy();
  });
});

describe("Exercises and Volume", () => {
  const many = buildWorkoutSummary(
    workout(
      Array.from({ length: 8 }, (_, i) => ({
        name: `Exercise ${i + 1}`,
        sets: [set(10 * (i + 1), 10), set(10 * (i + 1), 10)],
      })),
    ),
    3120,
  );

  it("lists completed exercises with sets × reps", () => {
    const q = renderSummary();
    expect(q.getByText("23 Oct · 52 min")).toBeTruthy();
    expect(q.getByText("01")).toBeTruthy();
    expect(q.getByText("2×8")).toBeTruthy();
    expect(q.getByText("1×10")).toBeTruthy();
    expect(q.queryByText(/more · see Workout details/)).toBeNull();
  });

  it("shows six exercises and five volumes, the rest in Workout details", () => {
    const q = renderSummary({ model: many });
    expect(q.getByText("06")).toBeTruthy();
    expect(q.queryByText("07")).toBeNull();
    expect(q.getByText("+2 more · see Workout details")).toBeTruthy();
    expect(q.getByText("+3 more · see Workout details")).toBeTruthy();
    // Volume is largest first.
    expect(q.getByText("1,600 kg")).toBeTruthy();
    expect(q.queryByText("300 kg")).toBeNull();
    fireEvent.press(q.getByText("+3 more · see Workout details"));
    expect(handlers.onDetails).toHaveBeenCalledTimes(1);
  });
});

describe("Personal records", () => {
  it("uses the hero layout for one record", () => {
    const q = renderSummary({ records: [record("Barbell Back Squat")] });
    expect(q.getByText("New personal record")).toBeTruthy();
    expect(q.getByText("65")).toBeTruthy();
    expect(q.getByText("Max weight · was 62.5 kg")).toBeTruthy();
    expect(q.getByLabelText("Personal records, page 5 of 5")).toBeTruthy();
  });

  it("omits 'was' when there is no previous value", () => {
    const q = renderSummary({
      records: [
        record("Walking Lunge", {
          recordType: "max_reps",
          newValue: 12,
          previousValue: null,
        }),
      ],
    });
    expect(q.getByText("12")).toBeTruthy();
    expect(q.getByText("reps")).toBeTruthy();
    expect(q.getByText("Max reps")).toBeTruthy();
  });

  it("lists two or three records without a more line", () => {
    const q = renderSummary({
      records: [
        record("Barbell Back Squat"),
        record("Glute Drive", { newValue: 70, previousValue: 65 }),
      ],
    });
    expect(q.getByText("2 new personal records")).toBeTruthy();
    expect(q.getByText("65 kg")).toBeTruthy();
    expect(q.getByText("Max weight · was 65 kg")).toBeTruthy();
    expect(q.queryByText(/more · see Workout details/)).toBeNull();
  });

  it("lists three of several and sends the rest to Workout details", () => {
    const q = renderSummary({
      records: [
        record("Barbell Back Squat"),
        record("Glute Drive", { newValue: 70, previousValue: 65 }),
        record("Leg Extension", {
          recordType: "1rm",
          newValue: 63,
          previousValue: 60,
        }),
        record("Walking Lunge", {
          recordType: "max_reps",
          newValue: 12,
          previousValue: 10,
        }),
      ],
    });
    expect(q.getByText("4 new personal records")).toBeTruthy();
    expect(q.getByText("1 rep max · was 60 kg")).toBeTruthy();
    expect(q.queryByText("Walking Lunge")).toBeNull();
    fireEvent.press(q.getByText("+1 more · see Workout details"));
    expect(handlers.onDetails).toHaveBeenCalled();
  });
});

describe("Trained together", () => {
  it("names everyone else, the mode and the duration", () => {
    const q = renderSummary({
      together: {
        self: "Mia",
        names: ["Brad", "Tom", "Inés"],
        connection: "Nearby",
      },
    });
    expect(q.getByText("With Brad, Tom and Inés")).toBeTruthy();
    expect(q.getByText("Lower Body B · Nearby · 52 min")).toBeTruthy();
    expect(q.getByText("M")).toBeTruthy();
    expect(q.getByText("I")).toBeTruthy();
    expect(
      q.getByText(
        "Everyone saved their own workout. Only names are shared here.",
      ),
    ).toBeTruthy();
  });

  it("reads naturally with one partner", () => {
    const q = renderSummary({
      together: { self: "Mia", names: ["Brad"], connection: "Online" },
    });
    expect(q.getByText("With Brad")).toBeTruthy();
    expect(q.getByText("Lower Body B · Online · 52 min")).toBeTruthy();
  });
});

describe("navigation", () => {
  it("moves with the dots and with a tap on the page, wrapping at the end", () => {
    const q = renderSummary();
    const selected = () =>
      q
        .queryAllByTestId(/^summary-dot-/)
        .filter((d) => d.props.accessibilityState?.selected)
        .map((d) => d.props.testID);
    expect(selected()).toEqual(["summary-dot-totals"]);
    fireEvent.press(q.getByTestId("summary-dot-volume"));
    expect(selected()).toEqual(["summary-dot-volume"]);
    fireEvent.press(q.getByTestId("summary-page-volume"));
    expect(selected()).toEqual(["summary-dot-totals"]);
    fireEvent.press(q.getByTestId("summary-page-totals"));
    expect(selected()).toEqual(["summary-dot-muscles"]);
  });

  it("a swipe back is not undone by the tap that ends it (TestFlight 31 Oct)", () => {
    // Jest cannot drive the native pan, so this replays what the device
    // delivers: press in, the carousel's scroll start, its snap to the page
    // the swipe chose, then the page's press on release. The press used to
    // add "next page" on top, so a swipe back landed one page forward.
    const q = renderSummary();
    const selected = () =>
      q
        .queryAllByTestId(/^summary-dot-/)
        .filter((d) => d.props.accessibilityState?.selected)
        .map((d) => d.props.testID);
    const pager = q.UNSAFE_getByType(Carousel as never);
    fireEvent.press(q.getByTestId("summary-dot-exercises"));
    const swipe = (to: number) => {
      const page = q.getByTestId(
        selected()[0]!.replace("summary-dot-", "summary-page-"),
      );
      fireEvent(page, "pressIn");
      act(() => pager.props.onScrollStart());
      act(() => pager.props.onSnapToItem(to));
      fireEvent.press(page);
    };
    swipe(1);
    expect(selected()).toEqual(["summary-dot-muscles"]);
    swipe(2);
    expect(selected()).toEqual(["summary-dot-exercises"]);
    // A plain tap, with no swipe, still turns the page.
    fireEvent(q.getByTestId("summary-page-exercises"), "pressIn");
    fireEvent.press(q.getByTestId("summary-page-exercises"));
    expect(selected()).toEqual(["summary-dot-volume"]);
  });

  it("an accessibility activation turns the page again after a swipe (inspector lead)", () => {
    // TalkBack's double-tap calls onPress with no onPressIn before it.
    const q = renderSummary();
    const selected = () =>
      q
        .queryAllByTestId(/^summary-dot-/)
        .filter((d) => d.props.accessibilityState?.selected)
        .map((d) => d.props.testID);
    const pager = q.UNSAFE_getByType(Carousel as never);
    fireEvent.press(q.getByTestId("summary-dot-exercises"));
    act(() => pager.props.onScrollStart());
    act(() => pager.props.onSnapToItem(1));
    act(() => pager.props.onScrollEnd());
    expect(selected()).toEqual(["summary-dot-muscles"]);
    fireEvent.press(q.getByTestId("summary-page-muscles"));
    expect(selected()).toEqual(["summary-dot-exercises"]);
  });

  it("keeps the page on screen when the records land and add a page", () => {
    const together = {
      self: "Mia",
      names: ["Brad"],
      connection: "Nearby" as const,
    };
    const props = {
      model,
      muscles: worked,
      workoutsThisMonth: null,
      rating: null,
      together,
      ...handlers,
    };
    const q = renderSummary({ together });
    fireEvent.press(q.getByTestId("summary-dot-together"));
    q.rerender(
      <SessionSummaryPresenter {...props} records={[record("Squat")]} />,
    );
    expect(pageIds(q)).toContain("summary-page-records");
    expect(
      q.getByTestId("summary-dot-together").props.accessibilityState,
    ).toEqual({ selected: true });
    fireEvent.press(q.getByTestId("session-summary-share"));
    expect(handlers.onShare.mock.calls[0]![0]).toMatch(
      /^Trained together with Brad/,
    );
  });

  it("opens on a chosen page, clamped to the pages there are", () => {
    const q = renderSummary({ initialPage: 9 });
    const dot = q.getByTestId("summary-dot-volume");
    expect(dot.props.accessibilityState).toEqual({ selected: true });
  });

  it("wires close, details and continue", () => {
    const q = renderSummary();
    fireEvent.press(q.getByTestId("session-summary-close"));
    fireEvent.press(q.getByTestId("summary-details"));
    fireEvent.press(q.getByTestId("summary-continue"));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(handlers.onDetails).toHaveBeenCalledTimes(1);
    expect(handlers.onContinue).toHaveBeenCalledTimes(1);
  });
});

describe("brand and share", () => {
  it("puts the P mark and Persistence at the centre of every page", () => {
    const q = renderSummary({
      records: [record("Barbell Back Squat"), record("Glute Drive")],
      together: { self: "Mia", names: ["Brad"], connection: "Nearby" },
    });
    expect(
      q.getAllByTestId("p-logo-mark", { includeHiddenElements: true }),
    ).toHaveLength(6);
    expect(q.getAllByText("Persistence")).toHaveLength(6);
  });

  it("shares the page on screen as text", () => {
    const q = renderSummary({
      rating: 8,
      records: [record("Barbell Back Squat")],
      together: { self: "Mia", names: ["Brad", "Tom"], connection: "Nearby" },
    });
    const shared = () => handlers.onShare.mock.calls.at(-1)![0] as string;
    fireEvent.press(q.getByTestId("session-summary-share"));
    expect(shared()).toBe(
      "Workout complete: Lower Body B · 23 Oct · 52 min\n1,385 kg · 3 sets · 25 reps\nEffort 8/10\nLogged with Persistence",
    );
    fireEvent.press(q.getByTestId("summary-dot-muscles"));
    fireEvent.press(q.getByTestId("session-summary-share"));
    expect(shared()).toContain("Muscles worked: quads 44%");
    fireEvent.press(q.getByTestId("summary-dot-exercises"));
    fireEvent.press(q.getByTestId("session-summary-share"));
    expect(shared()).toContain("Barbell Back Squat 2×8");
    fireEvent.press(q.getByTestId("summary-dot-volume"));
    fireEvent.press(q.getByTestId("session-summary-share"));
    expect(shared()).toContain("Romanian Deadlift 450 kg");
    fireEvent.press(q.getByTestId("summary-dot-records"));
    fireEvent.press(q.getByTestId("session-summary-share"));
    expect(shared()).toContain(
      "New personal record\nBarbell Back Squat: Max weight 65 kg",
    );
    fireEvent.press(q.getByTestId("summary-dot-together"));
    fireEvent.press(q.getByTestId("session-summary-share"));
    expect(shared()).toContain(
      "Trained together with Brad and Tom\nLower Body B · 23 Oct · 52 min · Nearby",
    );
  });

  it("shares several records and a workout without an effort", () => {
    const q = renderSummary({
      records: [record("Barbell Back Squat"), record("Glute Drive")],
      initialPage: 4,
    });
    fireEvent.press(q.getByTestId("session-summary-share"));
    expect(handlers.onShare.mock.calls.at(-1)![0]).toContain(
      "2 new personal records",
    );
    fireEvent.press(q.getByTestId("summary-dot-totals"));
    fireEvent.press(q.getByTestId("session-summary-share"));
    expect(handlers.onShare.mock.calls.at(-1)![0]).not.toContain("Effort");
  });
});
