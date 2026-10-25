import React from "react";
import { act, fireEvent, waitFor, within } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherPartnerPresenter,
  togetherPartnerAccess,
} from "../TogetherPartnerPresenter";
import {
  PARTNER_SET_TIMEOUT_MS,
  useTogetherPartnerOutbox,
} from "@/ui/hooks/useTogetherPartnerOutbox";
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
/**
 * What a container does: owns the outbox and mounts the view only while
 * Mia's tab is selected (`shown`), so sets outlive the view.
 */
function Harness(h: {
  snapshot: TogetherSharedSnapshot | null;
  editable?: boolean;
  shown?: boolean;
  sessionId?: string;
}) {
  const outbox = useTogetherPartnerOutbox({
    snapshot: h.snapshot,
    accountId: "me",
    sessionId: h.sessionId ?? "session-1",
    canLog: () => h.editable ?? true,
    send: (_owner, operation, revision) => onOperation(operation, revision),
  });
  if (h.shown === false || !h.snapshot) return null;
  return (
    <TogetherPartnerPresenter
      snapshot={h.snapshot}
      ownerId="mia"
      accountId="me"
      exerciseNames={names}
      tone="info"
      editable={
        (h.editable ?? true) &&
        togetherPartnerAccess(h.snapshot, "mia", "me").editable
      }
      outbox={outbox("mia")}
    />
  );
}
const render = (snapshot: TogetherSharedSnapshot, editable?: boolean) =>
  renderWithTheme(<Harness snapshot={snapshot} editable={editable} />);
const S = (setId: string, reps: number, weightKg: number) => ({
  setId,
  reps,
  weightKg,
  completed: true,
});
/** Mia's projection at `revision` with extra squat sets after her two. */
const withSquat = (revision: number, extra: ReturnType<typeof S>[]) => {
  const next = base();
  const athlete = next.athletes[0]!;
  const squat = athlete.exercises["squat-slot"]!;
  return {
    ...next,
    athletes: [
      {
        ...athlete,
        revision,
        exercises: {
          ...athlete.exercises,
          "squat-slot": { ...squat, sets: [...squat.sets, ...extra] },
        },
      },
    ],
  };
};
const view = (snapshot: TogetherSharedSnapshot, shown?: boolean) => (
  <Harness snapshot={snapshot} shown={shown} />
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
  // Handed over is not saved: the dot waits for Mia's projection to echo it.
  await act(async () => resolve());
  expect(r.getByTestId("set-logger-sync-sending")).toBeTruthy();
  r.rerender(view(withSquat(6, [S("new-1", 8, 65)])));
  expect(r.queryByTestId("set-logger-sync-sending")).toBeNull();
  expect(r.getAllByTestId("set-logger-sync-saved")).toHaveLength(3);
});

it("a set the owner skipped as stale shows Not sent, never Saved", async () => {
  const r = render(base());
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[2]!, "8");
  fireEvent.changeText(r.getAllByTestId("set-logger-weight")[2]!, "65");
  fireEvent(r.getAllByTestId("set-logger-weight")[2]!, "blur");
  await act(async () => {});
  // Mia logged her own set first: the revision moved on without ours.
  r.rerender(view(withSquat(6, [S("hers", 8, 62.5)])));
  expect(r.getByTestId("set-logger-sync-notsent")).toBeTruthy();
  // Only her three logged squat sets are Saved; ours is not.
  expect(r.getAllByTestId("set-logger-sync-saved")).toHaveLength(3);
  expect(r.getByText(/That set could not be sent to Mia/)).toBeTruthy();
  expect(
    r.getAllByTestId("set-logger-weight").map((i) => i.props.value),
  ).toContain("65");
});

it("quick successive sets go one at a time, each against the revision after the last echo", async () => {
  const r = render(base());
  const reps = () => r.getAllByTestId("set-logger-reps");
  const kg = () => r.getAllByTestId("set-logger-weight");
  fireEvent.changeText(reps()[2]!, "8");
  fireEvent.changeText(kg()[2]!, "65");
  fireEvent(kg()[2]!, "blur");
  fireEvent.changeText(reps()[3]!, "7");
  fireEvent.changeText(kg()[3]!, "65");
  fireEvent(kg()[3]!, "blur");
  await act(async () => {});
  expect(onOperation).toHaveBeenCalledTimes(1);
  expect(r.getAllByTestId("set-logger-sync-sending")).toHaveLength(2);
  r.rerender(view(withSquat(6, [S("new-1", 8, 65)])));
  await act(async () => {});
  expect(onOperation).toHaveBeenCalledTimes(2);
  expect(onOperation).toHaveBeenLastCalledWith(
    {
      type: "upsertSet",
      planExerciseId: "squat-slot",
      set: { setId: "new-2", reps: 7, weightKg: 65, completed: true },
    },
    6,
  );
});

