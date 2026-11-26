/**
 * PER-130 — C4f filling in a form: one question per screen, the draft saved
 * as you go, Send queued offline, photos uploaded first (needs a
 * connection), 409 "This check-in is no longer needed" and 422 errors on
 * the questions.
 */
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type {
  AthleteFormRequest,
  LocalFormState,
} from "@/domain/models/athleteForms";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import {
  CHECK_ANSWERS,
  FormFillContainer,
  PHOTOS_NEED_CONNECTION,
  PHOTO_UNREADABLE,
  SEND_FAILED,
} from "../FormFillContainer";

jest.mock("@/lib/sentry", () => ({ captureSyncFailure: jest.fn() }));
jest.mock("expo-crypto", () => {
  let n = 0;
  return { randomUUID: () => `uuid-${++n}` };
});
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(async () => ({ uri: "file://resized.jpg" })),
  SaveFormat: { JPEG: "jpeg" },
}));
const mockPick = jest.fn<Promise<string | null>, []>();
jest.mock("@/ui/hooks/formPhotoPicker", () => ({
  pickFormPhoto: () => mockPick(),
}));

const mockParams: { id: string; then?: string } = { id: "req-1" };
const mockRouter = {
  back: jest.fn(),
  replace: jest.fn(),
  push: jest.fn(),
  canGoBack: jest.fn(() => true),
};
jest.mock("expo-router", () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const USER = "athlete-1";

function request(
  id: string,
  extra: Partial<AthleteFormRequest> = {},
): AthleteFormRequest {
  return {
    id,
    formId: `f-${id}`,
    title: "Weekly check-in",
    description: null,
    coach: { id: "ellie", name: "Ellie Hart" },
    trigger: "weekly",
    periodKey: "p",
    sentAt: "2026-11-23T09:00:00Z",
    dueAt: null,
    closesAt: null,
    status: "pending",
    late: false,
    version: {
      id: "v",
      version: 1,
      questions: [
        {
          id: "energy",
          type: "scale",
          prompt: "Energy this week",
          required: true,
        },
        {
          id: "weight",
          type: "number",
          prompt: "Weight",
          required: false,
          min: 30,
          max: 300,
          unit: "kg",
          help: "Morning, before breakfast.",
        },
      ],
    },
    ...extra,
  };
}

const PHOTO_REQUEST = request("req-1", {
  version: {
    id: "v",
    version: 1,
    questions: [
      { id: "front", type: "photo", prompt: "Front photo", required: true },
    ],
  },
});

let fetchMock: jest.Mock;

function setup(opts: {
  requests?: AthleteFormRequest[];
  locals?: LocalFormState[];
  online?: boolean;
  noCache?: boolean;
  storage?: InMemoryStorageAdapter;
}) {
  const api = new InMemoryApiAdapter();
  const requests = opts.requests ?? [request("req-1")];
  api.formRequests = { requests, asOf: "a" };
  const storage = opts.storage ?? new InMemoryStorageAdapter();
  if (!opts.noCache) storage.cacheFormRequests(USER, { requests, asOf: "a" });
  for (const l of opts.locals ?? []) storage.saveLocalFormState(USER, l);
  const netInfo = new InMemoryNetInfoAdapter(opts.online ?? true);
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "a@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo,
  };
  const utils = renderWithTheme(
    <AdapterProvider adapters={adapters}>
      <FormFillContainer />
    </AdapterProvider>,
  );
  const local = () =>
    storage.getLocalFormStates(USER).find((l) => l.requestId === "req-1");
  return { api, storage, netInfo, local, ...utils };
}

beforeEach(() => {
  mockParams.id = "req-1";
  delete mockParams.then;
  for (const fn of Object.values(mockRouter)) fn.mockClear();
  mockRouter.canGoBack.mockReturnValue(true);
  mockPick.mockReset();
  fetchMock = jest.fn(async (url: string) => {
    if (url.startsWith("file://")) {
      return { ok: true, status: 200, blob: async () => ({ size: 2048 }) };
    }
    return {
      ok: true,
      status: 201,
      text: async () => "{}",
      json: async () => ({ data: {} }),
    };
  });
  (globalThis as Record<string, unknown>).fetch = fetchMock;
});

