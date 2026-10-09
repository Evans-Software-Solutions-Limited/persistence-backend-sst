import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { TogetherCloudController } from "../../../adapters/together/cloudSession";
import { fail } from "@/shared/errors/result";
import React from "react";
import QRCode from "react-native-qrcode-svg";
import { Alert, AppState, Share } from "react-native";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  TogetherCloudContainer,
  cloudSharedView,
} from "../TogetherCloudContainer";
import { TogetherCloudPresenter } from "../../presenters/TogetherCloudPresenter";
import { TogetherPartnerPresenter } from "../../presenters/TogetherPartnerPresenter";
import { TogetherSharingPresenter } from "../../presenters/TogetherSharingPresenter";
import type {
  TogetherCloudApi,
  TogetherCloudPort,
  TogetherCloudState,
  CloudSnapshot,
} from "@/domain/ports/togetherCloud.port";
import type { WorkoutSession } from "@/domain/models/session";
const mockCameraPermission = jest.fn();
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [null, mockCameraPermission],
  CameraView: "CameraView",
}));
jest.mock("react-native-qrcode-svg", () => "QRCode");
const mockPush = jest.fn(),
  mockCopy = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock("expo-clipboard", () => ({
  setStringAsync: (...args: unknown[]) => mockCopy(...args),
}));
jest.mock("expo-crypto", () => ({ randomUUID: () => "uuid" }));
jest.mock("@/ui/components/foundation/BottomSheet", () => ({
  BottomSheet: (p: {
    visible: boolean;
    children: React.ReactNode;
    footer?: React.ReactNode;
  }) =>
    p.visible ? (
      <>
        {p.children}
        {p.footer}
      </>
    ) : null,
}));
const server: CloudSnapshot = {
  sessionId: "s",
  state: "active",
  sharingActive: true,
  continuation: null,
  hostId: "u",
  revision: 1,
  planVersion: 1,
  plan: {
    name: "Push",
    exercises: [
      { planExerciseId: "slot", exerciseId: "ex", order: 0, targetSets: 2 },
    ],
  },
  completion: {
    status: "active",
    historyId: null,
    ownRevision: 1,
    recoveryMayBePending: false,
  },
  participants: [
    {
      userId: "u",
      status: "active",
      ownRevision: 1,
      delegationGeneration: 1,
      allowPartnerLogging: false,
      execution: { exercises: [] },
      numbersAvailable: true,
      previousValuesAvailable: true,
      numbersConsent: { version: 0, recipientIds: [] },
      previousConsent: { version: 0, recipientIds: [] },
      exerciseCatalog: {},
    },
    {
      userId: "v",
      status: "active",
      ownRevision: 3,
      delegationGeneration: 2,
      allowPartnerLogging: true,
      execution: {
        exercises: [
          {
            planExerciseId: "slot",
            skipped: false,
            sets: [{ setId: "set", reps: 8, weightKg: 60, completed: true }],
          },
        ],
      },
      numbersAvailable: true,
      previousValuesAvailable: true,
      exerciseCatalog: {
        ex: { name: "Squat", category: "strength", primaryMuscles: [] },
      },
    },
  ],
};
function setup(active = false) {
  let state: TogetherCloudState = {
    phase: active ? "active" : "idle",
    requests: [],
    previous: {},
    pendingCount: 0,
    ...(active ? { snapshot: structuredClone(server) } : {}),
  };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<TogetherCloudState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const cloud = {
    getSnapshot: () => state,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    hostWorkout: jest.fn(async () => {}),
    join: jest.fn(async () => {}),
    resume: jest.fn(async () => {}),
    cancel: jest.fn(),
    cancelJoin: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
    detachDraft: jest.fn(),
    retry: jest.fn(async () => {}),
    invite: jest.fn(async () => ({
      tokenId: "token-id",
      token: "invite",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    })),
    revokeInvite: jest.fn(async () => {}),
    friends: jest.fn(async () => ({
      ok: true,
      value: {
        data: [
          {
            sessionId: "friend-session",
            host: { userId: "friend", displayName: "Mia", avatarUrl: null },
            occupancy: 2,
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
          },
        ],
        nextCursor: null,
      },
    })),
    decide: jest.fn(async () => {}),
    previous: jest.fn(async () => {}),
    command: jest.fn(async () => {}),
    numbersConsent: jest.fn(async () => {}),
    previousConsent: jest.fn(async () => {}),
    delegation: jest.fn(async () => {}),
    visibility: jest.fn(async () => {}),
  } as unknown as TogetherCloudPort;
  const draft: WorkoutSession = {
    id: "local",
    userId: "u",
    name: "Push",
    workoutId: null,
    status: "in_progress",
    startedAt: "2026-10-05T10:00:00Z",
    completedAt: null,
    notes: null,
    exercises: [],
  };
  const props = {
    cloud,
    accountId: "u",
    workoutName: "Push",
    getWorkout: () => draft,
    onLocal: jest.fn(),
  };
  return { cloud, publish, props, state: () => state, draft };
}
const ui = (r: ReturnType<typeof renderWithTheme>) =>
  r.UNSAFE_getByType(TogetherCloudPresenter).props as React.ComponentProps<
    typeof TogetherCloudPresenter
  >;
