import React from "react";
import {
  Alert,
  AppState,
  Share,
  View,
  type AppStateStatus,
} from "react-native";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherLobbyContainer,
  startRowDetail,
} from "../TogetherLobbyContainer";
import type {
  TogetherLobbyPort,
  TogetherLobbySnapshot,
} from "@/domain/ports/togetherLobby.port";
import { router } from "expo-router";
import * as Crypto from "expo-crypto";
import { TogetherSharingPresenter } from "@/ui/presenters/TogetherSharingPresenter";
import { TogetherPartnerPresenter } from "@/ui/presenters/TogetherPartnerPresenter";
import { TogetherWorkoutRow } from "@/ui/presenters/TogetherWorkoutRow";
import type {
  TogetherPreviousRow,
  TogetherSharedPort,
  TogetherSharedSnapshot,
} from "@/domain/ports/togetherShared.port";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";
import type { WorkoutSession } from "@/domain/models/session";
import { useTogetherSettings } from "@/state/together-settings";
const mockCloud = jest.fn();
jest.mock("../TogetherCloudContainer", () => ({
  TogetherCloudContainer: (props: unknown) => {
    mockCloud(props);
    return null;
  },
}));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
const mockSheet = jest.fn();
const mockRequest = jest.fn();
const mockCopy = jest.fn();
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [{ granted: false }, mockRequest],
  CameraView: "CameraView",
}));
jest.mock("expo-clipboard", () => ({
  setStringAsync: (text: string) => mockCopy(text),
}));
jest.mock("react-native-qrcode-svg", () => "QRCode");
jest.mock("@/ui/components/foundation/BottomSheet", () => ({
  BottomSheet: (props: {
    visible: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
    onClose(): void;
  }) => {
    mockSheet(props);
    return props.visible ? (
      <>
        {props.children}
        {props.footer}
      </>
    ) : null;
  },
}));

function harness() {
  let snapshot: TogetherLobbySnapshot = {
    phase: "idle",
    members: [],
    pending: [],
  };
  const listeners = new Set<() => void>();
  const lobby: TogetherLobbyPort = {
    getSnapshot: () => snapshot,
    subscribe: (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    host: jest.fn(async () => {}),
    browse: jest.fn(async () => {}),
    selectDiscovered: jest.fn(async () => {}),
    selectInvite: jest.fn(async () => {}),
    join: jest.fn(async () => {}),
    approve: jest.fn(async () => {}),
    decline: jest.fn(async () => {}),
    reconnect: jest.fn(async () => {}),
    cancel: jest.fn(async () => {}),
    setOnline: jest.fn(),
    setActive: jest.fn(),
    setAccount: jest.fn(),
    dispose: jest.fn(async () => {}),
    invalidateAuthorization: jest.fn(),
  };
  return {
    lobby,
    publish: (change: Partial<TogetherLobbySnapshot>) =>
      act(() => {
        snapshot = { ...snapshot, ...change };
        listeners.forEach((l) => l());
      }),
  };
}
beforeEach(() => {
  jest
    .spyOn(AppState, "addEventListener")
    .mockReturnValue({ remove: jest.fn() });
  mockCloud.mockClear();
  jest.mocked(router.push).mockClear();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
  mockRequest.mockReset();
  mockCopy.mockReset();
  mockCopy.mockResolvedValue(undefined);
});
it("hosts current workout, approves real peer IDs, copies invite and cleans up", async () => {
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  // Presets from Together settings: Nearby and Training partners (canvas 1b).
  expect(
    r.getByRole("radio", { name: "Partners" }).props.accessibilityState.checked,
  ).toBe(true);
  fireEvent.press(r.getByText("Start the session"));
  expect(h.lobby.host).toHaveBeenCalledWith("Squats", "friends");
  await act(async () => {});
  const share = jest
    .spyOn(Share, "share")
    .mockResolvedValue({ action: "sharedAction" });
  jest.mocked(h.lobby.host).mockImplementation(async () => {
    h.publish({
      phase: "hosting",
      role: "host",
      audience: "friends",
      invitation: "signed",
    });
  });
  h.publish({ phase: "idle" });
  fireEvent.press(r.getByText("Start"));
  await act(async () => fireEvent.press(r.getByText("Start the session")));
  // The invite sheet opens once after start, with the mode on it.
  await waitFor(() => expect(r.getByText("Invite people")).toBeTruthy());
  expect(
    r.getByText(/Nearby · no internet needed · training partners join/),
  ).toBeTruthy();
  fireEvent.press(r.getByText("Share code"));
  await waitFor(() =>
    expect(share).toHaveBeenCalledWith({
      url: "persistencemobile://together/join?connection=local&invitation=signed&transport=lan",
    }),
  );
  // A non-partner's request is a Let in / No bar under the strip.
  h.publish({ pending: [{ userId: "g", peerId: "p" }] });
  fireEvent.press(r.getByText("Let in"));
  expect(h.lobby.approve).toHaveBeenCalledWith("p");
  fireEvent.press(r.getByText("No"));
  expect(h.lobby.decline).toHaveBeenCalledWith("p");
  share.mockRestore();
  r.unmount();
  expect(h.lobby.cancel).not.toHaveBeenCalled();
});
it("account replacement clears input; late failures cannot reappear", async () => {
  let reject!: (e: Error) => void;
  const h = harness();
  jest
    .mocked(h.lobby.host)
    .mockReturnValueOnce(new Promise((_, r) => (reject = r)));
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Start the session"));
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="b"
    />,
  );
  await act(async () => reject(Error("late")));
  fireEvent.press(r.getByText("Start"));
  expect(r.queryByText(/Could not complete this action/)).toBeNull();
  jest.mocked(h.lobby.host).mockRejectedValueOnce(Error("now"));
  fireEvent.press(r.getByText("Start the session"));
  await waitFor(() =>
    expect(r.getByText(/Could not finish preparing Together/)).toBeTruthy(),
  );
  h.publish({ phase: "disabled" });
  expect(r.queryByTestId("together-workout-row")).toBeNull();
});

