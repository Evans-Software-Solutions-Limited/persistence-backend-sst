import React from "react";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherPartnerPresenter,
  togetherPartnerAccess,
} from "../TogetherPartnerPresenter";
import type { TogetherSharedSnapshot } from "@/domain/ports/togetherShared.port";

let mockMinted = 0;
jest.mock("expo-crypto", () => ({ randomUUID: () => `new-${++mockMinted}` }));

const consent = (numbers: boolean, prev: boolean, logging: boolean) => [
  {
    ownerId: "mia",
    recipientId: "me",
    version: 2,
    consent: { numbers, prev, logging },
  },
];
const base = (
  over: Partial<TogetherSharedSnapshot> = {},
): TogetherSharedSnapshot => ({
  progress: [],
  plan: null,
  planHash: null,
  athletePlans: {
    mia: {
      name: "Lower Body B",
      exercises: [
        {
          planExerciseId: "squat-slot",
          exerciseId: "squat",
          order: 0,
          targetSets: 4,
        },
        {
          planExerciseId: "rdl-slot",
          exerciseId: "rdl",
          order: 1,
          targetSets: 3,
        },
      ],
    },
  },
  profiles: { mia: "Mia Osei", me: "Brad Evans" },
  athletes: [
    {
      userId: "mia",
      revision: 5,
      restEndsAt: null,
      exercises: {
        "squat-slot": {
          exerciseId: "squat",
          skipped: false,
          sets: [
            { setId: "s1", reps: 8, weightKg: 60, completed: true },
            { setId: "s2", reps: 8, weightKg: 62.5, completed: true },
          ],
        },
        "rdl-slot": { exerciseId: "rdl", skipped: false, sets: [] },
      },
    },
  ],
  previous: {
    mia: [
      {
        exerciseId: "squat",
        setNumber: 1,
        reps: 8,
        weightKg: 60,
        recordedAt: 1,
      },
      {
        exerciseId: "squat",
        setNumber: 3,
        reps: 7,
        weightKg: 60,
        recordedAt: 1,
      },
    ],
  },
  grants: consent(true, true, true),
  closures: [],
  delegated: [],
  deliveries: [],
  ...over,
});
const names = { squat: "Barbell Back Squat", rdl: "Romanian Deadlift" };
const onOperation = jest.fn<Promise<void>, [Record<string, unknown>, number]>(
  async () => {},
);
const render = (snapshot: TogetherSharedSnapshot, editable?: boolean) =>
  renderWithTheme(
    <TogetherPartnerPresenter
      snapshot={snapshot}
      ownerId="mia"
      accountId="me"
      exerciseNames={names}
      tone="info"
      editable={
        editable ?? togetherPartnerAccess(snapshot, "mia", "me").editable
      }
      onOperation={onOperation}
    />,
  );
beforeEach(() => {
  jest.clearAllMocks();
  mockMinted = 0;
});

describe("togetherPartnerAccess", () => {
  it("needs numbers, fill-in and a live revision to edit", () => {
    expect(togetherPartnerAccess(base(), "mia", "me")).toMatchObject({
      numbers: true,
      prev: true,
      editable: true,
      grantVersion: 2,
    });
    expect(
      togetherPartnerAccess(
        base({ grants: consent(true, false, false) }),
        "mia",
        "me",
      ),
    ).toMatchObject({ numbers: true, prev: false, editable: false });
    // Fill-in without numbers never edits, and PREV follows numbers.
    expect(
      togetherPartnerAccess(
        base({ grants: consent(false, true, true) }),
        "mia",
        "me",
      ),
    ).toMatchObject({ numbers: false, prev: false, editable: false });
    expect(
      togetherPartnerAccess(base({ athletes: [] }), "mia", "me").editable,
    ).toBe(false);
    // A grant addressed to someone else is not mine.
    expect(togetherPartnerAccess(base(), "mia", "tom").numbers).toBe(false);
  });
});

it("partner with fill-in: every planned set has a row, editable at once, no Log-for or back chrome", () => {
  const r = render(base());
  expect(r.getByText("Logging for Mia · changes Mia’s record")).toBeTruthy();
  expect(r.getByText("Barbell Back Squat")).toBeTruthy();
  expect(r.getByText("4 sets")).toBeTruthy();
  expect(r.getByText("3 sets")).toBeTruthy();
  // 2 logged + 2 planned squat rows, 3 planned RDL rows.
  const reps = r.getAllByTestId("set-logger-reps");
  expect(reps).toHaveLength(7);
  expect(reps.map((input) => input.props.value)).toEqual([
    "8",
    "8",
    "",
    "",
    "",
    "",
    "",
  ]);
  expect(reps.every((input) => input.props.editable)).toBe(true);
  expect(r.getAllByTestId("set-logger-sync-saved")).toHaveLength(2);
  expect(r.getAllByTestId("set-logger-sync-none")).toHaveLength(5);
  expect(r.getAllByTestId("session-exercise-add-set")).toHaveLength(2);
  // Someone else's exercise: no notes, swap, remove, rest, skip or per-set remove.
  for (const id of [
    "session-exercise-notes",
    "session-exercise-substitute",
    "session-exercise-remove",
    "session-exercise-start-rest",
    "session-exercise-tap",
    "set-logger-remove",
  ])
    expect(r.queryByTestId(id)).toBeNull();
  for (const copy of [
    /Log for/,
    /Back to my workout/,
    /^Mine$/,
    /^Done$/,
    /Finish/,
  ])
    expect(r.queryByText(copy)).toBeNull();
});