beforeEach(() => {
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation(() => ({ remove: jest.fn() }));
  mockPush.mockReset();
  mockCopy.mockReset().mockResolvedValue(undefined);
});
it("hosts only current personal draft; friend listing and invitation joins remain deliberate", async () => {
  const h = setup();
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Start remote session"));
  await waitFor(() =>
    expect(h.cloud.hostWorkout).toHaveBeenCalledWith(h.draft),
  );
  await act(async () => {});
  fireEvent.press(r.getByText("Find training partners’ sessions"));
  await waitFor(() => expect(r.getByText("Join Mia")).toBeTruthy());
  expect(h.cloud.join).not.toHaveBeenCalled();
  fireEvent.press(r.getByText("Join Mia"));
  await waitFor(() =>
    expect(h.cloud.join).toHaveBeenCalledWith(
      { sessionId: "friend-session" },
      h.draft,
    ),
  );
  await act(async () => {});
  fireEvent.changeText(r.getByLabelText("Remote invitation"), " signed ");
  fireEvent.press(r.getByText("Join deliberately"));
  await waitFor(() =>
    expect(h.cloud.join).toHaveBeenCalledWith(
      { inviteToken: "signed" },
      h.draft,
    ),
  );
});
it("wires host invitations, explicit approvals, scoped grants and reviewed closure", async () => {
  const h = setup(true);
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("Together settings"));
  await act(async () => ui(r).onInvite());
  expect(mockCopy).toHaveBeenCalledWith(
    "persistencemobile://together/join?connection=online&invitation=invite",
  );
  await act(async () => ui(r).onRevoke());
  expect(h.cloud.revokeInvite).toHaveBeenCalledWith("token-id");
  await act(async () => ui(r).onDecision("request", true));
  expect(h.cloud.decide).toHaveBeenCalledWith("request", "approve");
  await act(async () => ui(r).onDecision("request", false));
  expect(h.cloud.decide).toHaveBeenCalledWith("request", "reject");
  const settings = () =>
    r.UNSAFE_getByType(TogetherSharingPresenter).props as React.ComponentProps<
      typeof TogetherSharingPresenter
    >;
  await act(async () =>
    settings().onConsent("v", { numbers: true, prev: true, logging: true }),
  );
  expect(h.cloud.numbersConsent).toHaveBeenCalledWith(["v"]);
  expect(h.cloud.previousConsent).toHaveBeenCalledWith(["v"]);
  expect(h.cloud.delegation).toHaveBeenCalledWith(true);
  await act(async () => settings().onSessionLogging!(false));
  expect(h.cloud.delegation).toHaveBeenLastCalledWith(false);
  await act(async () => ui(r).onVisible());
  expect(h.cloud.visibility).toHaveBeenCalledWith(
    "friends",
    expect.any(String),
  );
  act(() => settings().onClose("finish_all"));
  expect(mockPush).toHaveBeenCalledWith({
    pathname: "/(app)/session/rate",
    params: { localSessionId: "local", mode: "finish_all" },
  });
});
it("does not apply a late friend lookup or chained consent to another account", async () => {
  const h = setup();
  let resolve!: (x: Awaited<ReturnType<TogetherCloudPort["friends"]>>) => void;
  jest.mocked(h.cloud.friends).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Find training partners’ sessions"));
  await act(async () => {});
  r.rerender(<TogetherCloudContainer {...h.props} accountId="other" />);
  await act(async () =>
    resolve({
      ok: true,
      value: {
        data: [
          {
            sessionId: "old",
            host: {
              userId: "old",
              displayName: "Old private friend",
              avatarUrl: null,
            },
            occupancy: 2,
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
          },
        ],
        nextCursor: null,
      },
    }),
  );
  expect(r.queryByText(/Old private friend/)).toBeNull();
});
it("keeps partner values scoped and hides all private state while reconnecting", () => {
  const h = setup(true);
  const active = {
    ...h.state(),
    previous: {
      v: {
        sessionId: "s",
        ownerId: "v",
        consentVersion: 1,
        revision: 1,
        planVersion: 1,
        ownRevision: 3,
        values: [
          {
            exerciseId: "ex",
            setNumber: 1,
            reps: 5,
            weightKg: 40,
            recordedAt: "2026-01-01",
          },
          {},
        ],
      },
    },
  };
  const shown = cloudSharedView(active, "u");
  expect(shown.athletes[0].exercises.slot.sets[0].weightKg).toBe(60);
  expect(shown.previous.v).toHaveLength(1);
  const hidden = cloudSharedView({ ...active, phase: "reconnecting" }, "u");
  expect(hidden.athletes).toEqual([]);
  expect(hidden.previous).toEqual({});
  const revoked = cloudSharedView(
    {
      ...active,
      snapshot: {
        ...server,
        participants: server.participants.map((p) => ({
          ...p,
          numbersAvailable: false,
          previousValuesAvailable: false,
        })),
      },
    },
    "u",
  );
  expect(revoked.athletes).toEqual([]);
  expect(revoked.previous).toEqual({});
});