it("dismissing the root sheet preserves admission; explicit Leave terminates it", () => {
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer lobby={h.lobby} workoutName="Squats" accountId="a">
      {(row) => <View testID="workout-header">{row}</View>}
    </TogetherLobbyContainer>,
  );
  fireEvent.press(r.getByText("Start"));
  h.publish({ phase: "hosting" });
  expect(
    r
      .getByTestId("workout-header")
      .findAllByProps({ testID: "together-lobby-content" }),
  ).toHaveLength(0);
  act(() => mockSheet.mock.calls.at(-1)![0].onClose());
  expect(h.lobby.cancel).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Leave lobby · keep my workout"));
  expect(h.lobby.cancel).toHaveBeenCalledTimes(1);
  h.publish({ phase: "disabled" });
  expect(r.getByTestId("workout-header")).toBeTruthy();
});
it("passes explicit audience and resets private on account change", () => {
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByRole("radio", { name: "Open nearby" }));
  fireEvent.press(r.getByText("Start the session"));
  expect(h.lobby.host).toHaveBeenLastCalledWith("Squats", "open");
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="b"
    />,
  );
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByText("Start the session"));
  expect(h.lobby.host).toHaveBeenLastCalledWith("Squats", "friends");
});
function workoutHarness() {
  const h = harness();
  const listeners = new Set<() => void>();
  let status:
    | import("@/domain/ports/togetherWorkout.port").TogetherWorkoutStatus
    | null = null;
  const workout: import("@/domain/ports/togetherWorkout.port").TogetherWorkoutPort =
    {
      getActive: jest.fn(),
      getPlan: jest.fn(),
      getOwnExecution: jest.fn(),
      applyOwnOperation: jest.fn(),
      review: jest.fn(),
      getReview: jest.fn(),
      finish: jest.fn(),
      promote: jest.fn(async () => {}),
      read: jest.fn(),
      save: jest.fn(),
      status: jest.fn((account, id) =>
        account === "a" && id === "local" ? status : null,
      ),
      subscribe: (l) => {
        listeners.add(l);
        return () => {
          listeners.delete(l);
        };
      },
    };
  return {
    ...h,
    lobby: { ...h.lobby, workout },
    workout,
    listeners,
    update: (
      sharing: import("@/domain/ports/togetherWorkout.port").TogetherWorkoutStatus["sharing"],
      receivedCount = 0,
    ) =>
      act(() => {
        status = {
          sessionId: "s",
          executionId: "e",
          localSessionId: "local",
          sharing,
          receivedCount,
          pendingCount: 2 - receivedCount,
        };
        listeners.forEach((l) => l());
      }),
  };
}
it("promotes only on consent using the fresh workout and shows durable receipt updates", async () => {
  const h = workoutHarness();
  const current: import("@/domain/models/session").WorkoutSession = {
    id: "local",
    userId: "a",
    workoutId: null,
    name: "Latest name",
    status: "in_progress",
    startedAt: "2026-10-04T09:00:00Z",
    completedAt: null,
    notes: null,
    exercises: [],
  };
  const getWorkout = jest.fn(() => current);
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Old name"
      accountId="a"
      localSessionId="local"
      getWorkout={getWorkout}
    />,
  );
  h.publish({ phase: "pending-approval" });
  fireEvent.press(r.getByText("Open"));
  expect(r.queryByText("Use my workout in Together")).toBeNull();
  h.publish({ phase: "joined" });
  expect(h.workout.promote).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Use my workout in Together"));
  expect(h.workout.promote).toHaveBeenCalledWith(current);
  h.update("active", 1);
  expect(r.getByText(/complete workout journal is retained/)).toBeTruthy();
  expect(r.queryByText(/Your workout remains personal/)).toBeNull();
  h.publish({ phase: "idle" });
  h.update("local-only");
  expect(r.queryByText("Start the session")).toBeNull();
  expect(r.queryByText("Join")).toBeNull();
  // Sharing has ended: an ordinary solo workout, no Together row (row 3).
  expect(r.queryByText(/My workout ·/)).toBeNull();
  expect(r.queryByTestId("together-workout-row")).toBeNull();
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Other"
      accountId="b"
      localSessionId="local"
      getWorkout={getWorkout}
    />,
  );
  expect(r.queryByText(/My workout ·/)).toBeNull();
  expect(r.getByText("Start")).toBeTruthy();
  r.unmount();
  expect(h.listeners.size).toBe(0);
});
it("rejects a changed personal workout and explains unsupported promotion without hiding logging", async () => {
  const h = workoutHarness();
  const getWorkout = jest.fn<
    ReturnType<
      NonNullable<
        React.ComponentProps<typeof TogetherLobbyContainer>["getWorkout"]
      >
    >,
    []
  >(() => null);
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Squats"
      accountId="a"
      localSessionId="local"
      getWorkout={getWorkout}
    />,
  );
  h.publish({ phase: "hosting" });
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Use my workout in Together"));
  await r.findByText(/Could not complete this action/);
  expect(h.workout.promote).not.toHaveBeenCalled();
  const session: import("@/domain/models/session").WorkoutSession = {
    id: "changed",
    userId: "a",
    workoutId: null,
    name: "Squats",
    status: "in_progress",
    startedAt: "2026-10-04T09:00:00Z",
    completedAt: null,
    notes: null,
    exercises: [],
  };
  getWorkout.mockReturnValue(session);
  fireEvent.press(r.getByText("Use my workout in Together"));
  await r.findByText(/Could not complete this action/);
  session.id = "local";
  session.userId = "b";
  fireEvent.press(r.getByText("Use my workout in Together"));
  await r.findByText(/Could not complete this action/);
  expect(h.workout.promote).not.toHaveBeenCalled();
  session.userId = "a";
  jest
    .mocked(h.workout.promote)
    .mockRejectedValueOnce(Error("workout-unsupported"));
  fireEvent.press(r.getByText("Use my workout in Together"));
  await r.findByText(/This workout can’t be shared yet/);
  expect(r.getByText("Leave lobby · keep my workout")).toBeTruthy();
});