it("shows the partner's own previous values by set number, a dash where they have none", () => {
  const r = render(base());
  const prev = r.getAllByTestId("set-logger-fill-previous");
  expect(prev).toHaveLength(2);
  expect(r.getByText("8 reps • 60 kg")).toBeTruthy();
  expect(r.getByText("7 reps • 60 kg")).toBeTruthy();
  expect(r.getAllByText("—")).toHaveLength(5);
});

it("no previous values when the partner does not share them", () => {
  const r = render(base({ grants: consent(true, false, true) }));
  expect(r.queryByTestId("set-logger-fill-previous")).toBeNull();
  expect(r.getAllByText("—")).toHaveLength(7);
});

it("sends a planned row once reps and kg are filled and the field loses focus", async () => {
  let resolve!: () => void;
  onOperation.mockImplementationOnce(
    () => new Promise<void>((done) => (resolve = done)),
  );
  const r = render(base());
  const reps = () => r.getAllByTestId("set-logger-reps")[2]!;
  const kg = () => r.getAllByTestId("set-logger-weight")[2]!;
  fireEvent.changeText(reps(), "8");
  fireEvent(reps(), "blur");
  expect(onOperation).not.toHaveBeenCalled();
  fireEvent.changeText(kg(), "65");
  fireEvent(kg(), "blur");
  fireEvent(kg(), "blur");
  expect(onOperation).toHaveBeenCalledTimes(1);
  expect(onOperation).toHaveBeenCalledWith(
    {
      type: "upsertSet",
      planExerciseId: "squat-slot",
      set: { setId: "new-1", reps: 8, weightKg: 65, completed: true },
    },
    5,
  );
  expect(r.getByTestId("set-logger-sync-sending")).toBeTruthy();
  await act(async () => resolve());
  expect(r.queryByTestId("set-logger-sync-sending")).toBeNull();
  expect(r.getAllByTestId("set-logger-sync-saved")).toHaveLength(3);
});

it("an unchanged logged set is not re-sent; a changed one is, against the shown revision", async () => {
  const r = render(base());
  const reps = r.getAllByTestId("set-logger-reps")[0]!;
  fireEvent(reps, "blur");
  expect(onOperation).not.toHaveBeenCalled();
  fireEvent.changeText(reps, "9");
  fireEvent(reps, "blur");
  await waitFor(() =>
    expect(onOperation).toHaveBeenCalledWith(
      {
        type: "upsertSet",
        planExerciseId: "squat-slot",
        set: { setId: "s1", reps: 9, weightKg: 60, completed: true },
      },
      5,
    ),
  );
});

it("tapping Prev fills the row and sends it", async () => {
  const r = render(base());
  fireEvent.press(r.getAllByTestId("set-logger-fill-previous")[1]!);
  await waitFor(() =>
    expect(onOperation).toHaveBeenCalledWith(
      {
        type: "upsertSet",
        planExerciseId: "squat-slot",
        set: { setId: "new-1", reps: 7, weightKg: 60, completed: true },
      },
      5,
    ),
  );
  expect(r.getAllByTestId("set-logger-reps")[2]!.props.value).toBe("7");
});

it("a refused set keeps its input, shows Not sent and can be sent again", async () => {
  onOperation.mockRejectedValueOnce(new Error("permission-changed"));
  const r = render(base());
  const reps = r.getAllByTestId("set-logger-reps")[2]!;
  fireEvent.changeText(reps, "6");
  fireEvent.changeText(r.getAllByTestId("set-logger-weight")[2]!, "70");
  fireEvent(reps, "blur");
  await waitFor(() =>
    expect(r.getByTestId("set-logger-sync-notsent")).toBeTruthy(),
  );
  expect(r.getByText(/That set could not be sent to Mia/)).toBeTruthy();
  expect(r.getAllByTestId("set-logger-reps")[2]!.props.value).toBe("6");
  fireEvent(r.getAllByTestId("set-logger-reps")[2]!, "blur");
  await waitFor(() => expect(onOperation).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(r.queryByText(/could not be sent/)).toBeNull());
});