it("selects partner views and sends edits against the revision actually displayed", async () => {
  const h = setup(true);
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("View Athlete 2’s workout"));
  await act(async () => {});
  expect(h.cloud.previous).toHaveBeenCalledWith("v");
  const partner = r.UNSAFE_getByType(TogetherPartnerPresenter);
  await act(async () =>
    partner.props.onOperation({ type: "rest", restEndsAt: null }, 3),
  );
  expect(h.cloud.command).toHaveBeenCalledWith({
    target: { kind: "execution", athleteId: "v" },
    expectedVersion: 3,
    delegationGeneration: 2,
    operation: { type: "rest", restEndsAt: null },
  });
  act(() => h.publish({ phase: "reconnecting" }));
  expect(r.queryByTestId("set-logger-reps")).toBeNull();
  fireEvent.press(r.getByText("Mine"));
  expect(r.queryByTestId("together-partner-view")).toBeNull();
});
it("surfaces command errors and wires retry, cancel, partner navigation and local choice", async () => {
  const h = setup();
  jest.mocked(h.cloud.hostWorkout).mockRejectedValue(new Error("subscription"));
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Start remote session"));
  await waitFor(() => expect(r.getByText(/Could not complete/)).toBeTruthy());
  await act(async () => ui(r).onRetry());
  expect(h.cloud.retry).toHaveBeenCalledTimes(1);
  act(() => ui(r).onLocal());
  expect(h.cloud.cancel).toHaveBeenCalledTimes(1);
  expect(h.props.onLocal).toHaveBeenCalledTimes(1);
  act(() => ui(r).onCancel());
  fireEvent.press(r.getByText("Open"));
  act(() => ui(r).onPartners());
  expect(mockPush).toHaveBeenCalledWith("/(app)/together/partners");
});
it("does not chain a PREV grant after the account changes during numeric consent", async () => {
  const h = setup(true);
  let resolve!: () => void;
  jest.mocked(h.cloud.numbersConsent).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("Together settings"));
  const settings = r.UNSAFE_getByType(TogetherSharingPresenter)
    .props as React.ComponentProps<typeof TogetherSharingPresenter>;
  act(() =>
    settings.onConsent("v", { numbers: true, prev: true, logging: true }),
  );
  await act(async () => {});
  r.rerender(<TogetherCloudContainer {...h.props} accountId="other" />);
  await act(async () => resolve());
  expect(h.cloud.previousConsent).not.toHaveBeenCalled();
  expect(h.cloud.delegation).not.toHaveBeenCalled();
  expect(r.queryByText("Push · 2/4 athletes")).toBeNull();
});
it("ignores stale invitation replies after unmount and resumes only a persisted cloud session", async () => {
  const h = setup(true);
  let resolve!: (v: {
    tokenId: string;
    token: string;
    expiresAt: string;
  }) => void;
  jest.mocked(h.cloud.invite).mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("Together settings"));
  act(() => ui(r).onInvite());
  await act(async () => {});
  r.unmount();
  await act(async () =>
    resolve({
      tokenId: "id",
      token: "private",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    }),
  );
  expect(mockCopy).not.toHaveBeenCalled();
  const pending = setup();
  pending.draft.together = {
    sessionId: "persisted",
    executionId: "own",
    transport: "cloud",
  };
  renderWithTheme(<TogetherCloudContainer {...pending.props} />);
  await waitFor(() => expect(pending.cloud.retry).toHaveBeenCalledTimes(1));
  expect(pending.cloud.join).not.toHaveBeenCalled();
});
it("cancels pending admission at the server and offers only explicit safe personal continuation", async () => {
  const h = setup();
  act(() => h.publish({ phase: "pending-approval" }));
  const restore = jest.fn();
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} onRestorePersonal={restore} />,
  );
  fireEvent.press(r.getByText("Open"));
  act(() => ui(r).onCancel());
  await waitFor(() => expect(h.cloud.cancelJoin).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(h.cloud.cancel).not.toHaveBeenCalled();
  act(() => h.publish({ phase: "unavailable", canDetachDraft: true }));
  jest.mocked(h.cloud.detachDraft).mockImplementation((_, persist) => {
    persist(h.draft);
    return h.draft;
  });
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Continue personally"));
  await waitFor(() => expect(restore).toHaveBeenCalledWith(h.draft));
  expect(h.props.onLocal).toHaveBeenCalledTimes(1);
});
it("does not remove someone after the removal dialog account has changed", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const h = setup(true);
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("Together settings"));
  const settings = r.UNSAFE_getByType(TogetherSharingPresenter)
    .props as React.ComponentProps<typeof TogetherSharingPresenter>;
  act(() => settings.onRemove!("v"));
  const confirm = alert.mock.calls
    .at(-1)![2]!
    .find((b) => b.text === "Remove")!.onPress!;
  r.rerender(<TogetherCloudContainer {...h.props} accountId="new" />);
  await act(async () => confirm());
  expect(h.cloud.remove).not.toHaveBeenCalled();
  r.rerender(<TogetherCloudContainer {...h.props} />);
  act(() => r.UNSAFE_getByType(TogetherSharingPresenter).props.onRemove("v"));
  await act(async () =>
    alert.mock.calls.at(-1)![2]!.find((b) => b.text === "Remove")!.onPress!(),
  );
  expect(h.cloud.remove).toHaveBeenCalledWith("v");
  alert.mockRestore();
});
it("ends from the workout strip through review and clears revoked per-recipient consent", async () => {
  const h = setup(true);
  h.state().snapshot!.participants[0].numbersConsent = {
    version: 1,
    recipientIds: ["v", "another"],
  };
  h.state().snapshot!.participants[0].previousConsent = {
    version: 1,
    recipientIds: ["v"],
  };
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByText("End"));
  expect(mockPush).not.toHaveBeenCalled();
  expect(r.UNSAFE_getByType(TogetherSharingPresenter)).toBeTruthy();
  await act(async () =>
    r
      .UNSAFE_getByType(TogetherSharingPresenter)
      .props.onConsent("v", { numbers: false, prev: false, logging: false }),
  );
  expect(h.cloud.numbersConsent).toHaveBeenCalledWith(["another"]);
  expect(h.cloud.previousConsent).toHaveBeenCalledWith([]);
});
it("renders private progress with no execution or consent objects from older snapshots", () => {
  const minimal = {
    ...server,
    sharingActive: false,
    participants: [
      {
        ...server.participants[0],
        numbersConsent: undefined,
        previousConsent: undefined,
      },
      {
        ...server.participants[1],
        displayName: "Mia",
        execution: {
          exercises: [
            {
              planExerciseId: "slot",
              substituteExerciseId: "alternate",
              skipped: true,
              sets: [],
            },
          ],
          restEndsAt: "2026-10-05T12:00:00Z",
        },
        progress: [{ planExerciseId: "slot", completedSets: 2, skipped: true }],
      },
    ],
  };
  const closed = cloudSharedView(
    {
      phase: "private",
      snapshot: minimal,
      requests: [],
      previous: {},
      pendingCount: 0,
    },
    "u",
  );
  expect(closed.closures).toEqual([{ userId: "u", mode: "leave" }]);
  const active = cloudSharedView(
    {
      phase: "active",
      snapshot: { ...minimal, sharingActive: true },
      requests: [],
      previous: {},
      pendingCount: 0,
    },
    "u",
  );
  expect(active.profiles.v).toBe("Mia");
  expect(active.athletes[0].exercises.slot.exerciseId).toBe("alternate");
  expect(active.progress[0].exercises[0].completedSets).toBe(2);
  expect(active.grants[0].consent.numbers).toBe(false);
  expect(
    cloudSharedView(
      { phase: "idle", requests: [], previous: {}, pendingCount: 0 },
      "u",
    ).athletes,
  ).toEqual([]);
});
it("does not host a disappeared workout, retries once while busy and handles friend failure", async () => {
  const h = setup();
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} getWorkout={() => null} />,
  );
  fireEvent.press(r.getByText("Open"));
  act(() => ui(r).onHost());
  await waitFor(() => expect(r.getByText(/Could not complete/)).toBeTruthy());
  expect(h.cloud.hostWorkout).not.toHaveBeenCalled();
  let reject!: (e: Error) => void;
  jest.mocked(h.cloud.retry).mockReturnValue(
    new Promise((_, r) => {
      reject = r;
    }),
  );
  const controls = ui(r);
  act(() => {
    controls.onRetry();
    controls.onRetry();
  });
  await act(async () => {});
  expect(h.cloud.retry).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("offline")));
  jest.mocked(h.cloud.friends).mockResolvedValue({
    ok: false,
    error: { kind: "api", code: "network", message: "offline" },
  });
  await act(async () => ui(r).onFriends());
  expect(r.getByText(/Could not complete/)).toBeTruthy();
});
it("shows failed persisted reconnection and ignores late error on unmount", async () => {
  const h = setup();
  h.draft.together = {
    sessionId: "persisted",
    executionId: "own",
    transport: "cloud",
  };
  jest.mocked(h.cloud.retry).mockRejectedValue(new Error("offline"));
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByText("Open"));
  await waitFor(() => expect(r.getByText(/Could not reconnect/)).toBeTruthy());
  r.unmount();
});