const plan = {
  name: "Shared plan",
  exercises: [
    { planExerciseId: "p", exerciseId: "squat", order: 0, targetSets: 3 },
  ],
};
const personal = (): WorkoutSession => ({
  id: "local",
  userId: "a",
  workoutId: null,
  name: "My workout",
  status: "in_progress",
  startedAt: "2026-10-05T09:00:00Z",
  completedAt: null,
  notes: null,
  exercises: [
    {
      id: "squat-slot",
      sessionId: "local",
      exerciseId: "squat",
      exerciseName: "Squat",
      sortOrder: 0,
      supersetGroup: null,
      isSubstituted: false,
      originalExerciseId: null,
      notes: null,
      sets: [],
    },
  ],
});
function sharingHarness() {
  const h = workoutHarness();
  let view: TogetherSharedSnapshot = {
    progress: [],
    plan,
    planHash: "hash",
    athletePlans: {},
    profiles: { other: "Mia" },
    athletes: [],
    previous: {},
    grants: [],
    closures: [],
    delegated: [],
    deliveries: [],
  };
  const shared: TogetherSharedPort = {
    getSnapshot: () => view,
    subscribe: () => () => {},
    publishOwnActivity: jest.fn(async () => {}),
    publishPlan: jest.fn(async () => {}),
    publishProfile: jest.fn(async () => {}),
    setOwnPlan: jest.fn(),
    setConsent: jest.fn(async () => {}),
    publishPrevious: jest.fn(async () => {}),
    requestDelegatedSet: jest.fn(async () => {}),
    consumeDelegated: jest.fn(),
    close: jest.fn(async () => {}),
  };
  const lobby: TogetherLobbyPort = {
    ...h.lobby,
    shared,
    removeParticipant: jest.fn(async () => {}),
    transports: ["lan", "nearby"],
    selectTransport: jest.fn(),
  };
  return {
    ...h,
    lobby,
    shared,
    setShared: (next: Partial<TogetherSharedSnapshot>) => {
      view = { ...view, ...next };
      h.publish({});
    },
  };
}
function mountShared(
  h: ReturnType<typeof sharingHarness>,
  extra: Partial<React.ComponentProps<typeof TogetherLobbyContainer>> = {},
) {
  return renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Mine"
      accountId="a"
      localSessionId="local"
      getWorkout={() => personal()}
      {...extra}
    />,
  );
}
function shareProps(r: ReturnType<typeof renderWithTheme>) {
  return r.UNSAFE_getByType(TogetherSharingPresenter)
    .props as React.ComponentProps<typeof TogetherSharingPresenter>;
}
function lastDialog() {
  return jest.mocked(Alert.alert).mock.calls.at(-1)![2]!;
}
it("offers only Nearby and Online, never a transport picker, and switches to remote only after local cancellation", async () => {
  const h = sharingHarness(),
    cloud = {} as TogetherCloudPort;
  const r = mountShared(h, { cloud });
  fireEvent.press(r.getByText("Start"));
  expect(r.queryByText(/hotspot|same Wi-Fi/)).toBeNull();
  expect(r.getByText("Online · internet required")).toBeTruthy();
  fireEvent.press(r.getByText("Nearby · no internet needed"));
  expect(h.lobby.selectTransport).not.toHaveBeenCalled();
  // Open nearby is Nearby-only: under Online it is disabled, never silently kept.
  fireEvent.press(r.getByRole("radio", { name: "Open nearby" }));
  fireEvent.press(r.getByText("Online · internet required"));
  expect(
    r.getByRole("radio", { name: "Open nearby" }).props.accessibilityState
      .disabled,
  ).toBe(true);
  expect(
    r.getByRole("radio", { name: "Partners" }).props.accessibilityState.checked,
  ).toBe(true);
  expect(r.getByText(/Open nearby works only with Nearby/)).toBeTruthy();
  let finish!: () => void;
  jest.mocked(h.lobby.cancel).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  fireEvent.press(r.getByText("Start the session"));
  expect(mockCloud).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(mockCloud).toHaveBeenCalledWith(
    expect.objectContaining({ cloud, accountId: "a" }),
  );
  act(() => mockCloud.mock.calls.at(-1)![0].onLocal());
  expect(r.getByText("Start")).toBeTruthy();
});
it("late cancellation cannot switch another account to the remote flow", async () => {
  const h = sharingHarness(),
    cloud = {} as TogetherCloudPort;
  let finish!: () => void;
  jest.mocked(h.lobby.cancel).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  const r = mountShared(h, { cloud });
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByRole("radio", { name: "Partners" }));
  fireEvent.press(r.getByText("Online · internet required"));
  fireEvent.press(r.getByText("Start the session"));
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      cloud={cloud}
      accountId="b"
      workoutName="Other"
      getWorkout={() => ({ ...personal(), userId: "b" })}
    />,
  );
  await act(async () => finish());
  expect(mockCloud).not.toHaveBeenCalled();
  expect(r.getByText("Start")).toBeTruthy();
});
it("restores a cloud-owned workout directly and forwards personal restoration", () => {
  const h = sharingHarness(),
    cloud = {} as TogetherCloudPort,
    onRestorePersonal = jest.fn(),
    session = {
      ...personal(),
      together: {
        sessionId: "s",
        executionId: "e",
        transport: "cloud" as const,
      },
    };
  mountShared(h, { cloud, getWorkout: () => session, onRestorePersonal });
  expect(mockCloud).toHaveBeenCalledWith(
    expect.objectContaining({ cloud, onRestorePersonal }),
  );
  expect(h.lobby.host).not.toHaveBeenCalled();
});
it("scopes PREV publication to explicit recipient, current owner and workout start", async () => {
  const h = sharingHarness(),
    getPrevious = jest.fn(() => [
      {
        exerciseId: "squat",
        setNumber: 1,
        reps: 8,
        weightKg: 60,
        recordedAt: 1,
      },
    ]);
  const r = mountShared(h, { getPrevious });
  h.publish({
    phase: "hosting",
    role: "host",
    members: [
      { userId: "a", host: true },
      { userId: "other", host: false },
    ],
  });
  fireEvent.press(r.getByText("Open"));
  await act(async () =>
    shareProps(r).onConsent("other", {
      numbers: false,
      prev: true,
      logging: false,
    }),
  );
  expect(h.shared.setConsent).toHaveBeenCalledWith("other", {
    numbers: false,
    prev: true,
    logging: false,
  });
  expect(h.shared.publishPrevious).toHaveBeenCalledWith(
    "other",
    getPrevious(),
    Date.parse(personal().startedAt),
  );
  jest.mocked(h.shared.publishPrevious).mockClear();
  await act(async () =>
    shareProps(r).onConsent("other", {
      numbers: true,
      prev: false,
      logging: true,
    }),
  );
  expect(h.shared.publishPrevious).not.toHaveBeenCalled();
});
it("does not publish PREV after a delayed grant crosses accounts", async () => {
  const h = sharingHarness();
  let finish!: () => void;
  jest.mocked(h.shared.setConsent).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  const getPrevious = jest.fn(() => []);
  const r = mountShared(h, { getPrevious });
  h.publish({ phase: "hosting", role: "host" });
  fireEvent.press(r.getByText("Open"));
  act(() =>
    shareProps(r).onConsent("other", {
      numbers: true,
      prev: true,
      logging: false,
    }),
  );
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="b"
      workoutName="Other"
      getWorkout={() => ({ ...personal(), userId: "b" })}
      getPrevious={getPrevious}
    />,
  );
  await act(async () => finish());
  expect(getPrevious).not.toHaveBeenCalled();
  expect(h.shared.publishPrevious).not.toHaveBeenCalled();
});
it("never reads PREV from a draft belonging to another account", async () => {
  const h = sharingHarness(),
    getPrevious = jest.fn(() => []);
  const r = mountShared(h, {
    getWorkout: () => ({ ...personal(), userId: "b" }),
    getPrevious,
  });
  h.publish({ phase: "hosting", role: "host" });
  fireEvent.press(r.getByText("Open"));
  await act(async () =>
    shareProps(r).onConsent("other", {
      numbers: false,
      prev: true,
      logging: false,
    }),
  );
  expect(getPrevious).not.toHaveBeenCalled();
});
it("publishes the chosen display name only while admitted and tolerates failed profile delivery", async () => {
  const h = sharingHarness();
  jest.mocked(h.shared.publishProfile).mockRejectedValue(new Error("offline"));
  mountShared(h, { displayName: "Brad" });
  expect(h.shared.publishProfile).not.toHaveBeenCalled();
  await act(async () => h.publish({ phase: "joined" }));
  expect(h.shared.publishProfile).toHaveBeenCalledWith("Brad");
});
it("adopts an offered plan deliberately and never offers replacement over logged sets", async () => {
  const h = sharingHarness(),
    onAdoptPlan = jest.fn();
  const r = mountShared(h, { onAdoptPlan });
  h.publish({ phase: "joined", role: "guest" });
  fireEvent.press(r.getByText("Open"));
  expect(onAdoptPlan).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Add their plan to mine"));
  expect(onAdoptPlan).toHaveBeenLastCalledWith(plan, "append");
  fireEvent.press(r.getByText("Use this plan"));
  expect(onAdoptPlan).toHaveBeenLastCalledWith(plan, "replace-empty");
  const session = personal();
  session.exercises = [
    {
      id: "x",
      sessionId: "local",
      exerciseId: "squat",
      exerciseName: "Squat",
      sortOrder: 0,
      supersetGroup: null,
      isSubstituted: false,
      originalExerciseId: null,
      notes: null,
      sets: [
        {
          id: "set",
          sessionExerciseId: "x",
          setNumber: 1,
          weightKg: 60,
          reps: 8,
          rpe: null,
          durationSeconds: null,
          distanceMeters: null,
          isCompleted: true,
          completedAt: null,
        },
      ],
    },
  ];
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      workoutName="Mine"
      accountId="a"
      getWorkout={() => session}
      onAdoptPlan={onAdoptPlan}
    />,
  );
  expect(r.queryByText("Use this plan")).toBeNull();
  expect(r.getByText("Add their plan to mine")).toBeTruthy();
});
it("promotes and publishes only the current host plan; guests keep their own plan", async () => {
  const h = sharingHarness();
  jest.mocked(h.workout.getPlan).mockReturnValue(plan);
  const r = mountShared(h);
  h.publish({ phase: "hosting", role: "host" });
  fireEvent.press(r.getByText("Open"));
  await act(async () =>
    fireEvent.press(r.getByText("Use my workout in Together")),
  );
  expect(h.shared.setOwnPlan).toHaveBeenCalledWith(plan);
  expect(h.shared.publishPlan).toHaveBeenCalledWith(plan);
  jest.mocked(h.shared.publishPlan).mockClear();
  h.publish({ phase: "joined", role: "guest" });
  await act(async () =>
    fireEvent.press(r.getByText("Use my workout in Together")),
  );
  expect(h.shared.publishPlan).not.toHaveBeenCalled();
});
it("does not publish an old account's plan after delayed promotion", async () => {
  const h = sharingHarness();
  let finish!: () => void;
  jest.mocked(h.workout.promote).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  jest.mocked(h.workout.getPlan).mockReturnValue(plan);
  const r = mountShared(h);
  h.publish({ phase: "hosting", role: "host" });
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Use my workout in Together"));
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="b"
      workoutName="Other"
      getWorkout={() => ({ ...personal(), userId: "b" })}
    />,
  );
  await act(async () => finish());
  expect(h.shared.setOwnPlan).not.toHaveBeenCalled();
  expect(h.shared.publishPlan).not.toHaveBeenCalled();
});
it("partner view delegates only the displayed revision and returns to own workout on removal", async () => {
  const h = sharingHarness();
  const r = mountShared(h, {
    displayName: "Brad",
    children: (row, partnerView) => (
      <View testID={partnerView ? "partner-screen" : "personal-workout"}>
        {row}
        {partnerView}
      </View>
    ),
  });
  h.publish({
    phase: "joined",
    members: [
      { userId: "a", host: false },
      { userId: "other", host: true },
    ],
  });
  h.update("active");
  fireEvent.press(r.getByLabelText("Show Mia’s workout"));
  expect(r.queryByTestId("personal-workout")).toBeNull();
  // The strip stays: the partner's workout renders inside the active screen.
  expect(r.getByTestId("partner-screen")).toBeTruthy();
  expect(r.getByTestId("together-workout-row")).toBeTruthy();
  const p = r.UNSAFE_getByType(TogetherPartnerPresenter)
    .props as React.ComponentProps<typeof TogetherPartnerPresenter>;
  expect(p.tone).toBe("info");
  expect(p.editable).toBe(false);
  // No numbers or fill-in from Mia yet: a commit goes nowhere.
  act(() => {
    p.outbox.edit("x", { reps: 5, weightKg: 50 }, "");
    p.outbox.commit("x", "slot");
  });
  await act(async () => {});
  expect(h.shared.requestDelegatedSet).not.toHaveBeenCalled();
  // Your own avatar is the only way back.
  expect(r.queryByText("Back to my workout")).toBeNull();
  expect(r.queryByText("Mine")).toBeNull();
  fireEvent.press(r.getByLabelText("Show my workout"));
  expect(r.getByTestId("personal-workout")).toBeTruthy();
  fireEvent.press(r.getByLabelText("Show Mia’s workout"));
  h.publish({ members: [{ userId: "a", host: false }] });
  expect(r.getByTestId("personal-workout")).toBeTruthy();
});
it("fill-in edits a Nearby partner's planned set at once, and a revoked grant locks the rows mid-view", async () => {
  const uuid = jest.spyOn(Crypto, "randomUUID").mockReturnValue("row-2");
  const h = sharingHarness();
  const grant = (logging: boolean, version: number) => [
    {
      ownerId: "other",
      recipientId: "a",
      version,
      consent: { numbers: true, prev: true, logging },
    },
  ];
  h.setShared({
    athletePlans: {
      other: {
        name: "Lower Body B",
        exercises: [
          {
            planExerciseId: "slot",
            exerciseId: "squat",
            order: 0,
            targetSets: 2,
          },
        ],
      },
    },
    athletes: [
      {
        userId: "other",
        revision: 4,
        restEndsAt: null,
        exercises: {
          slot: {
            exerciseId: "squat",
            skipped: false,
            sets: [{ setId: "s1", reps: 8, weightKg: 60, completed: true }],
          },
        },
      },
    ],
    previous: {
      other: [
        {
          exerciseId: "squat",
          setNumber: 2,
          reps: 8,
          weightKg: 57.5,
          recordedAt: 1,
        },
      ],
    },
    grants: grant(true, 1),
  });
  let refuse!: (error: Error) => void;
  jest
    .mocked(h.shared.requestDelegatedSet)
    .mockResolvedValueOnce(undefined)
    .mockImplementationOnce(
      () => new Promise<void>((_, reject) => (refuse = reject)),
    );
  const r = mountShared(h, {
    displayName: "Brad",
    exerciseNames: { squat: "Squat" },
    children: (row, partnerView) => (
      <>
        {row}
        {partnerView}
      </>
    ),
  });
  h.publish({
    phase: "joined",
    members: [
      { userId: "a", host: false },
      { userId: "other", host: true },
    ],
  });
  h.update("active");
  fireEvent.press(r.getByLabelText("Show Mia’s workout"));
  expect(r.getByText("Logging for Mia · changes Mia’s record")).toBeTruthy();
  const reps = () => r.getAllByTestId("set-logger-reps");
  expect(reps().map((input) => input.props.value)).toEqual(["8", ""]);
  expect(reps()[1]!.props.editable).toBe(true);
  // Prev on the planned row is Mia's own value; tapping it logs the set for her.
  fireEvent.press(r.getByText("8 reps • 57.5 kg"));
  await waitFor(() =>
    expect(h.shared.requestDelegatedSet).toHaveBeenCalledWith(
      "other",
      {
        type: "upsertSet",
        planExerciseId: "slot",
        set: {
          setId: expect.any(String),
          reps: 8,
          weightKg: 57.5,
          completed: true,
        },
      },
      4,
    ),
  );
  // Mia's projection echoes it; only then does the next edit go, at her new revision.
  const echoed = h.shared.getSnapshot().athletes[0]!;
  act(() =>
    h.setShared({
      athletes: [
        {
          ...echoed,
          revision: 5,
          exercises: {
            slot: {
              ...echoed.exercises.slot!,
              sets: [
                ...echoed.exercises.slot!.sets,
                { setId: "row-2", reps: 8, weightKg: 57.5, completed: true },
              ],
            },
          },
        },
      ],
    }),
  );
  // A second edit is in flight when Mia turns fill-in off.
  fireEvent.changeText(reps()[0]!, "9");
  fireEvent(reps()[0]!, "blur");
  expect(h.shared.requestDelegatedSet).toHaveBeenCalledTimes(2);
  expect(h.shared.requestDelegatedSet).toHaveBeenLastCalledWith(
    "other",
    {
      type: "upsertSet",
      planExerciseId: "slot",
      set: { setId: "s1", reps: 9, weightKg: 60, completed: true },
    },
    5,
  );
  act(() => h.setShared({ grants: grant(false, 2) }));
  await act(async () => refuse(new Error("permission-changed")));
  expect(r.getByText("Mia · read-only. Fill-in is off.")).toBeTruthy();
  expect(reps().every((input) => input.props.editable === false)).toBe(true);
  expect(reps()[0]!.props.value).toBe("8");
  expect(r.getByTestId("set-logger-sync-notsent")).toBeTruthy();
  expect(r.getByText(/could not be sent to Mia/)).toBeTruthy();
  fireEvent(reps()[0]!, "blur");
  expect(h.shared.requestDelegatedSet).toHaveBeenCalledTimes(2);
  uuid.mockRestore();
});
it("destructive dialogs are generation-bound and do nothing when dismissed", async () => {
  const h = sharingHarness();
  const r = mountShared(h);
  h.publish({
    phase: "hosting",
    role: "host",
    members: [
      { userId: "a", host: true },
      { userId: "other", host: false },
    ],
  });
  fireEvent.press(r.getByText("Open"));
  act(() => shareProps(r).onRemove!("other"));
  expect(h.lobby.removeParticipant).not.toHaveBeenCalled();
  const oldRemove = lastDialog().find((b) => b.text === "Remove")!;
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="b"
      workoutName="Other"
    />,
  );
  await act(async () => oldRemove.onPress!());
  expect(h.lobby.removeParticipant).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Open"));
  act(() => shareProps(r).onClose("finish_all"));
  const oldClose = lastDialog().find((b) => b.text === "End sharing")!;
  r.unmount();
  await act(async () => oldClose.onPress!());
  expect(h.shared.close).not.toHaveBeenCalled();
});
it("confirms removal and routes an acknowledged closure to own recovery", async () => {
  const h = sharingHarness();
  const r = mountShared(h);
  h.publish({
    phase: "hosting",
    role: "host",
    members: [
      { userId: "a", host: true },
      { userId: "other", host: false },
    ],
  });
  fireEvent.press(r.getByText("Open"));
  act(() => shareProps(r).onRemove!("other"));
  await act(async () =>
    lastDialog().find((b) => b.text === "Remove")!.onPress!(),
  );
  expect(h.lobby.removeParticipant).toHaveBeenCalledWith("other");
  act(() => shareProps(r).onClose("save_own"));
  expect(h.shared.close).not.toHaveBeenCalled();
  await act(async () =>
    lastDialog().find((b) => b.text === "End sharing")!.onPress!(),
  );
  expect(h.shared.close).toHaveBeenCalledWith("save_own");
  expect(router.push).not.toHaveBeenCalled();
});
it("late closure cannot navigate or cancel a newer account's lobby", async () => {
  const h = sharingHarness();
  let finish!: () => void;
  jest.mocked(h.shared.close).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  const r = mountShared(h);
  h.publish({ phase: "hosting", role: "host" });
  fireEvent.press(r.getByText("Open"));
  act(() => shareProps(r).onClose("finish_all"));
  act(() => lastDialog().find((b) => b.text === "End sharing")!.onPress!());
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="b"
      workoutName="Other"
    />,
  );
  await act(async () => finish());
  expect(router.push).not.toHaveBeenCalled();
  jest.mocked(h.shared.close).mockReturnValueOnce(
    new Promise((r) => {
      finish = r;
    }),
  );
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Leave lobby · keep my workout"));
  r.rerender(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="c"
      workoutName="Third"
    />,
  );
  const cancellations = jest.mocked(h.lobby.cancel).mock.calls.length;
  await act(async () => finish());
  expect(h.lobby.cancel).toHaveBeenCalledTimes(cancellations);
});
it("explicit leave signals shared closure before cancelling; review and partner navigation dismiss locally", async () => {
  const h = sharingHarness();
  const r = mountShared(h);
  h.publish({ phase: "joined", role: "guest" });
  fireEvent.press(r.getByText("Open"));
  await act(async () =>
    fireEvent.press(r.getByText("Leave lobby · keep my workout")),
  );
  expect(h.shared.close).toHaveBeenCalledWith("leave");
  expect(h.lobby.cancel).toHaveBeenCalled();
  fireEvent.press(r.getByText("Open"));
  h.update("active");
  fireEvent.press(r.getByText("Review my result"));
  expect(router.push).toHaveBeenLastCalledWith({
    pathname: "/(app)/session/together-review",
    params: { localSessionId: "local" },
  });
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Training partners"));
  expect(router.push).toHaveBeenLastCalledWith("/(app)/together/partners");
});

