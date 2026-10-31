import { reportTogetherFailure, resetTogetherReports } from "../togetherReport";

const mockCapture = jest.fn();
let mockSentryOn = true;
jest.mock("@/lib/sentry", () => ({
  isSentryEnabled: () => mockSentryOn,
  Sentry: {
    captureMessage: (...args: unknown[]) => mockCapture(...args),
    addBreadcrumb: jest.fn(),
  },
}));

beforeEach(() => {
  mockCapture.mockReset();
  mockSentryOn = true;
  resetTogetherReports();
});

it("sends one event per code with mode, stage, code and copy tags and a stable fingerprint", () => {
  reportTogetherFailure({
    mode: "lan",
    stage: "join",
    code: "Local sharing closed",
  });
  expect(mockCapture).toHaveBeenCalledWith(
    "Together join failed: Local sharing closed",
    {
      level: "warning",
      fingerprint: ["together-failure", "lan", "join", "Local sharing closed"],
      tags: {
        "together.mode": "lan",
        "together.stage": "join",
        "together.code": "Local sharing closed",
        "together.copy": "specific",
      },
    },
  );
  // The same failure again in this run is not sent twice.
  reportTogetherFailure({
    mode: "lan",
    stage: "join",
    code: "Local sharing closed",
  });
  expect(mockCapture).toHaveBeenCalledTimes(1);
  // A code with no copy of its own is tagged as the generic fallback.
  reportTogetherFailure({
    mode: "nearby",
    stage: "connect",
    code: "Member identity changed",
  });
  expect(mockCapture).toHaveBeenLastCalledWith(
    "Together connect failed: Member identity changed",
    expect.objectContaining({
      tags: expect.objectContaining({ "together.copy": "fallback" }),
    }),
  );
  // A caller that knows which copy was shown says so.
  reportTogetherFailure({
    mode: "online",
    stage: "join",
    code: "plan-unavailable",
    copy: "fallback",
  });
  expect(mockCapture).toHaveBeenLastCalledWith(
    "Together join failed: plan-unavailable",
    expect.objectContaining({
      tags: expect.objectContaining({
        "together.mode": "online",
        "together.copy": "fallback",
      }),
    }),
  );
  expect(mockCapture).toHaveBeenCalledTimes(3);
});

it("ignores cancels and host decisions, and sends nothing while Sentry is off", () => {
  for (const code of ["cancelled", "declined", "full", "removed-from-session"])
    reportTogetherFailure({ mode: "nearby", stage: "connect", code });
  expect(mockCapture).not.toHaveBeenCalled();
  mockSentryOn = false;
  reportTogetherFailure({ mode: "nearby", stage: "connect", code: "x" });
  expect(mockCapture).not.toHaveBeenCalled();
});

it("sends no part of a code that is not a plain code", () => {
  reportTogetherFailure({
    mode: "nearby",
    stage: "join",
    code: "invite for sam@example.com token abc/def+==",
  });
  const [message, context] = mockCapture.mock.calls[0];
  expect(message).toBe("Together join failed: unrecognised");
  expect(JSON.stringify([message, context])).not.toMatch(/sam|example|abc/);
  reportTogetherFailure({ mode: "nearby", stage: "join", code: "" });
  expect(mockCapture.mock.calls[1][0]).toBe("Together join failed: unknown");
});

it("never lets a reporting failure escape", () => {
  mockCapture.mockImplementationOnce(() => {
    throw new Error("transport down");
  });
  expect(() =>
    reportTogetherFailure({ mode: "lan", stage: "discover", code: "x" }),
  ).not.toThrow();
});