it("uses guest controls and keeps revoked partner edits and missing join drafts from sending", async () => {
  const h = setup(true);
  const r = renderWithTheme(
    <TogetherCloudContainer
      {...h.props}
      accountId="v"
      getWorkout={() => null}
    />,
  );
  fireEvent.press(r.getByLabelText("Together settings"));
  const settings = r.UNSAFE_getByType(TogetherSharingPresenter).props;
  expect(settings.role).toBe("guest");
  await act(async () =>
    settings.onConsent("u", { numbers: true, prev: true, logging: true }),
  );
  expect(h.cloud.numbersConsent).toHaveBeenCalledWith(["u"]);
  expect(h.cloud.previousConsent).toHaveBeenCalledWith(["u"]);
  fireEvent.press(r.getByLabelText("View Athlete 1’s workout"));
  const partner = r.UNSAFE_getByType(TogetherPartnerPresenter).props;
  await expect(
    partner.onOperation({ type: "rest", restEndsAt: null }, 1),
  ).rejects.toThrow("permission-changed");
  expect(h.cloud.command).not.toHaveBeenCalled();
  await act(async () => ui(r).onJoin());
  expect(h.cloud.join).not.toHaveBeenCalled();
  await act(async () => ui(r).onSelectFriend("missing"));
  expect(h.cloud.join).not.toHaveBeenCalled();
});
it("does not revoke absent invitations or reissue unchanged grants; selects Mine without PREV access", async () => {
  const h = setup(true);
  h.state().snapshot!.participants[0].previousValuesAvailable = false;
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByLabelText("Together settings"));
  await act(async () => ui(r).onRevoke());
  expect(h.cloud.revokeInvite).not.toHaveBeenCalled();
  await act(async () =>
    r
      .UNSAFE_getByType(TogetherSharingPresenter)
      .props.onConsent("v", { numbers: false, prev: false, logging: false }),
  );
  expect(h.cloud.numbersConsent).not.toHaveBeenCalled();
  expect(h.cloud.previousConsent).not.toHaveBeenCalled();
  expect(h.cloud.delegation).not.toHaveBeenCalled();
  fireEvent.press(r.getByLabelText("View Me’s workout"));
  expect(h.cloud.previous).not.toHaveBeenCalled();
  expect(r.queryByTestId("together-partner-view")).toBeNull();
});
it("discards queued actions and errors when the account changes before execution", async () => {
  const h = setup();
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByText("Open"));
  const old = ui(r);
  act(() => {
    old.onRetry();
    r.rerender(<TogetherCloudContainer {...h.props} accountId="other" />);
  });
  await act(async () => {});
  expect(h.cloud.retry).not.toHaveBeenCalled();
  act(() => old.onHost());
  await act(async () => {});
  expect(h.cloud.hostWorkout).not.toHaveBeenCalled();
});