it("workout row opens settings and the leave sheet while self selection restores the personal view", () => {
  const h = sharingHarness();
  const r = mountShared(h);
  h.publish({
    phase: "joined",
    role: "guest",
    members: [
      { userId: "a", host: true },
      { userId: "b", host: false },
    ],
  });
  h.update("active");
  const row = () => r.UNSAFE_getByType(TogetherWorkoutRow).props;
  // A guest's strip: Leave, the settings cog, no Invite.
  expect(row().endLabel).toBe("Leave");
  expect(row().onInvite).toBeUndefined();
  expect(row().status).toBe("In sync · 2 training");
  act(() => row().onSettings());
  expect(r.getByText("Training partners")).toBeTruthy();
  act(() => row().onSelect("b"));
  expect(r.UNSAFE_getByType(TogetherPartnerPresenter)).toBeTruthy();
  act(() => row().onSelect("a"));
  expect(r.UNSAFE_queryByType(TogetherPartnerPresenter)).toBeNull();
  // Leave opens row 3's sheet, not the settings.
  act(() => row().onEnd());
  expect(r.getByText("Leave the host’s session?")).toBeTruthy();
});

it("warms own history after local admission without gating lobby or sharing without consent", async () => {
  const h = sharingHarness();
  const refreshPrevious = jest.fn<
    Promise<readonly TogetherPreviousRow[]>,
    [() => boolean]
  >(async () => []);
  const r = mountShared(h, { refreshPrevious });
  h.publish({ phase: "hosting", role: "host" });
  await act(async () => {});
  expect(refreshPrevious).toHaveBeenCalledTimes(1);
  expect(refreshPrevious.mock.calls[0]![0]()).toBe(true);
  expect(h.shared.publishPrevious).not.toHaveBeenCalled();
  r.unmount();
  expect(refreshPrevious.mock.calls[0]![0]()).toBe(false);
});

