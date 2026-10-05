import React from "react";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { TogetherPartnerPresenter } from "../TogetherPartnerPresenter";
import type { TogetherSharedSnapshot } from "@/domain/ports/togetherShared.port";
jest.mock("expo-crypto", () => ({ randomUUID: () => "new-set" }));
const snapshot: TogetherSharedSnapshot = {
  progress: [],
  plan: null,
  planHash: null,
  athletePlans: {},
  profiles: { other: "Mia" },
  athletes: [
    {
      userId: "other",
      revision: 1,
      restEndsAt: null,
      exercises: {
        slot: {
          exerciseId: "squat",
          skipped: false,
          sets: [{ setId: "set", reps: 8, weightKg: 60, completed: true }],
        },
      },
    },
  ],
  previous: {},
  grants: [
    {
      ownerId: "other",
      recipientId: "me",
      version: 1,
      consent: { numbers: true, prev: false, logging: false },
    },
  ],
  closures: [],
  delegated: [],
  deliveries: [],
};
const props = {
  snapshot,
  ownerId: "other",
  accountId: "me",
  exerciseNames: { squat: "Squat" },
  onMine: jest.fn(),
  onOperation: jest.fn(async () => {}),
};
beforeEach(() => jest.clearAllMocks());
it("renders the recipient's read-only rows with no private PREV fallback", () => {
  const r = renderWithTheme(<TogetherPartnerPresenter {...props} />);
  expect(r.getByText("Mia · Read-only")).toBeTruthy();
  expect(r.getByTestId("set-logger-reps").props.editable).toBe(false);
  expect(r.queryByTestId("set-logger-remove")).toBeNull();
  expect(r.queryByText("Log for Mia")).toBeNull();
  fireEvent.press(r.getByText("Mine"));
  expect(props.onMine).toHaveBeenCalledTimes(1);
});
it("requires separate numbers and logging consent and identifies the owner of writes", async () => {
  const granted = {
    ...snapshot,
    grants: [
      {
        ownerId: "other",
        recipientId: "me",
        version: 2,
        consent: { numbers: true, prev: false, logging: true },
      },
    ],
  };
  const r = renderWithTheme(
    <TogetherPartnerPresenter {...props} snapshot={granted} />,
  );
  fireEvent.press(r.getByText("Log for Mia"));
  fireEvent.changeText(r.getByTestId("set-logger-reps"), "9");
  expect(props.onOperation).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Save set for Mia"));
  await waitFor(() =>
    expect(props.onOperation).toHaveBeenCalledWith(
      {
        type: "upsertSet",
        planExerciseId: "slot",
        set: { setId: "set", reps: 9, weightKg: 60, completed: true },
      },
      1,
    ),
  );
  r.rerender(
    <TogetherPartnerPresenter
      {...props}
      snapshot={{ ...granted, athletes: [], previous: {}, grants: [] }}
    />,
  );
  expect(r.queryByTestId("set-logger-reps")).toBeNull();
  expect(r.getByText(/Numbers are private/)).toBeTruthy();
  expect(r.queryByText("Log for Mia")).toBeNull();
});
it("logging permission without numeric consent never enables editing", () => {
  const r = renderWithTheme(
    <TogetherPartnerPresenter
      {...props}
      snapshot={{
        ...snapshot,
        grants: [
          {
            ownerId: "other",
            recipientId: "me",
            version: 1,
            consent: { numbers: false, prev: true, logging: true },
          },
        ],
      }}
    />,
  );
  expect(r.queryByText("Log for Mia")).toBeNull();
});