it("restores a personal workout through the real controller after terminal initial admission failure", async () => {
  const h = setup();
  const db = new DatabaseSync(":memory:");
  const controller = new TogetherCloudController({
    api: {
      join: jest.fn(async () =>
        fail({
          kind: "api",
          code: "server",
          togetherCode: "SESSION_FULL",
          message: "Full",
        }),
      ),
    } as unknown as TogetherCloudApi,
    randomUUID,
    db: {
      execSync: (sql) => db.exec(sql),
      runSync: (sql, params) => db.prepare(sql).run(...params),
      getFirstSync: <T,>(sql: string, params: (string | number | null)[]) =>
        (db.prepare(sql).get(...params) as T) ?? null,
      getAllSync: <T,>(sql: string, params: (string | number | null)[]) =>
        db.prepare(sql).all(...params) as T[],
      withTransactionSync: (fn) => {
        db.exec("BEGIN");
        try {
          fn();
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    },
  });
  controller.setAccount("u");
  const restore = jest.fn();
  try {
    await expect(
      controller.join({ sessionId: randomUUID() }, h.draft),
    ).rejects.toThrow("SESSION_FULL");
    const r = renderWithTheme(
      <TogetherCloudContainer
        {...h.props}
        cloud={controller}
        onRestorePersonal={restore}
      />,
    );
    fireEvent.press(r.getByText("Open"));
    fireEvent.press(r.getByText("Continue personally"));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(h.draft));
    expect(h.props.onLocal).toHaveBeenCalledTimes(1);
    expect(controller.readDraft("u")).toBeNull();
    r.unmount();
  } finally {
    controller.dispose();
    db.close();
  }
});

it("starts a selected training-partner session once and publishes only after confirmed hosting", async () => {
  const h = setup();
  jest.mocked(h.cloud.hostWorkout).mockImplementation(async () => {
    h.publish({ phase: "active", snapshot: server });
  });
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHostFriends />,
  );
  await waitFor(() => expect(h.cloud.visibility).toHaveBeenCalledTimes(1));
  expect(h.cloud.hostWorkout).toHaveBeenCalledWith(h.draft);
  expect(h.cloud.visibility).toHaveBeenCalledWith(
    "friends",
    expect.any(String),
  );
  r.rerender(<TogetherCloudContainer {...h.props} initialHostFriends />);
  expect(h.cloud.hostWorkout).toHaveBeenCalledTimes(1);
});