it.each(["current", "revoked", "regranted", "workout", "unmounted"])(
  "refreshes consented PREV only for the unchanged grant: %s",
  async (state) => {
    const h = sharingHarness();
    const refreshed = [
      {
        exerciseId: "squat",
        setNumber: 1,
        reps: 8,
        weightKg: 80,
        recordedAt: 1,
      },
    ];
    const refreshPrevious = jest.fn<
      Promise<readonly TogetherPreviousRow[]>,
      [() => boolean]
    >(async () => []);
    let workout = personal();
    const r = mountShared(h, {
      refreshPrevious,
      getPrevious: () => [],
      getWorkout: () => workout,
    });
    h.publish({ phase: "hosting", role: "host" });
    fireEvent.press(r.getByText("Open"));
    await act(async () => {});
    let resolve!: (rows: readonly TogetherPreviousRow[]) => void;
    refreshPrevious.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const grant = {
      ownerId: "a",
      recipientId: "other",
      version: 1,
      consent: { prev: true, numbers: false, logging: false },
    };
    h.setShared({ grants: [grant] });
    await act(async () => {
      shareProps(r).onConsent("other", grant.consent);
    });
    expect(h.shared.publishPrevious).toHaveBeenCalledWith(
      "other",
      [],
      Date.parse(workout.startedAt),
    );
    if (state === "revoked") {
      h.setShared({
        grants: [
          { ...grant, version: 2, consent: { ...grant.consent, prev: false } },
        ],
      });
      await act(async () => {
        shareProps(r).onConsent("other", { ...grant.consent, prev: false });
      });
    }
    if (state === "regranted")
      h.setShared({ grants: [{ ...grant, version: 3 }] });
    if (state === "workout") workout = { ...workout, id: "another" };
    if (state === "unmounted") r.unmount();
    await act(async () => resolve(refreshed));
    expect(h.shared.publishPrevious).toHaveBeenCalledTimes(
      state === "current" ? 2 : 1,
    );
    if (state === "current")
      expect(h.shared.publishPrevious).toHaveBeenLastCalledWith(
        "other",
        refreshed,
        Date.parse(workout.startedAt),
      );
  },
);

it("omits skipped PREV in cached and refreshed publication, using the current workout on resend", async () => {
  const h = sharingHarness();
  const squat = personal().exercises[0]!;
  let workout = {
    ...personal(),
    exercises: [
      { ...squat, skipped: true },
      { ...squat, id: "press-slot", exerciseId: "press", skipped: false },
      { ...squat, id: "row-slot", exerciseId: "row", skipped: false },
    ],
  };
  const rows = ["squat", "press", "row"].map((exerciseId) => ({
    exerciseId,
    setNumber: 1,
    reps: 8,
    weightKg: 60,
    recordedAt: 1,
  }));
  const refreshPrevious = jest.fn<
    Promise<readonly TogetherPreviousRow[]>,
    [() => boolean]
  >(async () => []);
  const r = mountShared(h, {
    getWorkout: () => workout,
    getPrevious: () => rows,
    refreshPrevious,
  });
  h.publish({ phase: "hosting", role: "host" });
  fireEvent.press(r.getByText("Open"));
  await act(async () => {});
  let resolve!: (value: readonly TogetherPreviousRow[]) => void;
  refreshPrevious.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const consent = { prev: true, numbers: false, logging: false };
  h.setShared({
    grants: [{ ownerId: "a", recipientId: "other", version: 1, consent }],
  });
  await act(async () => {
    shareProps(r).onConsent("other", consent);
  });
  expect(h.shared.publishPrevious).toHaveBeenLastCalledWith(
    "other",
    rows.slice(1),
    Date.parse(workout.startedAt),
  );
  workout = {
    ...workout,
    exercises: workout.exercises.map((e) =>
      e.exerciseId === "row" ? { ...e, skipped: true } : e,
    ),
  };
  await act(async () => resolve(rows.map((row) => ({ ...row, weightKg: 80 }))));
  expect(h.shared.publishPrevious).toHaveBeenLastCalledWith(
    "other",
    [{ ...rows[1], weightKg: 80 }],
    Date.parse(workout.startedAt),
  );
  r.unmount();
});

it("consumes a detail host intent once and does not restart after an error or cancellation", async () => {
  const h = harness();
  const consume = jest.fn();
  jest.mocked(h.lobby.host).mockRejectedValueOnce(new Error("unavailable"));
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="me"
      workoutName="Squats"
      initialHostAudience="open"
      onConsumeHostIntent={consume}
    />,
  );
  await waitFor(() => expect(h.lobby.host).toHaveBeenCalledTimes(1));
  expect(h.lobby.host).toHaveBeenCalledWith("Squats", "open");
  expect(consume).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(
      r.getByText(
        "Could not finish preparing Together. Your workout stays on this device. Open settings to retry sharing or review your result.",
      ),
    ).toBeTruthy(),
  );
  act(() => mockSheet.mock.calls.at(-1)![0].onClose());
  h.publish({ phase: "idle" });
  expect(h.lobby.host).toHaveBeenCalledTimes(1);
});

it.each(["ready", "cancel", "account"])(
  "defers detail hosting while preparing and handles %s",
  (outcome) => {
    const h = harness();
    h.publish({ phase: "preparing" });
    const consume = jest.fn();
    const render = (accountId: string) => (
      <TogetherLobbyContainer
        lobby={h.lobby}
        accountId={accountId}
        workoutName="Squats"
        initialHostAudience="open"
        onConsumeHostIntent={consume}
      />
    );
    const r = renderWithTheme(render("me"));
    expect(h.lobby.host).not.toHaveBeenCalled();
    if (outcome === "cancel")
      act(() => mockSheet.mock.calls.at(-1)![0].onClose());
    if (outcome === "account") {
      r.rerender(render("other"));
      r.rerender(render("me"));
    }
    h.publish({ phase: "idle" });
    expect(h.lobby.host).toHaveBeenCalledTimes(outcome === "ready" ? 1 : 0);
  },
);

it.each(["cloud", "local"] as const)(
  "does not auto-host over an existing %s workout checkpoint",
  (transport) => {
    const h = harness();
    const consume = jest.fn();
    const session: WorkoutSession = {
      ...personal(),
      together: {
        sessionId: "owned",
        executionId: "own-execution",
        ...(transport === "cloud" ? { transport: "cloud" as const } : {}),
      },
    };
    renderWithTheme(
      <TogetherLobbyContainer
        lobby={h.lobby}
        accountId="a"
        workoutName="Squats"
        cloud={{} as TogetherCloudPort}
        getWorkout={() => session}
        initialHostAudience="open"
        onConsumeHostIntent={consume}
      />,
    );
    expect(h.lobby.host).not.toHaveBeenCalled();
    expect(consume).toHaveBeenCalledTimes(1);
    expect(session.together?.sessionId).toBe("owned");
    if (transport === "cloud") expect(mockCloud).toHaveBeenCalled();
  },
);

it("background consumes a pending detail host intent before preparation completes", () => {
  let lifecycle!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, callback) => {
    lifecycle = callback;
    return { remove: jest.fn() };
  });
  const h = harness();
  h.publish({ phase: "preparing" });
  const consume = jest.fn();
  renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="a"
      workoutName="Squats"
      initialHostAudience="open"
      onConsumeHostIntent={consume}
    />,
  );
  act(() => lifecycle("background"));
  expect(consume).toHaveBeenCalledTimes(1);
  h.publish({ phase: "idle" });
  act(() => lifecycle("active"));
  expect(h.lobby.host).not.toHaveBeenCalled();
  expect(mockSheet.mock.calls.at(-1)![0].visible).toBe(false);
});