it("a correction made while the set is sending is sent after the echo, not dropped", async () => {
  const r = render(base());
  const kg = () => r.getAllByTestId("set-logger-weight")[2]!;
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[2]!, "8");
  fireEvent.changeText(kg(), "60");
  fireEvent(kg(), "blur");
  fireEvent.changeText(kg(), "65");
  fireEvent(kg(), "blur");
  await act(async () => {});
  expect(onOperation).toHaveBeenCalledTimes(1);
  r.rerender(view(withSquat(6, [S("new-1", 8, 60)])));
  await act(async () => {});
  expect(r.getAllByTestId("set-logger-weight")[2]!.props.value).toBe("65");
  expect(onOperation).toHaveBeenCalledTimes(2);
  expect(onOperation).toHaveBeenLastCalledWith(
    {
      type: "upsertSet",
      planExerciseId: "squat-slot",
      set: { setId: "new-1", reps: 8, weightKg: 65, completed: true },
    },
    6,
  );
  expect(r.getByTestId("set-logger-sync-sending")).toBeTruthy();
});

it("the row being typed into stays when the partner logs a set of their own", () => {
  const r = render(base());
  // Fourth squat row = the second planned one (pool id new-2).
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[3]!, "6");
  r.rerender(view(withSquat(6, [S("hers", 8, 62.5)])));
  const squat = r.getByTestId("session-exercise-squat-slot");
  const values = within(squat)
    .getAllByTestId("set-logger-reps")
    .map((input) => input.props.value);
  // 3 logged + the row being edited; the untouched empty row is the one that went.
  expect(values).toEqual(["8", "8", "8", "6"]);
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
    view({
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
    }),
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
  r.rerender(view(base({ grants: consent(true, false, false) })));
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

/** Fills planned squat row `i` (0-based over all rows) and blurs it. */
const fill = (
  r: ReturnType<typeof render>,
  i: number,
  reps: string,
  kg: string,
) => {
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[i]!, reps);
  fireEvent.changeText(r.getAllByTestId("set-logger-weight")[i]!, kg);
  fireEvent(r.getAllByTestId("set-logger-weight")[i]!, "blur");
};
const withGrant = (
  snapshot: TogetherSharedSnapshot,
  version: number,
): TogetherSharedSnapshot => ({
  ...snapshot,
  grants: [{ ...snapshot.grants[0]!, version }],
});

it("a grant change that keeps fill-in on keeps what you typed", () => {
  const r = render(base());
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[2]!, "6");
  r.rerender(view(withGrant(base(), 3)));
  expect(r.getAllByTestId("set-logger-reps")[2]!.props.value).toBe("6");
});

it("a set in flight when the partner changes the grant is Not sent, and the queue moves on", async () => {
  const r = render(base());
  fill(r, 2, "8", "65");
  fill(r, 3, "7", "65");
  await act(async () => {});
  expect(onOperation).toHaveBeenCalledTimes(1);
  // Nearby drops intents sent under the old grant without moving the revision.
  r.rerender(view(withGrant(base(), 3)));
  await act(async () => {});
  expect(r.getByTestId("set-logger-sync-notsent")).toBeTruthy();
  expect(onOperation).toHaveBeenCalledTimes(2);
  expect(onOperation).toHaveBeenLastCalledWith(
    expect.objectContaining({
      set: expect.objectContaining({ setId: "new-2", reps: 7 }),
    }),
    5,
  );
});