it("preserves existing Together authority rather than hosting a second session", () => {
  const h = setup();
  h.draft.together = {
    sessionId: "existing",
    executionId: "own",
  };
  renderWithTheme(<TogetherCloudContainer {...h.props} initialHostFriends />);
  expect(h.cloud.hostWorkout).not.toHaveBeenCalled();
  expect(h.cloud.visibility).not.toHaveBeenCalled();
});

it.each(["account", "unmount", "background", "cancel", "partners"])(
  "does not publish friends visibility after %s interrupts hosting",
  async (reason) => {
    const h = setup();
    let finish!: () => void;
    jest.mocked(h.cloud.hostWorkout).mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const appListener = jest.spyOn(AppState, "addEventListener");
    const r = renderWithTheme(
      <TogetherCloudContainer {...h.props} initialHostFriends />,
    );
    await waitFor(() => expect(h.cloud.hostWorkout).toHaveBeenCalledTimes(1));
    if (reason === "account")
      r.rerender(
        <TogetherCloudContainer
          {...h.props}
          accountId="other"
          initialHostFriends
        />,
      );
    if (reason === "unmount") r.unmount();
    if (reason === "cancel") act(() => ui(r).onCancel());
    if (reason === "partners") act(() => ui(r).onPartners());
    if (reason === "background")
      act(() => {
        appListener.mock.calls.at(-1)![1]("background");
      });
    await act(async () => {
      h.publish({ phase: "active", snapshot: server });
      finish();
    });
    expect(h.cloud.visibility).not.toHaveBeenCalled();
  },
);

