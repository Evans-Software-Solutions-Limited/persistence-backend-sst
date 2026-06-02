import { act, fireEvent } from "@testing-library/react-native";
import React from "react";
import { Alert } from "react-native";

import * as createExerciseCommandModule from "@/application/commands/create-exercise.command";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useExerciseLibrary } from "@/ui/hooks/useExerciseLibrary";
import { CreateExerciseSheetContainer } from "@/ui/containers/CreateExerciseSheetContainer";
import { renderWithTheme } from "../../../../__tests__/test-utils";

function makeAdapters(
  storage: InMemoryStorageAdapter,
  sessionOverride: AuthSession | null = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  },
): Adapters {
  const auth = {
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    signInWithOAuth: jest.fn(),
    signOut: jest.fn(),
    getSession: jest.fn(async () => ok(sessionOverride)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(sessionOverride);
      return () => {};
    }),
    resetPassword: jest.fn(),
    refreshSession: jest.fn(),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api: new InMemoryApiAdapter(),
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function withAdapters(adapters: Adapters, ui: React.ReactElement) {
  return <AdapterProvider adapters={adapters}>{ui}</AdapterProvider>;
}

describe("CreateExerciseSheetContainer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useExerciseLibrary.setState({ revision: 0 });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("creates a custom exercise: local cache + queued POST + library signal", async () => {
    jest.useFakeTimers();
    const storage = new InMemoryStorageAdapter();
    const onClose = jest.fn();
    const { getByTestId } = renderWithTheme(
      withAdapters(
        makeAdapters(storage),
        <CreateExerciseSheetContainer visible onClose={onClose} />,
      ),
    );

    fireEvent.changeText(getByTestId("exercise-form-name"), "Incline Press");
    fireEvent.press(getByTestId("exercise-form-primary-Back"));
    fireEvent.press(getByTestId("exercise-form-equipment-Dumbbell"));
    await act(async () => {
      fireEvent.press(getByTestId("create-exercise-save"));
    });

    const cached = storage.getCachedExercises();
    expect(cached).toHaveLength(1);
    expect(cached[0]).toMatchObject({
      name: "Incline Press",
      isCustom: true,
      createdBy: "user-1",
      category: "strength",
      primaryMuscleGroups: ["back", "lats"],
      equipment: ["dumbbell"],
    });
    expect(cached[0].id.startsWith("local-")).toBe(true);

    const queue = storage.getPendingMutations();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      entityType: "exercise",
      operation: "create",
      endpoint: "/exercises",
      method: "POST",
    });

    expect(useExerciseLibrary.getState().revision).toBe(1);

    act(() => {
      jest.advanceTimersByTime(700);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("blocks save when signed out and warns the user", async () => {
    const storage = new InMemoryStorageAdapter();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const onClose = jest.fn();
    const { getByTestId } = renderWithTheme(
      withAdapters(
        makeAdapters(storage, null),
        <CreateExerciseSheetContainer visible onClose={onClose} />,
      ),
    );

    fireEvent.changeText(getByTestId("exercise-form-name"), "Incline Press");
    await act(async () => {
      fireEvent.press(getByTestId("create-exercise-save"));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      "Sign in required",
      expect.any(String),
    );
    expect(storage.getCachedExercises()).toHaveLength(0);
    expect(useExerciseLibrary.getState().revision).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("surfaces a domain validation failure without persisting", async () => {
    const storage = new InMemoryStorageAdapter();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const onClose = jest.fn();
    const { getByTestId } = renderWithTheme(
      withAdapters(
        makeAdapters(storage),
        <CreateExerciseSheetContainer visible onClose={onClose} />,
      ),
    );

    // One non-blank char passes the Save-disabled guard but fails the
    // domain's min-2-char name rule.
    fireEvent.changeText(getByTestId("exercise-form-name"), "A");
    await act(async () => {
      fireEvent.press(getByTestId("create-exercise-save"));
    });

    expect(alertSpy).toHaveBeenCalledWith("Invalid input", expect.any(String));
    expect(storage.getCachedExercises()).toHaveLength(0);
    expect(useExerciseLibrary.getState().revision).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("falls back to a generic message when the error carries no fields", async () => {
    const storage = new InMemoryStorageAdapter();
    const alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    // A defensive guard: the real command always attaches >=1 field, so force
    // the empty-fields shape to exercise the fallback message branch.
    jest
      .spyOn(createExerciseCommandModule, "createExerciseCommand")
      .mockReturnValue({
        ok: false,
        error: { kind: "validation", fields: {} },
      });
    const onClose = jest.fn();
    const { getByTestId } = renderWithTheme(
      withAdapters(
        makeAdapters(storage),
        <CreateExerciseSheetContainer visible onClose={onClose} />,
      ),
    );

    fireEvent.changeText(getByTestId("exercise-form-name"), "Incline Press");
    await act(async () => {
      fireEvent.press(getByTestId("create-exercise-save"));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      "Invalid input",
      "Failed to save exercise",
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