describe("FormFillContainer (C4f)", () => {
  it("one question per screen: progress, required gate, Back and Next", async () => {
    const utils = setup({});
    await act(async () => {});
    expect(utils.getByText("Weekly check-in · 1 of 2")).toBeTruthy();
    expect(utils.getByText("Energy this week")).toBeTruthy();
    expect(
      utils.getByTestId("form-fill-next").props.accessibilityState,
    ).toMatchObject({
      disabled: true,
    });

    fireEvent.press(utils.getByTestId("form-fill-answer-scale-4"));
    await act(async () => {});
    fireEvent.press(utils.getByTestId("form-fill-next"));
    await act(async () => {});
    expect(utils.getByText("Weekly check-in · 2 of 2")).toBeTruthy();
    expect(utils.getByText("Morning, before breakfast.")).toBeTruthy();
    expect(utils.getByText("Send")).toBeTruthy();

    fireEvent.press(utils.getByTestId("form-fill-back"));
    expect(utils.getByText("Weekly check-in · 1 of 2")).toBeTruthy();
    fireEvent.press(utils.getByTestId("form-fill-back"));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("an answer outside the coach's range shows the form's message and holds", async () => {
    const utils = setup({
      locals: [localState({ answers: { q0: 4 }, step: 1 })],
    });
    await act(async () => {});
    fireEvent.changeText(utils.getByTestId("form-fill-answer-number"), "12");
    await act(async () => {});
    expect(utils.getByTestId("form-fill-error").props.children).toBe(
      "Enter 30 or more.",
    );
    fireEvent.press(utils.getByTestId("form-fill-next"));
    await act(async () => {});
    expect(utils.local()?.submittedAt).toBeNull();
  });

  it("saves the draft as you go and carries on from it", async () => {
    const utils = setup({});
    await act(async () => {});
    expect(utils.queryByTestId("form-fill-saved")).toBeNull();
    fireEvent.press(utils.getByTestId("form-fill-answer-scale-3"));
    await waitFor(() =>
      expect(utils.getByTestId("form-fill-saved")).toBeTruthy(),
    );
    expect(utils.local()?.answers.q0).toBe(3);
  });

  it("Send with no photos queues it (works offline) and goes back", async () => {
    const utils = setup({
      online: false,
      locals: [localState({ answers: { q0: 4, q1: "82,5" }, step: 1 })],
    });
    await act(async () => {});
    fireEvent.press(utils.getByTestId("form-fill-next"));
    await act(async () => {});
    expect(mockRouter.back).toHaveBeenCalled();
    expect(utils.local()?.submittedAt).not.toBeNull();
    // Drained straight away (the fetch mock accepts it).
    await waitFor(() => expect(utils.local()?.sentAt).not.toBeNull());
    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/users/me/form-requests/req-1/response"),
    );
    expect(JSON.parse(call![1].body)).toEqual({
      answers: { energy: 4, weight: 82.5 },
    });
    expect(call![1].headers["Idempotency-Key"]).toBeTruthy();
  });

  it("a joining form carries on to the next one", async () => {
    mockParams.then = "joining";
    const utils = setup({
      requests: [
        request("req-1", { trigger: "on_join" }),
        request("req-2", { trigger: "on_join" }),
      ],
      locals: [localState({ answers: { q0: 4 }, step: 1, trigger: "on_join" })],
    });
    await act(async () => {});
    fireEvent.press(utils.getByTestId("form-fill-next"));
    await act(async () => {});
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: "/(app)/forms/[id]",
      params: { id: "req-2", then: "joining" },
    });
  });

  it("photos: needs a connection to send", async () => {
    mockPick.mockResolvedValue("file://front.jpg");
    const utils = setup({ requests: [PHOTO_REQUEST], online: false });
    await act(async () => {});
    fireEvent.press(utils.getByTestId("form-fill-answer-photo-add"));
    await act(async () => {});
    expect(utils.getByTestId("form-fill-answer-photo-image")).toBeTruthy();
    fireEvent.press(utils.getByTestId("form-fill-next"));
    await act(async () => {});
    expect(utils.getByText(PHOTOS_NEED_CONNECTION)).toBeTruthy();
    expect(utils.api.createFormAnswerUploadCalls).toEqual([]);
    expect(mockRouter.back).not.toHaveBeenCalled();
  });

  it("photos online: uploads first, then sends, then goes back", async () => {
    mockPick.mockResolvedValue("file://front.jpg");
    const utils = setup({ requests: [PHOTO_REQUEST] });
    await act(async () => {});
    fireEvent.press(utils.getByTestId("form-fill-answer-photo-add"));
    await act(async () => {});
    fireEvent.press(utils.getByTestId("form-fill-next"));
    await act(async () => {});
    expect(utils.api.createFormAnswerUploadCalls).toHaveLength(1);
    expect(utils.api.putPresignedUploadCalls).toHaveLength(1);
    expect(utils.api.submitFormResponseCalls[0]!.answers).toEqual({
      front: { mediaId: "media-1" },
    });
    expect(mockRouter.back).toHaveBeenCalled();
    expect(utils.local()?.sentAt).not.toBeNull();
  });

  it("photos: a failed send keeps the answers and says so; retake works", async () => {
    mockPick.mockResolvedValue("file://front.jpg");
    const utils = setup({ requests: [PHOTO_REQUEST] });
    utils.api.submitFormResponseResults.push(
      fail({ kind: "api", code: "network", message: "x" }),
    );
    await act(async () => {});
    fireEvent.press(utils.getByTestId("form-fill-answer-photo-add"));
    await act(async () => {});
    fireEvent.press(utils.getByTestId("form-fill-next"));
    await act(async () => {});
    expect(utils.getByText(SEND_FAILED)).toBeTruthy();
    expect(mockRouter.back).not.toHaveBeenCalled();

    // Retry: the uploaded photo isn't uploaded again.
    fireEvent.press(utils.getByTestId("form-fill-next"));
    await act(async () => {});
    expect(utils.api.createFormAnswerUploadCalls).toHaveLength(1);
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it("photos: an unreadable photo asks for it again", async () => {
    mockPick.mockResolvedValue("file://front.jpg");
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      blob: async () => ({ size: 0 }),
    }));
    const utils = setup({ requests: [PHOTO_REQUEST] });
    await act(async () => {});
    fireEvent.press(utils.getByTestId("form-fill-answer-photo-add"));
    await act(async () => {});
    fireEvent.press(utils.getByTestId("form-fill-next"));
    await act(async () => {});
    expect(utils.getByText(PHOTO_UNREADABLE)).toBeTruthy();
  });

  it("photos: 409 request_closed shows 'This check-in is no longer needed'", async () => {
    mockPick.mockResolvedValue("file://front.jpg");
    const utils = setup({ requests: [PHOTO_REQUEST] });
    utils.api.submitFormResponseResults.push(
      ok({ status: 409, json: { code: "request_closed" } }),
    );
    await act(async () => {});
    fireEvent.press(utils.getByTestId("form-fill-answer-photo-add"));
    await act(async () => {});
    fireEvent.press(utils.getByTestId("form-fill-next"));
    await act(async () => {});
    expect(utils.getByTestId("form-fill-closed")).toBeTruthy();
    expect(utils.getByText("This check-in is no longer needed")).toBeTruthy();
  });

  it("photos: 422 puts the server's errors on the question", async () => {
    mockPick.mockResolvedValue("file://front.jpg");
    const utils = setup({ requests: [PHOTO_REQUEST] });
    utils.api.submitFormResponseResults.push(
      ok({
        status: 422,
        json: {
          code: "invalid_answers",
          errors: [{ at: "front", message: "must be a photo you uploaded" }],
        },
      }),
    );
    await act(async () => {});
    fireEvent.press(utils.getByTestId("form-fill-answer-photo-add"));
    await act(async () => {});
    fireEvent.press(utils.getByTestId("form-fill-next"));
    await act(async () => {});
    expect(utils.getByText(CHECK_ANSWERS)).toBeTruthy();
    expect(utils.getByTestId("form-fill-error").props.children).toBe(
      "Check this answer.",
    );
  });

  it("a queued send the server refused opens with its errors, on that question", async () => {
    const utils = setup({
      locals: [
        localState({
          answers: { q0: 4, q1: "500" },
          step: 0,
          rejected: {
            status: 422,
            json: {
              code: "invalid_answers",
              errors: [{ at: "weight", message: "must be at most 300" }],
            },
          },
        }),
      ],
    });
    await act(async () => {});
    expect(utils.getByText("Weekly check-in · 2 of 2")).toBeTruthy();
    expect(utils.getByText(CHECK_ANSWERS)).toBeTruthy();
    expect(utils.getByTestId("form-fill-error")).toBeTruthy();
  });

  it("a form closed on the server, or gone, says it's no longer needed", async () => {
    const closed = setup({ locals: [localState({ closed: true })] });
    await act(async () => {});
    expect(closed.getByTestId("form-fill-closed")).toBeTruthy();
    closed.unmount();

    mockParams.id = "gone";
    const missing = setup({});
    await act(async () => {});
    expect(missing.getByTestId("form-fill-missing")).toBeTruthy();
    fireEvent.press(missing.getByText("Back to Coach"));
    expect(mockRouter.back).toHaveBeenCalled();
    missing.unmount();

    mockRouter.canGoBack.mockReturnValue(false);
    const noBack = setup({});
    await act(async () => {});
    fireEvent.press(noBack.getByTestId("form-fill-close"));
    expect(mockRouter.replace).toHaveBeenCalledWith("/(app)/(tabs)/coach");
  });

  it("a form waiting to send opens read-only, with no Send (Inspector Brad, #571)", async () => {
    // Offline, so the mount-time refresh can't drain the row.
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Network request failed");
    });
    const utils = setup({
      locals: [
        localState({ answers: { q0: 4 }, submittedAt: "2026-11-26T08:12:00Z" }),
      ],
    });
    utils.storage.enqueueMutation({
      entityType: "form_response",
      entityId: `${USER}:req-1`,
      operation: "create",
      payload: { answers: { energy: 4 } },
      endpoint: "/users/me/form-requests/req-1/response",
      method: "POST",
    });
    utils.unmount();
    // Remount with the live row in place.
    const again = setup({ storage: utils.storage });
    await act(async () => {});
    expect(again.getByTestId("form-fill-waiting")).toBeTruthy();
    expect(again.getByText("Waiting to send")).toBeTruthy();
    expect(again.queryByTestId("form-fill-next")).toBeNull();
  });

  it("once its queue row is dead, it's fillable again with its answers", async () => {
    const utils = setup({
      locals: [
        localState({ answers: { q0: 4 }, submittedAt: "2026-11-26T08:12:00Z" }),
      ],
    });
    await act(async () => {});
    expect(utils.queryByTestId("form-fill-waiting")).toBeNull();
    expect(utils.getByText("Weekly check-in · 1 of 2")).toBeTruthy();
    expect(
      utils.getByTestId("form-fill-answer-scale-4").props.accessibilityState,
    ).toMatchObject({ selected: true });
  });

  it("nothing cached yet: waits for the list (loading), then shows the form", async () => {
    const utils = setup({ noCache: true });
    expect(utils.getByTestId("form-fill-loading")).toBeTruthy();
    await act(async () => {});
    await waitFor(() =>
      expect(utils.getByText("Energy this week")).toBeTruthy(),
    );
  });
});

function localState(extra: Partial<LocalFormState> = {}): LocalFormState {
  return {
    requestId: "req-1",
    title: "Weekly check-in",
    coachId: "ellie",
    trigger: "weekly",
    answers: {},
    step: 0,
    updatedAt: "2026-11-26T08:00:00Z",
    submittedAt: null,
    sentAt: null,
    closed: false,
    rejected: null,
    submitKey: null,
    uploadKeys: {},
    introSeen: false,
    ...extra,
  };
}