it("reports publication failure while retaining the created session", async () => {
  const h = setup();
  jest.mocked(h.cloud.hostWorkout).mockImplementation(async () => {
    h.publish({ phase: "active", snapshot: server });
  });
  jest.mocked(h.cloud.visibility).mockRejectedValue(new Error("offline"));
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHostFriends />,
  );
  await waitFor(() =>
    expect(
      r.getByText(/visibility to training partners is not confirmed/),
    ).toBeTruthy(),
  );
  expect(h.state().snapshot?.sessionId).toBe(server.sessionId);
  expect(h.cloud.cancel).not.toHaveBeenCalled();
});

it("does not publish a training-partner session before hosting is confirmed", async () => {
  const h = setup();
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHostFriends />,
  );
  await waitFor(() =>
    expect(r.getByText(/Your session has not been confirmed/)).toBeTruthy(),
  );
  expect(h.cloud.visibility).not.toHaveBeenCalled();
  act(() => ui(r).onRetry());
  await waitFor(() => expect(h.cloud.retry).toHaveBeenCalledTimes(1));
  expect(h.cloud.hostWorkout).toHaveBeenCalledTimes(1);
});

it("shows the actual online invitation after confirmed Start and retries invitation failure without hosting twice", async () => {
  const h = setup();
  jest.mocked(h.cloud.hostWorkout).mockImplementation(async () => {
    h.publish({ phase: "active", snapshot: server });
  });
  jest.mocked(h.cloud.invite).mockRejectedValueOnce(new Error("network"));
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHostFriends />,
  );
  await waitFor(() =>
    expect(r.getByText("Generate new invitation")).toBeTruthy(),
  );
  await waitFor(() =>
    expect(r.getByText(/invitation is not ready/)).toBeTruthy(),
  );
  expect(r.queryByText("Scan to join")).toBeNull();
  await act(async () => {
    fireEvent.press(r.getByText("Generate new invitation"));
  });
  await waitFor(() => expect(r.getByText("Scan to join")).toBeTruthy());
  expect(h.cloud.hostWorkout).toHaveBeenCalledTimes(1);
  expect(h.cloud.invite).toHaveBeenCalledTimes(2);
  expect(r.UNSAFE_getByType(QRCode).props.value).toBe(
    "persistencemobile://together/join?connection=online&invitation=invite",
  );
  expect(r.getByText(/Scan from Online join/)).toBeTruthy();
  fireEvent.press(r.getByText("Copy"));
  await waitFor(() =>
    expect(mockCopy).toHaveBeenCalledWith(
      "persistencemobile://together/join?connection=online&invitation=invite",
    ),
  );
  const share = jest
    .spyOn(Share, "share")
    .mockResolvedValue({ action: Share.sharedAction });
  fireEvent.press(r.getByText("Share"));
  await waitFor(() =>
    expect(share).toHaveBeenCalledWith({
      url: "persistencemobile://together/join?connection=online&invitation=invite",
    }),
  );
  share.mockRestore();
  fireEvent.press(r.getByText("Back to my workout"));
  expect(r.queryByText("Scan to join")).toBeNull();
  expect(h.cloud.getSnapshot().phase).toBe("active");
  expect(h.cloud.cancel).not.toHaveBeenCalled();
  fireEvent.press(r.getByLabelText("Together settings"));
  expect(r.getByText("Scan to join")).toBeTruthy();
  fireEvent.press(r.getByText("Session settings"));
  expect(ui(r)).toBeDefined();
});
it("scans an online token but requires a deliberate Join and handles camera denial", async () => {
  const h = setup();
  mockCameraPermission
    .mockResolvedValueOnce({ granted: false })
    .mockResolvedValue({ granted: true });
  const r = renderWithTheme(<TogetherCloudContainer {...h.props} />);
  fireEvent.press(r.getByText("Open"));
  fireEvent.press(r.getByText("Scan online invitation"));
  await waitFor(() =>
    expect(r.getByText(/Camera permission is needed/)).toBeTruthy(),
  );
  fireEvent.press(r.getByText("Scan online invitation"));
  await waitFor(() =>
    expect(r.getByTestId("together-online-qr-camera")).toBeTruthy(),
  );
  act(() =>
    r
      .getByTestId("together-online-qr-camera")
      .props.onBarcodeScanned({ data: "server-token" }),
  );
  expect(h.cloud.join).not.toHaveBeenCalled();
  expect(ui(r).code).toBe("server-token");
  await act(async () => ui(r).onJoin());
  expect(h.cloud.join).toHaveBeenCalledWith(
    { inviteToken: "server-token" },
    h.draft,
  );
});
it("does not publish a late generated invitation or scan after lifecycle interruption", async () => {
  const h = setup();
  jest.mocked(h.cloud.hostWorkout).mockImplementation(async () => {
    h.publish({ phase: "active", snapshot: server });
  });
  let resolve!: (
    value: Awaited<ReturnType<TogetherCloudPort["invite"]>>,
  ) => void;
  jest.mocked(h.cloud.invite).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const listener = jest.spyOn(AppState, "addEventListener");
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHostFriends />,
  );
  await waitFor(() => expect(h.cloud.invite).toHaveBeenCalledTimes(1));
  act(() => listener.mock.calls.at(-1)![1]("background"));
  await act(async () =>
    resolve({
      tokenId: "late",
      token: "late-secret",
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    }),
  );
  expect(r.queryByText("Scan to join")).toBeNull();
  r.unmount();
  const join = setup();
  mockCameraPermission.mockResolvedValue({ granted: true });
  const page = renderWithTheme(<TogetherCloudContainer {...join.props} />);
  fireEvent.press(page.getByText("Open"));
  fireEvent.press(page.getByText("Scan online invitation"));
  await waitFor(() =>
    expect(page.getByTestId("together-online-qr-camera")).toBeTruthy(),
  );
  const scan = page.getByTestId("together-online-qr-camera").props
    .onBarcodeScanned;
  act(() => listener.mock.calls.at(-1)![1]("background"));
  act(() => scan({ data: "late-secret" }));
  expect(ui(page).code).toBe("");
  expect(join.cloud.join).not.toHaveBeenCalled();
});