it("starts online training partners only after explicit connection selection", async () => {
  const h = sharingHarness(),
    cloud = {} as TogetherCloudPort;
  const r = mountShared(h, { cloud });
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByRole("radio", { name: "Partners" }));
  fireEvent.press(r.getByText("Online · internet required"));
  fireEvent.press(r.getByText("Start the session"));
  await waitFor(() =>
    expect(mockCloud).toHaveBeenCalledWith(
      expect.objectContaining({ cloud, initialHost: "friends" }),
    ),
  );
  expect(h.lobby.host).not.toHaveBeenCalled();
});

it("routes a training-partners detail intent independently of local credential preparation", async () => {
  const h = sharingHarness(),
    cloud = {} as TogetherCloudPort;
  h.publish({ phase: "preparing" });
  const consume = jest.fn();
  mountShared(h, {
    cloud,
    initialHostAudience: "friends",
    initialHostConnection: "online",
    onConsumeHostIntent: consume,
  });
  await waitFor(() =>
    expect(mockCloud).toHaveBeenCalledWith(
      expect.objectContaining({ cloud, initialHost: "friends" }),
    ),
  );
  expect(consume).toHaveBeenCalledTimes(1);
  expect(h.lobby.host).not.toHaveBeenCalled();
});

it("hosts partners locally by default without contacting cloud", async () => {
  const h = sharingHarness();
  const r = mountShared(h, { cloud: {} as TogetherCloudPort });
  fireEvent.press(r.getByText("Start"));
  fireEvent.press(r.getByRole("radio", { name: "Partners" }));
  fireEvent.press(r.getByText("Start the session"));
  // The open workout's plan and start ride in the advert (PER-60).
  expect(h.lobby.host).toHaveBeenCalledWith("Mine", "friends", {
    startedAt: expect.any(Number),
    plan: [{ name: "Squat", sets: 1, reps: null }],
  });
  expect(mockCloud).not.toHaveBeenCalled();
});
it("waits for credentials then hosts local partner detail intent", () => {
  const h = sharingHarness();
  h.publish({ phase: "preparing" });
  const consume = jest.fn();
  mountShared(h, {
    initialHostAudience: "friends",
    onConsumeHostIntent: consume,
  });
  expect(h.lobby.host).not.toHaveBeenCalled();
  h.publish({ phase: "idle" });
  expect(h.lobby.host).toHaveBeenCalledWith(
    "Mine",
    "friends",
    expect.objectContaining({ plan: [{ name: "Squat", sets: 1, reps: null }] }),
  );
  expect(consume).toHaveBeenCalledTimes(1);
  expect(mockCloud).not.toHaveBeenCalled();
});

it("starts and promotes the detail workout before showing the actual invitation, and Back preserves it", async () => {
  const h = sharingHarness();
  jest.mocked(h.workout.getPlan).mockReturnValue(plan);
  jest.mocked(h.lobby.host).mockImplementation(async () => {
    h.publish({
      phase: "hosting",
      role: "host",
      audience: "invite-only",
      invitation: "signed-real-payload",
    });
  });
  const share = jest
    .spyOn(Share, "share")
    .mockResolvedValue({ action: "sharedAction" });
  const r = mountShared(h, { initialHostAudience: "invite-only" });
  await waitFor(() => expect(r.getByText("Invite people")).toBeTruthy());
  expect(h.workout.promote).toHaveBeenCalledWith(
    expect.objectContaining({ id: "local", userId: "a" }),
  );
  expect(h.shared.publishPlan).toHaveBeenCalledWith(plan);
  expect(mockSheet.mock.calls.at(-1)![0].title).toBeUndefined();
  expect(r.UNSAFE_getByType("QRCode" as never).props.value).toBe(
    "persistencemobile://together/join?connection=local&invitation=signed-real-payload&transport=lan",
  );
  expect(
    r.getByText("Nearby · no internet needed · only people with this QR"),
  ).toBeTruthy();
  fireEvent.press(r.getByText("Share code"));
  expect(share).toHaveBeenCalledWith({
    url: "persistencemobile://together/join?connection=local&invitation=signed-real-payload&transport=lan",
  });
  fireEvent.press(r.getByLabelText("Close"));
  expect(mockSheet.mock.calls.at(-1)![0].visible).toBe(false);
  expect(h.lobby.cancel).not.toHaveBeenCalled();
  // The strip: Invite reopens the invitation, the cog opens settings.
  h.update("active");
  h.publish({ members: [{ userId: "a", host: true }] });
  const row = () => r.UNSAFE_getByType(TogetherWorkoutRow).props;
  expect(row().status).toBe("Waiting for people · 1 of 4");
  act(() => row().onInvite());
  expect(r.getByText("Invite people")).toBeTruthy();
  act(() => row().onSettings());
  expect(mockSheet.mock.calls.at(-1)![0].title).toBe("Together settings");
  expect(r.getByText("Show session invitation")).toBeTruthy();
  share.mockRestore();
});

it.each(["hosting-fails", "promotion-fails", "cancelled"])(
  "does not claim a live shared session when %s",
  async (outcome) => {
    const h = sharingHarness();
    let release!: () => void;
    jest.mocked(h.lobby.host).mockImplementation(async () => {
      if (outcome === "cancelled")
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      h.publish({
        phase: outcome === "hosting-fails" ? "unavailable" : "hosting",
        role: "host",
        invitation: "signed",
        error: outcome === "hosting-fails" ? "network" : undefined,
      });
    });
    if (outcome === "promotion-fails")
      jest
        .mocked(h.workout.promote)
        .mockRejectedValue(new Error("workout-unsupported"));
    const r = mountShared(h, { initialHostAudience: "invite-only" });
    if (outcome === "cancelled") {
      act(() => mockSheet.mock.calls.at(-1)![0].onClose());
      await act(async () => release());
    } else await act(async () => {});
    expect(r.queryByText("Invite people")).toBeNull();
    if (outcome === "cancelled")
      expect(mockSheet.mock.calls.at(-1)![0].visible).toBe(false);
    else expect(mockSheet.mock.calls.at(-1)![0].title).toBe("Train together");
    if (outcome !== "promotion-fails")
      expect(h.workout.promote).not.toHaveBeenCalled();
  },
);

it("retries failed host plan publication after promotion without hosting or promoting twice", async () => {
  const h = sharingHarness();
  jest.mocked(h.workout.getPlan).mockReturnValue(plan);
  jest.mocked(h.lobby.host).mockImplementation(async () => {
    h.publish({ phase: "hosting", role: "host", invitation: "signed" });
  });
  jest.mocked(h.workout.promote).mockImplementation(async () => {
    h.update("active");
  });
  jest.mocked(h.shared.publishPlan).mockRejectedValueOnce(new Error("network"));
  const r = mountShared(h, { initialHostAudience: "invite-only" });
  await waitFor(() =>
    expect(r.getByText("Retry sharing my workout")).toBeTruthy(),
  );
  expect(r.queryByText("Invite people")).toBeNull();
  fireEvent.press(r.getByText("Retry sharing my workout"));
  await waitFor(() => expect(r.getByText("Invite people")).toBeTruthy());
  expect(h.lobby.host).toHaveBeenCalledTimes(1);
  expect(h.workout.promote).toHaveBeenCalledTimes(1);
  expect(h.shared.publishPlan).toHaveBeenCalledTimes(2);
});

it.each(["existing-authority", "wrong-account"])(
  "refuses to replace %s before starting a local host",
  async (reason) => {
    const h = sharingHarness();
    const draft = personal();
    if (reason === "existing-authority")
      draft.together = { sessionId: "kept", executionId: "own" };
    else draft.userId = "other";
    const r = mountShared(h, { getWorkout: () => draft });
    fireEvent.press(r.getByText("Start"));
    fireEvent.press(r.getByText("Start the session"));
    await r.findByText(/Could not finish preparing Together/);
    expect(h.lobby.host).not.toHaveBeenCalled();
    expect(h.workout.promote).not.toHaveBeenCalled();
  },
);

it("does not expose new sharing or consume a host action when entry access is denied", () => {
  const h = harness();
  const r = renderWithTheme(
    <TogetherLobbyContainer
      lobby={h.lobby}
      accountId="me"
      workoutName="My workout"
      allowNewSharing={false}
      initialHostAudience="invite-only"
    >
      {(row) => <View testID="personal-workout">{row}</View>}
    </TogetherLobbyContainer>,
  );
  expect(r.getByTestId("personal-workout")).toBeTruthy();
  expect(r.queryByTestId("together-workout-row")).toBeNull();
  expect(r.queryByText("Start the session")).toBeNull();
  expect(h.lobby.host).not.toHaveBeenCalled();
  expect(h.lobby.browse).not.toHaveBeenCalled();
});