const granted = () => ({
  ...snapshot,
  previous: {
    other: [
      {
        exerciseId: "squat",
        setNumber: 1,
        reps: 7,
        weightKg: 55,
        recordedAt: 1,
      },
    ],
  },
  grants: [
    {
      ownerId: "other",
      recipientId: "me",
      version: 2,
      consent: { numbers: true, prev: true, logging: true },
    },
  ],
});
it("shows private plan progress without weights, reps, PREV or logging", () => {
  const privateSnapshot = {
    ...granted(),
    profiles: {},
    athletePlans: {
      other: {
        name: "Push",
        exercises: [
          {
            planExerciseId: "slot",
            exerciseId: "squat",
            order: 0,
            targetSets: 4,
          },
          {
            planExerciseId: "unknown",
            exerciseId: "not-in-cache",
            order: 1,
            targetSets: 3,
          },
        ],
      },
    },
    progress: [
      {
        userId: "other",
        revision: 3,
        exercises: [
          { planExerciseId: "slot", completedSets: 2, skipped: false },
          { planExerciseId: "unknown", completedSets: 0, skipped: true },
          { planExerciseId: "missing", completedSets: 1, skipped: false },
        ],
      },
    ],
    grants: [],
  };
  const r = renderWithTheme(
    <TogetherPartnerPresenter {...props} snapshot={privateSnapshot} />,
  );
  expect(r.getByText("Training partner · Read-only")).toBeTruthy();
  expect(r.getByText("2 sets completed")).toBeTruthy();
  expect(r.getByText("Skipped")).toBeTruthy();
  expect(r.getByText("Exercise 2")).toBeTruthy();
  expect(r.getByText("Exercise 3")).toBeTruthy();
  expect(r.queryByTestId("set-logger-reps")).toBeNull();
  expect(r.queryByText(/7 reps/)).toBeNull();
  expect(r.queryByText(/Log for/)).toBeNull();
  fireEvent.press(r.getByText("Back to my workout"));
  expect(props.onMine).toHaveBeenCalled();
});
it("fills authorized PREV only in explicit edit mode and submits the observed revision", async () => {
  const r = renderWithTheme(
    <TogetherPartnerPresenter {...props} snapshot={granted()} />,
  );
  fireEvent.press(r.getByTestId("set-logger-fill-previous"));
  expect(r.getByTestId("set-logger-reps").props.value).toBe("8");
  fireEvent.press(r.getByText("Log for Mia"));
  fireEvent.press(r.getByTestId("set-logger-fill-previous"));
  expect(props.onOperation).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Save set for Mia"));
  await waitFor(() =>
    expect(props.onOperation).toHaveBeenCalledWith(
      {
        type: "upsertSet",
        planExerciseId: "slot",
        set: { setId: "set", reps: 7, weightKg: 55, completed: true },
      },
      1,
    ),
  );
  fireEvent.press(r.getByText("Read only"));
  expect(r.getByTestId("set-logger-reps").props.editable).toBe(false);
});
it("preserves an unconfirmed set after failure and prevents duplicate writes while pending", async () => {
  const onOperation = jest.fn<
    Promise<void>,
    [Record<string, unknown>, number]
  >();
  let reject!: (value: unknown) => void;
  onOperation.mockImplementationOnce(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  const r = renderWithTheme(
    <TogetherPartnerPresenter
      {...props}
      snapshot={granted()}
      onOperation={onOperation}
    />,
  );
  fireEvent.press(r.getByText("Log for Mia"));
  fireEvent.changeText(r.getByTestId("set-logger-reps"), "10");
  act(() => {
    fireEvent.press(r.getByText("Save set for Mia"));
    fireEvent.press(r.getByText("Save set for Mia"));
  });
  expect(onOperation).toHaveBeenCalledTimes(1);
  expect(r.getByTestId("set-logger-reps").props.editable).toBe(false);
  await act(async () => reject(new Error("offline")));
  expect(r.getByText(/That set could not be sent/)).toBeTruthy();
  expect(r.getByTestId("set-logger-reps").props.value).toBe("10");
  expect(r.getByTestId("set-logger-reps").props.editable).toBe(true);
});
it("creates a new set deliberately, retains failed input and accepts only its current revision", async () => {
  const onOperation = jest
    .fn<Promise<void>, [Record<string, unknown>, number]>()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  const r = renderWithTheme(
    <TogetherPartnerPresenter
      {...props}
      snapshot={granted()}
      onOperation={onOperation}
    />,
  );
  fireEvent.press(r.getByText("Log for Mia"));
  fireEvent.press(r.getByText("Add set for Mia"));
  fireEvent.press(r.getAllByText("Save set for Mia")[1]);
  expect(onOperation).not.toHaveBeenCalled();
  fireEvent.changeText(r.getAllByTestId("set-logger-reps")[1], "6");
  fireEvent.changeText(r.getAllByTestId("set-logger-weight")[1], "65");
  fireEvent.press(r.getAllByText("Save set for Mia")[1]);
  await waitFor(() =>
    expect(r.getByText(/Could not send this set/)).toBeTruthy(),
  );
  expect(r.getAllByTestId("set-logger-reps")[1].props.value).toBe("6");
  fireEvent.press(r.getAllByText("Save set for Mia")[1]);
  await waitFor(() => expect(r.getByText("Add set for Mia")).toBeTruthy());
  expect(r.queryByText(/Could not send this set/)).toBeNull();
  expect(onOperation).toHaveBeenLastCalledWith(
    {
      type: "upsertSet",
      planExerciseId: "slot",
      set: { setId: "new-set", reps: 6, weightKg: 65, completed: true },
    },
    1,
  );
});
it("revision or grant changes discard old input and revoke PREV immediately", () => {
  const r = renderWithTheme(
    <TogetherPartnerPresenter {...props} snapshot={granted()} />,
  );
  fireEvent.press(r.getByText("Log for Mia"));
  fireEvent.changeText(r.getByTestId("set-logger-reps"), "99");
  const updated = {
    ...granted(),
    athletes: [
      {
        ...snapshot.athletes[0],
        revision: 2,
        exercises: {
          slot: {
            ...snapshot.athletes[0].exercises.slot,
            skipped: true,
            exerciseId: "uncached",
          },
        },
      },
    ],
    grants: [
      {
        ownerId: "other",
        recipientId: "me",
        version: 3,
        consent: { numbers: true, prev: false, logging: false },
      },
    ],
  };
  r.rerender(<TogetherPartnerPresenter {...props} snapshot={updated} />);
  expect(r.getByText("Exercise 1")).toBeTruthy();
  expect(r.getByText("Skipped")).toBeTruthy();
  expect(r.getByTestId("set-logger-reps").props.value).toBe("8");
  expect(r.queryByTestId("set-logger-fill-previous")).toBeNull();
  expect(r.queryByText("Save set for Mia")).toBeNull();
});