it("invalidates the single-use invitation after admission and after expiry", async () => {
  const h = setup();
  jest.mocked(h.cloud.hostWorkout).mockImplementation(async () => {
    h.publish({ phase: "active", snapshot: server });
  });
  const r = renderWithTheme(
    <TogetherCloudContainer {...h.props} initialHostFriends />,
  );
  await waitFor(() => expect(r.getByText("Scan to join")).toBeTruthy());
  act(() =>
    h.publish({
      snapshot: {
        ...server,
        participants: [
          ...server.participants,
          { ...server.participants[1], userId: "new-athlete" },
        ],
      },
    }),
  );
  await waitFor(() => expect(r.queryByText("Scan to join")).toBeNull());
  expect(r.getByText("Generate new invitation")).toBeTruthy();
  jest.mocked(h.cloud.invite).mockResolvedValue({
    tokenId: "next",
    token: "new-invite",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  await act(async () => {
    fireEvent.press(r.getByText("Generate new invitation"));
  });
  await waitFor(() => expect(r.getByText("Scan to join")).toBeTruthy());
  expect(h.cloud.hostWorkout).toHaveBeenCalledTimes(1);
  const now = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);
  fireEvent.press(r.getByText("Copy"));
  await waitFor(() => expect(r.queryByText("Scan to join")).toBeNull());
  expect(mockCopy).not.toHaveBeenCalledWith("new-invite");
  now.mockRestore();
});
it("removes the QR automatically when its server expiry is reached", async () => {
  jest.useFakeTimers();
  try {
    const h = setup();
    jest.mocked(h.cloud.hostWorkout).mockImplementation(async () => {
      h.publish({ phase: "active", snapshot: server });
    });
    jest.mocked(h.cloud.invite).mockResolvedValue({
      tokenId: "short",
      token: "short-lived",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const r = renderWithTheme(
      <TogetherCloudContainer {...h.props} initialHostFriends />,
    );
    await waitFor(() => expect(r.getByText("Scan to join")).toBeTruthy());
    act(() => jest.advanceTimersByTime(60_000));
    expect(r.queryByText("Scan to join")).toBeNull();
    expect(r.getByText("Generate new invitation")).toBeTruthy();
    expect(h.cloud.invite).toHaveBeenCalledTimes(1);
    r.unmount();
  } finally {
    jest.useRealTimers();
  }
});