it("keeps one startup screen across host cleanup, credentials and workout promotion", async () => {
  const h = sharingHarness();
  let finishHost!: () => void;
  let finishPromotion!: () => void;
  jest.mocked(h.lobby.host).mockImplementation(async () => {
    await new Promise<void>((resolve) => {
      finishHost = resolve;
    });
  });
  jest.mocked(h.workout.promote).mockReturnValue(
    new Promise<void>((resolve) => {
      finishPromotion = resolve;
    }),
  );
  jest.mocked(h.workout.getPlan).mockReturnValue(plan);
  const r = mountShared(h, { initialHostAudience: "invite-only" });
  expect(r.getByTestId("together-starting")).toBeTruthy();
  expect(r.queryByText("Start the session")).toBeNull();
  h.publish({ phase: "preparing" });
  expect(mockSheet.mock.calls.at(-1)![0].title).toBe("Starting Together");
  h.publish({ phase: "hosting", role: "host", invitation: "signed" });
  await act(async () => finishHost());
  await waitFor(() => expect(h.workout.promote).toHaveBeenCalledTimes(1));
  expect(mockSheet.mock.calls.at(-1)![0].title).toBe("Starting Together");
  expect(r.queryByText("Use my workout in Together")).toBeNull();
  expect(r.queryByText("Invite people")).toBeNull();
  await act(async () => finishPromotion());
  await waitFor(() => expect(r.getByText("Invite people")).toBeTruthy());
  expect(h.lobby.host).toHaveBeenCalledTimes(1);
});

it.each(["button", "swipe"])(
  "cancels native startup through %s without reopening when hosting settles",
  async (mode) => {
    const h = sharingHarness();
    let finishHost!: () => void;
    jest.mocked(h.lobby.host).mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finishHost = resolve;
      });
    });
    const consume = jest.fn();
    const r = mountShared(h, {
      initialHostAudience: "invite-only",
      onConsumeHostIntent: consume,
    });
    h.publish({ phase: "preparing" });
    if (mode === "button")
      fireEvent.press(r.getByText("Cancel · keep my workout"));
    else act(() => mockSheet.mock.calls.at(-1)![0].onClose());
    await waitFor(() => expect(h.lobby.cancel).toHaveBeenCalledTimes(1));
    h.publish({ phase: "hosting", role: "host", invitation: "signed" });
    await act(async () => finishHost());
    expect(mockSheet.mock.calls.at(-1)![0].visible).toBe(false);
    expect(h.workout.promote).not.toHaveBeenCalled();
    expect(h.lobby.host).toHaveBeenCalledTimes(1);
  },
);

it("leaves startup honestly when credential preparation becomes unavailable", () => {
  const h = sharingHarness();
  h.publish({ phase: "preparing" });
  const r = mountShared(h, { initialHostAudience: "invite-only" });
  expect(r.getByTestId("together-starting")).toBeTruthy();
  h.publish({ phase: "unavailable", error: "expired" });
  expect(r.queryByTestId("together-starting")).toBeNull();
  expect(mockSheet.mock.calls.at(-1)![0].title).toBe("Train together");
  expect(h.lobby.host).not.toHaveBeenCalled();
});

it("preserves permission interruption during hosting until the workout and plan are published", async () => {
  let lifecycle!: (state: AppStateStatus) => void;
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, callback) => {
    lifecycle = callback;
    return { remove: jest.fn() };
  });
  const h = sharingHarness();
  let finishHost!: () => void;
  jest.mocked(h.lobby.host).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finishHost = resolve;
      }),
  );
  jest.mocked(h.workout.getPlan).mockReturnValue(plan);
  const r = mountShared(h, { initialHostAudience: "invite-only" });
  h.publish({ phase: "preparing" });
  act(() => lifecycle("inactive"));
  act(() => lifecycle("active"));
  h.publish({ phase: "hosting", role: "host", invitation: "signed" });
  await act(async () => finishHost());
  await waitFor(() => expect(h.workout.promote).toHaveBeenCalledTimes(1));
  expect(h.shared.publishPlan).toHaveBeenCalledWith(plan);
  expect(r.getByText("Invite people")).toBeTruthy();
});

it("applies the stored sharing defaults once to each person who joins a local session (PER-60)", async () => {
  const h = sharingHarness();
  const r = mountShared(h);
  // Mounting rehydrates the store for the account; the defaults under test go in after.
  await act(async () => {});
  useTogetherSettings.setState({
    userId: "a",
    hydrated: true,
    sharing: { numbers: false, previous: true, logging: true },
  });
  h.publish({
    phase: "hosting",
    role: "host",
    members: [{ userId: "a", host: true }],
  });
  expect(h.shared.setConsent).not.toHaveBeenCalled();
  h.publish({
    members: [
      { userId: "a", host: true },
      { userId: "other", host: false },
    ],
  });
  await act(async () => {});
  expect(h.shared.setConsent).toHaveBeenCalledTimes(1);
  expect(h.shared.setConsent).toHaveBeenCalledWith("other", {
    numbers: false,
    prev: true,
    logging: true,
  });
  // The same member again, or one already granted by hand, is left alone.
  h.publish({
    members: [
      { userId: "a", host: true },
      { userId: "other", host: false },
    ],
  });
  await act(async () => {});
  expect(h.shared.setConsent).toHaveBeenCalledTimes(1);
  h.setShared({
    grants: [
      {
        ownerId: "a",
        recipientId: "third",
        version: 1,
        consent: { numbers: false, prev: false, logging: false },
      },
    ],
  });
  h.publish({
    members: [
      { userId: "a", host: true },
      { userId: "other", host: false },
      { userId: "third", host: false },
    ],
  });
  await act(async () => {});
  expect(h.shared.setConsent).toHaveBeenCalledTimes(1);
  r.unmount();
  useTogetherSettings.getState().reset();
});
it("sharing defaults that share nothing grant nothing (PER-60)", async () => {
  const h = sharingHarness();
  const r = mountShared(h);
  await act(async () => {});
  useTogetherSettings.setState({
    userId: "a",
    hydrated: true,
    sharing: { numbers: false, previous: false, logging: false },
  });
  h.publish({
    phase: "joined",
    role: "guest",
    members: [
      { userId: "host", host: true },
      { userId: "a", host: false },
    ],
  });
  await act(async () => {});
  expect(h.shared.setConsent).not.toHaveBeenCalled();
  r.unmount();
  useTogetherSettings.getState().reset();
});

it("a guest landing already joined grants nothing until the settings are read (inspector lead 2)", async () => {
  // A previous test's still-mounted container may have started a real
  // rehydrate for "a"; its completion is ignored once the account is cleared.
  useTogetherSettings.getState().reset();
  useTogetherSettings.setState({ rehydrate: jest.fn(async () => {}) });
  const h = sharingHarness();
  h.publish({
    phase: "joined",
    role: "guest",
    members: [
      { userId: "host", host: true },
      { userId: "a", host: false },
    ],
  });
  mountShared(h);
  await act(async () => {});
  expect(h.shared.setConsent).not.toHaveBeenCalled();
  act(() =>
    useTogetherSettings.setState({
      userId: "a",
      hydrated: true,
      sharing: { numbers: false, previous: true, logging: false },
    }),
  );
  await act(async () => {});
  expect(h.shared.setConsent).toHaveBeenCalledTimes(1);
  expect(h.shared.setConsent).toHaveBeenCalledWith("host", {
    numbers: false,
    prev: true,
    logging: false,
  });
  useTogetherSettings.getState().reset();
});

it("the solo strip counts completed sets, not the empty planned rows (inspector lead)", () => {
  const set = (isCompleted: boolean) =>
    ({
      id: "s",
      isCompleted,
    }) as unknown as WorkoutSession["exercises"][number]["sets"][number];
  const workout = (sets: boolean[][]) =>
    ({
      exercises: sets.map((rows) => ({ sets: rows.map(set) })),
    }) as unknown as WorkoutSession;
  // Push A, 2 × 3 planned and nothing logged yet.
  expect(
    startRowDetail(
      workout([
        [false, false, false],
        [false, false, false],
      ]),
    ),
  ).toBe("your sets stay yours");
  expect(
    startRowDetail(
      workout([
        [true, false, false],
        [false, false, false],
      ]),
    ),
  ).toBe("keeps your 1 logged set");
  expect(
    startRowDetail(
      workout([
        [true, true, false],
        [true, false, false],
      ]),
    ),
  ).toBe("keeps your 3 logged sets");
  expect(startRowDetail(null)).toBe("your sets stay yours");
});