it("Add set adds an empty row; a sent extra row keeps the count", () => {
  const r = render(base());
  fireEvent.press(r.getAllByTestId("session-exercise-add-set")[1]!);
  expect(r.getAllByTestId("set-logger-reps")).toHaveLength(8);
  expect(r.getAllByText("4 sets")).toHaveLength(2);
  // The partner logs the added row: it moves into the logged sets, nothing is lost.
  const logged = base();
  const rdl = logged.athletes[0]!.exercises["rdl-slot"]!;
  r.rerender(
    <TogetherPartnerPresenter
      snapshot={{
        ...logged,
        athletes: [
          {
            ...logged.athletes[0]!,
            revision: 6,
            exercises: {
              ...logged.athletes[0]!.exercises,
              "rdl-slot": {
                ...rdl,
                sets: [
                  { setId: "new-6", reps: 10, weightKg: 45, completed: true },
                ],
              },
            },
          },
        ],
      }}
      ownerId="mia"
      accountId="me"
      exerciseNames={names}
      tone="info"
      editable
      onOperation={onOperation}
    />,
  );
  expect(r.getAllByTestId("set-logger-reps")).toHaveLength(8);
  expect(r.getAllByTestId("set-logger-sync-saved")).toHaveLength(3);
});

it("partner read-only with numbers: values and Prev shown, nothing editable or added", () => {
  const r = render(base({ grants: consent(true, true, false) }));
  expect(r.getByText("Mia Osei · read-only. Fill-in is off.")).toBeTruthy();
  const reps = r.getAllByTestId("set-logger-reps");
  expect(reps).toHaveLength(7);
  expect(reps.every((input) => input.props.editable === false)).toBe(true);
  expect(r.queryByTestId("session-exercise-add-set")).toBeNull();
  fireEvent.press(r.getAllByTestId("set-logger-fill-previous")[0]!);
  expect(onOperation).not.toHaveBeenCalled();
});

it("the container's grant wins: editable false keeps rows read-only even with fill-in on", () => {
  const r = render(base(), false);
  expect(r.getAllByTestId("set-logger-reps")[0]!.props.editable).toBe(false);
});

it("a revoked grant mid-edit drops the draft and locks the rows", () => {
  const r = render(base());
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[0]!, "99");
  r.rerender(
    <TogetherPartnerPresenter
      snapshot={base({ grants: consent(true, false, false) })}
      ownerId="mia"
      accountId="me"
      exerciseNames={names}
      tone="info"
      editable={false}
      onOperation={onOperation}
    />,
  );
  const reps = r.getAllByTestId("set-logger-reps")[0]!;
  expect(reps.props.value).toBe("8");
  expect(reps.props.editable).toBe(false);
  fireEvent(reps, "blur");
  expect(onOperation).not.toHaveBeenCalled();
  expect(r.queryByTestId("set-logger-fill-previous")).toBeNull();
});

it("planned-only rows before the first live values arrive", () => {
  const r = render(base({ athletes: [] }));
  expect(r.getByText("Mia Osei · waiting for Mia’s sets")).toBeTruthy();
  const reps = r.getAllByTestId("set-logger-reps");
  expect(reps).toHaveLength(7);
  expect(reps.every((input) => input.props.value === "")).toBe(true);
  expect(reps.every((input) => input.props.editable === false)).toBe(true);
});

it("exercises outside the plan are appended; unknown names fall back to their position", () => {
  const snapshot = base({ athletePlans: {} });
  snapshot.athletes[0]!.exercises["extra-slot"] = {
    exerciseId: "uncached",
    skipped: true,
    sets: [],
  };
  const r = render(snapshot);
  expect(r.getByText("Exercise 3")).toBeTruthy();
  expect(r.getByText("Skipped")).toBeTruthy();
  expect(r.getAllByTestId("set-logger-reps")).toHaveLength(2);
});

it("waits for the plan when nothing is known yet", () => {
  const r = render(base({ athletePlans: {}, athletes: [] }));
  expect(r.getByText("Waiting for Mia’s plan.")).toBeTruthy();
});

it("private partner: progress through the plan only, no weights, reps or Prev", () => {
  const r = render(
    base({
      grants: consent(false, true, true),
      progress: [
        {
          userId: "mia",
          revision: 3,
          exercises: [
            { planExerciseId: "squat-slot", completedSets: 3, skipped: false },
            { planExerciseId: "rdl-slot", completedSets: 0, skipped: true },
            { planExerciseId: "lunge-slot", completedSets: 1, skipped: false },
          ],
        },
      ],
    }),
  );
  expect(r.getByText("Mia Osei · numbers private")).toBeTruthy();
  expect(r.getByText("Mia keeps numbers private")).toBeTruthy();
  expect(
    r.getByText(
      "You see Mia’s progress through the plan, not weights or reps.",
    ),
  ).toBeTruthy();
  expect(r.getByText("3 of 4 sets")).toBeTruthy();
  expect(r.getByText("Skipped")).toBeTruthy();
  expect(r.getByText("Exercise 3")).toBeTruthy();
  expect(r.getByText("1 of 1 sets")).toBeTruthy();
  expect(r.getByLabelText("Barbell Back Squat, 3 of 4 sets")).toBeTruthy();
  expect(r.queryByTestId("set-logger-reps")).toBeNull();
  expect(r.queryByText(/60 kg/)).toBeNull();
});

it("private partner with no plan yet says so", () => {
  const r = render(base({ grants: [], athletePlans: {}, profiles: {} }));
  expect(r.getByText("Training partner · numbers private")).toBeTruthy();
  expect(r.getByText("Waiting for Training partner’s plan.")).toBeTruthy();
});