it("a set nobody applies or rejects times out as Not sent; a late echo still turns it Saved", async () => {
  jest.useFakeTimers();
  try {
    const r = render(base());
    fill(r, 2, "8", "65");
    fill(r, 3, "7", "65");
    await act(async () => {});
    expect(onOperation).toHaveBeenCalledTimes(1);
    act(() => jest.advanceTimersByTime(PARTNER_SET_TIMEOUT_MS - 1));
    expect(r.queryByTestId("set-logger-sync-notsent")).toBeNull();
    act(() => jest.advanceTimersByTime(1));
    expect(r.getByTestId("set-logger-sync-notsent")).toBeTruthy();
    expect(r.getByText(/That set could not be sent to Mia/)).toBeTruthy();
    // The stuck set no longer holds back the next one.
    await act(async () => {});
    expect(onOperation).toHaveBeenCalledTimes(2);
    r.rerender(view(withSquat(5, [S("new-1", 8, 65)])));
    expect(r.queryByTestId("set-logger-sync-notsent")).toBeNull();
    // Nothing is left to retry, so the "try again" line goes with the dot.
    expect(r.queryByText(/could not be sent/)).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

it("a queued set keeps going while you look at your own workout, and is Saved when you come back", async () => {
  const r = render(base());
  fill(r, 2, "8", "65");
  fill(r, 3, "7", "65");
  await act(async () => {});
  expect(onOperation).toHaveBeenCalledTimes(1);
  // Back to my own workout: Mia's view unmounts, the container's outbox stays.
  r.rerender(view(base(), false));
  expect(r.queryByTestId("together-partner-view")).toBeNull();
  r.rerender(view(withSquat(6, [S("new-1", 8, 65)]), false));
  await act(async () => {});
  expect(onOperation).toHaveBeenCalledTimes(2);
  expect(onOperation).toHaveBeenLastCalledWith(
    expect.objectContaining({
      set: expect.objectContaining({ setId: "new-2", reps: 7, weightKg: 65 }),
    }),
    6,
  );
  r.rerender(view(withSquat(7, [S("new-1", 8, 65), S("new-2", 7, 65)]), false));
  await act(async () => {});
  r.rerender(view(withSquat(7, [S("new-1", 8, 65), S("new-2", 7, 65)])));
  expect(r.queryByTestId("set-logger-sync-sending")).toBeNull();
  expect(r.getAllByTestId("set-logger-sync-saved")).toHaveLength(4);
});

it("a send refused on a network error that lands on the retry turns Saved", async () => {
  onOperation.mockRejectedValueOnce(new Error("network"));
  const r = render(base());
  fill(r, 2, "8", "65");
  await waitFor(() =>
    expect(r.getByTestId("set-logger-sync-notsent")).toBeTruthy(),
  );
  // The Online outbox retries on reconnect and the set lands.
  r.rerender(view(withSquat(6, [S("new-1", 8, 65)])));
  await act(async () => {});
  expect(r.queryByTestId("set-logger-sync-notsent")).toBeNull();
  expect(r.getAllByTestId("set-logger-sync-saved")).toHaveLength(3);
});

it("a set that landed leaves no draft behind: if the partner removes it, the row comes back empty", async () => {
  const r = render(base());
  fill(r, 2, "8", "65");
  await act(async () => {});
  r.rerender(view(withSquat(6, [S("new-1", 8, 65)])));
  await act(async () => {});
  // Mia deletes that set on her phone.
  r.rerender(view(withSquat(7, [])));
  await act(async () => {});
  const squat = within(r.getByTestId("session-exercise-squat-slot"));
  expect(
    squat.getAllByTestId("set-logger-reps").map((input) => input.props.value),
  ).toEqual(["8", "8", "", ""]);
  expect(squat.getAllByTestId("set-logger-sync-none")).toHaveLength(2);
});

it("one ADD SET tap adds a row even when the partner logged past the plan", () => {
  // Plan has 3 RDL sets; Mia has logged 4.
  const snapshot = base();
  snapshot.athletes[0]!.exercises["rdl-slot"]!.sets = [
    S("r1", 10, 45),
    S("r2", 10, 45),
    S("r3", 10, 45),
    S("r4", 10, 45),
  ];
  const r = render(snapshot);
  const rdl = () => within(r.getByTestId("session-exercise-rdl-slot"));
  expect(rdl().getAllByTestId("set-logger-reps")).toHaveLength(4);
  fireEvent.press(rdl().getByTestId("session-exercise-add-set"));
  expect(rdl().getAllByTestId("set-logger-reps")).toHaveLength(5);
});

it("a correction to a logged set stays Sending through unrelated snapshot changes", async () => {
  const r = render(base());
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[0]!, "9");
  fireEvent(r.getAllByTestId("set-logger-reps")[0]!, "blur");
  fill(r, 2, "8", "65");
  await act(async () => {});
  expect(onOperation).toHaveBeenCalledTimes(1);
  // Someone else moves (Tom logs a set); Mia's revision and grant are unchanged.
  const other = base();
  r.rerender(
    view({
      ...other,
      athletes: [
        ...other.athletes,
        { userId: "tom", revision: 3, restEndsAt: null, exercises: {} },
      ],
    }),
  );
  await act(async () => {});
  expect(r.queryByTestId("set-logger-sync-notsent")).toBeNull();
  expect(r.queryByText(/could not be sent/)).toBeNull();
  // The queued set still waits: it must not go against revision 5 again.
  expect(onOperation).toHaveBeenCalledTimes(1);
  expect(r.getAllByTestId("set-logger-sync-sending")).toHaveLength(2);
});

it("a row with only reps typed is not queued, and leaves an earlier Not sent line alone", async () => {
  onOperation.mockRejectedValueOnce(new Error("network"));
  const r = render(base());
  fill(r, 2, "8", "65");
  await waitFor(() =>
    expect(r.getByText(/could not be sent to Mia/)).toBeTruthy(),
  );
  fill(r, 3, "7", "65");
  await act(async () => {});
  expect(onOperation).toHaveBeenCalledTimes(2);
  // Set 3 is in flight; reps only on the next row, then a blur.
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[5]!, "10");
  fireEvent(r.getAllByTestId("set-logger-reps")[5]!, "blur");
  expect(r.getAllByTestId("set-logger-sync-sending")).toHaveLength(1);
  expect(r.getByTestId("set-logger-sync-notsent")).toBeTruthy();
});

it("leaving the session clears added rows, dots and errors before the next one", async () => {
  onOperation.mockRejectedValueOnce(new Error("network"));
  const r = render(base());
  fireEvent.press(r.getAllByTestId("session-exercise-add-set")[0]!);
  fill(r, 2, "8", "65");
  await waitFor(() =>
    expect(r.getByTestId("set-logger-sync-notsent")).toBeTruthy(),
  );
  expect(r.getAllByTestId("set-logger-reps")).toHaveLength(8);
  r.rerender(<Harness snapshot={null} />);
  r.rerender(<Harness snapshot={base()} sessionId="session-2" />);
  expect(r.getAllByTestId("set-logger-reps")).toHaveLength(7);
  expect(r.queryByTestId("set-logger-sync-notsent")).toBeNull();
  expect(r.queryByText(/could not be sent/)).toBeNull();
  expect(r.getAllByTestId("set-logger-reps")[2]!.props.value).toBe("");
});

it("while Mia's data is hidden (a reconnect) drafts stay and the queue waits", async () => {
  const r = render(base());
  fill(r, 2, "8", "65");
  fill(r, 3, "7", "65");
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[5]!, "10");
  await act(async () => {});
  expect(onOperation).toHaveBeenCalledTimes(1);
  // Reconnecting: no grant and no projection for Mia in view.
  r.rerender(view(base({ grants: [], athletes: [] })));
  await act(async () => {});
  expect(r.queryByTestId("set-logger-sync-notsent")).toBeNull();
  // Back, and the first set landed meanwhile.
  r.rerender(view(withSquat(6, [S("new-1", 8, 65)])));
  await act(async () => {});
  expect(onOperation).toHaveBeenCalledTimes(2);
  expect(onOperation).toHaveBeenLastCalledWith(
    expect.objectContaining({
      set: expect.objectContaining({ setId: "new-2", reps: 7, weightKg: 65 }),
    }),
    6,
  );
  expect(r.getAllByTestId("set-logger-reps")[5]!.props.value).toBe("10");
  expect(r.queryByText(/could not be sent/)).toBeNull();
});