const doneSet = (id: string) => ({
  id,
  sessionExerciseId: "squat-slot",
  setNumber: 1,
  weightKg: 60,
  reps: 8,
  rpe: null,
  durationSeconds: null,
  distanceMeters: null,
  isCompleted: true,
  completedAt: null,
});
const withSets = (n: number): WorkoutSession => {
  const w = personal();
  return {
    ...w,
    exercises: [
      {
        ...w.exercises[0]!,
        sets: Array.from({ length: n }, (_, i) => doneSet(`d${i}`)),
      },
    ],
  };
};
const leaveRow = (r: ReturnType<typeof renderWithTheme>) =>
  r.UNSAFE_getByType(TogetherWorkoutRow).props;

describe("leaving and ending (canvas row 3)", () => {
  it("a guest's Leave is one sentence and two buttons, then an ordinary solo workout with a toast", async () => {
    const h = sharingHarness();
    h.setShared({ profiles: { host: "Brad", other: "Mia" } });
    const r = mountShared(h, { getWorkout: () => withSets(6) });
    h.publish({
      phase: "joined",
      role: "guest",
      sessionId: "s1",
      members: [
        { userId: "host", host: true },
        { userId: "a", host: false },
        { userId: "other", host: false },
      ],
    });
    h.update("active");
    act(() => leaveRow(r).onEnd());
    expect(r.getByText("Leave Brad’s session?")).toBeTruthy();
    expect(
      r.getByText(
        "Your workout carries on here with your 6 logged sets. Brad and Mia keep training.",
      ),
    ).toBeTruthy();
    expect(r.queryByTestId("together-leave-unsent")).toBeNull();
    // Stay keeps the session; nothing is sent.
    fireEvent.press(r.getByTestId("together-leave-stay"));
    expect(r.queryByText("Leave Brad’s session?")).toBeNull();
    expect(h.shared.close).not.toHaveBeenCalled();
    act(() => leaveRow(r).onEnd());
    await act(async () =>
      fireEvent.press(r.getByTestId("together-leave-confirm")),
    );
    expect(h.shared.close).toHaveBeenCalledWith("leave");
    expect(h.lobby.cancel).toHaveBeenCalled();
    expect(
      r.getByText("You left Brad’s session. Your 6 sets are here."),
    ).toBeTruthy();
    // The workout is no longer shared: no strip, no "Sharing ended" row.
    h.update("local-only");
    expect(r.UNSAFE_queryByType(TogetherWorkoutRow)).toBeNull();
    expect(r.queryByText(/My workout ·/)).toBeNull();
    expect(r.getByTestId("together-toast")).toBeTruthy();
  });

  it("the host's End lets everyone carry on solo", async () => {
    const h = sharingHarness();
    const r = mountShared(h, { getWorkout: () => withSets(1) });
    h.publish({
      phase: "hosting",
      role: "host",
      sessionId: "s1",
      members: [
        { userId: "a", host: true },
        { userId: "other", host: false },
      ],
    });
    h.update("active");
    expect(leaveRow(r).endLabel).toBe("End");
    act(() => leaveRow(r).onEnd());
    expect(r.getByText("End the live session?")).toBeTruthy();
    expect(
      r.getByText(
        "Everyone keeps their own workout and carries on solo. Nobody new can join.",
      ),
    ).toBeTruthy();
    expect(r.getByText("Keep it live")).toBeTruthy();
    await act(async () => fireEvent.press(r.getByText("End session")));
    expect(h.shared.close).toHaveBeenCalledWith("save_own");
    expect(h.lobby.cancel).toHaveBeenCalled();
    expect(
      r.getByText("Live session ended. Your workout carries on."),
    ).toBeTruthy();
  });

  it("a failed leave keeps the workout and says so", async () => {
    const h = sharingHarness();
    jest.mocked(h.shared.close).mockRejectedValueOnce(new Error("offline"));
    const r = mountShared(h, { getWorkout: () => withSets(0) });
    h.publish({
      phase: "joined",
      role: "guest",
      sessionId: "s1",
      members: [
        { userId: "other", host: true },
        { userId: "a", host: false },
      ],
    });
    h.update("active");
    act(() => leaveRow(r).onEnd());
    expect(
      r.getByText("Your workout carries on here. Mia keeps training."),
    ).toBeTruthy();
    await act(async () =>
      fireEvent.press(r.getByTestId("together-leave-confirm")),
    );
    expect(h.lobby.cancel).not.toHaveBeenCalled();
    expect(
      r.getByText(
        "Could not leave the session. Your workout is safe. Try again.",
      ),
    ).toBeTruthy();
  });

  it("a partner hears once when the host ends the session, but not for an old closure", () => {
    const h = sharingHarness();
    h.setShared({
      profiles: { other: "Brad" },
      closures: [{ userId: "gone", mode: "leave" }],
    });
    const r = mountShared(h);
    h.publish({
      phase: "joined",
      role: "guest",
      sessionId: "s1",
      members: [
        { userId: "other", host: true },
        { userId: "a", host: false },
      ],
    });
    h.update("active");
    expect(r.queryByTestId("together-toast")).toBeNull();
    // Another guest leaving is not the host ending.
    act(() =>
      h.setShared({
        closures: [
          { userId: "gone", mode: "leave" },
          { userId: "c", mode: "leave" },
        ],
      }),
    );
    expect(r.queryByTestId("together-toast")).toBeNull();
    act(() =>
      h.setShared({
        closures: [
          { userId: "gone", mode: "leave" },
          { userId: "c", mode: "leave" },
          { userId: "other", mode: "save_own" },
        ],
      }),
    );
    expect(
      r.getByText("Brad ended the live session. Your workout carries on."),
    ).toBeTruthy();
    h.update("local-only");
    expect(r.UNSAFE_queryByType(TogetherWorkoutRow)).toBeNull();
  });

  it("a recovering workout keeps its row so its review stays reachable", () => {
    const h = workoutHarness();
    const r = renderWithTheme(
      <TogetherLobbyContainer
        lobby={h.lobby}
        workoutName="Squats"
        accountId="a"
        localSessionId="local"
        getWorkout={() => personal()}
      />,
    );
    h.update("local-only");
    jest.mocked(h.workout.status).mockReturnValue({
      sessionId: "s",
      executionId: "e",
      localSessionId: "local",
      sharing: "local-only",
      receivedCount: 0,
      pendingCount: 0,
      recovery: "review",
    });
    h.publish({});
    expect(r.getByText(/My workout · Sharing ended/)).toBeTruthy();
  });

  it("warns about sets still on their way to a partner", async () => {
    const h = sharingHarness();
    h.setShared({
      athletePlans: {
        other: {
          name: "Lower Body B",
          exercises: [
            {
              planExerciseId: "slot",
              exerciseId: "squat",
              order: 0,
              targetSets: 2,
            },
          ],
        },
      },
      athletes: [
        {
          userId: "other",
          revision: 4,
          restEndsAt: null,
          exercises: {
            slot: {
              exerciseId: "squat",
              skipped: false,
              sets: [{ setId: "s1", reps: 8, weightKg: 60, completed: true }],
            },
          },
        },
      ],
      grants: [
        {
          ownerId: "other",
          recipientId: "a",
          version: 1,
          consent: { numbers: true, prev: true, logging: true },
        },
      ],
    });
    // The set never lands.
    jest
      .mocked(h.shared.requestDelegatedSet)
      .mockImplementation(() => new Promise<void>(() => {}));
    const r = mountShared(h, {
      exerciseNames: { squat: "Squat" },
      children: (row, partnerView) => (
        <>
          {row}
          {partnerView}
        </>
      ),
    });
    h.publish({
      phase: "joined",
      role: "guest",
      sessionId: "s1",
      members: [
        { userId: "a", host: false },
        { userId: "other", host: true },
      ],
    });
    h.update("active");
    fireEvent.press(r.getByLabelText("Show Mia’s workout"));
    const reps = r.getAllByTestId("set-logger-reps");
    fireEvent.changeText(reps[0]!, "9");
    fireEvent(reps[0]!, "blur");
    await waitFor(() =>
      expect(h.shared.requestDelegatedSet).toHaveBeenCalled(),
    );
    act(() => leaveRow(r).onEnd());
    expect(
      r.getByText(
        "1 set hasn’t reached Mia yet. If you leave now, it won’t be sent.",
      ),
    ).toBeTruthy();
  });
});