it("a failed correction stops showing Not sent once Mia changes that set herself", async () => {
  const r = render(base());
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[0]!, "9");
  fireEvent(r.getAllByTestId("set-logger-reps")[0]!, "blur");
  await act(async () => {});
  // Mia logs her own set first: the correction is stale.
  r.rerender(view(withSquat(6, [S("hers", 8, 62.5)])));
  await act(async () => {});
  expect(r.getByTestId("set-logger-sync-notsent")).toBeTruthy();
  // Then Mia edits s1 to 10 × 60 on her phone.
  const edited = withSquat(7, [S("hers", 8, 62.5)]);
  edited.athletes[0]!.exercises["squat-slot"]!.sets[0] = S("s1", 10, 60);
  r.rerender(view(edited));
  await act(async () => {});
  expect(r.queryByTestId("set-logger-sync-notsent")).toBeNull();
  expect(r.queryByText(/could not be sent/)).toBeNull();
  expect(r.getAllByTestId("set-logger-reps")[0]!.props.value).toBe("10");
});

it("a consent event that purges Mia's projection for a moment keeps drafts and the queue", async () => {
  const r = render(base());
  fill(r, 2, "8", "65");
  fill(r, 3, "7", "65");
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[5]!, "10");
  await act(async () => {});
  expect(onOperation).toHaveBeenCalledTimes(1);
  // Mia toggles Prev: the new grant arrives before her projection does.
  const consentOnly = withGrant(base({ athletes: [] }), 3);
  r.rerender(view(consentOnly));
  await act(async () => {});
  r.rerender(view(withGrant(base(), 3)));
  await act(async () => {});
  // The set sent under the old grant was dropped by Mia's phone: Not sent.
  // The queued one goes under the new grant, and the typed row is still there.
  expect(r.getByTestId("set-logger-sync-notsent")).toBeTruthy();
  expect(onOperation).toHaveBeenCalledTimes(2);
  expect(onOperation).toHaveBeenLastCalledWith(
    expect.objectContaining({
      set: expect.objectContaining({ setId: "new-2", reps: 7, weightKg: 65 }),
    }),
    5,
  );
  expect(r.getAllByTestId("set-logger-reps")[5]!.props.value).toBe("10");
});
